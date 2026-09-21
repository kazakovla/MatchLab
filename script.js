'use strict';
const toggle = document.querySelector('#menu-toggle');
const sidebar = document.querySelector('#sidebar');
const overlay = document.querySelector('.overlay');
function setMenu(open) {
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? 'Закрыть ×' : 'Меню ☰';
  sidebar.classList.toggle('open', open);
  overlay.hidden = !open;
  document.body.classList.toggle('menu-open', open);
  sidebar.inert = matchMedia('(max-width: 900px)').matches && !open;
}
toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
overlay.addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { setMenu(false); toggle.focus(); }
});
sidebar.addEventListener('click', event => { if (event.target.closest('a')) setMenu(false); });
matchMedia('(max-width: 900px)').addEventListener('change', () => setMenu(false));
setMenu(false);
const cards = [...document.querySelectorAll('[data-category]')];
document.querySelectorAll('[data-filter]').forEach(button => {
  button.addEventListener('click', () => {
    const category = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    document.querySelector('.article-grid').classList.toggle('filtered', category !== 'Все');
    cards.forEach(card => { card.hidden = category !== 'Все' && card.dataset.category !== category; });
    document.querySelector('#filter-status').textContent = `Выбрана категория: ${category}`;
  });
});
