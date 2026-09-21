// Адрес сервера без /api/v1. Пустая строка = тот же адрес, что у frontend.
// Например: apiBaseUrl: 'http://localhost:3000'
window.MATCHLAB_CONFIG = Object.freeze({
  apiBaseUrl: '',
  upcomingPath: '/api/v1/matches/upcoming',
  limit: 3,
  timeZone: 'Europe/Moscow',
  timeoutMs: 10000,
});
