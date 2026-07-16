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

const HOME_UPSELL_DISMISS_KEY = 'yomiUpsellDismiss';
const DAY_MS = 24 * 60 * 60 * 1000;

// Trigger de intención real (equipo Growth+UX): NO es un banner permanente.
// Dispara solo cuando tocó el límite de OCR gratis hoy — momento de fricción
// real, no venta genérica. (Un "Trigger A" basado en preferencias declaradas
// se eliminó del diseño original: es lógicamente inalcanzable para un usuario
// free — PUT /api/me/preferences es premium-only y GET /api/me nunca regresa
// `preferences` para un plan no-premium, ver nota de la 4a ronda de revisión.)
function shouldShowHomeUpsell(profile) {
  if (!profile || profile.plan === 'premium') return false;

  const dismiss = JSON.parse(localStorage.getItem(HOME_UPSELL_DISMISS_KEY) || '{}');
  const now = Date.now();
  if (dismiss.count >= 2 && now - dismiss.lastAt < 30 * DAY_MS) return false;
  if (dismiss.lastAt && now - dismiss.lastAt < 3 * DAY_MS) return false;

  const today = new Date().toISOString().slice(0, 10);
  const usage = profile.usage;
  return !!(usage && usage.date === today && usage.ocrCount >= 5);
}

// Copy y trigger definidos por el equipo Growth Hacker en la sesión de revisión.
function renderHomeUpsellBanner() {
  const el = document.getElementById('home-upsell-banner');
  if (!el) return;
  const profile = (typeof window !== 'undefined' && window.authClient) ? window.authClient.getCachedProfile() : null;
  if (!shouldShowHomeUpsell(profile)) {
    el.classList.add('hidden');
    return;
  }
  el.innerHTML = `
    <p>¿Esto es seguro para ti o para tu hijo? Actívalo con tu perfil.</p>
    <a href="preferences.html" class="btn-primary">Activar mis alertas</a>
    <button type="button" id="btn-dismiss-upsell" aria-label="Cerrar">✕</button>
  `;
  el.classList.remove('hidden');
  document.getElementById('btn-dismiss-upsell')?.addEventListener('click', () => {
    const dismiss = JSON.parse(localStorage.getItem(HOME_UPSELL_DISMISS_KEY) || '{}');
    localStorage.setItem(HOME_UPSELL_DISMISS_KEY, JSON.stringify({ count: (dismiss.count || 0) + 1, lastAt: Date.now() }));
    el.classList.add('hidden');
  });
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
  if (window.authClient) await window.authClient.syncUserProfile();
  renderHomeUpsellBanner();
});
