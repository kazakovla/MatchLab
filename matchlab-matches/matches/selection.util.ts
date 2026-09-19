/**
 * Отбор матчей по угловому индексу.
 *
 * Логика вынесена из сервиса намеренно: это единственное место, где живёт
 * продуктовое правило «какие матчи считать интересными», и его надо уметь
 * покрывать тестами без базы, Redis и Nest.
 */

export interface TeamIndex {
  teamId: string;
  leagueCode: string;
  ci: number | null;
  grade: string | null;
  enoughData: boolean;
}

export interface FixtureLike {
  id: string;
  leagueCode: string;
  kickoffAt: Date;
  homeTeamId: string;
  awayTeamId: string;
}

export interface RankedFixture<T extends FixtureLike> {
  fixture: T;
  /** Наибольший из индексов двух команд — по нему матч попадает в подборку. */
  matchCi: number;
  /** Команды матча, входящие в топ своей лиги. */
  highlightedTeamIds: string[];
}

/**
 * Топ-N команд каждой лиги по CI.
 *
 * Команды без достаточной истории не участвуют: их CI не рассчитан, и ставить
 * их в подборку «высокий индекс» было бы подлогом.
 */
export function selectTopTeamIds(indices: TeamIndex[], topPerLeague: number): Set<string> {
  const byLeague = new Map<string, TeamIndex[]>();

  for (const t of indices) {
    if (!t.enoughData || t.ci === null) continue;
    const list = byLeague.get(t.leagueCode) ?? [];
    list.push(t);
    byLeague.set(t.leagueCode, list);
  }

  const top = new Set<string>();
  for (const list of byLeague.values()) {
    list
      // при равном CI порядок должен быть устойчивым, иначе подборка
      // «дрожит» между запросами на одних и тех же данных
      .sort((a, b) => (b.ci as number) - (a.ci as number) || a.teamId.localeCompare(b.teamId))
      .slice(0, Math.max(0, topPerLeague))
      .forEach((t) => top.add(t.teamId));
  }

  return top;
}

/**
 * Оставляет матчи, где хотя бы одна команда входит в топ своей лиги,
 * и сортирует их по времени начала: блок называется «Ближайшие матчи»,
 * поэтому первичный порядок — хронологический, а индекс работает фильтром.
 *
 * При равном времени начала выше встаёт матч с большим matchCi — так лимит
 * в 3–4 карточки отсекает менее интересное, а не случайное.
 */
export function rankUpcoming<T extends FixtureLike>(
  fixtures: T[],
  indices: TeamIndex[],
  options: { topPerLeague: number; limit: number },
): RankedFixture<T>[] {
  const top = selectTopTeamIds(indices, options.topPerLeague);
  const ciByTeam = new Map<string, number>();
  for (const t of indices) {
    if (t.ci !== null && t.enoughData) ciByTeam.set(t.teamId, t.ci);
  }

  const ranked: RankedFixture<T>[] = [];
  for (const f of fixtures) {
    const highlighted = [f.homeTeamId, f.awayTeamId].filter((id) => top.has(id));
    if (highlighted.length === 0) continue;
    const matchCi = Math.max(
      ciByTeam.get(f.homeTeamId) ?? 0,
      ciByTeam.get(f.awayTeamId) ?? 0,
    );
    ranked.push({ fixture: f, matchCi, highlightedTeamIds: highlighted });
  }

  ranked.sort(
    (a, b) =>
      a.fixture.kickoffAt.getTime() - b.fixture.kickoffAt.getTime() ||
      b.matchCi - a.matchCi ||
      a.fixture.id.localeCompare(b.fixture.id),
  );

  return options.limit > 0 ? ranked.slice(0, options.limit) : ranked;
}

/**
 * Выбор игрового дня.
 *
 * Если в запрошенные сутки матчей нет — пауза на сборные, понедельник, — берём
 * ближайший будущий день, в котором они есть, чтобы страница «Смотреть все»
 * не открывалась пустой. Отдаём и фактическую дату, и признак, что она
 * отличается от запрошенной: интерфейс должен об этом сказать пользователю.
 */
export function resolveMatchday(
  dateKeys: string[],
  requestedKey: string,
): { dateKey: string; isRequested: boolean } | null {
  const unique = Array.from(new Set(dateKeys)).sort();
  if (unique.includes(requestedKey)) {
    return { dateKey: requestedKey, isRequested: true };
  }
  const next = unique.find((k) => k > requestedKey);
  if (next) return { dateKey: next, isRequested: false };
  return null;
}
