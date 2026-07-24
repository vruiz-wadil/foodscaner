import {
  firebaseAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithCustomToken
} from './firebase-init.js';
import { setAutoSyncSuppressed } from './authClient.js';
import { COUNTRY_CODES, flagEmoji } from './country-codes.js';
import { mapAuthError } from './authErrors.js';

// Re-exportado para no romper a quien ya hacía
// `import { mapAuthError } from './auth-ui.js'` (ej. tests/auth-ui.test.js) —
// el mapeo real ahora vive en authErrors.js, un módulo sin efectos
// secundarios (ver comentario junto a setAutoSyncSuppressed más abajo).
export { mapAuthError };

// hallazgo de revisión del plan: auth-ui.js NUNCA había importado
// authClient.js antes de este cambio — el simple hecho de importarlo activa
// su listener de auto-sync module-level (onAuthChange, auth-ui.html nunca lo
// había cargado). Si solo se suprimiera dentro de handleVerifyCode (como
// decía una versión anterior de este plan), ese listener quedaría ACTIVO por
// primera vez para handleLogin/handleSignup/handleGoogleSignIn también —
// exponiendo la MISMA race de consentimiento perdido (spec, sección 4) en el
// signup por correo ya existente, que nunca la tuvo porque authClient.js
// nunca corría en esta página. auth.html no necesita el auto-sync genérico en
// NINGÚN flujo: cada uno (login, signup, Google, teléfono) ya hace su propio
// sync explícito y redirige de inmediato — así que se suprime una sola vez,
// aquí, a nivel de módulo, para toda la vida de esta página.
setAutoSyncSuppressed(true);

const googleProvider = new GoogleAuthProvider();
const TERMS_VERSION = 'v1';

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

let pendingPhone = null;
let isSignupMode = false; // movido aquí desde dentro de DOMContentLoaded — ver nota arriba

const VIEWS = ['login', 'phone-number', 'phone-code', 'phone-consent'];
let currentView = 'login';

export function setView(view) {
  currentView = view;
  document.getElementById('login-view')?.classList.toggle('hidden', view !== 'login');
  document.getElementById('phone-step')?.classList.toggle('hidden', view !== 'phone-number');
  document.getElementById('phone-code-step')?.classList.toggle('hidden', view !== 'phone-code');
  // signup-only es compartido: visible si estamos en consentimiento de teléfono
  // O si el signup por correo (isSignupMode, controlado por enterSignupMode/
  // exitSignupMode más abajo) ya lo mostró — ninguno de los dos caminos debe
  // pisar al otro.
  document.getElementById('signup-only')?.classList.toggle('hidden', view !== 'phone-consent' && !isSignupMode);
  // btn-phone-consent-confirm SOLO es para el camino de teléfono — el signup
  // por correo usa btn-signup (su semántica de doble-clic existente), nunca
  // este botón.
  document.getElementById('btn-phone-consent-confirm')?.classList.toggle('hidden', view !== 'phone-consent');
}

function clearPhoneFlowState() {
  pendingPhone = null;
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
      window.location.href = 'onboarding-profile.html';
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
      window.location.href = 'onboarding-profile.html';
      return result;
    } catch (err) {
      showError(mapAuthError(err.code));
      throw err;
    }
  });
}

export async function handleSendCode(dialCode, localNumber) {
  clearError();
  const btn = document.getElementById('btn-send-code');
  return withLoadingState(btn, 'Enviando código…', async () => {
    try {
      const phone = dialCode + localNumber.replace(/\D/g, '');
      const res = await fetch('/api/auth/phone/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(mapAuthError(data.error));
        return;
      }
      pendingPhone = phone;
      setView('phone-code');
    } catch {
      showError(mapAuthError());
    }
  });
}

export async function handleVerifyCode(code) {
  clearError();
  // No hace falta suprimir aquí — ya se suprimió a nivel de módulo arriba,
  // para toda la página (ver comentario junto al import de setAutoSyncSuppressed).
  const btn = document.getElementById('btn-verify-code');
  return withLoadingState(btn, 'Verificando…', async () => {
    try {
      const res = await fetch('/api/auth/phone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: pendingPhone, code })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(mapAuthError(data.error));
        return;
      }
      await signInWithCustomToken(firebaseAuth, data.customToken);
      if (data.isNewUser !== false) {
        setView('phone-consent');
        return;
      }
      window.location.href = 'index.html';
    } catch (err) {
      // A diferencia de handleSendCode (que solo puede fallar por fetch, sin
      // .code), aquí SÍ puede fallar signInWithCustomToken con un error real
      // de Firebase (ej. auth/network-request-failed) — perder err.code aquí
      // perdería el mensaje específico ya mapeado en AUTH_ERROR_MESSAGES.
      showError(mapAuthError(err.code));
    }
  });
}

export async function handlePhoneSignupConsent() {
  const termsChecked = document.getElementById('terms-checkbox')?.checked;
  const ageChecked = document.getElementById('age-checkbox')?.checked;
  if (!termsChecked || !ageChecked) {
    showError('Debes aceptar los Términos y confirmar tu edad para crear tu cuenta.');
    return;
  }
  const btn = document.getElementById('btn-phone-consent-confirm');
  return withLoadingState(btn, 'Guardando…', async () => {
    try {
      const token = await firebaseAuth.currentUser.getIdToken();
      const res = await fetch('/api/auth/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ termsAccepted: true, ageConfirmed: true, termsVersion: TERMS_VERSION })
      });
      if (!res.ok) {
        showError(mapAuthError());
        return;
      }
      window.location.href = 'onboarding-profile.html';
    } catch (err) {
      showError(mapAuthError(err.code));
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  const btnLogin = document.getElementById('btn-login');
  const btnSignup = document.getElementById('btn-signup');
  const btnBackToLogin = document.getElementById('btn-back-to-login');
  const btnGoogle = document.getElementById('btn-google');
  const btnTogglePassword = document.getElementById('btn-toggle-password');
  const passwordInput = document.getElementById('login-password');
  const signupOnly = document.getElementById('signup-only');
  const headingTitle = document.getElementById('auth-heading-title');

  const SIGNUP_BTN_TEXT = btnSignup ? btnSignup.textContent : null;
  const LOGIN_HEADING_TEXT = headingTitle ? headingTitle.textContent : null;

  function enterSignupMode() {
    isSignupMode = true;
    signupOnly?.classList.remove('hidden');
    // btn-login es type="submit" y, si sigue visible, se roba el Enter del
    // teclado en modo signup (hallazgo UX #2) — se oculta, no solo se
    // "desenfatiza", y btn-back-to-login toma su lugar visual (hallazgo #14).
    btnLogin?.classList.add('hidden');
    btnBackToLogin?.classList.remove('hidden');
    if (headingTitle) headingTitle.textContent = 'Crea tu cuenta';
    if (btnSignup) btnSignup.textContent = 'Confirmar creación de cuenta';
  }

  function exitSignupMode() {
    isSignupMode = false;
    signupOnly?.classList.add('hidden');
    btnLogin?.classList.remove('hidden');
    btnBackToLogin?.classList.add('hidden');
    if (headingTitle && LOGIN_HEADING_TEXT !== null) headingTitle.textContent = LOGIN_HEADING_TEXT;
    if (btnSignup && SIGNUP_BTN_TEXT !== null) btnSignup.textContent = SIGNUP_BTN_TEXT;
  }

  if (btnTogglePassword && passwordInput) {
    btnTogglePassword.addEventListener('click', () => {
      const isHidden = passwordInput.type === 'password';
      passwordInput.type = isHidden ? 'text' : 'password';
      btnTogglePassword.textContent = isHidden ? 'Ocultar' : 'Ver';
      btnTogglePassword.setAttribute('aria-label', isHidden ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });
  }

  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      // hallazgo UX #13: el login saltaba required/minlength del <input> y
      // pasaba directo a Firebase con campos vacíos (mismo problema que ya se
      // había arreglado del lado de signup).
      if (!form.reportValidity()) return;
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
        enterSignupMode();
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
  if (btnBackToLogin) {
    btnBackToLogin.addEventListener('click', () => exitSignupMode());
  }
  if (btnGoogle) {
    btnGoogle.addEventListener('click', () => handleGoogleSignIn());
  }

  const btnPhone = document.getElementById('btn-phone');
  const phoneCountrySelect = document.getElementById('phone-country');
  const btnSendCode = document.getElementById('btn-send-code');
  const btnPhoneCancel = document.getElementById('btn-phone-cancel');
  const btnVerifyCode = document.getElementById('btn-verify-code');
  const btnResendCode = document.getElementById('btn-resend-code');
  const btnPhoneCodeBack = document.getElementById('btn-phone-code-back');
  const btnPhoneConsentConfirm = document.getElementById('btn-phone-consent-confirm');

  if (phoneCountrySelect) {
    // Nombre primero, bandera al final — un emoji regional-indicator al INICIO
    // del texto rompe el typeahead nativo del <select> (teclear "M" ya no
    // salta a "México", porque el primer carácter visible ya no es una letra).
    phoneCountrySelect.innerHTML = COUNTRY_CODES.map(c =>
      `<option value="${c.dial}">${c.name} (${c.dial}) ${flagEmoji(c.iso2)}</option>`
    ).join('');
  }

  if (btnPhone) {
    btnPhone.addEventListener('click', () => {
      clearError();
      // Si el usuario venía de "Crear cuenta nueva" (isSignupMode=true) y
      // cambia a teléfono sin terminar, exitSignupMode() ya resetea todo lo
      // relacionado (heading, botones, isSignupMode) — sin esto, setView()
      // seguiría mostrando los checkboxes de Términos del signup por correo
      // abandonado junto a la UI de teléfono (hallazgo de revisión: ambos
      // toggles de #signup-only son independientes por diseño).
      exitSignupMode();
      setView('phone-number');
    });
  }
  if (btnSendCode) {
    btnSendCode.addEventListener('click', () => {
      const dialCode = phoneCountrySelect.value;
      const localNumber = document.getElementById('phone-number').value;
      handleSendCode(dialCode, localNumber);
    });
  }
  if (btnPhoneCancel) {
    btnPhoneCancel.addEventListener('click', () => {
      clearError();
      clearPhoneFlowState();
      setView('login');
    });
  }
  if (btnVerifyCode) {
    btnVerifyCode.addEventListener('click', () => {
      const code = document.getElementById('phone-code').value;
      handleVerifyCode(code);
    });
  }
  if (btnResendCode) {
    btnResendCode.addEventListener('click', () => {
      const dialCode = phoneCountrySelect.value;
      const localNumber = document.getElementById('phone-number').value;
      handleSendCode(dialCode, localNumber);
    });
  }
  if (btnPhoneCodeBack) {
    btnPhoneCodeBack.addEventListener('click', () => {
      clearError();
      setView('phone-number');
    });
  }
  if (btnPhoneConsentConfirm) {
    btnPhoneConsentConfirm.addEventListener('click', () => handlePhoneSignupConsent());
  }
});
