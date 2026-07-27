import { firebaseAuth, verifyPasswordResetCode, confirmPasswordReset } from './firebase-init.js';

function showError(message) {
  const el = document.getElementById('reset-password-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function getOobCode() {
  const params = new URLSearchParams(window.location.search);
  return params.get('oobCode');
}

export async function initResetPasswordPage() {
  const oobCode = getOobCode();
  const sub = document.getElementById('reset-password-sub');
  const form = document.getElementById('reset-password-form');

  if (!oobCode) {
    if (sub) sub.textContent = 'Este enlace no es válido.';
    showError('Falta el código de restablecimiento. Solicita un nuevo enlace desde la pantalla de inicio de sesión.');
    return;
  }

  try {
    const email = await verifyPasswordResetCode(firebaseAuth, oobCode);
    if (sub) sub.textContent = `Ingresa tu nueva contraseña para ${email}.`;
    form?.classList.remove('hidden');
  } catch {
    if (sub) sub.textContent = 'Este enlace no es válido.';
    showError('Este enlace ya expiró o ya fue usado. Solicita uno nuevo desde la pantalla de inicio de sesión.');
  }
}

export async function submitNewPassword(oobCode, newPassword, confirmPassword) {
  const errorEl = document.getElementById('reset-password-error');
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }

  if (newPassword !== confirmPassword) {
    showError('Las contraseñas no coinciden.');
    throw new Error('Las contraseñas no coinciden.');
  }

  const btn = document.getElementById('btn-reset-password-confirm');
  const originalText = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    await confirmPasswordReset(firebaseAuth, oobCode, newPassword);
    const successEl = document.getElementById('reset-password-success');
    if (successEl) { successEl.textContent = 'Tu contraseña se actualizó. Redirigiendo a iniciar sesión…'; successEl.classList.remove('hidden'); }
    document.getElementById('reset-password-form')?.classList.add('hidden');
    setTimeout(() => { window.location.href = 'auth.html'; }, 2000);
  } catch (err) {
    showError('No se pudo actualizar tu contraseña. El enlace pudo haber expirado — solicita uno nuevo.');
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    throw err;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initResetPasswordPage();

  const btnToggle = document.getElementById('btn-toggle-reset-password');
  const passwordInput = document.getElementById('reset-new-password');
  if (btnToggle && passwordInput) {
    btnToggle.addEventListener('click', () => {
      const isHidden = passwordInput.type === 'password';
      passwordInput.type = isHidden ? 'text' : 'password';
      btnToggle.textContent = isHidden ? 'Ocultar' : 'Ver';
    });
  }

  const form = document.getElementById('reset-password-form');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const oobCode = getOobCode();
      const newPassword = document.getElementById('reset-new-password').value;
      const confirmPassword = document.getElementById('reset-confirm-password').value;
      submitNewPassword(oobCode, newPassword, confirmPassword).catch(() => {});
    });
  }
});
