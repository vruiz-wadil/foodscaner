import {
  firebaseAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider
} from './firebase-init.js';

const googleProvider = new GoogleAuthProvider();
const TERMS_VERSION = 'v1';

// wrong-password/user-not-found/invalid-credential mapean al MISMO mensaje
// genérico (hallazgo de seguridad: mensajes distintos permiten enumerar si un
// correo está registrado). Se agregan los códigos que un usuario real en
// México dispara seguido (hallazgo UX): too-many-requests, network failures,
// popup bloqueado, y el caso de mezclar Google/password en la misma cuenta.
const AUTH_ERROR_MESSAGES = {
  'auth/invalid-email': 'Correo inválido.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/popup-closed-by-user': 'Se cerró la ventana de Google antes de terminar.',
  'auth/popup-blocked': 'Tu navegador bloqueó la ventana de Google. Habilítala e inténtalo de nuevo.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
  'auth/network-request-failed': 'Sin conexión a internet. Revisa tu red e inténtalo de nuevo.',
  'auth/account-exists-with-different-credential': 'Ya tienes una cuenta con ese correo usando otro método de acceso (ej. Google). Usa ese método para entrar.'
};

export function mapAuthError(code) {
  return AUTH_ERROR_MESSAGES[code] || 'Ocurrió un error. Intenta de nuevo.';
}

function showError(message) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearError() {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

// Deshabilita el botón + cambia el texto mientras dura la operación async —
// hallazgo UX: sin esto, en conexión móvil típica el botón "se siente
// congelado" y el usuario da doble tap (doble submit).
async function withLoadingState(button, loadingText, fn) {
  const originalText = button ? button.textContent : null;
  if (button) { button.disabled = true; button.textContent = loadingText; }
  try {
    return await fn();
  } finally {
    if (button) { button.disabled = false; button.textContent = originalText; }
  }
}

export async function handleLogin(email, password) {
  clearError();
  const btn = document.getElementById('btn-login');
  return withLoadingState(btn, 'Iniciando sesión…', async () => {
    try {
      const result = await signInWithEmailAndPassword(firebaseAuth, email, password);
      window.location.href = 'index.html';
      return result;
    } catch (err) {
      showError(mapAuthError(err.code));
      throw err;
    }
  });
}

export async function handleSignup(email, password) {
  clearError();
  // Gate de Términos/edad (hallazgo legal): no se puede crear la cuenta sin
  // esto — Yomi va a facturar suscripciones y necesita evidencia de aceptación.
  const termsChecked = document.getElementById('terms-checkbox')?.checked;
  const ageChecked = document.getElementById('age-checkbox')?.checked;
  if (!termsChecked) {
    const err = new Error('Debes aceptar los Términos y Condiciones para crear tu cuenta.');
    showError(err.message);
    throw err;
  }
  if (!ageChecked) {
    const err = new Error('Debes confirmar que eres mayor de edad para crear tu cuenta.');
    showError(err.message);
    throw err;
  }

  const btn = document.getElementById('btn-signup');
  return withLoadingState(btn, 'Creando cuenta…', async () => {
    try {
      const result = await createUserWithEmailAndPassword(firebaseAuth, email, password);
      const token = await result.user.getIdToken();
      await fetch('/api/auth/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ termsAccepted: true, ageConfirmed: true, termsVersion: TERMS_VERSION })
      });
      window.location.href = 'index.html';
      return result;
    } catch (err) {
      showError(mapAuthError(err.code));
      throw err;
    }
  });
}

export async function handleGoogleSignIn() {
  clearError();
  const btn = document.getElementById('btn-google');
  return withLoadingState(btn, 'Conectando con Google…', async () => {
    try {
      const result = await signInWithPopup(firebaseAuth, googleProvider);
      window.location.href = 'index.html';
      return result;
    } catch (err) {
      showError(mapAuthError(err.code));
      throw err;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  const btnSignup = document.getElementById('btn-signup');
  const btnGoogle = document.getElementById('btn-google');
  const btnTogglePassword = document.getElementById('btn-toggle-password');
  const passwordInput = document.getElementById('login-password');
  const signupOnly = document.getElementById('signup-only');

  let isSignupMode = false;

  if (btnTogglePassword && passwordInput) {
    btnTogglePassword.addEventListener('click', () => {
      const isHidden = passwordInput.type === 'password';
      passwordInput.type = isHidden ? 'text' : 'password';
      btnTogglePassword.textContent = isHidden ? 'Ocultar' : 'Ver';
    });
  }

  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      handleLogin(email, password);
    });
  }
  if (btnSignup) {
    btnSignup.addEventListener('click', () => {
      // Primer clic: revela los checkboxes de Términos/edad sin crear la cuenta
      // todavía (evita pedir consentimiento antes de que el usuario decida
      // registrarse — menos fricción en el primer vistazo del formulario).
      if (!isSignupMode) {
        isSignupMode = true;
        signupOnly?.classList.remove('hidden');
        btnSignup.textContent = 'Confirmar creación de cuenta';
        return;
      }
      // Segundo clic: valida el form nativamente (hallazgo UX: antes este botón
      // no era type="submit" e ignoraba required/minlength del <input>,
      // disparando un error críptico de Firebase con campos vacíos).
      if (!form.reportValidity()) return;
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      handleSignup(email, password);
    });
  }
  if (btnGoogle) {
    btnGoogle.addEventListener('click', () => handleGoogleSignIn());
  }
});
