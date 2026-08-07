// Yomi bottom nav wiring — shared by account.html, preferences.html and
// history.html (hallazgo UX #7: estas 3 páginas no tenían forma de volver a
// Home ni al resto de la app). index.html tiene su propia lógica de nav en
// home.js y no carga este archivo.

// Duplicado a propósito de home.js's historyNavTarget — mismo patrón que
// escapeHtml en account-ui.js/header-badge.js, no hay módulo compartido
// entre estos scripts planos.
function historyNavTarget(profile) {
  if (!profile) return 'premium-offer.html';
  if (profile.membershipStatus !== 'active') return 'onboarding-membership.html';
  return 'history.html';
}

document.addEventListener('DOMContentLoaded', () => {
  const home = document.querySelector('.bottom-nav .nav-item:first-child');
  const scan = document.getElementById('nav-scan');
  const history = document.getElementById('nav-history');
  const profile = document.getElementById('nav-profile');

  home?.addEventListener('click', () => { window.location.href = 'index.html'; });
  scan?.addEventListener('click', () => { window.location.href = 'scan.html?scan=1'; });
  history?.addEventListener('click', () => {
    const cachedProfile = window.authClient && window.authClient.getCachedProfile();
    window.location.href = historyNavTarget(cachedProfile);
  });
  profile?.addEventListener('click', () => { window.location.href = 'account.html'; });
});
