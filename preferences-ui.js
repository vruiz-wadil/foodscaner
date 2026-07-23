import { getIdToken, getCachedProfile, syncUserProfile } from './authClient.js';

const ALLERGEN_CODES = ['cacahuate', 'lacteos', 'nueces', 'trigo', 'huevo', 'pescado', 'mariscos', 'soja'];
const CONSENT_NOTICE_VERSION = 'v1';
const ONBOARDING_PREFS_KEY = 'yomi_pending_preferences';

function isOnboarding() {
  return new URLSearchParams(window.location.search).get('onboarding') === '1';
}

export async function continueOnboardingPreferences() {
  clearError();
  clearConsentError();
  const consentChecked = document.getElementById('consent-checkbox')?.checked;
  if (!consentChecked) {
    const message = 'Falta el consentimiento expreso para guardar datos de salud';
    showConsentError(message);
    throw new Error(message);
  }
  const payload = { ...buildPreferencesPayload(), consent: true, consentNoticeVersion: CONSENT_NOTICE_VERSION };
  sessionStorage.setItem(ONBOARDING_PREFS_KEY, JSON.stringify(payload));
  window.location.href = 'onboarding-membership.html';
}

export function skipOnboardingPreferences() {
  sessionStorage.removeItem(ONBOARDING_PREFS_KEY);
  window.location.href = 'onboarding-membership.html';
}

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

// El color del tile de alergeno depende de la severidad elegida (naranja =
// Aviso, rojo = Estricto — hallazgo: "los botones deben ser... rojos o
// naranja dependiendo si estan seleccionados con aviso o estricto"). El CSS
// (.allergen-grid-item.chosen.severity-severe) lee esta clase; se mantiene
// sincronizada en los 3 puntos donde cambia la severidad.
function setTileSeverityColor(tile, severity) {
  tile.classList.remove('severity-mild', 'severity-severe');
  tile.classList.add(`severity-${severity}`);
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
    const el = document.querySelector(`#dietary-tiles [data-dietary="${key}"]`);
    if (el) { el.classList.add('chosen'); el.setAttribute('aria-pressed', 'true'); }
  });
  (prefs.healthConditions || []).forEach(key => {
    const el = document.querySelector(`#health-tiles [data-health="${key}"]`);
    if (el) { el.classList.add('chosen'); el.setAttribute('aria-pressed', 'true'); }
  });
  (prefs.allergens || []).forEach(({ code, severity }) => {
    const tile = document.getElementById(`allergen-${code}`);
    const toggle = document.getElementById(`severity-${code}`);
    if (tile) {
      tile.classList.add('chosen');
      tile.setAttribute('aria-pressed', 'true');
      setTileSeverityColor(tile, severity);
    }
    if (toggle) {
      toggle.classList.remove('hidden');
      toggle.querySelectorAll('button').forEach(b => {
        const isActive = b.dataset.severity === severity;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-checked', String(isActive));
      });
    }
  });
}

function buildPreferencesPayload() {
  const dietary = Array.from(document.querySelectorAll('#dietary-tiles [data-dietary].chosen')).map(el => el.dataset.dietary);
  const healthConditions = Array.from(document.querySelectorAll('#health-tiles [data-health].chosen')).map(el => el.dataset.health);
  const allergens = ALLERGEN_CODES
    .filter(code => document.getElementById(`allergen-${code}`)?.classList.contains('chosen'))
    .map(code => ({
      code,
      severity: document.querySelector(`#severity-${code} button.active`)?.dataset.severity || 'mild'
    }));
  return { dietary, allergens, healthConditions };
}

// Wiring de click para los tiles de toggle simple (dietas/condiciones de
// salud) — cada click alterna .chosen y aria-pressed. Alergias tiene su
// propio wiring: además de alternar .chosen en el tile, muestra/oculta su
// .severity-toggle asociado y arranca en "Aviso" activo por default cuando
// se elige el alérgeno por primera vez (sin severidad previa marcada).
export function setupPreferenceTiles() {
  document.querySelectorAll('#dietary-tiles [data-dietary], #health-tiles [data-health]').forEach(tile => {
    tile.addEventListener('click', () => {
      const chosen = tile.classList.toggle('chosen');
      tile.setAttribute('aria-pressed', String(chosen));
    });
  });

  ALLERGEN_CODES.forEach(code => {
    const tile = document.getElementById(`allergen-${code}`);
    const toggle = document.getElementById(`severity-${code}`);
    if (!tile || !toggle) return;

    tile.addEventListener('click', () => {
      const chosen = tile.classList.toggle('chosen');
      tile.setAttribute('aria-pressed', String(chosen));
      toggle.classList.toggle('hidden', !chosen);
      if (chosen && !toggle.querySelector('button.active')) {
        const mildBtn = toggle.querySelector('[data-severity="mild"]');
        mildBtn.classList.add('active');
        mildBtn.setAttribute('aria-checked', 'true');
        setTileSeverityColor(tile, 'mild');
      }
    });

    toggle.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        toggle.querySelectorAll('button').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-checked', 'true');
        setTileSeverityColor(tile, btn.dataset.severity);
      });
    });
  });
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
      showError(['membership_required', 'membership_expired'].includes(data.error)
        ? 'Necesitas una membresía activa para guardar tus preferencias.'
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
  setupPreferenceTiles();
  const onboarding = isOnboarding();
  const form = document.getElementById('preferences-form');
  const btnDelete = document.getElementById('btn-delete-preferences');
  const btnSave = document.getElementById('btn-save-preferences');
  const btnSkip = document.getElementById('btn-skip-preferences');
  if (onboarding) {
    if (btnSave) btnSave.textContent = 'Continuar';
    btnDelete?.classList.add('hidden');
    btnSkip?.classList.remove('hidden');
    btnSkip?.addEventListener('click', () => skipOnboardingPreferences());
  }
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      (onboarding ? continueOnboardingPreferences() : savePreferences()).catch(() => {});
    });
  }
  if (btnDelete) {
    btnDelete.addEventListener('click', () => deletePreferences().catch(() => {}));
  }
});
