import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import matchesConfig from './matches.config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { dateKeyInZone, dayBoundsUtc } from './time.util';
import { rankUpcoming, resolveMatchday, TeamIndex } from './selection.util';
import { MatchDto, MatchdayResponseDto, UpcomingResponseDto } from './dto/match.dto';

interface FixtureRow {
  id: string;
  leagueCode: string;
  kickoffAt: Date;
  kickoffTimeKnown: boolean;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: { id: string; name: string; slug: string; crestUrl: string | null };
  awayTeam: { id: string; name: string; slug: string; crestUrl: string | null };
}

const LEAGUE_NAMES: Record<string, string> = {
  E0: 'Английская Премьер-лига',
  SP1: 'Ла Лига',
  I1: 'Серия А',
  D1: 'Бундеслига',
  F1: 'Лига 1',
};

@Injectable()
export class MatchesService {
  private readonly logger = new Logger(MatchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(matchesConfig.KEY)
    private readonly config: ConfigType<typeof matchesConfig>,
  ) {}

  /**
   * Блок «Ближайшие матчи»: и виджет на главной, и раздел из бокового меню.
   * Разница между ними только в лимите, поэтому эндпоинт один.
   */
  async getUpcoming(limit?: number, now: Date = new Date()): Promise<UpcomingResponseDto> {
    const take = this.clampLimit(limit ?? this.config.widgetLimit, 1, 50);
    const cacheKey = `matches:upcoming:${take}:${dateKeyInZone(now, this.config.serviceTimeZone)}:${now.getUTCHours()}`;

    const cached = await this.redis.getJson<UpcomingResponseDto>(cacheKey);
    if (cached) return cached;

    const to = new Date(now.getTime() + this.config.upcomingWindowDays * 86_400_000);
    const [fixtures, indices] = await Promise.all([
      this.findFixtures(now, to),
      this.loadLatestIndices(),
    ]);

    const ranked = rankUpcoming(fixtures, indices, {
      topPerLeague: this.config.topTeamsPerLeague,
      limit: take,
    });

    const response: UpcomingResponseDto = {
      generatedAt: now.toISOString(),
      // Отбор по индексу — продуктовое правило, и интерфейсу полезно знать
      // его параметры, чтобы честно подписать блок.
      selection: {
        rule: 'top-per-league',
        topTeamsPerLeague: this.config.topTeamsPerLeague,
        windowDays: this.config.upcomingWindowDays,
      },
      items: ranked.map((r) =>
        this.toDto(
          fixtures.find((f) => f.id === r.fixture.id) as FixtureRow,
          indices,
          r.highlightedTeamIds,
        ),
      ),
    };

    await this.redis.setJson(cacheKey, response, this.config.cacheTtlSeconds);
    return response;
  }

  /**
   * Страница «Смотреть все»: все матчи игрового дня по нашим пяти лигам,
   * без отбора по индексу — но с его значениями в карточках.
   */
  async getMatchday(dateKey?: string, now: Date = new Date()): Promise<MatchdayResponseDto> {
    const requested = dateKey ?? dateKeyInZone(now, this.config.serviceTimeZone);
    const cacheKey = `matches:matchday:${requested}`;

    const cached = await this.redis.getJson<MatchdayResponseDto>(cacheKey);
    if (cached) return cached;

    const { from } = dayBoundsUtc(requested, this.config.serviceTimeZone);
    const searchTo = new Date(
      from.getTime() + this.config.matchdayLookaheadDays * 86_400_000,
    );

    // Сначала ищем, какие игровые дни вообще есть в окне: запрошенный день
    // может оказаться пустым — пауза на сборные, понедельник.
    const candidates = await this.findFixtures(from, searchTo);
    const dayKeys = candidates.map((f) =>
      dateKeyInZone(f.kickoffAt, this.config.serviceTimeZone),
    );

    const resolved = resolveMatchday(dayKeys, requested);
    if (!resolved) {
      const empty: MatchdayResponseDto = {
        requestedDate: requested,
        date: requested,
        isRequestedDate: true,
        hasMatches: false,
        leagues: [],
        items: [],
      };
      await this.redis.setJson(cacheKey, empty, this.config.cacheTtlSeconds);
      return empty;
    }

    const { from: dayFrom, to: dayTo } = dayBoundsUtc(
      resolved.dateKey,
      this.config.serviceTimeZone,
    );
    const items = candidates.filter(
      (f) => f.kickoffAt >= dayFrom && f.kickoffAt < dayTo,
    );
    const indices = await this.loadLatestIndices();
    const top = new Set(
      rankUpcoming(items, indices, {
        topPerLeague: this.config.topTeamsPerLeague,
        limit: 0,
      }).flatMap((r) => r.highlightedTeamIds),
    );

    const response: MatchdayResponseDto = {
      requestedDate: requested,
      date: resolved.dateKey,
      isRequestedDate: resolved.isRequested,
      hasMatches: items.length > 0,
      leagues: Array.from(new Set(items.map((f) => f.leagueCode))).map((code) => ({
        code,
        name: LEAGUE_NAMES[code] ?? code,
        count: items.filter((f) => f.leagueCode === code).length,
      })),
      items: items
        .sort(
          (a, b) =>
            a.kickoffAt.getTime() - b.kickoffAt.getTime() ||
            a.leagueCode.localeCompare(b.leagueCode),
        )
        .map((f) =>
          this.toDto(
            f,
            indices,
            [f.homeTeamId, f.awayTeamId].filter((id) => top.has(id)),
          ),
        ),
    };

    await this.redis.setJson(cacheKey, response, this.config.cacheTtlSeconds);
    return response;
  }

  /** Сбрасывает кэш после обновления расписания или пересчёта индекса. */
  async invalidateCache(): Promise<void> {
    await this.redis.deleteByPrefix('matches:');
  }

  private clampLimit(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.trunc(value)));
  }

  private findFixtures(from: Date, to: Date): Promise<FixtureRow[]> {
    return this.prisma.fixture.findMany({
      where: {
        leagueCode: { in: this.config.leagueCodes },
        kickoffAt: { gte: from, lt: to },
        status: { in: ['SCHEDULED', 'LIVE'] },
      },
      orderBy: { kickoffAt: 'asc' },
      select: {
        id: true,
        leagueCode: true,
        kickoffAt: true,
        kickoffTimeKnown: true,
        homeTeamId: true,
        awayTeamId: true,
        homeTeam: { select: { id: true, name: true, slug: true, crestUrl: true } },
        awayTeam: { select: { id: true, name: true, slug: true, crestUrl: true } },
      },
    }) as unknown as Promise<FixtureRow[]>;
  }

  /**
   * Последний снимок индекса на каждую команду.
   *
   * Снимки историчны, поэтому берём по одному свежему на команду через
   * DISTINCT ON — это дешевле, чем тянуть всю историю и фильтровать в коде.
   */
  private async loadLatestIndices(): Promise<TeamIndex[]> {
    type IndexRow = {
      team_id: string;
      league_code: string;
      ci: number | null;
      grade: string | null;
      enough_data: boolean;
    };

    const rows: IndexRow[] = await this.prisma.$queryRaw<IndexRow[]>`
      SELECT DISTINCT ON (team_id)
             team_id, league_code, ci, grade, enough_data
        FROM corner_index_snapshots
       WHERE league_code = ANY(${this.config.leagueCodes})
       ORDER BY team_id, computed_at DESC
    `;

    return rows.map((r) => ({
      teamId: r.team_id,
      leagueCode: r.league_code,
      ci: r.ci,
      grade: r.grade,
      enoughData: r.enough_data,
    }));
  }

  private toDto(
    f: FixtureRow,
    indices: TeamIndex[],
    highlightedTeamIds: string[],
  ): MatchDto {
    const byId = new Map(indices.map((i) => [i.teamId, i]));
    const side = (team: FixtureRow['homeTeam'], teamId: string) => {
      const idx = byId.get(teamId);
      return {
        id: team.id,
        name: team.name,
        slug: team.slug,
        crestUrl: team.crestUrl,
        cornerIndex: idx?.enoughData ? idx.ci : null,
        cornerGrade: idx?.enoughData ? idx.grade : null,
        highlighted: highlightedTeamIds.includes(teamId),
      };
    };

    return {
      id: f.id,
      kickoffAt: f.kickoffAt.toISOString(),
      kickoffTimeKnown: f.kickoffTimeKnown,
      league: { code: f.leagueCode, name: LEAGUE_NAMES[f.leagueCode] ?? f.leagueCode },
      home: side(f.homeTeam, f.homeTeamId),
      away: side(f.awayTeam, f.awayTeamId),
    };
  }
}
