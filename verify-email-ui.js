import { firebaseAuth, applyActionCode } from './firebase-init.js';

function showError(message) {
  const el = document.getElementById('verify-email-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function showSuccess(message) {
  const el = document.getElementById('verify-email-success');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function getOobCode() {
  const params = new URLSearchParams(window.location.search);
  return params.get('oobCode');
}

export async function initVerifyEmailPage() {
  const oobCode = getOobCode();
  const sub = document.getElementById('verify-email-sub');

  if (!oobCode) {
    if (sub) sub.textContent = 'Este enlace no es válido.';
    showError('Falta el código de verificación. Solicita un nuevo enlace desde Mi cuenta.');
    return;
  }

  try {
    await applyActionCode(firebaseAuth, oobCode);
    if (sub) sub.textContent = 'Tu correo fue verificado.';
    showSuccess('Tu correo fue verificado. Redirigiendo a Mi cuenta…');
    setTimeout(() => { window.location.href = 'account.html'; }, 2000);
  } catch {
    if (sub) sub.textContent = 'Este enlace no es válido.';
    showError('Este enlace ya expiró o ya fue usado. Solicita uno nuevo desde Mi cuenta.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initVerifyEmailPage();
});
