import { firebaseAuth, signOut } from './firebase-init.js';
import { getCachedProfile, syncUserProfile } from './authClient.js';

export function renderAccountHub() {
  const profile = getCachedProfile();
  const root = document.getElementById('account-root');
  if (!root) return;

  if (!profile) {
    window.location.href = 'auth.html';
    return;
  }

  const isPremium = profile.plan === 'premium';
  const prefs = profile.preferences;
  const hasPrefs = prefs && ((prefs.dietary || []).length || (prefs.allergens || []).length || (prefs.healthConditions || []).length);

  const summaryHtml = hasPrefs
    ? `<p class="account-summary">Tu perfil: ${[...(prefs.dietary || []), ...(prefs.allergens || []).map(a => a.code), ...(prefs.healthConditions || [])].join(', ')}</p>`
    : '<p class="account-empty">Aún no configuraste tus preferencias.</p>';

  root.innerHTML = `
    <div class="about-card">
      <p class="account-email">${profile.email || ''}</p>
      <span class="account-plan-badge account-plan-${profile.plan}">${isPremium ? 'Premium' : 'Free'}</span>
    </div>
    <div class="about-card">
      ${summaryHtml}
      ${isPremium ? '<a href="preferences.html" class="btn-primary">Editar preferencias</a>' : ''}
    </div>
    ${!isPremium ? `
      <div class="about-card account-upsell">
        <p>Activa alertas cuando un producto no es apto para tu perfil.</p>
        <a href="preferences.html" class="btn-primary">Hazte Premium</a>
      </div>` : ''}
    <button type="button" id="btn-logout">Cerrar sesión</button>
  `;

  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
}

export async function handleLogout() {
  await signOut(firebaseAuth);
  window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', async () => {
  await syncUserProfile();
  renderAccountHub();
});
