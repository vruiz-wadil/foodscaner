import { getIdToken, getCachedProfile } from './authClient.js';

function renderLocalHistoryWithUpsell(root) {
  const localHistory = window.getLocalHistory ? window.getLocalHistory() : [];
  const itemsHtml = localHistory.map(h => `
    <div class="row-card">
      <span class="verdict-badge verdict-${h.rating}">${h.rating}</span>
      <p>${h.name}</p>
    </div>
  `).join('');

  root.innerHTML = `
    <div class="content-card">
      ${itemsHtml || '<p class="account-empty">Aún no tienes escaneos.</p>'}
      <div class="history-locked-block">
        <div class="history-locked-overlay">
          <p>Ya sabemos qué trae este producto. Ahora dinos qué NO puedes comer tú o tu familia,
          y Yomi revisa cada escaneo contra tu perfil antes de que muerdas.</p>
          <a href="preferences.html" class="btn btn-primary">Configurar mis preferencias</a>
        </div>
      </div>
    </div>
  `;
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
      <p>${h.productName}</p>
    </div>
  `).join('') || '<p class="account-empty">Aún no tienes escaneos.</p>';
  root.innerHTML = `<div class="content-card">${itemsHtml}</div>`;
}

export async function renderHistoryScreen() {
  const root = document.getElementById('history-root');
  if (!root) return;
  const profile = getCachedProfile();

  if (!profile || profile.plan !== 'premium') {
    renderLocalHistoryWithUpsell(root);
    return;
  }
  await renderCloudHistory(root);
}

document.addEventListener('DOMContentLoaded', renderHistoryScreen);
