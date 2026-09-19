/**
 * Работа с часовыми поясами без внешних библиотек.
 *
 * Два пояса, которые нельзя путать:
 *  - пояс источника: в fixtures.csv с football-data.co.uk время матча указано
 *    по Лондону, а не в UTC;
 *  - пояс сервиса: в нём определяется «игровой день» для страницы всех матчей.
 *
 * В базе всё лежит в UTC, конвертация происходит только на границах.
 */

/** Смещение пояса относительно UTC в миллисекундах на конкретный момент. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }

  const hour = parts.hour === '24' ? '0' : parts.hour;
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asIfUtc - instant.getTime();
}

/**
 * Локальное время в заданном поясе -> момент в UTC.
 *
 * Смещение зависит от самого момента (летнее время), поэтому оно уточняется
 * вторым проходом: первая оценка может попасть по другую сторону перевода
 * часов, и тогда первое смещение было бы взято не то.
 */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  let ts = naive - zoneOffsetMs(new Date(naive), timeZone);
  ts = naive - zoneOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/** Дата вида YYYY-MM-DD, какой её видит наблюдатель в заданном поясе. */
export function dateKeyInZone(instant: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(instant);
}

/** Границы календарных суток пояса: [начало, конец) в UTC. */
export function dayBoundsUtc(dateKey: string, timeZone: string): { from: Date; to: Date } {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) {
    throw new Error(`некорректная дата: ${dateKey}`);
  }
  const from = zonedToUtc(y, m, d, 0, 0, timeZone);
  const to = new Date(zonedToUtc(y, m, d + 1, 0, 0, timeZone).getTime());
  return { from, to };
}

/**
 * Разбор даты и времени из fixtures.csv.
 * Дата приходит как DD/MM/YYYY (в старых файлах DD/MM/YY), время как HH:MM.
 * Пустое время означает, что час начала ещё не назначен.
 */
export function parseSourceKickoff(
  dateRaw: string,
  timeRaw: string,
  sourceTimeZone: string,
): Date | null {
  const date = (dateRaw || '').trim();
  const time = (timeRaw || '').trim();
  const dm = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(date);
  if (!dm) return null;

  const day = Number(dm[1]);
  const month = Number(dm[2]);
  const year = dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]);

  let hour = 0;
  let minute = 0;
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (tm) {
    hour = Number(tm[1]);
    minute = Number(tm[2]);
  } else if (time) {
    return null;
  }

  const at = zonedToUtc(year, month, day, hour, minute, sourceTimeZone);
  return Number.isNaN(at.getTime()) ? null : at;
}
