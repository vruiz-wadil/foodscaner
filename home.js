// Yomi Home Screen — Figma Redesign branch

function getHistory() {
  try { return JSON.parse(localStorage.getItem('yomi_history')) || []; } catch { return []; }
}

function placeholderSvg() {
  return "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>');
}

function badgeHtml(rating) {
  if (!rating) return '';
  const r = String(rating).toLowerCase();
  if (r === 'sano' || r === 'saludable' || r.includes('recomendar'))
    return '<span class="badge badge-sano">SANO</span>';
  if (r === 'evitar' || r.includes('evitar') || r.includes('no recom'))
    return '<span class="badge badge-evitar">EVITAR</span>';
  if (r === 'regular' || r.includes('modera') || r.includes('limitar'))
    return '<span class="badge badge-regular">REGULAR</span>';
  return '';
}

function imgHtml(item) {
  if (item.image) {
    return `<img class="product-card-img" src="${escHtml(item.image)}" alt="" onerror="this.onerror=null;this.src='${placeholderSvg()}'">`;
  }
  return `<div class="product-card-img-placeholder">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0d3d35" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
    </svg>
  </div>`;
}

function renderGrid() {
  const grid   = document.getElementById('products-grid');
  const empty  = document.getElementById('products-empty');
  const hint   = document.getElementById('activation-hint');
  const history = getHistory();

  if (!history.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    if (hint) hint.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.innerHTML = history.slice(0, 4).map(item => `
    <div class="product-card" data-barcode="${item.barcode}" role="button" tabindex="0">
      ${imgHtml(item)}
      <div class="product-card-body">
        <p class="product-card-name">${escHtml(item.name || item.barcode)}</p>
        <p class="product-card-brand">${escHtml(item.brand || '')}</p>
        <div class="product-card-badge-row">
          ${badgeHtml(item.rating)}
        </div>
      </div>
    </div>
  `).join('');

  // One-time nudge right after the first-ever scan, when momentum is highest.
  // Gated so it never shows again once it has, regardless of history changes.
  if (hint) {
    if (history.length === 1 && !localStorage.getItem('yomi_activation_shown')) {
      hint.classList.remove('hidden');
      localStorage.setItem('yomi_activation_shown', '1');
    } else {
      hint.classList.add('hidden');
    }
  }
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Navigate to scanner
function goScan() { window.location.href = 'scan.html?scan=1'; }

// Evita que un usuario a medio onboarding llegue a index.html navegando
// directo por URL (ej. cerró la pestaña de onboarding-membership.html y
// volvió a abrir la app) — lo manda de vuelta al paso que le falta.
function redirectTargetForIncompleteOnboarding(profile) {
  if (!profile) return null;
  if (!profile.profile || !profile.profile.completedAt) return 'onboarding-profile.html';
  if (profile.membershipStatus === 'pending') return 'onboarding-membership.html';
  return null;
}

document.addEventListener('DOMContentLoaded', async () => {
  renderGrid();

  document.getElementById('btn-scan').addEventListener('click', goScan);
  document.getElementById('nav-scan').addEventListener('click', goScan);
  document.getElementById('nav-profile').addEventListener('click', () => {
    window.location.href = 'account.html';
  });
  document.getElementById('nav-history').addEventListener('click', () => {
    window.location.href = 'history.html';
  });

  // Product card click → scan that barcode
  document.getElementById('products-grid').addEventListener('click', e => {
    const card = e.target.closest('.product-card');
    if (!card) return;
    window.location.href = 'scan.html?barcode=' + encodeURIComponent(card.dataset.barcode);
  });

  // Same navigation via keyboard (cards are role="button" tabindex="0")
  document.getElementById('products-grid').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.product-card');
    if (!card) return;
    e.preventDefault();
    window.location.href = 'scan.html?barcode=' + encodeURIComponent(card.dataset.barcode);
  });

  // await explícito (mismo motivo que preferences-ui.js, Task 15): no depender
  // de que el auto-sync de authClient.js ya haya resuelto para este frame.
  const profile = window.authClient ? await window.authClient.syncUserProfile() : null;
  const redirectTarget = redirectTargetForIncompleteOnboarding(profile);
  if (redirectTarget) window.location.href = redirectTarget;
});
