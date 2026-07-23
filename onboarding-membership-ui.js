import { getIdToken, syncUserProfile } from './authClient.js';

const ONBOARDING_PREFS_KEY = 'yomi_pending_preferences';

function showError(message) {
  const el = document.getElementById('membership-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function confirmMembershipPayment() {
  const checkbox = document.getElementById('pay-checkbox');
  if (!checkbox?.checked) {
    showError('Marca la casilla para confirmar el pago simulado.');
    throw new Error('pay_checkbox_required');
  }

  const btn = document.getElementById('btn-confirm-payment');
  if (btn) { btn.disabled = true; btn.textContent = 'Procesando…'; }
  try {
    const token = await getIdToken();
    const res = await fetch('/api/me/membership/pay', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      showError('No se pudo procesar el pago. Intenta de nuevo.');
      throw new Error('pay_failed');
    }

    const pendingPrefs = sessionStorage.getItem(ONBOARDING_PREFS_KEY);
    if (pendingPrefs) {
      try {
        await fetch('/api/me/preferences', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: pendingPrefs
        });
      } catch (e) {
        console.warn('[onboarding] no se pudieron guardar preferencias pendientes:', e.message);
      }
      sessionStorage.removeItem(ONBOARDING_PREFS_KEY);
    }

    await syncUserProfile();
    window.location.href = 'index.html';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar pago'; }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-confirm-payment')?.addEventListener('click', () => {
    confirmMembershipPayment().catch(() => {});
  });
});
