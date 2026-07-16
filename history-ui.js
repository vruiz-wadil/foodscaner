import { getIdToken, getCachedProfile } from './authClient.js';

function renderLocalHistoryWithUpsell(root) {
  const localHistory = window.getLocalHistory ? window.getLocalHistory() : [];
  const itemsHtml = localHistory.map(h => `
    <div class="about-card">
      <p>${h.name}</p>
      <span class="verdict-badge verdict-${h.rating}">${h.rating}</span>
    </div>
  `).join('');

  root.innerHTML = `
    ${itemsHtml || '<p class="account-empty">Aún no tienes escaneos.</p>'}
    <div class="history-locked-block">
      <div class="history-locked-overlay">
        <p>Ya sabemos qué trae este producto. Ahora dinos qué NO puedes comer tú o tu familia,
        y Yomi revisa cada escaneo contra tu perfil antes de que muerdas.</p>
        <a href="preferences.html" class="btn btn-primary">Empezar prueba gratis de 7 días</a>
      </div>
    </div>
  `;
}

async function renderCloudHistory(root) {
  const token = await getIdToken();
  const res = await fetch('/api/me/history', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    root.innerHTML = '<p class="account-empty">No se pudo cargar tu historial. Intenta de nuevo.</p>';
    return;
  }
  const { history } = await res.json();
  root.innerHTML = history.map(h => `
    <div class="about-card">
      <p>${h.productName}</p>
      <span class="verdict-badge verdict-${h.verdict}">${h.verdict}</span>
    </div>
  `).join('') || '<p class="account-empty">Aún no tienes escaneos.</p>';
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
