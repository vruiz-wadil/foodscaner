# Login por teléfono (Firebase Phone Auth) — Design

## Contexto

`auth.html` hoy soporta email/password y Google (`auth-ui.js`, `firebase-init.js` como único punto de import del SDK de Firebase v11.6.0). Se agrega una tercera opción: login/signup por número de teléfono con código SMS, vía Firebase Phone Auth.

## Objetivo

Botón "Continuar con teléfono" junto al de Google. Flujo: país+número → código SMS → sesión. Usuario nuevo pasa por el mismo gate legal de Términos/edad que ya existe para signup por correo. Usuarios que ya usan el free tier vía teléfono no deben quedar bloqueados por el gate anti-abuso de OCR que hoy exige `emailVerified`.

## Fuera de alcance

- Vincular una cuenta de teléfono a una cuenta existente de email/Google (Firebase no lo fuerza automáticamente y no se pidió).
- Cambiar/agregar número de teléfono desde `account.html` (solo se cubre login inicial).
- E2E automatizado del envío/recepción real de SMS (no hay forma de recibirlo en CI).

## Arquitectura

### 1. UI en `auth.html`

Reutiliza el patrón de alternar vistas que `auth-ui.js` ya usa para signup (`enterSignupMode`/`exitSignupMode`). Tres estados dentro del mismo card:

- **`login`** (default): sin cambios.
- **`phone-number`**: `<div id="phone-step" class="hidden">` con `<select id="phone-country">` (código de país, México preseleccionado), `<input id="phone-number" type="tel">`, botón `#btn-send-code`, link `#btn-phone-cancel`.
- **`phone-code`**: `<div id="phone-code-step" class="hidden">` con `<input id="phone-code" type="text" inputmode="numeric" maxlength="6">`, botón `#btn-verify-code`, link `#btn-resend-code`, link `#btn-phone-code-back`.

Nuevo botón `#btn-phone` ("Continuar con teléfono") junto a `#btn-google`, arriba del divisor.

Si `getAdditionalUserInfo(result).isNewUser` es `true` tras verificar el código, se reutiliza el bloque `#signup-only` existente (checkboxes Términos/edad) antes de llamar `/api/auth/sync` — mismo gate legal, sin duplicar markup.

`<div id="recaptcha-container"></div>` fijo en el DOM (oculto vía CSS, nunca `display:none` en el nodo mismo — `RecaptchaVerifier` necesita el nodo montado para renderizar su iframe invisible).

### 2. Datos de país — `country-codes.js` (nuevo archivo)

Array estático `[{ name, iso2, dial, flag }]`, lista ITU completa (~200 países, nombre en español, emoji de bandera, código E.164), México primero y resto alfabético. `auth-ui.js` lo importa y puebla `#phone-country` en `DOMContentLoaded`. `<select>` nativo, sin librería externa.

### 3. `firebase-init.js`

Agrega import/export de `RecaptchaVerifier`, `signInWithPhoneNumber`, `getAdditionalUserInfo` desde el mismo CDN de Firebase Auth ya usado (`firebase-auth.js` v11.6.0), mismo patrón que el resto del archivo (único punto de import del SDK).

### 4. Lógica en `auth-ui.js`

```js
let recaptchaVerifier = null;
let confirmationResult = null;
let pendingPhoneCredentialResult = null;

function getRecaptchaVerifier() {
  if (!recaptchaVerifier) {
    recaptchaVerifier = new RecaptchaVerifier(firebaseAuth, 'recaptcha-container', { size: 'invisible' });
  }
  return recaptchaVerifier;
}

async function handleSendCode(dialCode, localNumber) {
  clearError();
  const btn = document.getElementById('btn-send-code');
  return withLoadingState(btn, 'Enviando código…', async () => {
    try {
      const phoneNumber = dialCode + localNumber.replace(/\D/g, '');
      confirmationResult = await signInWithPhoneNumber(firebaseAuth, phoneNumber, getRecaptchaVerifier());
      enterPhoneCodeStep();
    } catch (err) {
      showError(mapAuthError(err.code));
      recaptchaVerifier?.clear();
      recaptchaVerifier = null;
      throw err;
    }
  });
}

async function handleVerifyCode(code) {
  clearError();
  const btn = document.getElementById('btn-verify-code');
  return withLoadingState(btn, 'Verificando…', async () => {
    try {
      const result = await confirmationResult.confirm(code);
      const isNewUser = getAdditionalUserInfo(result)?.isNewUser;
      if (isNewUser) {
        pendingPhoneCredentialResult = result;
        enterPhoneConsentStep();
        return result;
      }
      window.location.href = 'index.html';
      return result;
    } catch (err) {
      showError(mapAuthError(err.code));
      throw err;
    }
  });
}

async function handlePhoneSignupConsent() {
  const termsChecked = document.getElementById('terms-checkbox')?.checked;
  const ageChecked = document.getElementById('age-checkbox')?.checked;
  if (!termsChecked || !ageChecked) {
    showError('Debes aceptar los Términos y confirmar tu edad para crear tu cuenta.');
    return;
  }
  const token = await pendingPhoneCredentialResult.user.getIdToken();
  await fetch('/api/auth/sync', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ termsAccepted: true, ageConfirmed: true, termsVersion: TERMS_VERSION })
  });
  window.location.href = 'index.html';
}
```

`#btn-phone-cancel` limpia `confirmationResult`, `pendingPhoneCredentialResult` y el `recaptchaVerifier` (`.clear()` + null). `#btn-phone-code-back` solo limpia `confirmationResult` (vuelve a paso 1, no a `login`). `#btn-resend-code` limpia el verifier igual que el catch de `handleSendCode` (fuerza challenge fresco) y reusa el número ya capturado.

`syncUserProfile()` en `authClient.js` (auto-sync on cualquier auth state change) ya cubre el caso de usuario EXISTENTE que entra por teléfono sin cambios — no necesita tocarse.

### 5. CSP (`auth.html`)

reCAPTCHA de Firebase carga desde `google.com` (no solo `gstatic.com`/`apis.google.com`, ya permitidos):
- `script-src`: + `https://www.google.com`
- `frame-src`: + `https://www.google.com`
- `connect-src`: + `https://www.google.com`

### 6. Backend

**`api/auth.js`** `verifyFirebaseIdToken` — agrega el claim de teléfono al retorno:
```js
return { uid: payload.sub, email: payload.email || null, emailVerified: !!payload.email_verified, phoneNumber: payload.phone_number || null };
```
Firebase solo incluye `phone_number` en el ID token si el usuario verificó por SMS — no hay claim "verificado" aparte; la sola presencia ya es la señal, igual que `email_verified` para email.

**`api/index.js`**:
- `requireUser`/`optionalUser`: agregan `phoneNumber` al `req.user` armado desde el token.
- Gate anti-abuso OCR gratis (hoy `if (plan !== 'premium' && !req.user.emailVerified)`): pasa a `if (plan !== 'premium' && !req.user.emailVerified && !req.user.phoneNumber)`. Teléfono verificado también libera la cuota free — es al menos tan fuerte como email verificado contra cuentas desechables (conseguir muchos números es más caro/lento que muchos correos).
- `authSyncHandler`: agrega `phoneNumber: req.user.phoneNumber` al objeto pasado a `fireUpsertUser`.

**`api/firestore.js`** `fireUpsertUser`, bloque de creación: agrega `phoneNumber: data.phoneNumber || null`.

**`account-ui.js`**: si no hay `profile.email`, muestra `profile.phoneNumber` en su lugar (`profile.email || profile.phoneNumber || ''`).

## Manejo de errores

`mapAuthError` gana:
```js
'auth/invalid-phone-number': 'Número de teléfono inválido.',
'auth/missing-phone-number': 'Ingresa un número de teléfono.',
'auth/invalid-verification-code': 'Código incorrecto. Verifica e intenta de nuevo.',
'auth/code-expired': 'El código expiró. Solicita uno nuevo.',
'auth/quota-exceeded': 'Demasiados SMS solicitados. Intenta más tarde.'
```
(`auth/too-many-requests` ya existe y se reusa igual para SMS.)

Doble submit ya cubierto por `withLoadingState` (deshabilita el botón durante la operación), mismo mecanismo que login/signup/Google — sin cambios necesarios ahí.

## Testing

- `tests/auth-ui.test.js`: mockea `RecaptchaVerifier`/`signInWithPhoneNumber`/`getAdditionalUserInfo` desde `firebase-init.js` (mismo patrón que ya mockea `signInWithEmailAndPassword`). Casos: envío de código éxito/error, verificación con usuario existente (redirige directo) vs nuevo (exige consentimiento antes de sync), cancelar/volver limpia estado.
- `tests/auth.test.js` / `tests/requireUser.test.js`: extiende para el claim `phone_number` → `phoneNumber` en el token verificado y en `req.user`.
- `tests/ocrQuota.test.js`: extiende el gate — usuario free con `phoneNumber` pero sin `emailVerified` NO debe recibir 403.
- Sin E2E real de SMS — verificación de ese tramo queda manual (límite conocido, ver "Fuera de alcance").

## Constraints globales

- Solo rama `develop` — nunca tocar `master`/producción sin pedirlo explícitamente.
- Único punto de import del SDK de Firebase: `firebase-init.js` (no importar del CDN directo en ningún otro archivo).
- CSP debe seguir siendo restrictiva — solo agregar los hosts de `google.com` estrictamente necesarios para reCAPTCHA, no relajar de más.
- Mensajes de error de auth siempre genéricos donde aplica el hallazgo de anti-enumeración ya establecido (no aplica aquí: los errores de teléfono/código no permiten enumerar cuentas de la misma forma que email).
