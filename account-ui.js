import { firebaseAuth, signOut } from './firebase-init.js';
import { getIdToken, getCachedProfile, syncUserProfile } from './authClient.js';

// Suma de ítems declarados por el usuario — sin backend nuevo, se deriva
// del perfil ya cacheado. Para free (sin preferences) siempre 0.
export function computeAlertsActive(prefs) {
  if (!prefs) return 0;
  return (prefs.dietary || []).length + (prefs.allergens || []).length + (prefs.healthConditions || []).length;
}

const PROFILE_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d="M17.4167 19.25V17.4167C17.4167 16.4442 17.0304 15.5116 16.3428 14.8239C15.6551 14.1363 14.7225 13.75 13.75 13.75H8.25004C7.27758 13.75 6.34495 14.1363 5.65732 14.8239C4.96968 15.5116 4.58337 16.4442 4.58337 17.4167V19.25" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 10.0833C13.0251 10.0833 14.6667 8.44171 14.6667 6.41667C14.6667 4.39162 13.0251 2.75 11 2.75C8.975 2.75 7.33337 4.39162 7.33337 6.41667C7.33337 8.44171 8.975 10.0833 11 10.0833Z" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const BADGE_LABEL = { active: 'Activa', pending: 'Pendiente', expired: 'Expirada' };

export function renderAccountHub() {
  const profile = getCachedProfile();
  const root = document.getElementById('account-root');
  if (!root) return;

  if (!profile) {
    window.location.href = 'auth.html';
    return;
  }

  const status = profile.membershipStatus;
  const isActive = status === 'active';
  const prefs = profile.preferences;
  const hasPrefs = prefs && ((prefs.dietary || []).length || (prefs.allergens || []).length || (prefs.healthConditions || []).length);
  const totalScans = (profile.usage && profile.usage.totalScans) || 0;
  const alertsActive = computeAlertsActive(prefs);

  const summaryHtml = hasPrefs
    ? `<p class="account-summary">Tu perfil: ${[...(prefs.dietary || []), ...(prefs.allergens || []).map(a => a.code), ...(prefs.healthConditions || [])].join(', ')}</p>`
    : '<p class="account-empty">Aún no configuraste tus preferencias.</p>';

  const renewCta = status === 'expired'
    ? { text: 'Tu membresía venció. Renuévala para seguir escaneando y guardar tu historial.', btn: 'Renovar membresía' }
    : { text: 'Completa tu membresía para desbloquear el escaneo de ingredientes.', btn: 'Activar membresía' };

  root.innerHTML = `
    <div class="content-card">
      <div class="hero-card-dark">
        <div class="icon-wrap">${PROFILE_ICON_SVG}</div>
        <div>
          <p class="account-email">${profile.email || profile.phoneNumber || ''}</p>
          <span class="account-plan-badge account-plan-${status}">${BADGE_LABEL[status] || 'Pendiente'}</span>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat-tile"><div class="stat-num">${totalScans}</div><div class="stat-label">Escaneos</div></div>
        <div class="stat-tile"><div class="stat-num">${alertsActive}</div><div class="stat-label">Alertas activas</div></div>
      </div>
      <div class="row-card">
        ${summaryHtml}
        <a href="preferences.html" class="btn btn-secondary">Editar preferencias</a>
      </div>
      ${!isActive ? `
        <div class="row-card account-renew">
          <div class="icon-wrap" style="background:rgba(245,166,35,0.15);">🔔</div>
          <div>
            <p class="about-text">${renewCta.text}</p>
            <button type="button" id="btn-renew-membership" class="btn btn-primary">${renewCta.btn}</button>
          </div>
        </div>` : ''}
      <button type="button" id="btn-logout" class="btn btn-secondary">Cerrar sesión</button>
    </div>
  `;

  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
  document.getElementById('btn-renew-membership')?.addEventListener('click', () => handleRenewMembership());
}

export async function handleRenewMembership() {
  const btn = document.getElementById('btn-renew-membership');
  if (btn) { btn.disabled = true; btn.textContent = 'Procesando…'; }
  try {
    const token = await getIdToken();
    await fetch('/api/me/membership/pay', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    await syncUserProfile();
    renderAccountHub();
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function handleLogout() {
  await signOut(firebaseAuth);
  window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', async () => {
  await syncUserProfile();
  renderAccountHub();
});
