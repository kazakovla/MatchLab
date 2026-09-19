import { Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Inject } from '@nestjs/common';

import matchesConfig from './matches.config';
import { PrismaService } from '../prisma/prisma.service';
import { externalKey, parseFixturesCsv, ParsedFixture } from './fixtures.parser';

export interface IngestResult {
  fetchedRows: number;
  parsed: number;
  upserted: number;
  unknownTeams: string[];
  skipped: {
    otherLeague: number;
    badDate: number;
    noTeams: number;
    unresolvedTeam: number;
  };
}

/**
 * Загрузка расписания из внешнего источника в нашу базу.
 *
 * Вызывается задачей BullMQ по расписанию и вручную из админ-панели.
 * Операция идемпотентна: файл источника перезаписывается целиком, поэтому
 * повторный прогон должен обновлять существующие матчи, а не создавать копии.
 */
@Injectable()
export class FixturesIngestService {
  private readonly logger = new Logger(FixturesIngestService.name);
  private static readonly SOURCE = 'football-data.co.uk';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(matchesConfig.KEY)
    private readonly config: ConfigType<typeof matchesConfig>,
  ) {}

  async ingest(): Promise<IngestResult> {
    const csv = await this.fetchCsv(this.config.fixturesUrl);

    const { fixtures, report } = parseFixturesCsv(csv, {
      leagueCodes: this.config.leagueCodes,
      sourceTimeZone: this.config.sourceTimeZone,
    });

    const aliasMap = await this.loadAliasMap();

    const unknownTeams = new Set<string>();
    let upserted = 0;
    let unresolvedTeam = 0;

    for (const f of fixtures) {
      const homeId = aliasMap.get(this.aliasKey(f.leagueCode, f.homeTeamRaw));
      const awayId = aliasMap.get(this.aliasKey(f.leagueCode, f.awayTeamRaw));

      // Матч с неопознанной командой не пишем: иначе в расписании появится
      // строка, которая никогда не сойдётся с угловым индексом и таблицей.
      if (!homeId || !awayId) {
        if (!homeId) unknownTeams.add(`${f.leagueCode}: ${f.homeTeamRaw}`);
        if (!awayId) unknownTeams.add(`${f.leagueCode}: ${f.awayTeamRaw}`);
        unresolvedTeam += 1;
        continue;
      }

      await this.upsertFixture(f, homeId, awayId);
      upserted += 1;
    }

    if (unknownTeams.size > 0) {
      // Это рабочая ситуация при смене состава лиги, но она требует внимания:
      // пока алиас не заведён, матчи такой команды в расписании не появятся.
      this.logger.warn(
        `не сопоставлены с нашим справочником: ${Array.from(unknownTeams).join('; ')}`,
      );
    }

    const result: IngestResult = {
      fetchedRows: report.rowsTotal,
      parsed: report.rowsParsed,
      upserted,
      unknownTeams: Array.from(unknownTeams),
      skipped: {
        otherLeague: report.rowsSkippedOtherLeague,
        badDate: report.rowsSkippedBadDate,
        noTeams: report.rowsSkippedNoTeams,
        unresolvedTeam,
      },
    };

    this.logger.log(
      `расписание обновлено: строк ${result.fetchedRows}, разобрано ${result.parsed}, ` +
        `записано ${result.upserted}, не сопоставлено ${unresolvedTeam}`,
    );

    return result;
  }

  private aliasKey(leagueCode: string, alias: string): string {
    return `${leagueCode}|${alias.toLowerCase().replace(/\s+/g, ' ').trim()}`;
  }

  private async loadAliasMap(): Promise<Map<string, string>> {
    const aliases = await this.prisma.teamAlias.findMany({
      where: { source: FixturesIngestService.SOURCE },
      select: { alias: true, teamId: true, team: { select: { leagueCode: true } } },
    });

    const map = new Map<string, string>();
    for (const a of aliases) {
      map.set(this.aliasKey(a.team.leagueCode, a.alias), a.teamId);
    }
    return map;
  }

  private async upsertFixture(f: ParsedFixture, homeTeamId: string, awayTeamId: string) {
    const key = externalKey(FixturesIngestService.SOURCE, f);
    const data = {
      source: FixturesIngestService.SOURCE,
      leagueCode: f.leagueCode,
      kickoffAt: f.kickoffAt,
      kickoffTimeKnown: f.kickoffTimeKnown,
      homeTeamId,
      awayTeamId,
    };

    await this.prisma.fixture.upsert({
      where: { externalKey: key },
      // Статус и счёт при обновлении расписания не трогаем: их ведёт
      // отдельный процесс, и затирать результат сыгранного матча
      // перезалитым расписанием нельзя.
      update: {
        kickoffAt: data.kickoffAt,
        kickoffTimeKnown: data.kickoffTimeKnown,
        leagueCode: data.leagueCode,
      },
      create: { externalKey: key, ...data },
    });
  }

  private async fetchCsv(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'MatchLab/1.0 (+fixtures-ingest)' },
      });
      if (!res.ok) {
        throw new Error(`источник расписания ответил ${res.status}`);
      }
      // Файлы источника отдаются в cp1252; латиница в названиях команд
      // при этом читается корректно, а редкие диакритические знаки
      // декодируются с заменой, что для сопоставления по алиасам достаточно.
      const buf = await res.arrayBuffer();
      return new TextDecoder('windows-1252').decode(buf);
    } finally {
      clearTimeout(timeout);
    }
  }
}
