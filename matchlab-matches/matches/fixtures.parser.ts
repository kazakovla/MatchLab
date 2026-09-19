import { parseSourceKickoff } from './time.util';

/**
 * Разбор fixtures.csv с football-data.co.uk.
 *
 * Формат файла: Div,Date,Time,HomeTeam,AwayTeam,Referee, далее коэффициенты
 * десятков букмекеров. Нам нужны первые пять колонок, но брать их по номеру
 * нельзя: набор и порядок столбцов между файлами источника различается.
 * Разбор идёт строго по именам из заголовка.
 */

export interface ParsedFixture {
  leagueCode: string;
  homeTeamRaw: string;
  awayTeamRaw: string;
  kickoffAt: Date;
  kickoffTimeKnown: boolean;
  /** Дата в написании источника — часть ключа идемпотентности. */
  sourceDate: string;
}

export interface ParseReport {
  rowsTotal: number;
  rowsParsed: number;
  rowsSkippedOtherLeague: number;
  rowsSkippedBadDate: number;
  rowsSkippedNoTeams: number;
}

/** Разбор строки CSV с учётом значений в кавычках. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

export function parseFixturesCsv(
  csv: string,
  options: { leagueCodes: string[]; sourceTimeZone: string },
): { fixtures: ParsedFixture[]; report: ParseReport } {
  const report: ParseReport = {
    rowsTotal: 0,
    rowsParsed: 0,
    rowsSkippedOtherLeague: 0,
    rowsSkippedBadDate: 0,
    rowsSkippedNoTeams: 0,
  };

  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { fixtures: [], report };
  }

  const header = splitCsvLine(lines[0]);
  const idx = (name: string) => header.indexOf(name);
  const iDiv = idx('Div');
  const iDate = idx('Date');
  const iTime = idx('Time');
  const iHome = idx('HomeTeam');
  const iAway = idx('AwayTeam');

  if ([iDiv, iDate, iHome, iAway].some((i) => i < 0)) {
    throw new Error(
      `в файле расписания нет обязательных колонок (Div, Date, HomeTeam, AwayTeam); ` +
        `получен заголовок: ${header.slice(0, 8).join(',')}`,
    );
  }

  const wanted = new Set(options.leagueCodes);
  const fixtures: ParsedFixture[] = [];

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    if (cells.every((c) => c === '')) continue;
    report.rowsTotal += 1;

    const leagueCode = cells[iDiv] ?? '';
    if (!wanted.has(leagueCode)) {
      report.rowsSkippedOtherLeague += 1;
      continue;
    }

    const home = cells[iHome] ?? '';
    const away = cells[iAway] ?? '';
    if (!home || !away) {
      report.rowsSkippedNoTeams += 1;
      continue;
    }

    const dateRaw = cells[iDate] ?? '';
    const timeRaw = iTime >= 0 ? cells[iTime] ?? '' : '';
    const kickoffAt = parseSourceKickoff(dateRaw, timeRaw, options.sourceTimeZone);
    if (!kickoffAt) {
      report.rowsSkippedBadDate += 1;
      continue;
    }

    fixtures.push({
      leagueCode,
      homeTeamRaw: home,
      awayTeamRaw: away,
      kickoffAt,
      kickoffTimeKnown: Boolean(timeRaw),
      sourceDate: dateRaw,
    });
    report.rowsParsed += 1;
  }

  return { fixtures, report };
}

/** Ключ идемпотентности: один и тот же матч из источника даёт один и тот же ключ. */
export function externalKey(source: string, f: ParsedFixture): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return [source, f.leagueCode, f.sourceDate, norm(f.homeTeamRaw), norm(f.awayTeamRaw)].join('|');
}
