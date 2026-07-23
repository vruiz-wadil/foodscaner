import { getIdToken, getCachedProfile } from './authClient.js';

function wireShareButtons(root) {
  root.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.shareResult({ name: btn.dataset.name, verdict: btn.dataset.verdict }, btn);
    });
  });
}

function renderLocalHistoryWithUpsell(root) {
  const localHistory = window.getLocalHistory ? window.getLocalHistory() : [];
  const itemsHtml = localHistory.map(h => `
    <div class="row-card">
      <span class="verdict-badge verdict-${h.rating}">${h.rating}</span>
      <p class="history-item-name">${h.name}</p>
      <button type="button" class="share-btn" data-name="${h.name}" data-verdict="${h.rating}" aria-label="Compartir">↗</button>
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
  wireShareButtons(root);
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
    <div class="row-card">
      <span class="verdict-badge verdict-${h.verdict}">${h.verdict}</span>
      <p class="history-item-name">${h.productName}</p>
      <button type="button" class="share-btn" data-name="${h.productName}" data-verdict="${h.verdict}" aria-label="Compartir">↗</button>
    </div>
  `).join('') || '<p class="account-empty">Aún no tienes escaneos.</p>';
  root.innerHTML = `<div class="content-card">${itemsHtml}</div>`;
  wireShareButtons(root);
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
