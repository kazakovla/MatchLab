import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { dateKeyInZone, dayBoundsUtc, parseSourceKickoff, zonedToUtc } from '../time.util';
import { rankUpcoming, resolveMatchday, selectTopTeamIds, TeamIndex } from '../selection.util';
import { externalKey, parseFixturesCsv, splitCsvLine } from '../fixtures.parser';

// --------------------------------------------------------------- часовые пояса

test('время источника переводится в UTC с учётом летнего времени', () => {
  // сентябрь — в Лондоне действует BST (UTC+1)
  assert.equal(
    zonedToUtc(2026, 9, 15, 19, 45, 'Europe/London').toISOString(),
    '2026-09-15T18:45:00.000Z',
  );
  // декабрь — GMT, смещения нет
  assert.equal(
    zonedToUtc(2026, 12, 5, 15, 0, 'Europe/London').toISOString(),
    '2026-12-05T15:00:00.000Z',
  );
});

test('границы суток считаются по поясу сервиса, а не по UTC', () => {
  const { from, to } = dayBoundsUtc('2026-09-19', 'Europe/Moscow');
  assert.equal(from.toISOString(), '2026-09-18T21:00:00.000Z');
  assert.equal(to.toISOString(), '2026-09-19T21:00:00.000Z');
});

test('поздний матч попадает в тот игровой день, в котором его видит пользователь', () => {
  // 22:00 по Лондону 19 сентября — это 00:00 20 сентября по Москве
  const kickoff = zonedToUtc(2026, 9, 19, 22, 0, 'Europe/London');
  assert.equal(dateKeyInZone(kickoff, 'Europe/London'), '2026-09-19');
  assert.equal(dateKeyInZone(kickoff, 'Europe/Moscow'), '2026-09-20');
});

test('разбор даты и времени из файла расписания', () => {
  const full = parseSourceKickoff('15/09/2026', '19:45', 'Europe/London');
  assert.equal(full?.toISOString(), '2026-09-15T18:45:00.000Z');

  // двузначный год из старых файлов
  const short = parseSourceKickoff('15/09/26', '19:45', 'Europe/London');
  assert.equal(short?.toISOString(), '2026-09-15T18:45:00.000Z');

  // час начала ещё не назначен — дата остаётся, время считаем полуночью
  const noTime = parseSourceKickoff('15/09/2026', '', 'Europe/London');
  assert.equal(noTime?.toISOString(), '2026-09-14T23:00:00.000Z');

  assert.equal(parseSourceKickoff('какая-то ерунда', '19:45', 'Europe/London'), null);
  assert.equal(parseSourceKickoff('15/09/2026', '19-45', 'Europe/London'), null);
});

// ----------------------------------------------------------------------- отбор

const indices: TeamIndex[] = [
  { teamId: 'ars', leagueCode: 'E0', ci: 95, grade: 'A+', enoughData: true },
  { teamId: 'liv', leagueCode: 'E0', ci: 80, grade: 'A', enoughData: true },
  { teamId: 'eve', leagueCode: 'E0', ci: 40, grade: 'C', enoughData: true },
  { teamId: 'sun', leagueCode: 'E0', ci: 99, grade: 'A+', enoughData: false }, // новичок лиги
  { teamId: 'rma', leagueCode: 'SP1', ci: 90, grade: 'A+', enoughData: true },
  { teamId: 'get', leagueCode: 'SP1', ci: 20, grade: 'D', enoughData: true },
];

test('в топ попадают только команды с достаточной историей', () => {
  const top = selectTopTeamIds(indices, 2);
  assert.deepEqual([...top].sort(), ['ars', 'get', 'liv', 'rma']);
  assert.ok(!top.has('sun'), 'команда без истории не может считаться высокоиндексной');
});

test('топ считается по каждой лиге отдельно', () => {
  const top = selectTopTeamIds(indices, 1);
  assert.deepEqual([...top].sort(), ['ars', 'rma']);
});

const fx = (id: string, league: string, iso: string, home: string, away: string) => ({
  id,
  leagueCode: league,
  kickoffAt: new Date(iso),
  homeTeamId: home,
  awayTeamId: away,
});

test('в подборку идут матчи с топ-командой, порядок — хронологический', () => {
  const fixtures = [
    fx('m3', 'E0', '2026-09-21T18:00:00Z', 'eve', 'liv'),
    fx('m1', 'E0', '2026-09-19T11:30:00Z', 'ars', 'eve'),
    fx('m2', 'SP1', '2026-09-20T19:00:00Z', 'get', 'rma'),
    fx('m4', 'E0', '2026-09-22T18:00:00Z', 'eve', 'sun'), // обе команды вне топа
  ];

  const ranked = rankUpcoming(fixtures, indices, { topPerLeague: 2, limit: 10 });
  assert.deepEqual(ranked.map((r) => r.fixture.id), ['m1', 'm2', 'm3']);
  assert.ok(!ranked.some((r) => r.fixture.id === 'm4'));
});

test('matchCi берётся по сильнейшей команде матча', () => {
  const ranked = rankUpcoming(
    [fx('m1', 'E0', '2026-09-19T11:30:00Z', 'ars', 'eve')],
    indices,
    { topPerLeague: 2, limit: 10 },
  );
  assert.equal(ranked[0].matchCi, 95);
  assert.deepEqual(ranked[0].highlightedTeamIds, ['ars']);
});

test('при одинаковом времени начала выше встаёт матч с большим индексом', () => {
  const same = '2026-09-19T11:30:00Z';
  const ranked = rankUpcoming(
    [fx('b', 'E0', same, 'liv', 'eve'), fx('a', 'SP1', same, 'rma', 'get')],
    indices,
    { topPerLeague: 2, limit: 1 },
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].fixture.id, 'a', 'Реал с CI 90 должен опередить Ливерпуль с 80');
});

test('лимит 0 означает «без ограничения»', () => {
  const fixtures = [
    fx('m1', 'E0', '2026-09-19T11:30:00Z', 'ars', 'eve'),
    fx('m2', 'SP1', '2026-09-20T19:00:00Z', 'get', 'rma'),
  ];
  assert.equal(rankUpcoming(fixtures, indices, { topPerLeague: 2, limit: 0 }).length, 2);
});

// ------------------------------------------------------------------ игровой день

test('запрошенный день отдаётся как есть, если матчи в нём есть', () => {
  const r = resolveMatchday(['2026-09-19', '2026-09-20'], '2026-09-19');
  assert.deepEqual(r, { dateKey: '2026-09-19', isRequested: true });
});

test('пустой день подменяется ближайшим следующим', () => {
  const r = resolveMatchday(['2026-09-22', '2026-09-20'], '2026-09-19');
  assert.deepEqual(r, { dateKey: '2026-09-20', isRequested: false });
});

test('если впереди матчей нет, возвращается null', () => {
  assert.equal(resolveMatchday(['2026-09-10'], '2026-09-19'), null);
});

// ---------------------------------------------------------------------- парсер

test('строка CSV со значением в кавычках разбирается верно', () => {
  assert.deepEqual(splitCsvLine('E0,15/09/2026,"Nott\'m Forest, FC",Arsenal'), [
    'E0',
    '15/09/2026',
    "Nott'm Forest, FC",
    'Arsenal',
  ]);
});

const CSV = [
  'Div,Date,Time,HomeTeam,AwayTeam,Referee,B365H,B365D,B365A',
  'E0,19/09/2026,15:00,Arsenal,Everton,M Oliver,1.4,4.5,7.0',
  'SP1,20/09/2026,22:00,Real Madrid,Getafe,,1.3,5.0,9.0',
  'E1,19/09/2026,19:45,Bristol City,Lincoln,T Robinson,1.79,3.6,4.1',
  'I1,ерунда,18:00,Roma,Lazio,,2.0,3.2,3.6',
  'D1,21/09/2026,,Bayern Munich,Hamburg,,1.2,6.0,12.0',
  ',,,,,,,,',
].join('\n');

test('парсер берёт только наши лиги и отбрасывает битые строки', () => {
  const { fixtures, report } = parseFixturesCsv(CSV, {
    leagueCodes: ['E0', 'SP1', 'I1', 'D1', 'F1'],
    sourceTimeZone: 'Europe/London',
  });

  assert.equal(report.rowsSkippedOtherLeague, 1, 'E1 не наша лига');
  assert.equal(report.rowsSkippedBadDate, 1, 'строка с нечитаемой датой отброшена');
  assert.equal(fixtures.length, 3);

  const arsenal = fixtures.find((f) => f.homeTeamRaw === 'Arsenal');
  assert.equal(arsenal?.kickoffAt.toISOString(), '2026-09-19T14:00:00.000Z');
  assert.equal(arsenal?.kickoffTimeKnown, true);

  const bayern = fixtures.find((f) => f.homeTeamRaw === 'Bayern Munich');
  assert.equal(bayern?.kickoffTimeKnown, false, 'час начала не назначен');
});

test('парсер не полагается на порядок колонок', () => {
  const reordered = [
    'HomeTeam,AwayTeam,Div,Time,Date,Referee',
    'Arsenal,Everton,E0,15:00,19/09/2026,M Oliver',
  ].join('\n');

  const { fixtures } = parseFixturesCsv(reordered, {
    leagueCodes: ['E0'],
    sourceTimeZone: 'Europe/London',
  });
  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].kickoffAt.toISOString(), '2026-09-19T14:00:00.000Z');
});

test('файл без обязательных колонок вызывает явную ошибку', () => {
  assert.throws(
    () =>
      parseFixturesCsv('Date,Time,Referee\n19/09/2026,15:00,M Oliver', {
        leagueCodes: ['E0'],
        sourceTimeZone: 'Europe/London',
      }),
    /нет обязательных колонок/,
  );
});

test('ключ идемпотентности устойчив к регистру и лишним пробелам', () => {
  const base = {
    leagueCode: 'E0',
    homeTeamRaw: 'Man United',
    awayTeamRaw: 'Arsenal',
    kickoffAt: new Date(),
    kickoffTimeKnown: true,
    sourceDate: '19/09/2026',
  };
  const a = externalKey('football-data.co.uk', base);
  const b = externalKey('football-data.co.uk', { ...base, homeTeamRaw: '  man   united ' });
  assert.equal(a, b);
});
