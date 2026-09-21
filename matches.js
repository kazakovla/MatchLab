'use strict';
(() => {
  const config = window.MATCHLAB_CONFIG;
  const container = document.querySelector('#matches-list');
  const status = document.querySelector('#matches-status');
  const retry = document.querySelector('#matches-retry');
  const zoneLabel = document.querySelector('#matches-timezone');
  let loading = false;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function validMatch(match) {
    const side = team => team && typeof team.name === 'string' &&
      (team.cornerIndex === null || (Number.isFinite(team.cornerIndex) && team.cornerIndex >= 0 && team.cornerIndex <= 100));
    return match && typeof match.kickoffAt === 'string' && Number.isFinite(Date.parse(match.kickoffAt)) &&
      typeof match.kickoffTimeKnown === 'boolean' && side(match.home) && side(match.away) &&
      match.league && typeof match.league.name === 'string';
  }

  function teamSide(team, isHome) {
    const node = element('span', isHome ? 'home-team' : 'away-team');
    const name = element('span', 'team-name', team.name);
    node.append(name);
    if (team.cornerIndex !== null) {
      const badge = element('span', 'index', String(team.cornerIndex));
      badge.title = `Угловой индекс: ${team.cornerIndex}${team.cornerGrade ? ` · ${team.cornerGrade}` : ''}`;
      if (!team.highlighted) badge.classList.add('index-neutral');
      if (isHome) node.prepend(badge); else node.append(badge);
    }
    return node;
  }

  function render(items) {
    const dateFormat = new Intl.DateTimeFormat('ru-RU', { timeZone: config.timeZone, day: 'numeric', month: 'long' });
    const timeFormat = new Intl.DateTimeFormat('ru-RU', { timeZone: config.timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
    const fragment = document.createDocumentFragment();
    for (const match of items) {
      const wrapper = element('div', 'fixture-entry');
      const date = new Date(match.kickoffAt);
      wrapper.append(element('p', 'fixture-meta', `${dateFormat.format(date)} · ${match.league.name}`));
      const row = element('div', 'fixture');
      const time = element('time', '', match.kickoffTimeKnown ? timeFormat.format(date) : 'Уточняется');
      time.dateTime = match.kickoffTimeKnown ? match.kickoffAt : new Intl.DateTimeFormat('sv-SE', {timeZone: config.timeZone}).format(date);
      if (!match.kickoffTimeKnown) time.classList.add('time-unknown');
      row.append(teamSide(match.home, true), time, teamSide(match.away, false));
      wrapper.append(row);
      fragment.append(wrapper);
    }
    container.replaceChildren(fragment);
  }

  async function loadMatches() {
    if (loading) return;
    if (!config.apiBaseUrl && window.MATCHLAB_DATA) {
      const items = window.MATCHLAB_DATA.fixtures.filter(match => Date.parse(match.kickoffAt) >= Date.now() && (match.home.highlighted || match.away.highlighted)).sort((a,b) => Date.parse(a.kickoffAt)-Date.parse(b.kickoffAt)).slice(0,config.limit);
      render(items);
      zoneLabel.textContent = 'Время матчей: московское (МСК)';
      status.textContent = items.length ? '' : 'В последней выгрузке источника нет предстоящих матчей. Расписание доступно по кнопке «Все матчи».';
      return;
    }
    if (location.protocol === 'file:') {
      status.textContent = 'Для загрузки матчей откройте страницу через локальный сервер. Инструкция — в README.md.';
      return;
    }
    loading = true;
    container.setAttribute('aria-busy', 'true');
    retry.hidden = true;
    container.replaceChildren();
    status.textContent = 'Загружаем ближайшие матчи…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const endpoint = new URL(`${config.apiBaseUrl.replace(/\/$/, '')}${config.upcomingPath}`, location.origin);
      endpoint.searchParams.set('limit', String(config.limit));
      const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.items) || !data.items.every(validMatch)) throw new Error('Unexpected matches response');
      render(data.items);
      zoneLabel.textContent = `Время матчей: ${config.timeZone === 'Europe/Moscow' ? 'московское (МСК)' : config.timeZone}`;
      status.textContent = data.items.length ? '' : 'В ближайшие дни подходящих матчей нет. Загляните позже.';
    } catch (error) {
      status.textContent = error.name === 'AbortError'
        ? 'Сервер не ответил вовремя. Попробуйте ещё раз.'
        : 'Не удалось загрузить матчи. Попробуйте ещё раз.';
      retry.hidden = false;
    } finally {
      clearTimeout(timeout);
      loading = false;
      container.setAttribute('aria-busy', 'false');
    }
  }

  retry.addEventListener('click', loadMatches);
  loadMatches();
})();
