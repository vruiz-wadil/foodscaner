import { getIdToken, syncUserProfile, getCachedProfile } from './authClient.js';
import { COUNTRY_CODES, flagEmoji } from './country-codes.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function showError(message) {
  const el = document.getElementById('profile-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearError() {
  const el = document.getElementById('profile-error');
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

export function renderMissingFields(profile) {
  document.getElementById('field-name')?.classList.toggle('hidden', !!profile.displayName);
  document.getElementById('field-phone')?.classList.toggle('hidden', !!profile.phoneNumber);
  document.getElementById('field-email')?.classList.toggle('hidden', !!profile.email);
}

export async function submitProfile() {
  clearError();
  const fieldName = document.getElementById('field-name');
  const fieldPhone = document.getElementById('field-phone');
  const fieldEmail = document.getElementById('field-email');
  const body = {};

  if (fieldName && !fieldName.classList.contains('hidden')) {
    const v = document.getElementById('input-name').value.trim();
    if (!v) { showError('Escribe tu nombre.'); throw new Error('invalid_display_name'); }
    body.displayName = v;
  }
  if (fieldPhone && !fieldPhone.classList.contains('hidden')) {
    const dial = document.getElementById('input-phone-country')?.value || '';
    const local = document.getElementById('input-phone').value.trim();
    if (!local) { showError('Escribe tu teléfono.'); throw new Error('invalid_phone'); }
    body.phone = dial + local.replace(/\D/g, '');
  }
  if (fieldEmail && !fieldEmail.classList.contains('hidden')) {
    const v = document.getElementById('input-email').value.trim();
    if (!EMAIL_RE.test(v)) { showError('Escribe un correo válido.'); throw new Error('invalid_email'); }
    body.email = v;
  }

  const btn = document.getElementById('btn-continue-profile');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    const token = await getIdToken();
    const res = await fetch('/api/me/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      showError('No se pudo guardar tu perfil. Intenta de nuevo.');
      throw new Error('save_failed');
    }
    window.location.href = 'preferences.html?onboarding=1';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Continuar'; }
  }
}

export async function initOnboardingProfilePage() {
  await syncUserProfile();
  const profile = getCachedProfile();
  if (!profile) {
    window.location.href = 'auth.html';
    return;
  }
  if (profile.profile && profile.profile.completedAt) {
    window.location.href = 'index.html';
    return;
  }
  const phoneCountrySelect = document.getElementById('input-phone-country');
  if (phoneCountrySelect) {
    phoneCountrySelect.innerHTML = COUNTRY_CODES.map(c => `<option value="${c.dial}">${c.name} (${c.dial}) ${flagEmoji(c.iso2)}</option>`).join('');
  }
  renderMissingFields(profile);
  document.getElementById('profile-form')?.addEventListener('submit', e => {
    e.preventDefault();
    submitProfile().catch(() => {});
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initOnboardingProfilePage();
});
