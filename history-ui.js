import { getIdToken, getCachedProfile } from './authClient.js';

function placeholderSvg() {
  return "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>');
}

function imgHtml(image) {
  if (image) {
    return `<img class="history-thumb" src="${escHtml(image)}" alt="" onerror="this.onerror=null;this.src='${placeholderSvg()}'">`;
  }
  return `<div class="history-thumb-placeholder">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0d3d35" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
    </svg>
  </div>`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function wireRowCards(root) {
  root.querySelectorAll('.row-card').forEach(card => {
    const barcode = card.dataset.barcode;
    const goToScan = () => { window.location.href = 'scan.html?barcode=' + encodeURIComponent(barcode); };
    card.addEventListener('click', goToScan);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToScan(); }
    });
  });
  root.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      window.shareResult({ name: btn.dataset.name, verdict: btn.dataset.verdict, barcode: btn.dataset.barcode }, btn);
    });
  });
}

function renderLocalHistoryWithUpsell(root) {
  const localHistory = window.getLocalHistory ? window.getLocalHistory() : [];
  const itemsHtml = localHistory.map(h => `
    <div class="row-card" data-barcode="${escHtml(h.barcode)}" role="button" tabindex="0">
      ${imgHtml(h.image)}
      <span class="verdict-badge verdict-${h.rating}">${h.rating}</span>
      <p class="history-item-name">${h.name}</p>
      <button type="button" class="share-btn" data-name="${h.name}" data-verdict="${h.rating}" data-barcode="${h.barcode}" aria-label="Compartir">↗</button>
    </div>
  `).join('');

  root.innerHTML = `
    <div class="content-card">
      ${itemsHtml || '<p class="account-empty">Aún no tienes escaneos.</p>'}
      <div class="row-card history-upsell">
        <div class="icon-wrap" style="background:rgba(245,166,35,0.15);">🔓</div>
        <div>
          <p class="about-text">Ya sabemos qué trae este producto. Ahora dinos qué NO puedes comer tú o tu familia,
          y Yomi revisa cada escaneo contra tu perfil antes de que muerdas.</p>
          <a href="preferences.html" class="btn btn-primary">Configurar mis preferencias</a>
        </div>
      </div>
    </div>
  `;
  wireRowCards(root);
}

async function renderCloudHistory(root) {
  const token = await getIdToken();
  const res = await fetch('/api/me/history', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    root.innerHTML = '<div class="content-card"><p class="account-empty">No se pudo cargar tu historial. Intenta de nuevo.</p></div>';
    return;
  }
  const { history } = await res.json();
  const itemsHtml = history.map(h => `
    <div class="row-card" data-barcode="${escHtml(h.barcode)}" role="button" tabindex="0">
      ${imgHtml(h.image)}
      <span class="verdict-badge verdict-${h.verdict}">${h.verdict}</span>
      <p class="history-item-name">${h.productName}</p>
      <button type="button" class="share-btn" data-name="${h.productName}" data-verdict="${h.verdict}" data-barcode="${h.barcode}" aria-label="Compartir">↗</button>
    </div>
  `).join('') || '<p class="account-empty">Aún no tienes escaneos.</p>';
  root.innerHTML = `<div class="content-card">${itemsHtml}</div>`;
  wireRowCards(root);
}

export async function renderHistoryScreen() {
  const root = document.getElementById('history-root');
  if (!root) return;
  const profile = getCachedProfile();

  if (!profile || profile.membershipStatus !== 'active') {
    renderLocalHistoryWithUpsell(root);
    return;
  }
  await renderCloudHistory(root);
}

document.addEventListener('DOMContentLoaded', renderHistoryScreen);
