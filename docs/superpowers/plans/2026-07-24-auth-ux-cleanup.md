# Limpieza UX/UI del flujo de registro/login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arreglar 5 defectos de UX/UI del flujo de registro/login: botón "Ahora no" sin estilo, botón de confirmar antes de los checkboxes de Términos, sin confirmar contraseña al crear cuenta, sin verificación de correo, sin recuperar contraseña.

**Architecture:** Task 1 cubre `auth.html`/`auth-ui.js`/`firebase-init.js`/`home.css` (la página de login/signup en sí — items 1, 2, 3, 5, y el lado "disparar el correo de verificación" del item 4). Task 2 cubre `account-ui.js` (el aviso de "correo no verificado" + reenviar, el otro lado del item 4) — depende de que Task 1 ya exporte `sendEmailVerification` desde `firebase-init.js`.

**Tech Stack:** Firebase Auth client SDK (sin backend nuevo), vanilla JS ES modules, Vitest + jsdom.

## Global Constraints

- Nada de backend nuevo — `sendEmailVerification`/`sendPasswordResetEmail` son funciones del SDK de Firebase Auth, ya cargado vía `firebase-init.js`.
- La verificación de correo **nunca bloquea** nada (ni el registro, ni el login, ni pagar membresía, ni escanear) — es puramente informativa.
- `sendPasswordResetEmail` siempre muestra el mismo mensaje de éxito, exista o no la cuenta con ese correo (protección contra enumeración de cuentas) — nunca revela si `sendPasswordResetEmail` fue exitoso o falló con `auth/user-not-found`.
- **`tests/auth-ui.test.js` tiene un orden de tests frágil y documentado** (ver el comentario largo antes de `describe('handleVerifyCode — isNewUser ambiguo...')`, cerca del final del archivo): el test `'password toggle aria-label'` es sensible a CUÁNTOS tests con `await import('../auth-ui.js')` corrieron antes que él en el archivo (cada import re-adjunta un listener de `DOMContentLoaded` que jsdom nunca limpia). **Todo test nuevo para este plan debe agregarse estrictamente al FINAL del archivo** (después del último `describe` existente), nunca insertado antes de `'password toggle aria-label'` — incluso en un describe distinto, un test insertado ahí corre la cuenta y puede romper esa paridad. La única excepción permitida es editar un *argumento* de una llamada ya existente en un test ya existente (no agrega un test nuevo, no cambia la cuenta).

---

### Task 1: `auth.html` / `auth-ui.js` / `firebase-init.js` / `home.css`

**Files:**
- Modify: `auth.html`
- Modify: `home.css`
- Modify: `firebase-init.js`
- Modify: `auth-ui.js`
- Modify: `tests/auth-ui.test.js`

**Interfaces:**
- Consumes: nada nuevo de otros módulos.
- Produces: `firebase-init.js` re-exporta `sendEmailVerification`, `sendPasswordResetEmail` (Task 2 los consume vía `sendEmailVerification` para el aviso en `account-ui.js`). `auth-ui.js` exporta `handleForgotPassword(email)` (nuevo) y `handleSignup(email, password, passwordConfirm)` (firma extendida — antes tenía 2 parámetros, ahora 3).

- [ ] **Step 1: Mover `.link-button` de `auth.html` a `home.css`**

En `auth.html`, dentro del `<style>` del `<head>`, eliminar esta línea:

```css
    .link-button { background: none; border: none; color: var(--ink, #0d3d35); text-decoration: underline; font-size: 0.85rem; padding: 8px 0; cursor: pointer; }
```

En `home.css`, al final del archivo, agregar:

```css

/* .link-button vivía solo en el <style> inline de auth.html — cualquier otro
   botón con esta clase (ej. #btn-skip-preferences en preferences.html) se
   renderizaba sin ningún estilo, botón de navegador puro (hallazgo UX). */
.link-button { background: none; border: none; color: var(--ink); text-decoration: underline; font-size: 0.85rem; padding: 8px 0; cursor: pointer; }
```

- [ ] **Step 2: Reestructurar `auth.html`** — extraer `#login-actions`, agregar confirmar contraseña + link de recuperar + vista de recuperar contraseña

Reemplazar el bloque completo desde `<div id="login-view">` hasta el `<p id="auth-error" ...></p>` (justo antes de `</div>` que cierra `.content-card`) por:

```html
        <div id="login-view">
          <button type="button" id="btn-google" class="btn btn-google"><img src="assets/redesign/icon-google.svg" alt="" class="btn-icon">Continuar con Google</button>
          <button type="button" id="btn-phone" class="btn btn-secondary"><img src="assets/redesign/icon-phone.svg" alt="" class="btn-icon">Continuar con teléfono</button>
          <div class="auth-divider">o con tu correo</div>

          <form id="login-form" novalidate>
            <div class="form-field">
              <label for="login-email">Correo electrónico</label>
              <input id="login-email" class="form-input" type="email" required autocomplete="email" placeholder="tucorreo@ejemplo.com">
            </div>

            <div class="form-field">
              <label for="login-password">Contraseña</label>
              <div class="password-field-wrap">
                <input id="login-password" class="form-input" type="password" required minlength="6" autocomplete="current-password" placeholder="Mínimo 6 caracteres">
                <button type="button" id="btn-toggle-password" class="btn-toggle-password" aria-label="Mostrar contraseña">Ver</button>
              </div>
            </div>

            <button type="button" id="btn-forgot-password" class="link-button">¿Olvidaste tu contraseña?</button>

            <div class="form-field hidden" id="signup-password-confirm-field">
              <label for="signup-password-confirm">Confirmar contraseña</label>
              <input id="signup-password-confirm" class="form-input" type="password" minlength="6" autocomplete="new-password" placeholder="Repite tu contraseña">
            </div>
          </form>
        </div>

        <div id="phone-step" class="hidden">
          <div class="form-field">
            <label for="phone-country">País</label>
            <select id="phone-country"></select>
          </div>
          <div class="form-field">
            <label for="phone-number">Número de teléfono</label>
            <input id="phone-number" class="form-input" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="10 dígitos">
          </div>
          <button type="button" id="btn-send-code" class="btn btn-primary">Enviar código</button>
          <button type="button" id="btn-phone-cancel" class="link-button">Cancelar</button>
        </div>

        <div id="phone-code-step" class="hidden">
          <div class="form-field">
            <label for="phone-code">Código de verificación</label>
            <input id="phone-code" class="form-input" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
          </div>
          <button type="button" id="btn-verify-code" class="btn btn-primary">Verificar</button>
          <button type="button" id="btn-resend-code" class="link-button">Reenviar código</button>
          <button type="button" id="btn-phone-code-back" class="link-button">Cambiar número</button>
        </div>

        <div id="forgot-password-view" class="hidden">
          <div class="form-field">
            <label for="forgot-password-email">Correo electrónico</label>
            <input id="forgot-password-email" class="form-input" type="email" placeholder="tucorreo@ejemplo.com">
          </div>
          <button type="button" id="btn-send-reset" class="btn btn-primary">Enviar enlace</button>
          <button type="button" id="btn-forgot-password-back" class="link-button">Volver a iniciar sesión</button>
          <p id="forgot-password-success" class="hidden" role="status"></p>
        </div>

        <!-- Compartido entre signup por correo (2do clic de #btn-signup) y
             signup por teléfono (#btn-phone-consent-confirm) — mismo gate legal,
             sin duplicar markup. Ver setView() en auth-ui.js. -->
        <div id="signup-only" class="hidden">
          <label class="consent-block">
            <input type="checkbox" id="terms-checkbox">
            Acepto los <a href="/terminos.html" target="_blank" rel="noopener">Términos y Condiciones</a>
            y el <a href="/privacidad.html" target="_blank" rel="noopener">Aviso de Privacidad</a>.
          </label>
          <label class="consent-block">
            <input type="checkbox" id="age-checkbox">
            Confirmo que soy mayor de 18 años.
          </label>
          <button type="button" id="btn-phone-consent-confirm" class="btn btn-primary hidden">Confirmar y continuar</button>
        </div>

        <!-- Hermano de #login-view (no anidado en <form>) a propósito: durante
             el consentimiento de teléfono, #login-view completo está oculto,
             y estos botones no aplican a esa pantalla. btn-login usa form=
             para seguir enviando #login-form nativamente pese a vivir fuera
             de la etiqueta <form> (hallazgo UX: antes #signup-only aparecía
             DESPUÉS de este bloque de botones — el botón de confirmar se veía
             antes que los checkboxes de Términos). -->
        <div id="login-actions">
          <button type="submit" form="login-form" id="btn-login" class="btn btn-primary">Iniciar sesión</button>
          <button type="button" id="btn-back-to-login" class="link-button hidden">¿Ya tienes cuenta? Inicia sesión</button>
          <button type="button" id="btn-signup" class="btn btn-secondary">Crear cuenta nueva</button>
        </div>

        <p id="auth-error" class="hidden" role="alert"></p>
```

- [ ] **Step 3: Exportar `sendEmailVerification`/`sendPasswordResetEmail` desde `firebase-init.js`**

En el import desde `firebase-auth.js`, agregar ambos nombres a la lista existente:

```js
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  signInWithCustomToken,
  updatePassword,
  verifyBeforeUpdateEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
```

Y en el bloque `export { ... }` al final del archivo, agregar ambos nombres:

```js
export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  signInWithCustomToken,
  updatePassword,
  verifyBeforeUpdateEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail
};
```

- [ ] **Step 4: Escribir/actualizar tests en `tests/auth-ui.test.js` (RED)**

**4a.** En el mock de `../firebase-init.js` (arriba del archivo), agregar dos mocks nuevos y registrarlos:

```js
const mockAuth = { currentUser: null }
const signInWithEmailAndPassword = vi.fn()
const createUserWithEmailAndPassword = vi.fn()
const signInWithPopup = vi.fn()
const signInWithCustomToken = vi.fn()
const sendEmailVerification = vi.fn()
const sendPasswordResetEmail = vi.fn()
class GoogleAuthProvider {}

vi.mock('../firebase-init.js', () => ({
  firebaseAuth: mockAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithCustomToken,
  sendEmailVerification,
  sendPasswordResetEmail
}))
```

**4b.** En el `beforeEach`, dentro del `document.body.innerHTML` (el fixture HTML), reemplazar el bloque completo desde `<div id="login-view">` hasta `</div>` que cierra `signup-only` (NO tocar `#phone-step`/`#phone-code-step`, esos quedan igual) por:

```js
    <div id="login-view">
      <button id="btn-google">Continuar con Google</button>
      <button type="button" id="btn-phone">Continuar con teléfono</button>
      <form id="login-form" novalidate>
        <input id="login-email" type="email" required>
        <input id="login-password" type="password" required minlength="6">
        <button type="button" id="btn-toggle-password" aria-label="Mostrar contraseña">Ver</button>
        <button type="button" id="btn-forgot-password">¿Olvidaste tu contraseña?</button>
        <div class="hidden" id="signup-password-confirm-field">
          <input id="signup-password-confirm" type="password">
        </div>
      </form>
    </div>
    <div id="phone-step" class="hidden">
      <select id="phone-country"></select>
      <input id="phone-number" type="tel">
      <button type="button" id="btn-send-code">Enviar código</button>
      <button type="button" id="btn-phone-cancel">Cancelar</button>
    </div>
    <div id="phone-code-step" class="hidden">
      <input id="phone-code" type="text" maxlength="6">
      <button type="button" id="btn-verify-code">Verificar</button>
      <button type="button" id="btn-resend-code">Reenviar código</button>
      <button type="button" id="btn-phone-code-back">Cambiar número</button>
    </div>
    <div id="forgot-password-view" class="hidden">
      <input id="forgot-password-email" type="email">
      <button type="button" id="btn-send-reset">Enviar enlace</button>
      <button type="button" id="btn-forgot-password-back">Volver a iniciar sesión</button>
      <p id="forgot-password-success" class="hidden" role="status"></p>
    </div>
    <div id="signup-only" class="hidden">
      <input type="checkbox" id="terms-checkbox">
      <input type="checkbox" id="age-checkbox">
      <button type="button" id="btn-phone-consent-confirm" class="hidden">Confirmar y continuar</button>
    </div>
    <div id="login-actions">
      <button type="submit" form="login-form" id="btn-login">Iniciar sesión</button>
      <button type="button" id="btn-back-to-login" class="hidden">¿Ya tienes cuenta? Inicia sesión</button>
      <button type="button" id="btn-signup">Crear cuenta</button>
    </div>
```

**4c.** En el `describe('handleSignup', ...)` existente, cambiar la línea de la llamada exitosa (dentro de `'crea la cuenta y sincroniza termsAccepted/ageConfirmed...'`) de:

```js
    await handleSignup('new@example.com', 'secret123')
```

a:

```js
    await handleSignup('new@example.com', 'secret123', 'secret123')
```

(Esto NO agrega un test nuevo — solo cambia un argumento de uno ya existente, seguro respecto a la paridad documentada arriba.)

**4d.** Al final del archivo (después del último `describe`, `'handlePhoneSignupConsent — manejo de errores...'`), agregar:

```js

describe('handleSignup — confirmar contraseña y verificación de correo', () => {
  it('rechaza si las contraseñas no coinciden, sin llamar a Firebase', async () => {
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true

    await expect(handleSignup('new@example.com', 'secret123', 'different')).rejects.toThrow(/no coinciden/i)

    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled()
  })

  it('llama sendEmailVerification con el usuario recién creado', async () => {
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true
    const getIdToken = vi.fn().mockResolvedValue('tok-new')
    const newUser = { uid: 'abc', getIdToken }
    createUserWithEmailAndPassword.mockResolvedValueOnce({ user: newUser })
    sendEmailVerification.mockResolvedValueOnce(undefined)

    await handleSignup('new@example.com', 'secret123', 'secret123')

    expect(sendEmailVerification).toHaveBeenCalledWith(newUser)
  })

  it('no bloquea el registro si sendEmailVerification falla (best-effort)', async () => {
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true
    const getIdToken = vi.fn().mockResolvedValue('tok-new')
    createUserWithEmailAndPassword.mockResolvedValueOnce({ user: { uid: 'abc', getIdToken } })
    sendEmailVerification.mockRejectedValueOnce(new Error('quota exceeded'))

    await expect(handleSignup('new@example.com', 'secret123', 'secret123')).resolves.toBeTruthy()
  })
})

describe('setView — forgot-password', () => {
  it('shows only #forgot-password-view for "forgot-password"', () => {
    setView('forgot-password')
    expect(document.getElementById('login-view').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('login-actions').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('forgot-password-view').classList.contains('hidden')).toBe(false)
  })

  it('hides #login-actions alongside #login-view for "phone-number"', () => {
    setView('phone-number')
    expect(document.getElementById('login-actions').classList.contains('hidden')).toBe(true)
  })
})

describe('handleForgotPassword', () => {
  it('llama sendPasswordResetEmail y muestra el mensaje de éxito', async () => {
    sendPasswordResetEmail.mockResolvedValueOnce(undefined)

    await handleForgotPassword('user@example.com')

    expect(sendPasswordResetEmail).toHaveBeenCalledWith(mockAuth, 'user@example.com')
    const successEl = document.getElementById('forgot-password-success')
    expect(successEl.classList.contains('hidden')).toBe(false)
    expect(successEl.textContent).toMatch(/enlace para restablecer/)
  })

  it('muestra el MISMO mensaje de éxito incluso si sendPasswordResetEmail falla (no revela si el correo existe)', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce({ code: 'auth/user-not-found' })

    await handleForgotPassword('noexiste@example.com')

    const successEl = document.getElementById('forgot-password-success')
    expect(successEl.classList.contains('hidden')).toBe(false)
    expect(successEl.textContent).toMatch(/enlace para restablecer/)
  })
})

describe('wiring — forgot-password link y signup-mode (DOMContentLoaded)', () => {
  beforeEach(() => {
    document.dispatchEvent(new Event('DOMContentLoaded'))
  })

  it('#btn-forgot-password cambia a la vista forgot-password', () => {
    document.getElementById('btn-forgot-password').click()
    expect(document.getElementById('forgot-password-view').classList.contains('hidden')).toBe(false)
  })

  it('entrar en modo signup revela el campo de confirmar contraseña y oculta el link de recuperar', () => {
    document.getElementById('btn-signup').click()
    expect(document.getElementById('signup-password-confirm-field').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('btn-forgot-password').classList.contains('hidden')).toBe(true)
  })

  it('volver a modo login oculta de nuevo el campo de confirmar contraseña y muestra el link de recuperar', () => {
    document.getElementById('btn-signup').click()
    document.getElementById('btn-back-to-login').click()
    expect(document.getElementById('signup-password-confirm-field').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('btn-forgot-password').classList.contains('hidden')).toBe(false)
  })
})
```

- [ ] **Step 5: Correr los tests para confirmar que los nuevos fallan**

Run: `npx vitest run tests/auth-ui.test.js`
Expected: FAIL — los describes nuevos fallan (`handleForgotPassword` no exportado, `sendEmailVerification`/`sendPasswordResetEmail` nunca llamados, `#login-actions`/`#forgot-password-view`/`#signup-password-confirm-field`/`#btn-forgot-password` no reaccionan porque `auth-ui.js` no los conoce aún). Los tests existentes (incluyendo el editado en 4c) deben seguir en verde.

- [ ] **Step 6: Implementar los cambios en `auth-ui.js`**

En el import del tope del archivo, agregar `sendEmailVerification, sendPasswordResetEmail`:

```js
import {
  firebaseAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithCustomToken,
  sendEmailVerification,
  sendPasswordResetEmail
} from './firebase-init.js';
```

Reemplazar `const VIEWS = [...]` y la función `setView` completa por:

```js
const VIEWS = ['login', 'phone-number', 'phone-code', 'phone-consent', 'forgot-password'];
let currentView = 'login';

export function setView(view) {
  currentView = view;
  document.getElementById('login-view')?.classList.toggle('hidden', view !== 'login');
  document.getElementById('login-actions')?.classList.toggle('hidden', view !== 'login');
  document.getElementById('phone-step')?.classList.toggle('hidden', view !== 'phone-number');
  document.getElementById('phone-code-step')?.classList.toggle('hidden', view !== 'phone-code');
  document.getElementById('forgot-password-view')?.classList.toggle('hidden', view !== 'forgot-password');
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
```

Reemplazar la función `handleSignup` completa por:

```js
export async function handleSignup(email, password, passwordConfirm) {
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
  if (password !== passwordConfirm) {
    const err = new Error('Las contraseñas no coinciden.');
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
      // Best-effort: un fallo al enviar el correo de verificación no debe
      // impedir que el usuario continúe su registro — la verificación es
      // informativa, nunca bloqueante (ver spec).
      sendEmailVerification(result.user).catch(() => {});
      window.location.href = 'onboarding-profile.html';
      return result;
    } catch (err) {
      showError(mapAuthError(err.code));
      throw err;
    }
  });
}
```

Justo después de `handlePhoneSignupConsent` (antes del `document.addEventListener('DOMContentLoaded', ...)`), agregar:

```js
export async function handleForgotPassword(email) {
  clearError();
  const btn = document.getElementById('btn-send-reset');
  return withLoadingState(btn, 'Enviando…', async () => {
    // sendPasswordResetEmail puede fallar con auth/user-not-found — nunca se
    // distingue ese caso del éxito real (hallazgo de seguridad: evita
    // enumeración de cuentas, mismo principio ya aplicado en mapAuthError
    // para wrong-password/user-not-found/invalid-credential).
    try {
      await sendPasswordResetEmail(firebaseAuth, email);
    } catch {
      // intencional: mismo mensaje de éxito sin importar el resultado real
    }
    const successEl = document.getElementById('forgot-password-success');
    if (successEl) {
      successEl.textContent = 'Si ese correo tiene una cuenta, te enviamos un enlace para restablecer tu contraseña.';
      successEl.classList.remove('hidden');
    }
  });
}
```

Dentro de `enterSignupMode`, agregar estas dos líneas (junto a las que ya ocultan/muestran `btnLogin`/`btnBackToLogin`):

```js
    document.getElementById('signup-password-confirm-field')?.classList.remove('hidden');
    document.getElementById('btn-forgot-password')?.classList.add('hidden');
```

Dentro de `exitSignupMode`, agregar (simétrico):

```js
    document.getElementById('signup-password-confirm-field')?.classList.add('hidden');
    document.getElementById('btn-forgot-password')?.classList.remove('hidden');
```

Dentro del listener `btnSignup.addEventListener('click', ...)`, en la rama del segundo clic (después de `if (!form.reportValidity()) return;`), agregar la lectura del campo de confirmación y pasarlo a `handleSignup`:

```js
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const passwordConfirm = document.getElementById('signup-password-confirm')?.value;
      handleSignup(email, password, passwordConfirm);
```

(reemplaza las 2 líneas existentes `const email = ...` / `const password = ...` / `handleSignup(email, password);` de esa rama por las 3 de arriba).

Finalmente, junto a donde se declaran `btnPhone`, `phoneCountrySelect`, etc. dentro de `DOMContentLoaded`, agregar:

```js
  const btnForgotPassword = document.getElementById('btn-forgot-password');
  const btnSendReset = document.getElementById('btn-send-reset');
  const btnForgotPasswordBack = document.getElementById('btn-forgot-password-back');

  if (btnForgotPassword) {
    btnForgotPassword.addEventListener('click', () => {
      clearError();
      setView('forgot-password');
    });
  }
  if (btnSendReset) {
    btnSendReset.addEventListener('click', () => {
      const email = document.getElementById('forgot-password-email').value.trim();
      handleForgotPassword(email);
    });
  }
  if (btnForgotPasswordBack) {
    btnForgotPasswordBack.addEventListener('click', () => {
      document.getElementById('forgot-password-success')?.classList.add('hidden');
      clearError();
      setView('login');
    });
  }
```

- [ ] **Step 7: Correr los tests para confirmar que pasan**

Run: `npx vitest run tests/auth-ui.test.js`
Expected: PASS, todos verdes (incluyendo `'password toggle aria-label'` sin cambios de comportamiento).

- [ ] **Step 8: Correr la suite completa para confirmar que no hay regresiones**

Run: `npx vitest run`
Expected: PASS en todas las suites salvo la falla preexistente y no relacionada de `tests/e2e/scan-cycle.spec.js`.

- [ ] **Step 9: Commit**

```bash
git add auth.html home.css firebase-init.js auth-ui.js tests/auth-ui.test.js
git commit -m "fix(auth): confirmar contraseña, verificación de correo, recuperar contraseña, orden de consentimiento

- .link-button ahora vive en home.css (compartido) en vez de atrapado en
  el <style> inline de auth.html — arregla el botón 'Ahora no' sin estilo
  en preferences.html.
- Los botones de acción (#login-actions) se extraen como hermano de
  #signup-only en vez de contenerlo — el botón de confirmar cuenta ya
  no aparece antes que los checkboxes de Términos/edad.
- Nuevo campo de confirmar contraseña en signup, validado antes de
  llamar a Firebase.
- sendEmailVerification (best-effort, no bloqueante) tras crear cuenta
  por correo.
- Nueva vista 'Olvidé mi contraseña' vía sendPasswordResetEmail, mismo
  mensaje de éxito exista o no la cuenta (evita enumeración)."
```

---

### Task 2: Aviso de correo no verificado en `account-ui.js`

**Files:**
- Modify: `account-ui.js`
- Modify: `tests/account-ui.test.js`

**Interfaces:**
- Consumes: `sendEmailVerification` de `firebase-init.js` (agregado en Task 1), `firebaseAuth.currentUser.emailVerified`/`providerData` (ya expuestos por el SDK).
- Produces: nueva función exportada `submitResendVerification()` (zero-arg, mismo patrón que el resto de `submit*` del archivo).

- [ ] **Step 1: Escribir los tests (RED)**

En `tests/account-ui.test.js`, cambiar el import de `firebase-init.js` para incluir `sendEmailVerification`:

```js
const sendEmailVerification = vi.fn()
vi.mock('../firebase-init.js', () => ({ firebaseAuth: mockAuth, signOut, reauthenticateWithCredential, verifyBeforeUpdateEmail, updatePassword, EmailAuthProvider, sendEmailVerification }))
```

(agrega la línea `const sendEmailVerification = vi.fn()` junto a los demás `vi.fn()` del tope del archivo, y agrega `sendEmailVerification` al objeto que regresa el mock).

Al final del archivo, después del último `describe`, agregar:

```js

describe('aviso de correo no verificado', () => {
  it('se muestra cuando el provider es password y emailVerified es false', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', emailVerified: false, providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    expect(document.getElementById('btn-resend-verification')).toBeTruthy()
  })

  it('NO se muestra si el correo ya está verificado', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', emailVerified: true, providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    expect(document.getElementById('btn-resend-verification')).toBeNull()
  })

  it('NO se muestra para cuentas sin provider password (Google/teléfono)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', emailVerified: false, providerData: [{ providerId: 'google.com' }] }
    renderAccountHub()
    expect(document.getElementById('btn-resend-verification')).toBeNull()
  })

  it('submitResendVerification llama sendEmailVerification y muestra confirmación', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', emailVerified: false, providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    sendEmailVerification.mockResolvedValueOnce(undefined)

    await submitResendVerification()

    expect(sendEmailVerification).toHaveBeenCalledWith(mockAuth.currentUser)
    const successEl = document.getElementById('resend-verification-success')
    expect(successEl.classList.contains('hidden')).toBe(false)
  })
})
```

Y en la sección de imports/declaraciones del tope del archivo de test, agrega `submitResendVerification` a la lista de `let` y a la asignación desde `mod` en el `beforeEach`, igual que las demás `submit*`.

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `npx vitest run tests/account-ui.test.js`
Expected: FAIL — `submitResendVerification` no exportado, `#btn-resend-verification` no existe.

- [ ] **Step 3: Implementar en `account-ui.js`**

En el import del tope del archivo, agregar `sendEmailVerification`:

```js
import { firebaseAuth, signOut, reauthenticateWithCredential, verifyBeforeUpdateEmail, updatePassword, EmailAuthProvider, sendEmailVerification } from './firebase-init.js';
```

Justo después de la función `hasPasswordProvider` existente, agregar:

```js
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
      </div>
    </div>
  `;
}
```

Dentro de `renderAccountHub`, en el template, justo después del cierre de `</div>` de `.hero-card-dark` (antes de `<div class="stat-row">`), agregar:

```js
      ${renderEmailVerificationBanner()}
```

Dentro de `wireAccountHubEvents`, junto al wiring de `btn-logout`, agregar:

```js
  document.getElementById('btn-resend-verification')?.addEventListener('click', () => {
    submitResendVerification().catch(() => {});
  });
```

Al final del archivo, junto a los demás `submit*` (antes de `handleLogout`), agregar:

```js
export async function submitResendVerification() {
  const btn = document.getElementById('btn-resend-verification');
  const originalText = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  try {
    await sendEmailVerification(firebaseAuth.currentUser);
    const successEl = document.getElementById('resend-verification-success');
    if (successEl) { successEl.textContent = 'Correo de verificación enviado.'; successEl.classList.remove('hidden'); }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}
```

- [ ] **Step 4: Correr el test para confirmar que pasa**

Run: `npx vitest run tests/account-ui.test.js`
Expected: PASS, todos verdes (existentes + los 4 nuevos del aviso).

- [ ] **Step 5: Correr la suite completa para confirmar que no hay regresiones**

Run: `npx vitest run`
Expected: PASS en todas las suites salvo la falla preexistente y no relacionada de `tests/e2e/scan-cycle.spec.js`.

- [ ] **Step 6: Commit**

```bash
git add account-ui.js tests/account-ui.test.js
git commit -m "feat(account): aviso de correo no verificado + reenviar

Fila informativa (no bloqueante) en Mi cuenta cuando el login es por
correo/contraseña y emailVerified es false, con botón para reenviar
el correo de verificación (sendEmailVerification)."
```
