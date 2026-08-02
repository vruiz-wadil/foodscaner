import { firebaseAuth, signOut, reauthenticateWithCredential, verifyBeforeUpdateEmail, updatePassword, EmailAuthProvider } from './firebase-init.js';
import { getIdToken, getCachedProfile, syncUserProfile } from './authClient.js';
import { mapAuthError } from './authErrors.js';
import { COUNTRY_CODES, flagEmoji, splitE164 } from './country-codes.js';
import { showPendingToast, showToast } from './toast.js';
import { buildPreferenceSummary } from './preference-labels.js';

// Suma de ítems declarados por el usuario — sin backend nuevo, se deriva
// del perfil ya cacheado. Para free (sin preferences) siempre 0.
export function computeAlertsActive(prefs) {
  if (!prefs) return 0;
  return (prefs.dietary || []).length + (prefs.allergens || []).length + (prefs.healthConditions || []).length;
}

const PROFILE_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d="M17.4167 19.25V17.4167C17.4167 16.4442 17.0304 15.5116 16.3428 14.8239C15.6551 14.1363 14.7225 13.75 13.75 13.75H8.25004C7.27758 13.75 6.34495 14.1363 5.65732 14.8239C4.96968 15.5116 4.58337 16.4442 4.58337 17.4167V19.25" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 10.0833C13.0251 10.0833 14.6667 8.44171 14.6667 6.41667C14.6667 4.39162 13.0251 2.75 11 2.75C8.975 2.75 7.33337 4.39162 7.33337 6.41667C7.33337 8.44171 8.975 10.0833 11 10.0833Z" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const BADGE_LABEL = { active: 'Activa', pending: 'Pendiente', expired: 'Expirada' };

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hasPasswordProvider() {
  const user = firebaseAuth.currentUser;
  return !!(user && Array.isArray(user.providerData) && user.providerData.some(p => p.providerId === 'password'));
}

function renderEmailVerificationBanner() {
  const user = firebaseAuth.currentUser;
  if (!user || user.emailVerified || !hasPasswordProvider()) return '';
  return `
    <div class="row-card account-renew">
      <div class="icon-wrap" style="background:rgba(245,166,35,0.15);">✉️</div>
      <div>
        <p class="about-text">Tu correo no está verificado.</p>
        <button type="button" id="btn-resend-verification" class="btn btn-secondary">Reenviar correo de verificación</button>
        <p id="resend-verification-success" class="hidden" role="status"></p>
        <p id="resend-verification-error" class="hidden modal-inline-error" role="alert"></p>
      </div>
    </div>
  `;
}

const CATEGORY_SECTION_LABEL = { dietary: 'Dietético', allergens: 'Alergias', health: 'Condiciones' };

function renderPreferenceChips(chips) {
  const byCategory = { dietary: [], allergens: [], health: [] };
  chips.forEach(chip => byCategory[chip.category]?.push(chip));
  return ['dietary', 'allergens', 'health']
    .filter(cat => byCategory[cat].length)
    .map(cat => `
      <div class="account-preference-group">
        <div class="account-preference-group-label">${CATEGORY_SECTION_LABEL[cat]}</div>
        <div class="account-preference-chips">
          ${byCategory[cat].map(chip => {
            const severityClass = ['mild', 'severe'].includes(chip.severity) ? ` severity-${chip.severity}` : '';
            const text = chip.extra ? `${chip.label} · ${chip.extra}` : chip.label;
            return `<span class="account-preference-chip${severityClass}">${chip.emoji} ${escapeHtml(text)}</span>`;
          }).join('')}
        </div>
      </div>`).join('');
}

function renderPreferenceSummary({ counts, chips }) {
  const countsLine = counts.map(c => `${c.emoji} ${escapeHtml(c.text)}`).join(' · ');
  const toggleLabel = preferenceSummaryExpanded ? 'Ocultar ▲' : 'Ver todo ▾';
  const expandedHtml = preferenceSummaryExpanded ? renderPreferenceChips(chips) : '';
  return `
    <div class="account-preference-summary">
      <div class="account-preference-summary-line">
        <span>${countsLine}</span>
        <button type="button" id="btn-toggle-preference-summary" class="account-preference-toggle">${toggleLabel}</button>
      </div>
      ${expandedHtml}
    </div>`;
}

// Solo una fila (nombre, teléfono-con-email, o correo-de-contacto) puede
// estar en edición inline a la vez — correo-de-identidad/teléfono-SMS/
// contraseña son multi-paso y usan el modal en su lugar, así que no
// compiten por este estado.
let editingRow = null; // 'name' | 'phone' | 'email' | null
let preferenceSummaryExpanded = false;

function renderCountryOptions(selectedDial) {
  return COUNTRY_CODES.map(c => `<option value="${c.dial}" ${c.dial === selectedDial ? 'selected' : ''}>${c.name} (${c.dial}) ${flagEmoji(c.iso2)}</option>`).join('');
}

function renderNameRow(displayName) {
  if (editingRow === 'name') {
    return `
      <div class="account-data-row account-data-row-editing" data-row="name">
        <input id="input-edit-name" class="form-input" type="text" value="${escapeHtml(displayName)}">
        <button type="button" id="btn-save-name" class="row-icon-btn" aria-label="Guardar nombre">✔️</button>
        <button type="button" id="btn-cancel-name" class="row-icon-btn" aria-label="Cancelar edición de nombre">✖️</button>
      </div>
      <p id="edit-name-error" class="hidden modal-inline-error" role="alert"></p>
    `;
  }
  return `
    <div class="account-data-row" data-row="name">
      <div class="account-data-info">
        <div class="account-data-label">Nombre</div>
        <div class="account-data-value">${escapeHtml(displayName) || 'Sin nombre'}</div>
      </div>
      <button type="button" id="btn-edit-name" class="row-icon-btn" aria-label="Editar nombre">✏️</button>
    </div>
  `;
}

function renderPhoneRow(profile, phoneContact) {
  const hasEmailLogin = !!profile.email;

  if (!hasEmailLogin) {
    // Login por teléfono: cambiar el número real requiere verificar un
    // código SMS (2 pasos), así que va al modal en vez de edición inline.
    return `
      <div class="account-data-row" data-row="phone">
        <div class="account-data-info">
          <div class="account-data-label">Teléfono</div>
          <div class="account-data-value">${escapeHtml(phoneContact)}</div>
        </div>
        <button type="button" id="btn-open-phone-modal" class="row-icon-btn" aria-label="Cambiar teléfono">✏️</button>
      </div>
    `;
  }

  if (editingRow === 'phone') {
    const { dial, local } = splitE164(phoneContact);
    return `
      <div class="account-data-row account-data-row-editing" data-row="phone">
        <select id="input-edit-phone-country" class="form-input">${renderCountryOptions(dial)}</select>
        <input id="input-edit-phone-contact" class="form-input" type="tel" value="${escapeHtml(local)}">
        <button type="button" id="btn-save-phone" class="row-icon-btn" aria-label="Guardar teléfono">✔️</button>
        <button type="button" id="btn-cancel-phone" class="row-icon-btn" aria-label="Cancelar edición de teléfono">✖️</button>
      </div>
      <p id="edit-phone-error" class="hidden modal-inline-error" role="alert"></p>
    `;
  }
  return `
    <div class="account-data-row" data-row="phone">
      <div class="account-data-info">
        <div class="account-data-label">Teléfono</div>
        <div class="account-data-value">${escapeHtml(phoneContact) || 'Sin teléfono'}</div>
      </div>
      <button type="button" id="btn-edit-phone" class="row-icon-btn" aria-label="Editar teléfono">✏️</button>
    </div>
  `;
}

function renderEmailRow(profile) {
  return `
    <div class="account-data-row" data-row="email">
      <div class="account-data-info">
        <div class="account-data-label">Correo</div>
        <div class="account-data-value">${escapeHtml(profile.email)}</div>
      </div>
      <button type="button" id="btn-edit-email" class="row-icon-btn" aria-label="Editar correo">✏️</button>
    </div>
  `;
}

// Solo para cuentas SIN identidad de correo real (login por teléfono, sin
// password provider) — onboarding ya pide un correo de contacto para estas
// cuentas, pero no había forma de editarlo después (hallazgo). Edición
// inline simple, sin reautenticar ni verificar — es un dato de contacto,
// no cambia el login, igual que el teléfono-de-contacto en las cuentas que
// sí tienen correo de identidad.
function renderEmailContactRow(emailContact) {
  if (editingRow === 'email') {
    return `
      <div class="account-data-row account-data-row-editing" data-row="email">
        <input id="input-edit-email-contact" class="form-input" type="email" value="${escapeHtml(emailContact)}">
        <button type="button" id="btn-save-email-contact" class="row-icon-btn" aria-label="Guardar correo">✔️</button>
        <button type="button" id="btn-cancel-email-contact" class="row-icon-btn" aria-label="Cancelar edición de correo">✖️</button>
      </div>
      <p id="edit-email-contact-error" class="hidden modal-inline-error" role="alert"></p>
    `;
  }
  return `
    <div class="account-data-row" data-row="email">
      <div class="account-data-info">
        <div class="account-data-label">Correo</div>
        <div class="account-data-value">${escapeHtml(emailContact) || 'Sin correo'}</div>
      </div>
      <button type="button" id="btn-edit-email-contact" class="row-icon-btn" aria-label="Editar correo">✏️</button>
    </div>
  `;
}

function formatMembershipDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderSubscriptionBlock(profile) {
  const autoRenew = profile.autoRenew !== false;
  const expiresLabel = formatMembershipDate(profile.membershipExpiresAt);
  const statusLine = autoRenew
    ? `Se renovará automáticamente el ${expiresLabel}.`
    : `Vence el ${expiresLabel} — no se renovará.`;
  const actionBtn = autoRenew
    ? `<button type="button" id="btn-open-cancel-subscription-modal" class="account-link-btn">Cancelar suscripción</button>`
    : `<button type="button" id="btn-reactivate-subscription" class="account-link-btn">Reactivar suscripción</button>
      <p id="reactivate-subscription-error" class="hidden modal-inline-error" role="alert"></p>`;

  const history = profile.paymentHistory || [];
  const historyHtml = history.length ? `
    <div class="account-payment-history">
      <div class="account-data-label">Historial de pagos</div>
      ${history.slice().reverse().map(p => `
        <div class="account-payment-row">
          <span>${formatMembershipDate(p.date)}</span>
          <span>$${Number(p.amount).toFixed(2)} (${escapeHtml(p.method)})</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  return `
    <div class="account-subscription-block" data-row="subscription">
      <div class="account-subscription-status">${statusLine}</div>
      ${actionBtn}
    </div>
    ${historyHtml}
  `;
}

function openCancelSubscriptionModal(profile) {
  const expiresLabel = formatMembershipDate(profile.membershipExpiresAt);
  openModal(`
    <div class="modal-header"><h2>¿Cancelar tu suscripción?</h2><button type="button" class="modal-close" aria-label="Cerrar">×</button></div>
    <p class="about-text">Conservas acceso completo hasta el ${expiresLabel}. Después de esa fecha no se te volverá a cobrar y tu cuenta pasará a inactiva.</p>
    <div class="modal-actions">
      <button type="button" id="btn-cancel-subscription-back" class="btn btn-secondary">Volver</button>
      <button type="button" id="btn-cancel-subscription-confirm" class="btn btn-primary">Sí, cancelar</button>
    </div>
    <p id="cancel-subscription-error" class="hidden modal-inline-error" role="alert"></p>
  `);
  document.getElementById('btn-cancel-subscription-back')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-subscription-confirm')?.addEventListener('click', () => {
    submitCancelSubscription().then(() => closeModal()).catch(() => {});
  });
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
  const displayName = (profile.profile && profile.profile.displayName) || profile.displayName || '';
  const phoneContact = profile.phoneNumber || (profile.profile && profile.profile.phone) || '';
  const emailContact = profile.email || (profile.profile && profile.profile.email) || '';

  const summaryHtml = hasPrefs
    ? renderPreferenceSummary(buildPreferenceSummary(prefs))
    : '<p class="account-empty">Aún no configuraste tus preferencias.</p>';

  const renewCta = status === 'expired'
    ? { text: 'Tu membresía venció. Renuévala para seguir escaneando y guardar tu historial.', btn: 'Renovar membresía' }
    : { text: 'Completa tu membresía para desbloquear el escaneo de ingredientes.', btn: 'Activar membresía' };

  root.innerHTML = `
    <div class="content-card">
      <div class="account-data-label" style="margin-bottom:10px;">Perfil</div>
      <div class="hero-card-dark">
        <div class="icon-wrap">${PROFILE_ICON_SVG}</div>
        <div>
          <p class="account-name">${escapeHtml(displayName) || 'Sin nombre'}</p>
          <p class="account-email">${escapeHtml(profile.email || profile.phoneNumber || '')}</p>
          <span class="account-plan-badge account-plan-${status}">${BADGE_LABEL[status] || 'Pendiente'}</span>
        </div>
      </div>
      ${renderEmailVerificationBanner()}
      <div class="stat-row">
        <div class="stat-tile"><div class="stat-num">${totalScans}</div><div class="stat-label">Escaneos</div></div>
        <div class="stat-tile"><div class="stat-num">${alertsActive}</div><div class="stat-label">Alertas activas</div></div>
      </div>
      <div class="account-data-section">
        ${renderNameRow(displayName)}
        ${renderPhoneRow(profile, phoneContact)}
        ${hasPasswordProvider() ? renderEmailRow(profile) : (!profile.email ? renderEmailContactRow(emailContact) : '')}
        ${hasPasswordProvider() ? `
          <div class="account-data-row account-password-row">
            <button type="button" id="btn-open-password-modal" class="account-link-btn">Cambiar contraseña</button>
          </div>` : ''}
      </div>
    </div>
    <div class="content-card">
      <div class="account-data-label" style="margin-bottom:10px;">Preferencias</div>
      <div class="row-card account-preference-row">
        ${summaryHtml}
        <a href="preferences.html" class="btn btn-secondary">Editar preferencias</a>
      </div>
    </div>
    <div class="content-card">
      <div class="account-data-label" style="margin-bottom:10px;">Invita a un amigo</div>
      <div class="row-card">
        <p class="about-text">¿Conoces a alguien a quien le sirva saber qué come? Compártele Yomi.</p>
        <button type="button" id="btn-invite-friend" class="btn btn-secondary">Compartir Yomi</button>
      </div>
    </div>
    <div class="content-card">
      <div class="account-data-label" style="margin-bottom:10px;">Suscripción</div>
      ${isActive ? renderSubscriptionBlock(profile) : `
        <div class="row-card account-renew">
          <div class="icon-wrap" style="background:rgba(245,166,35,0.15);">🔔</div>
          <div>
            <p class="about-text">${renewCta.text}</p>
            <button type="button" id="btn-renew-membership" class="btn btn-primary">${renewCta.btn}</button>
            <p id="account-renew-error" class="hidden"></p>
          </div>
        </div>`}
    </div>
    <button type="button" id="btn-logout" class="btn btn-secondary">Cerrar sesión</button>
  `;

  wireAccountHubEvents(profile);
}

function wireAccountHubEvents(profile) {
  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
  document.getElementById('btn-invite-friend')?.addEventListener('click', (e) => {
    window.shareApp(e.currentTarget);
  });
  document.getElementById('btn-resend-verification')?.addEventListener('click', () => {
    submitResendVerification().catch(() => {});
  });
  document.getElementById('btn-renew-membership')?.addEventListener('click', () => {
    handleRenewMembership().catch(() => {});
  });

  document.getElementById('btn-toggle-preference-summary')?.addEventListener('click', () => {
    preferenceSummaryExpanded = !preferenceSummaryExpanded;
    renderAccountHub();
    document.getElementById('btn-toggle-preference-summary')?.focus();
  });

  document.getElementById('btn-edit-name')?.addEventListener('click', () => {
    editingRow = 'name';
    renderAccountHub();
  });
  document.getElementById('btn-cancel-name')?.addEventListener('click', () => {
    editingRow = null;
    renderAccountHub();
  });
  document.getElementById('btn-save-name')?.addEventListener('click', () => {
    submitNameEdit().catch(() => {});
  });

  document.getElementById('btn-edit-phone')?.addEventListener('click', () => {
    editingRow = 'phone';
    renderAccountHub();
  });
  document.getElementById('btn-cancel-phone')?.addEventListener('click', () => {
    editingRow = null;
    renderAccountHub();
  });
  document.getElementById('btn-save-phone')?.addEventListener('click', () => {
    submitPhoneContactEdit().catch(() => {});
  });
  document.getElementById('btn-open-phone-modal')?.addEventListener('click', () => {
    openPhoneChangeModal();
  });

  document.getElementById('btn-edit-email')?.addEventListener('click', () => {
    openEmailModal(profile);
  });
  document.getElementById('btn-edit-email-contact')?.addEventListener('click', () => {
    editingRow = 'email';
    renderAccountHub();
  });
  document.getElementById('btn-cancel-email-contact')?.addEventListener('click', () => {
    editingRow = null;
    renderAccountHub();
  });
  document.getElementById('btn-save-email-contact')?.addEventListener('click', () => {
    submitEmailContactEdit().catch(() => {});
  });
  document.getElementById('btn-open-password-modal')?.addEventListener('click', () => {
    openPasswordModal();
  });
  document.getElementById('btn-open-cancel-subscription-modal')?.addEventListener('click', () => {
    openCancelSubscriptionModal(profile);
  });
  document.getElementById('btn-reactivate-subscription')?.addEventListener('click', () => {
    submitReactivateSubscription().catch(() => {});
  });
}

// === Modal genérico (correo / teléfono-SMS / contraseña) ===
// app.js ya tiene un helper equivalente (openModalA11y/closeModalA11y,
// compartido por los modales de OCR/nutrición/reporte) pero app.js es un
// script clásico que scan.html carga y account.html no — no es importable
// desde este módulo, así que account-ui.js tiene su propia copia mínima,
// reusando las mismas clases CSS (.modal/.modal-content/...) de styles.css.
let _lastFocusedBeforeModal = null;

function trapModalTabKey(e) {
  if (e.key !== 'Tab') return;
  const modalEl = e.currentTarget;
  const focusable = Array.from(modalEl.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function openModal(innerHtml) {
  closeModal();
  const modalEl = document.createElement('div');
  modalEl.id = 'account-modal';
  modalEl.className = 'modal';
  modalEl.innerHTML = `<div class="modal-overlay"></div><div class="modal-content">${innerHtml}</div>`;
  document.body.appendChild(modalEl);

  modalEl.querySelector('.modal-overlay').addEventListener('click', closeModal);
  modalEl.querySelector('.modal-close')?.addEventListener('click', closeModal);

  _lastFocusedBeforeModal = document.activeElement;
  const heading = modalEl.querySelector('h2, h3');
  if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); }
  modalEl._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  modalEl.addEventListener('keydown', modalEl._escHandler);
  modalEl.addEventListener('keydown', trapModalTabKey);

  return modalEl;
}

function closeModal() {
  const modalEl = document.getElementById('account-modal');
  if (!modalEl) return;
  modalEl.removeEventListener('keydown', trapModalTabKey);
  if (modalEl._escHandler) modalEl.removeEventListener('keydown', modalEl._escHandler);
  modalEl.remove();
  if (_lastFocusedBeforeModal && typeof _lastFocusedBeforeModal.focus === 'function') {
    _lastFocusedBeforeModal.focus();
  }
  _lastFocusedBeforeModal = null;
}

function openPhoneChangeModal() {
  openModal(`
    <div class="modal-header"><h2>Cambiar teléfono</h2><button type="button" class="modal-close" aria-label="Cerrar">×</button></div>
    <div id="phone-login-flow">
      <div class="form-field">
        <label for="input-new-phone">Nuevo número</label>
        <select id="input-new-phone-country" class="form-input">${renderCountryOptions('+52')}</select>
        <input id="input-new-phone" class="form-input" type="tel" placeholder="5512345678">
      </div>
      <button type="button" id="btn-phone-send-code" class="btn btn-secondary">Enviar código</button>
      <div class="form-field">
        <label for="input-phone-code">Código de verificación</label>
        <input id="input-phone-code" class="form-input" type="text" inputmode="numeric" maxlength="6">
      </div>
      <button type="button" id="btn-phone-confirm-change" class="btn btn-primary">Confirmar cambio</button>
    </div>
    <p id="edit-phone-error" class="hidden modal-inline-error" role="alert"></p>
  `);
  document.getElementById('btn-phone-send-code')?.addEventListener('click', () => {
    submitPhoneSendCode().catch(() => {});
  });
  document.getElementById('btn-phone-confirm-change')?.addEventListener('click', () => {
    submitPhoneChangeConfirm().then(() => closeModal()).catch(() => {});
  });
}

function openEmailModal(profile) {
  openModal(`
    <div class="modal-header"><h2>Cambiar correo</h2><button type="button" class="modal-close" aria-label="Cerrar">×</button></div>
    <form id="form-edit-email">
      <div class="form-field">
        <label for="input-edit-email">Correo nuevo</label>
        <input id="input-edit-email" class="form-input" type="email" placeholder="${escapeHtml(profile.email)}">
      </div>
      <div class="form-field">
        <label for="input-email-current-password">Confirma tu contraseña actual</label>
        <input id="input-email-current-password" class="form-input" type="password">
      </div>
      <button type="submit" class="btn btn-primary">Guardar correo</button>
      <p id="edit-email-error" class="hidden modal-inline-error" role="alert"></p>
      <p id="edit-email-success" class="hidden" role="status"></p>
    </form>
  `);
  document.getElementById('form-edit-email')?.addEventListener('submit', e => {
    e.preventDefault();
    submitEmailEdit().catch(() => {});
  });
}

function openPasswordModal() {
  openModal(`
    <div class="modal-header"><h2>Cambiar contraseña</h2><button type="button" class="modal-close" aria-label="Cerrar">×</button></div>
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
      <p id="edit-password-error" class="hidden modal-inline-error" role="alert"></p>
      <p id="edit-password-success" class="hidden" role="status"></p>
    </form>
  `);
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
    const data = await res.json();
    window.location.href = data.checkoutUrl;
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    showRenewError('No se pudo procesar el pago. Intenta de nuevo.');
    console.warn('[account] no se pudo iniciar el pago de membresía:', err.message);
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
  editingRow = null;
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
  const dial = document.getElementById('input-edit-phone-country')?.value || '';
  const local = document.getElementById('input-edit-phone-contact')?.value.trim() || '';
  const phone = dial + local.replace(/\D/g, '');
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
  editingRow = null;
  await syncUserProfile();
  renderAccountHub();
}

function showEmailContactError(message) {
  const el = document.getElementById('edit-email-contact-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function submitEmailContactEdit() {
  const input = document.getElementById('input-edit-email-contact');
  const email = input ? input.value.trim() : '';
  const token = await getIdToken();
  const res = await fetch('/api/me/profile', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  if (!res.ok) {
    showEmailContactError('No se pudo guardar tu correo. Intenta de nuevo.');
    throw new Error('save_failed');
  }
  editingRow = null;
  await syncUserProfile();
  renderAccountHub();
}

export async function submitPhoneSendCode() {
  const dial = document.getElementById('input-new-phone-country')?.value || '';
  const local = document.getElementById('input-new-phone')?.value.trim() || '';
  const phone = dial + local.replace(/\D/g, '');
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
  const dial = document.getElementById('input-new-phone-country')?.value || '';
  const localInput = document.getElementById('input-new-phone');
  const codeInput = document.getElementById('input-phone-code');
  const phone = dial + (localInput ? localInput.value.trim().replace(/\D/g, '') : '');
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

function showCancelSubscriptionError(message) {
  const el = document.getElementById('cancel-subscription-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function showReactivateSubscriptionError(message) {
  const el = document.getElementById('reactivate-subscription-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function showResendVerificationError(message) {
  const el = document.getElementById('resend-verification-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

const ONBOARDING_PREFS_KEY = 'yomi_pending_preferences';

async function flushPendingPreferences(token) {
  const pendingPrefs = sessionStorage.getItem(ONBOARDING_PREFS_KEY);
  if (!pendingPrefs) return;
  try {
    await fetch('/api/me/preferences', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: pendingPrefs
    });
  } catch (e) {
    console.warn('[account] no se pudieron guardar preferencias pendientes:', e.message);
  }
  sessionStorage.removeItem(ONBOARDING_PREFS_KEY);
}

export async function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  const stripeParam = params.get('stripe');
  if (!stripeParam) return;

  // Si checkout-result falla, dejamos ?stripe=success&session_id=… en la URL:
  // las preferencias pendientes del onboarding sólo se envían cuando la
  // confirmación sale bien, así que borrar los params ahí mataría la única vía
  // de reintento (recargar la página vuelve a llamar handleStripeReturn).
  let keepParamsForRetry = false;

  if (stripeParam === 'success') {
    const sessionId = params.get('session_id');
    if (sessionId) {
      try {
        const token = await getIdToken();
        const res = await fetch(`/api/me/membership/checkout-result?session_id=${encodeURIComponent(sessionId)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          await flushPendingPreferences(token);
          showToast('¡Pago confirmado! Tu membresía está activa.');
        } else {
          keepParamsForRetry = true;
          showToast('Pago recibido, confirmando con Stripe…');
        }
      } catch (err) {
        keepParamsForRetry = true;
        console.warn('[account] no se pudo confirmar el checkout de Stripe:', err.message);
      }
    }
  } else if (stripeParam === 'cancel') {
    showToast('Pago cancelado.');
  }

  if (keepParamsForRetry) return;

  params.delete('stripe');
  params.delete('session_id');
  const newQuery = params.toString();
  const newUrl = window.location.pathname + (newQuery ? `?${newQuery}` : '') + window.location.hash;
  window.history.replaceState({}, '', newUrl);
}

export async function submitCancelSubscription() {
  const token = await getIdToken();
  const res = await fetch('/api/me/membership/cancel', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    showCancelSubscriptionError('No se pudo cancelar tu suscripción. Intenta de nuevo.');
    throw new Error('cancel_failed');
  }
  await syncUserProfile();
  renderAccountHub();
}

export async function submitReactivateSubscription() {
  const token = await getIdToken();
  const res = await fetch('/api/me/membership/reactivate', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    showReactivateSubscriptionError('No se pudo reactivar tu suscripción. Intenta de nuevo.');
    throw new Error('reactivate_failed');
  }
  await syncUserProfile();
  renderAccountHub();
}

export async function submitResendVerification() {
  const btn = document.getElementById('btn-resend-verification');
  const originalText = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  try {
    const token = await getIdToken();
    const res = await fetch('/api/me/verification-email', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('resend_failed');
    const successEl = document.getElementById('resend-verification-success');
    if (successEl) { successEl.textContent = 'Correo de verificación enviado.'; successEl.classList.remove('hidden'); }
  } catch (err) {
    showResendVerificationError('No se pudo reenviar el correo de verificación. Intenta de nuevo.');
    throw err;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}

export async function handleLogout() {
  await signOut(firebaseAuth);
  window.location.href = 'index.html';
}

export async function initAccountPage() {
  await handleStripeReturn();
  await syncUserProfile();
  renderAccountHub();
  showPendingToast();
}

document.addEventListener('DOMContentLoaded', () => {
  initAccountPage();
});
