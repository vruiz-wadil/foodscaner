import { getIdToken, getCachedProfile, syncUserProfile } from './authClient.js';

const ALLERGEN_CODES = ['cacahuate', 'lacteos'];
const CONSENT_NOTICE_VERSION = 'v1';

function showError(message) {
  const el = document.getElementById('preferences-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearError() {
  const el = document.getElementById('preferences-error');
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

// Error mostrado JUNTO al checkbox de consentimiento, no solo en el error
// general del form (hallazgo UX: si el form es largo, el usuario no conecta
// el error de arriba con el checkbox que le falta marcar).
function showConsentError(message) {
  const el = document.getElementById('consent-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearConsentError() {
  const el = document.getElementById('consent-error');
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

// hallazgo #11: éxito de borrado no tenía ningún feedback — el form
// simplemente se quedaba igual y el usuario no sabía si funcionó.
function showSuccess(message) {
  const el = document.getElementById('preferences-success');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearSuccess() {
  const el = document.getElementById('preferences-success');
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

async function withLoadingState(button, loadingText, fn) {
  const originalText = button ? button.textContent : null;
  if (button) { button.disabled = true; button.textContent = loadingText; }
  try {
    return await fn();
  } finally {
    if (button) { button.disabled = false; button.textContent = originalText; }
  }
}

export function loadPreferencesIntoForm() {
  const profile = getCachedProfile();
  const prefs = profile && profile.preferences;
  if (!prefs) return;

  (prefs.dietary || []).forEach(key => {
    const el = document.querySelector(`[name="dietary"][value="${key}"]`);
    if (el) el.checked = true;
  });
  (prefs.healthConditions || []).forEach(key => {
    const el = document.querySelector(`[name="healthConditions"][value="${key}"]`);
    if (el) el.checked = true;
  });
  (prefs.allergens || []).forEach(({ code, severity }) => {
    const checkbox = document.getElementById(`allergen-${code}`);
    const severitySelect = document.getElementById(`severity-${code}`);
    if (checkbox) checkbox.checked = true;
    if (severitySelect) severitySelect.value = severity;
  });
}

function buildPreferencesPayload() {
  const dietary = Array.from(document.querySelectorAll('[name="dietary"]:checked')).map(el => el.value);
  const healthConditions = Array.from(document.querySelectorAll('[name="healthConditions"]:checked')).map(el => el.value);
  const allergens = ALLERGEN_CODES
    .filter(code => document.getElementById(`allergen-${code}`)?.checked)
    .map(code => ({ code, severity: document.getElementById(`severity-${code}`).value }));
  return { dietary, allergens, healthConditions };
}

export async function savePreferences() {
  clearError();
  clearConsentError();
  const consentChecked = document.getElementById('consent-checkbox')?.checked;
  if (!consentChecked) {
    const message = 'Falta el consentimiento expreso para guardar datos de salud';
    showConsentError(message);
    throw new Error(message);
  }

  const btn = document.getElementById('btn-save-preferences');
  return withLoadingState(btn, 'Guardando…', async () => {
    const token = await getIdToken();
    // consent:true + consentNoticeVersion viajan al servidor porque
    // putPreferencesHandler (Task 6) ahora los EXIGE — el checkbox de cliente
    // por sí solo no es evidencia demostrable de consentimiento expreso
    // (hallazgo legal/seguridad: una llamada directa al endpoint sin pasar por
    // este checkbox antes guardaba datos de salud igual).
    const payload = { ...buildPreferencesPayload(), consent: true, consentNoticeVersion: CONSENT_NOTICE_VERSION };
    const res = await fetch('/api/me/preferences', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // hallazgo #6/#10: no existe checkout/pago en la app todavía — el CTA
      // no debe insinuar que hay una compra disponible que en realidad no
      // existe. Segunda oración honesta en vez de un link a un flujo falso.
      showError(data.error === 'premium_required'
        ? 'Esta función es solo para cuentas premium. Estamos por lanzar la suscripción — te avisaremos en cuanto esté disponible.'
        : 'No se pudo guardar. Intenta de nuevo.');
      throw new Error(data.error || 'save_failed');
    }

    return res.json();
  });
}

export async function deletePreferences() {
  clearError();
  clearSuccess();
  // hallazgo #11: borrar preferencias no tenía guard de confirmación — un
  // tap accidental borraba datos de salud del usuario sin poder deshacerlo.
  if (!window.confirm('¿Seguro que quieres borrar tus preferencias? Esta acción no se puede deshacer.')) {
    return;
  }

  const btn = document.getElementById('btn-delete-preferences');
  return withLoadingState(btn, 'Borrando…', async () => {
    const token = await getIdToken();
    const res = await fetch('/api/me/preferences', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      showError('No se pudieron borrar tus preferencias. Intenta de nuevo.');
      throw new Error('delete_failed');
    }
    const result = await res.json();
    showSuccess('Tus preferencias fueron borradas.');
    return result;
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // await explícito (hallazgo de revisión, ver nota arriba): esta pantalla
  // necesita el perfil listo YA al cargar, no puede depender de que el
  // auto-sync de authClient.js (disparado por onAuthChange) haya corrido a
  // tiempo — de lo contrario el form casi siempre carga vacío.
  await syncUserProfile();
  // hallazgo #9: sin sesión, el form se podía llenar y "guardar" igual —
  // el 403 del backend recién avisaba hasta el submit. Mismo patrón que ya
  // usa account-ui.js: si no hay perfil cacheado tras el sync, no hay sesión.
  if (!getCachedProfile()) {
    window.location.href = 'auth.html';
    return;
  }
  loadPreferencesIntoForm();
  const form = document.getElementById('preferences-form');
  const btnDelete = document.getElementById('btn-delete-preferences');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      savePreferences().catch(() => {});
    });
  }
  if (btnDelete) {
    btnDelete.addEventListener('click', () => deletePreferences().catch(() => {}));
  }
});
