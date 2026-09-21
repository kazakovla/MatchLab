'use strict';
(() => {
  const config = window.MATCHLAB_CONFIG;
  const $ = selector => document.querySelector(selector);
  const results = $('#schedule-results');
  const status = $('#schedule-status');
  const notice = $('#schedule-notice');
  const more = $('#schedule-more');
  const retry = $('#schedule-retry');
  const data = window.MATCHLAB_DATA;
  const dialog = $('#match-dialog');
  const zone = config.timeZone;
  const key = date => new Intl.DateTimeFormat('sv-SE', { timeZone: zone }).format(new Date(date));
  const today = key(new Date());
  const addDays = (date, days) => new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  const dayLabel = date => new Intl.DateTimeFormat('ru-RU', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(date + 'T12:00:00Z'));
  const timeLabel = match => match.kickoffTimeKnown ? new Intl.DateTimeFormat('ru-RU', { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(new Date(match.kickoffAt)) : 'Уточняется';
  const leagues = { E0: 'Премьер-лига', SP1: 'Ла Лига', I1: 'Серия А', D1: 'Бундеслига', F1: 'Лига 1' };
  let period = 'all', league = 'all', items = [], visible = 6;
  function el(tag, className, text) { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function dates() {
    if (period === 'today') return [today];
    if (period === 'tomorrow') return [addDays(today, 1)];
    if (period === 'all') return Array.from({ length: 14 }, (_, i) => addDays(today, i));
    const weekday = new Date(today + 'T12:00:00Z').getUTCDay();
    const saturday = addDays(today, weekday === 0 ? -1 : (6 - weekday + 7) % 7);
    return [saturday, addDays(saturday, 1)];
  }
  function showMatch(match) {
    $('#match-dialog-title').textContent = `${match.home.name} — ${match.away.name}`;
    $('#match-dialog-date').textContent = `${dayLabel(key(match.kickoffAt))} · ${timeLabel(match)} МСК · ${match.league.name}`;
    const indices = $('#match-dialog-indices'); indices.replaceChildren();
    for (const team of [match.home, match.away]) indices.append(el('p', '', `${team.name}: ${team.cornerIndex === null ? 'недостаточно данных для индекса' : 'угловой индекс ' + team.cornerIndex}`));
    if (match.score) indices.append(el('p', 'match-score', 'Итоговый счёт: ' + match.score));
    if (match.matchStats) {
      const s = match.matchStats;
      const value = n => n === null ? '—' : String(n);
      indices.append(el('p', '', 'Угловые: ' + value(s.homeCorners) + ' : ' + value(s.awayCorners)));
      indices.append(el('p', '', 'Удары: ' + value(s.homeShots) + ' : ' + value(s.awayShots)));
      indices.append(el('p', '', 'В створ: ' + value(s.homeShotsOnTarget) + ' : ' + value(s.awayShotsOnTarget)));
    }
    for (const team of [match.home, match.away]) {
      const s = team.stats; if (!s) continue;
      const section = el('section', 'team-statistics');
      section.append(el('h3', '', team.name));
      section.append(el('p', 'schedule-help', 'Статистика за ' + s.seasons + ' · ' + s.first_match + ' — ' + s.last_match + '. Индекс по этой выборке, не на дату матча.'));
      const list = el('dl', 'statistics-grid');
      for (const [label, value] of [['Матчей',s.matches],['Угловые команды',s.corners_for],['Угловые соперников',s.corners_against],['Средние угловые команды',s.corners_for_avg],['Средние угловые соперников',s.corners_against_avg],['Средний тотал угловых',s.corners_total_avg],['Удары команды',s.shots_for],['Удары соперников',s.shots_against],['Средние удары',s.shots_for_avg],['Средние удары в створ',s.shots_on_for_avg],['Исходный индекс',s.raw_index],['Грейд',s.grade],['Позиция',s.position]]) {list.append(el('dt','',label),el('dd','',String(value ?? '—')));}
      section.append(list);indices.append(section);
    }
    dialog.showModal();
  }
  function render() {
    const filtered = items.filter(match => league === 'all' || match.league.code === league);
    results.replaceChildren();
    let lastDay = '', group;
    for (const match of filtered.slice(0, visible)) {
      const date = key(match.kickoffAt);
      if (date !== lastDay) {
        const section = el('section', 'matchday-group');
        section.append(el('h2', 'matchday-heading', `${date === today ? 'Сегодня, ' : date === addDays(today, 1) ? 'Завтра, ' : ''}${dayLabel(date)}`));
        group = el('div', 'fixtures'); section.append(group); results.append(section); lastDay = date;
      }
      const button = el('button', 'fixture match-row'); button.type = 'button';
      button.setAttribute('aria-label', `${match.home.name} — ${match.away.name}, ${timeLabel(match)}, ${match.league.name}. Подробности`);
      for (const [index, team] of [match.home, match.away].entries()) {
        const side = el('span', index === 0 ? 'home-team' : 'away-team');
        side.append(el('span', 'team-name', team.name));
        if (team.cornerIndex !== null) {
          const badge = el('span', 'index' + (team.highlighted ? '' : ' index-neutral'), String(team.cornerIndex)); badge.title = 'Угловой индекс';
          index === 0 ? side.prepend(badge) : side.append(badge);
        }
        button.append(side);
        if (index === 0) { const time = el('time', match.kickoffTimeKnown ? '' : 'time-unknown', match.score || timeLabel(match)); time.dateTime = match.kickoffTimeKnown ? match.kickoffAt : date; button.append(time); }
      }
      button.addEventListener('click', () => showMatch(match)); group.append(button);
    }
    status.textContent = filtered.length ? `Показано ${Math.min(visible, filtered.length)} из ${filtered.length} матчей` : 'В выбранном периоде и лиге матчей нет.';
    more.hidden = false;
    more.disabled = visible >= filtered.length;
    more.title = more.disabled ? 'Все доступные матчи показаны' : 'Показать следующие 6 матчей';
  }
  function load() {
    visible = 6; retry.hidden = true; notice.textContent = ''; results.setAttribute('aria-busy', 'false');
    const requested = dates();
    items = (period === 'archive' ? data.history : data.fixtures).filter(match => period === 'all' || period === 'archive' || requested.includes(key(match.kickoffAt)));
    items.sort((a,b) => period === 'archive' ? Date.parse(b.kickoffAt)-Date.parse(a.kickoffAt) : Date.parse(a.kickoffAt)-Date.parse(b.kickoffAt));
    const scheduleDays = data.fixtures.map(match => key(match.kickoffAt)).sort();
    $('#period-note').textContent = 'Время — московское (МСК). ' + (period === 'archive' ? 'Результаты сезонов 2024/25 и 2025/26 из репозитория.' : 'Расписание источника: ' + (scheduleDays.length ? dayLabel(scheduleDays[0]) + ' — ' + dayLabel(scheduleDays.at(-1)) : 'нет данных') + '.');
    if (period !== 'archive' && scheduleDays.length && scheduleDays.at(-1) < today) notice.textContent = 'Источник пока не опубликовал новое расписание. Здесь сохранены последние доступные даты; результаты этих матчей в файле расписания не указаны.';
    render();
  }
  document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
    period = button.dataset.period; document.querySelectorAll('[data-period]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); load();
  }));
  document.querySelectorAll('[data-league]').forEach(button => button.addEventListener('click', () => {
    league = button.dataset.league; document.querySelectorAll('[data-league]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); visible = 6; if (results.getAttribute('aria-busy') !== 'true' && retry.hidden) render();
  }));
  more.addEventListener('click', () => { visible += 6; render(); }); retry.addEventListener('click', load); 
  dialog.querySelectorAll('button').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });
  load();
})();
