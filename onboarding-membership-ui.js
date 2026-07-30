import { getIdToken } from './authClient.js';

function showError(message) {
  const el = document.getElementById('membership-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function confirmMembershipPayment() {
  const checkbox = document.getElementById('pay-checkbox');
  if (!checkbox?.checked) {
    showError('Marca la casilla para continuar.');
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
      showError('No se pudo iniciar el pago. Intenta de nuevo.');
      throw new Error('pay_failed');
    }
    const data = await res.json();
    window.location.href = data.checkoutUrl;
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Continuar al pago'; }
    throw err;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-confirm-payment')?.addEventListener('click', () => {
    confirmMembershipPayment().catch(() => {});
  });
});
