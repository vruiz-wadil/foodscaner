// Yomi bottom nav wiring — shared by account.html, preferences.html and
// history.html (hallazgo UX #7: estas 3 páginas no tenían forma de volver a
// Home ni al resto de la app). index.html tiene su propia lógica de nav en
// home.js y no carga este archivo.
document.addEventListener('DOMContentLoaded', () => {
  const home = document.querySelector('.bottom-nav .nav-item:first-child');
  const scan = document.getElementById('nav-scan');
  const history = document.getElementById('nav-history');
  const profile = document.getElementById('nav-profile');

  home?.addEventListener('click', () => { window.location.href = 'index.html'; });
  scan?.addEventListener('click', () => { window.location.href = 'scan.html?scan=1'; });
  history?.addEventListener('click', () => { window.location.href = 'history.html'; });
  profile?.addEventListener('click', () => { window.location.href = 'account.html'; });
});
