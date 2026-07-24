import { firebaseAuth, signOut, reauthenticateWithCredential, verifyBeforeUpdateEmail, updatePassword, EmailAuthProvider } from './firebase-init.js';
import { getIdToken, getCachedProfile, syncUserProfile } from './authClient.js';
import { mapAuthError } from './authErrors.js';

// Suma de ítems declarados por el usuario — sin backend nuevo, se deriva
// del perfil ya cacheado. Para free (sin preferences) siempre 0.
export function computeAlertsActive(prefs) {
  if (!prefs) return 0;
  return (prefs.dietary || []).length + (prefs.allergens || []).length + (prefs.healthConditions || []).length;
}

const PROFILE_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d="M17.4167 19.25V17.4167C17.4167 16.4442 17.0304 15.5116 16.3428 14.8239C15.6551 14.1363 14.7225 13.75 13.75 13.75H8.25004C7.27758 13.75 6.34495 14.1363 5.65732 14.8239C4.96968 15.5116 4.58337 16.4442 4.58337 17.4167V19.25" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 10.0833C13.0251 10.0833 14.6667 8.44171 14.6667 6.41667C14.6667 4.39162 13.0251 2.75 11 2.75C8.975 2.75 7.33337 4.39162 7.33337 6.41667C7.33337 8.44171 8.975 10.0833 11 10.0833Z" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const BADGE_LABEL = { active: 'Activa', pending: 'Pendiente', expired: 'Expirada' };

function hasPasswordProvider() {
  const user = firebaseAuth.currentUser;
  return !!(user && Array.isArray(user.providerData) && user.providerData.some(p => p.providerId === 'password'));
}

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
            <p id="account-renew-error" class="hidden"></p>
          </div>
        </div>` : ''}
      <div class="row-card">
        <button type="button" id="btn-toggle-edit" class="btn btn-secondary">Editar mis datos</button>
      </div>
      <div id="account-edit-section" class="hidden">
        <form id="form-edit-name">
          <div class="form-field">
            <label for="input-edit-name">Nombre</label>
            <input id="input-edit-name" class="form-input" type="text" value="${(profile.profile && profile.profile.displayName) || profile.displayName || ''}">
          </div>
          <button type="submit" class="btn btn-primary">Guardar nombre</button>
          <p id="edit-name-error" class="hidden" role="alert"></p>
        </form>
        <form id="form-edit-phone">
          ${profile.email ? `
            <div class="form-field">
              <label for="input-edit-phone-contact">Teléfono</label>
              <input id="input-edit-phone-contact" class="form-input" type="tel" value="${profile.phoneNumber || (profile.profile && profile.profile.phone) || ''}">
            </div>
            <button type="submit" class="btn btn-primary">Guardar teléfono</button>
          ` : `
            <div id="phone-login-flow">
              <div class="form-field">
                <label for="input-new-phone">Nuevo número</label>
                <input id="input-new-phone" class="form-input" type="tel" placeholder="+525512345678">
              </div>
              <button type="button" id="btn-phone-send-code" class="btn btn-secondary">Enviar código</button>
              <div class="form-field">
                <label for="input-phone-code">Código de verificación</label>
                <input id="input-phone-code" class="form-input" type="text" inputmode="numeric" maxlength="6">
              </div>
              <button type="button" id="btn-phone-confirm-change" class="btn btn-primary">Confirmar cambio</button>
            </div>
          `}
          <p id="edit-phone-error" class="hidden" role="alert"></p>
        </form>
        ${hasPasswordProvider() ? `
          <form id="form-edit-email">
            <div class="form-field">
              <label for="input-edit-email">Correo nuevo</label>
              <input id="input-edit-email" class="form-input" type="email" placeholder="${profile.email || ''}">
            </div>
            <div class="form-field">
              <label for="input-email-current-password">Confirma tu contraseña actual</label>
              <input id="input-email-current-password" class="form-input" type="password">
            </div>
            <button type="submit" class="btn btn-primary">Guardar correo</button>
            <p id="edit-email-error" class="hidden" role="alert"></p>
            <p id="edit-email-success" class="hidden" role="status"></p>
          </form>
        ` : ''}
        ${hasPasswordProvider() ? `
          <form id="form-edit-password">
            <div class="form-field">
              <label for="input-current-password">Contraseña actual</label>
              <input id="input-current-password" class="form-input" type="password">
            </div>
            <div class="form-field">
              <label for="input-new-password">Nueva contraseña</label>
              <input id="input-new-password" class="form-input" type="password" minlength="6">
            </div>
            <div class="form-field">
              <label for="input-confirm-password">Confirmar nueva contraseña</label>
              <input id="input-confirm-password" class="form-input" type="password" minlength="6">
            </div>
            <button type="submit" class="btn btn-primary">Guardar contraseña</button>
            <p id="edit-password-error" class="hidden" role="alert"></p>
            <p id="edit-password-success" class="hidden" role="status"></p>
          </form>
        ` : ''}
      </div>
      <button type="button" id="btn-logout" class="btn btn-secondary">Cerrar sesión</button>
    </div>
  `;

  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
  document.getElementById('btn-renew-membership')?.addEventListener('click', () => {
    handleRenewMembership().catch(() => {});
  });
  document.getElementById('btn-toggle-edit')?.addEventListener('click', () => {
    document.getElementById('account-edit-section')?.classList.toggle('hidden');
  });
  document.getElementById('form-edit-name')?.addEventListener('submit', e => {
    e.preventDefault();
    submitNameEdit().catch(() => {});
  });
  document.getElementById('form-edit-phone')?.addEventListener('submit', e => {
    e.preventDefault();
    submitPhoneContactEdit().catch(() => {});
  });
  document.getElementById('btn-phone-send-code')?.addEventListener('click', () => {
    submitPhoneSendCode().catch(() => {});
  });
  document.getElementById('btn-phone-confirm-change')?.addEventListener('click', () => {
    submitPhoneChangeConfirm().catch(() => {});
  });
  document.getElementById('form-edit-email')?.addEventListener('submit', e => {
    e.preventDefault();
    submitEmailEdit().catch(() => {});
  });
  document.getElementById('form-edit-password')?.addEventListener('submit', e => {
    e.preventDefault();
    submitPasswordEdit().catch(() => {});
  });
}

function showRenewError(message) {
  const el = document.getElementById('account-renew-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function handleRenewMembership() {
  const btn = document.getElementById('btn-renew-membership');
  const originalText = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Procesando…'; }
  try {
    const token = await getIdToken();
    const res = await fetch('/api/me/membership/pay', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error('renew_failed');
    }
    await syncUserProfile();
    renderAccountHub();
  } catch (err) {
    // El botón NUNCA debe quedarse mostrando "Procesando…" — ya sea por un
    // res.ok:false del pago simulado o por un fetch que rechaza (red caída),
    // se restaura el texto/estado original y se avisa al usuario, siguiendo
    // el mismo patrón de showError que preferences-ui.js/onboarding-membership-ui.js.
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    showRenewError('No se pudo procesar el pago. Intenta de nuevo.');
    console.warn('[account] no se pudo renovar la membresía:', err.message);
    throw err;
  }
}

function showNameError(message) {
  const el = document.getElementById('edit-name-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function submitNameEdit() {
  const input = document.getElementById('input-edit-name');
  const name = input ? input.value.trim() : '';
  const errorEl = document.getElementById('edit-name-error');
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
  if (!name) {
    showNameError('Escribe tu nombre.');
    throw new Error('invalid_display_name');
  }
  const token = await getIdToken();
  const res = await fetch('/api/me/profile', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: name })
  });
  if (!res.ok) {
    showNameError('No se pudo guardar tu nombre. Intenta de nuevo.');
    throw new Error('save_failed');
  }
  await syncUserProfile();
  renderAccountHub();
}

function showPhoneError(message) {
  const el = document.getElementById('edit-phone-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function submitPhoneContactEdit() {
  const input = document.getElementById('input-edit-phone-contact');
  const phone = input ? input.value.trim() : '';
  const token = await getIdToken();
  const res = await fetch('/api/me/profile', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  if (!res.ok) {
    showPhoneError('No se pudo guardar tu teléfono. Intenta de nuevo.');
    throw new Error('save_failed');
  }
  await syncUserProfile();
  renderAccountHub();
}

export async function submitPhoneSendCode() {
  const input = document.getElementById('input-new-phone');
  const phone = input ? input.value.trim() : '';
  const res = await fetch('/api/auth/phone/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  if (!res.ok) {
    showPhoneError('No se pudo enviar el código. Intenta de nuevo.');
    throw new Error('send_failed');
  }
}

const PHONE_CHANGE_ERROR_MESSAGES = {
  invalid_code: 'Código incorrecto o expirado.',
  phone_in_use: 'Ese número ya está en uso por otra cuenta.',
  verify_failed: 'No se pudo verificar el código. Intenta más tarde.'
};

export async function submitPhoneChangeConfirm() {
  const phoneInput = document.getElementById('input-new-phone');
  const codeInput = document.getElementById('input-phone-code');
  const phone = phoneInput ? phoneInput.value.trim() : '';
  const code = codeInput ? codeInput.value.trim() : '';
  const token = await getIdToken();
  const res = await fetch('/api/me/phone/change', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    showPhoneError(PHONE_CHANGE_ERROR_MESSAGES[data.error] || 'No se pudo cambiar tu teléfono. Intenta de nuevo.');
    throw new Error(data.error || 'change_failed');
  }
  await syncUserProfile();
  renderAccountHub();
}

function showEmailError(message) {
  const el = document.getElementById('edit-email-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function showEmailSuccess(message) {
  const el = document.getElementById('edit-email-success');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function submitEmailEdit() {
  const emailInput = document.getElementById('input-edit-email');
  const passwordInput = document.getElementById('input-email-current-password');
  const newEmail = emailInput ? emailInput.value.trim() : '';
  const currentPassword = passwordInput ? passwordInput.value : '';
  const errorEl = document.getElementById('edit-email-error');
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }

  const user = firebaseAuth.currentUser;
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  } catch (err) {
    showEmailError(mapAuthError(err.code));
    throw err;
  }

  try {
    await verifyBeforeUpdateEmail(user, newEmail);
    showEmailSuccess('Revisa tu correo nuevo y confirma el cambio desde ahí.');
  } catch (err) {
    showEmailError(mapAuthError(err.code));
    throw err;
  }
}

function showPasswordError(message) {
  const el = document.getElementById('edit-password-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function submitPasswordEdit() {
  const currentInput = document.getElementById('input-current-password');
  const newInput = document.getElementById('input-new-password');
  const confirmInput = document.getElementById('input-confirm-password');
  const currentPassword = currentInput ? currentInput.value : '';
  const newPassword = newInput ? newInput.value : '';
  const confirmPassword = confirmInput ? confirmInput.value : '';
  const errorEl = document.getElementById('edit-password-error');
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }

  if (newPassword !== confirmPassword) {
    showPasswordError('Las contraseñas nuevas no coinciden.');
    throw new Error('password_mismatch');
  }

  const user = firebaseAuth.currentUser;
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  } catch (err) {
    showPasswordError(mapAuthError(err.code));
    throw err;
  }

  try {
    await updatePassword(user, newPassword);
    const successEl = document.getElementById('edit-password-success');
    if (successEl) { successEl.textContent = 'Tu contraseña se actualizó correctamente.'; successEl.classList.remove('hidden'); }
  } catch (err) {
    showPasswordError(mapAuthError(err.code));
    throw err;
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
