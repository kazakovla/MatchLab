import { registerAs } from '@nestjs/config';

/**
 * Все продуктовые константы блока — в конфигурации, а не в коде: аналитики
 * должны иметь возможность подвинуть размер топа и глубину окна расписания
 * без релиза.
 */
export const MATCHES_CONFIG = 'matches';

export interface MatchesConfig {
  /** Лиги, по которым считается индекс и показывается расписание. */
  leagueCodes: string[];
  /** Сколько команд каждой лиги считается «высоким индексом». */
  topTeamsPerLeague: number;
  /** Сколько карточек отдаём в виджет главной по умолчанию. */
  widgetLimit: number;
  /** На сколько дней вперёд смотрим в поисках ближайших матчей. */
  upcomingWindowDays: number;
  /** На сколько дней вперёд ищем ближайший непустой игровой день. */
  matchdayLookaheadDays: number;
  /** Пояс, в котором определяется «сегодняшний игровой день». */
  serviceTimeZone: string;
  /** Пояс, в котором источник указывает время начала матчей. */
  sourceTimeZone: string;
  /** URL файла расписания. */
  fixturesUrl: string;
  /** TTL кэша ответов, секунды. */
  cacheTtlSeconds: number;
}

export default registerAs(
  MATCHES_CONFIG,
  (): MatchesConfig => ({
    leagueCodes: (process.env.MATCHES_LEAGUES ?? 'E0,SP1,I1,D1,F1')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    topTeamsPerLeague: Number(process.env.MATCHES_TOP_TEAMS_PER_LEAGUE ?? 6),
    widgetLimit: Number(process.env.MATCHES_WIDGET_LIMIT ?? 4),
    upcomingWindowDays: Number(process.env.MATCHES_UPCOMING_WINDOW_DAYS ?? 10),
    matchdayLookaheadDays: Number(process.env.MATCHES_MATCHDAY_LOOKAHEAD_DAYS ?? 14),
    serviceTimeZone: process.env.MATCHES_SERVICE_TZ ?? 'Europe/Moscow',
    // Внимание: football-data.co.uk указывает время матчей по Лондону.
    // Если источник сменится, этот пояс меняется вместе с ним.
    sourceTimeZone: process.env.MATCHES_SOURCE_TZ ?? 'Europe/London',
    fixturesUrl:
      process.env.MATCHES_FIXTURES_URL ?? 'https://www.football-data.co.uk/fixtures.csv',
    cacheTtlSeconds: Number(process.env.MATCHES_CACHE_TTL ?? 120),
  }),
);
