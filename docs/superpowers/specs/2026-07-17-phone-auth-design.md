# Login por teléfono (Firebase Phone Auth) — Design

## Contexto

`auth.html` hoy soporta email/password y Google (`auth-ui.js`, `firebase-init.js` como único punto de import del SDK de Firebase v11.6.0). Se agrega una tercera opción: login/signup por número de teléfono con código SMS, vía Firebase Phone Auth.

Este documento incorpora los hallazgos de una revisión con 3 agentes especializados (seguridad, arquitectura backend, frontend) hecha sobre la v1 del spec — ver sección "Cambios de la revisión" al final para el detalle de qué cambió y por qué.

## Objetivo

Botón "Continuar con teléfono" junto al de Google. Flujo: país+número → código SMS → sesión. Usuario nuevo pasa por el mismo gate legal de Términos/edad que ya existe para signup por correo. Usuarios que ya usan el free tier vía teléfono no deben quedar bloqueados por el gate anti-abuso de OCR que hoy exige `emailVerified`.

## Fuera de alcance

- Vincular una cuenta de teléfono a una cuenta existente de email/Google (Firebase no lo fuerza automáticamente y no se pidió).
- Cambiar/agregar número de teléfono desde `account.html` (solo se cubre login inicial).
- E2E automatizado del envío/recepción real de SMS (no hay forma de recibirlo en CI).
- Firebase App Check / reCAPTCHA Enterprise (ver "Prerequisito de producción" abajo) — es config de consola de Firebase, no código de este repo, pero es **requisito antes de habilitar esto en producción**, no un nice-to-have.

## Prerequisito de producción: Firebase App Check

`signInWithPhoneNumber` corre enteramente en el navegador contra Identity Platform — nunca toca `api/index.js`, así que el rate-limit existente (`express-rate-limit`, 60 req/min en `/api/`) no protege nada de este flujo. reCAPTCHA invisible v2 (lo único que especifica este documento) detecta bots, no automatización de volumen con navegador real — exactamente el hueco que la propia documentación de Firebase señala como vector de "SMS toll fraud" (atacante dispara verificaciones a números que no controla, la víctima recibe spam de SMS, el proyecto paga cada envío).

Antes de exponer este botón en producción (no bloquea developer/preview):
- Habilitar **Firebase App Check** (reCAPTCHA v3/Enterprise) en la consola de Firebase para el proveedor Phone.
- Restringir las regiones de SMS permitidas en la consola a los países que la app realmente sirve.
- Monitorear volumen de SMS/costos (alerta si hay picos).

Ninguna de estas tres es una tarea de código de este plan — son config de consola — pero se documentan aquí porque el diseño de abajo (gate anti-abuso, rate-limiting client-side) asume que existen.

## Arquitectura

### 1. UI en `auth.html`

**Máquina de estados explícita**, no una extensión ad hoc del booleano `isSignupMode` existente. `auth-ui.js` gana:

```js
const VIEWS = ['login', 'phone-number', 'phone-code', 'phone-consent'];
let currentView = 'login';

function setView(view) {
  currentView = view;
  document.getElementById('login-view').classList.toggle('hidden', view !== 'login');
  document.getElementById('phone-step').classList.toggle('hidden', view !== 'phone-number');
  document.getElementById('phone-code-step').classList.toggle('hidden', view !== 'phone-code');
  document.getElementById('signup-only').classList.toggle('hidden', view !== 'phone-consent' && !isSignupMode);
}
```

`isSignupMode` (email/password signup) y `currentView` (teléfono) son independientes — el signup por correo nunca toca `currentView`, y viceversa. `#signup-only` puede mostrarse por CUALQUIERA de los dos caminos (`isSignupMode === true` O `currentView === 'phone-consent'`), de ahí el `||` en el toggle.

`#login-view` es un `<div>` nuevo que envuelve el markup que YA existe hoy (`#btn-google`, el `.auth-divider`, y `<form id="login-form">`) — no cambia su contenido, solo lo agrupa para poder ocultarlo como una unidad al entrar a cualquier paso de teléfono.

**Markup nuevo**, todo como hermanos de `<form id="login-form">` dentro de `.content-card` (NO anidados dentro del `<form>` — evita que Enter en un input de teléfono dispare el submit del form de login, que es `type="submit"` hacia `#btn-login`):

```html
<div id="phone-step" class="hidden">
  <div class="form-field">
    <label for="phone-country">País</label>
    <select id="phone-country"></select>
  </div>
  <div class="form-field">
    <label for="phone-number">Número de teléfono</label>
    <input id="phone-number" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="10 dígitos">
  </div>
  <button type="button" id="btn-send-code" class="btn btn-primary">Enviar código</button>
  <button type="button" id="btn-phone-cancel" class="link-button">Cancelar</button>
</div>

<div id="phone-code-step" class="hidden">
  <div class="form-field">
    <label for="phone-code">Código de verificación</label>
    <input id="phone-code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
  </div>
  <button type="button" id="btn-verify-code" class="btn btn-primary">Verificar</button>
  <button type="button" id="btn-resend-code" class="link-button">Reenviar código</button>
  <button type="button" id="btn-phone-code-back" class="link-button">Cambiar número</button>
</div>
```

`autocomplete="one-time-code"` en `#phone-code` habilita autofill nativo de SMS en iOS/Android — gratis, sin código adicional.

Nuevo botón `#btn-phone` ("Continuar con teléfono") junto a `#btn-google`, arriba del divisor, llama `setView('phone-number')`.

**Reutilización de `#signup-only`**: cuando `getAdditionalUserInfo(result).isNewUser` es `true` tras verificar el código, se llama `setView('phone-consent')`, que muestra `#signup-only` (los mismos 2 checkboxes de Términos/edad). Se agrega un botón nuevo y sin ambigüedad — NO reutilizar `#btn-signup` (ese botón tiene semántica de doble-click específica del flujo de email, ver Task original):

```html
<button type="button" id="btn-phone-consent-confirm" class="btn btn-primary">Confirmar y continuar</button>
```

`<div id="recaptcha-container"></div>` — sin ningún CSS aplicado (ni `display:none`, ni `visibility:hidden`, ni posicionamiento fuera de pantalla). Es un `<div>` vacío común y corriente: no ocupa espacio visible por estar vacío, pero permanece un nodo real montado en el DOM con layout normal, que es lo que `RecaptchaVerifier` necesita para adjuntar su iframe. Si Google escala a un challenge visible (raro, pero posible con `size:'invisible'`), necesita poder renderizarse — cualquier CSS que lo saque del flujo o lo oculte por completo rompe ese caso.

### 2. Datos de país — `country-codes.js` (nuevo archivo)

Array estático `[{ name, iso2, dial, flag }]`, lista ITU completa (~200 países, nombre en español, emoji de bandera, código E.164), México primero y resto alfabético. `auth-ui.js` lo importa y puebla `#phone-country` en `DOMContentLoaded`. `<select>` nativo, sin librería externa — 200 opciones no es un problema real de usabilidad aquí (el usuario objetivo casi nunca lo abre, ya viene en México).

### 3. `firebase-init.js`

Agrega import/export de `RecaptchaVerifier`, `signInWithPhoneNumber`, `getAdditionalUserInfo` desde el mismo CDN de Firebase Auth ya usado (`firebase-auth.js` v11.6.0), mismo patrón que el resto del archivo (único punto de import del SDK).

### 4. `authClient.js` — suprimir auto-sync mientras el consentimiento está pendiente

**Este es el cambio más importante de la revisión.** `authClient.js` ya auto-sincroniza (`syncUserProfile()`, POST **sin body** a `/api/auth/sync`) en CUALQUIER cambio de estado de auth, incluyendo el instante en que `confirmationResult.confirm(code)` resuelve — es decir, ANTES de que el usuario nuevo vea los checkboxes de consentimiento. Esa sync sin body crea el doc de Firestore (`fireUpsertUser`, rama de creación) con `termsAccepted` ausente → `termsAcceptedAt: null`. La sync explícita de `handlePhoneSignupConsent()` (que sí manda `termsAccepted:true`) llega milisegundos después y cae en la rama de usuario YA EXISTENTE de `fireUpsertUser`, que solo actualiza `lastLoginAt`+`providers` — nunca escribe `termsAccepted*`/`ageConfirmedAt`/`termsVersion`. Resultado sin este fix: todo signup por teléfono pierde la evidencia legal de aceptación de Términos, silenciosa y permanentemente.

Fix — un flag de módulo en `authClient.js` que `auth-ui.js` puede pausar:

```js
// authClient.js
let autoSyncSuppressed = false;
export function setAutoSyncSuppressed(value) { autoSyncSuppressed = value; }

onAuthChange((user) => {
  if (user && !autoSyncSuppressed) return syncUserProfile();
});
```

`auth-ui.js` llama `setAutoSyncSuppressed(true)` como PRIMERA línea de `handleVerifyCode`, antes de `await confirmationResult.confirm(code)` — así el flag ya está en `true` cuando Firebase dispara el auth-state-change interno que activa el listener de `authClient.js` (el `confirm()` es async, así que el set síncrono previo siempre gana la carrera). No hace falta volver a poner el flag en `false`: todo camino posterior a `handleVerifyCode` termina en `window.location.href = 'index.html'` dentro de ESTA misma carga de página — la navegación completa descarta el estado del módulo, y `index.html` arranca con `autoSyncSuppressed = false` de nuevo por defecto.

### 5. Lógica en `auth-ui.js`

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
      setView('phone-code');
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
  setAutoSyncSuppressed(true); // antes de confirm() — ver sección 4
  const btn = document.getElementById('btn-verify-code');
  return withLoadingState(btn, 'Verificando…', async () => {
    try {
      const result = await confirmationResult.confirm(code);
      const isNewUser = getAdditionalUserInfo(result)?.isNewUser;
      if (isNewUser) {
        pendingPhoneCredentialResult = result;
        setView('phone-consent');
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
  const btn = document.getElementById('btn-phone-consent-confirm');
  return withLoadingState(btn, 'Guardando…', async () => {
    const token = await pendingPhoneCredentialResult.user.getIdToken();
    await fetch('/api/auth/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ termsAccepted: true, ageConfirmed: true, termsVersion: TERMS_VERSION })
    });
    window.location.href = 'index.html';
  });
}
```

`#btn-phone-cancel` llama `setView('login')`, limpia `confirmationResult`, `pendingPhoneCredentialResult` y el `recaptchaVerifier` (`.clear()` + null). `#btn-phone-code-back` llama `setView('phone-number')` y solo limpia `confirmationResult`. `#btn-resend-code` limpia el verifier igual que el catch de `handleSendCode` (fuerza challenge fresco) y reusa el número ya capturado — sin cooldown de UI en esta v1 (queda como límite conocido, mitigado por App Check en el prerequisito de producción, no por este repo).

### 6. CSP (`auth.html`)

reCAPTCHA de Firebase carga desde `google.com` (no solo `gstatic.com`/`apis.google.com`, ya permitidos):
- `script-src`: + `https://www.google.com`
- `frame-src`: + `https://www.google.com`
- `connect-src`: + `https://www.google.com`

Confirmado que ninguna otra directiva (`style-src`, `img-src`) necesita cambios: `img-src` ya permite `https:` en general, y reCAPTCHA v2 invisible no requiere estilos externos fuera de lo que ya permite `unsafe-inline`.

### 7. Backend

**`api/auth.js`** `verifyFirebaseIdToken` — agrega el claim de teléfono al retorno:
```js
return { uid: payload.sub, email: payload.email || null, emailVerified: !!payload.email_verified, phoneNumber: payload.phone_number || null };
```
Firebase solo incluye `phone_number` en el ID token si el usuario verificó por SMS y el token pasa la misma verificación de firma RS256/iss/aud que ya se aplica a todo el payload — no hay ruta para que `phone_number` aparezca en un token válido sin verificación real. No requiere cambios estructurales en la verificación de firma.

**`api/index.js`**:
- `requireUser`/`optionalUser`: agregan `phoneNumber` al `req.user` armado desde el token.
- Gate anti-abuso OCR gratis (hoy `if (plan !== 'premium' && !req.user.emailVerified)`): pasa a `if (plan !== 'premium' && !req.user.emailVerified && !req.user.phoneNumber)`. **Nota de la revisión de seguridad**: la premisa original ("teléfono es más fuerte que email contra abuso") no se sostiene — servicios de SMS-PVA hacen verificación OTP real y automatizada más barata que evadir verificación de email, y cada verificación fraudulenta además cuesta un SMS real que paga el proyecto. Este bypass del gate se considera aceptable SOLO como parte de este feature completo, es decir, condicionado al prerequisito de producción (App Check) de arriba — sin App Check habilitado, no desplegar este bypass a producción.
- `authSyncHandler`: agrega `phoneNumber: req.user.phoneNumber` al objeto pasado a `fireUpsertUser`.

**`api/firestore.js`** `fireUpsertUser`, bloque de creación: agrega `phoneNumber: data.phoneNumber || null`. Seguirá el mismo patrón ya establecido para `email`/`emailVerified` — se fija SOLO en creación del doc, nunca se actualiza en logins posteriores (ver bloque de actualización de usuario existente, que solo toca `lastLoginAt`+`providers`). Esto es intencional y consistente con el manejo actual de email, no un gap — se documenta aquí explícitamente porque es precisamente la ausencia de un camino de actualización lo que hace real la race condition de la sección 4 (no hay red de seguridad post-creación para corregir un consentimiento perdido).

**`account-ui.js`**: si no hay `profile.email`, muestra `profile.phoneNumber` en su lugar (`profile.email || profile.phoneNumber || ''`).

**Nota para trabajo futuro** (no de este plan): si algún día se implementa vinculación de proveedores (email+teléfono en una misma cuenta), la presencia de `phoneNumber` en el perfil deja de significar "esta sesión se autenticó por SMS" y pasa a significar solo "esta cuenta tiene un teléfono verificado registrado". El gate anti-abuso de arriba ya usa exactamente esa semántica (a nivel de cuenta, no de sesión), así que no requiere cambios cuando eso pase — es una nota de precaución para no reinterpretar el campo más adelante.

## Manejo de errores

`mapAuthError` gana:
```js
'auth/invalid-phone-number': 'Número de teléfono inválido.',
'auth/missing-phone-number': 'Ingresa un número de teléfono.',
'auth/invalid-verification-code': 'Código incorrecto. Verifica e intenta de nuevo.',
'auth/code-expired': 'El código expiró. Solicita uno nuevo.',
'auth/quota-exceeded': 'Demasiados SMS solicitados. Intenta más tarde.',
'auth/captcha-check-failed': 'Verificación de seguridad falló. Intenta de nuevo.',
'auth/invalid-app-credential': 'Verificación de seguridad falló. Intenta de nuevo.'
```
(`auth/too-many-requests` ya existe y se reusa igual para SMS.)

Doble submit ya cubierto por `withLoadingState` en los 3 handlers nuevos (`handleSendCode`, `handleVerifyCode`, `handlePhoneSignupConsent`) — mismo mecanismo que login/signup/Google, sin excepciones esta vez (v1 del spec dejaba `handlePhoneSignupConsent` sin envolver; ya corregido arriba).

## Testing

- `tests/auth-ui.test.js`: mockea `RecaptchaVerifier`/`signInWithPhoneNumber`/`getAdditionalUserInfo` desde `firebase-init.js` (mismo patrón que ya mockea `signInWithEmailAndPassword`). Casos: envío de código éxito/error, verificación con usuario existente (redirige directo, `setAutoSyncSuppressed` no importa porque no hay paso de consentimiento) vs nuevo (exige consentimiento antes de sync), cancelar/volver limpia estado y restaura `setView`.
- `tests/authClient.test.js`: nuevo caso — con `setAutoSyncSuppressed(true)`, un cambio de auth state NO dispara `syncUserProfile()`/POST a `/api/auth/sync`; con `false` (default), sí lo dispara, sin regresión al comportamiento actual.
- `tests/auth.test.js` / `tests/requireUser.test.js`: extiende para el claim `phone_number` → `phoneNumber` en el token verificado y en `req.user`.
- `tests/ocrQuota.test.js`: extiende el gate — usuario free con `phoneNumber` pero sin `emailVerified` NO debe recibir 403.
- Fixture de la race condition (sección 4): dos llamadas secuenciales a `authSyncHandler`/`fireUpsertUser` sobre un uid nuevo — primera sin `termsAccepted` (simula el auto-sync suprimido que NO debió correr, o si corriera por error), segunda con `termsAccepted:true` — asertar que el doc final SÍ tiene `termsAcceptedAt` no-nulo. Este test debe fallar contra la v1 del diseño (sin supresión) y pasar con el fix de la sección 4.
- Sin E2E real de SMS — verificación de ese tramo queda manual (límite conocido, ver "Fuera de alcance").

## Constraints globales

- Solo rama `develop` — nunca tocar `master`/producción sin pedirlo explícitamente.
- Único punto de import del SDK de Firebase: `firebase-init.js` (no importar del CDN directo en ningún otro archivo).
- CSP debe seguir siendo restrictiva — solo agregar los hosts de `google.com` estrictamente necesarios para reCAPTCHA, no relajar de más.
- Mensajes de error de auth siempre genéricos donde aplica el hallazgo de anti-enumeración ya establecido (no aplica aquí: los errores de teléfono/código no permiten enumerar cuentas de la misma forma que email).
- El bypass del gate anti-abuso de OCR (sección 7) no debe desplegarse a producción sin el prerequisito de App Check.

## Cambios de la revisión (3 agentes: seguridad, backend, frontend)

Resumen de qué cambió respecto a la v1 de este documento y por qué — para que quede rastro de la decisión:

1. **Crítico, backend**: agregada la sección 4 completa (`setAutoSyncSuppressed`) — la v1 no tenía forma de evitar que el auto-sync sin body de `authClient.js` pisara el consentimiento real. Sin esto, el feature entero habría lanzado sin evidencia legal de Términos para signups por teléfono.
2. **Alto, seguridad**: agregado "Prerequisito de producción: Firebase App Check" — la v1 no mencionaba SMS pumping/toll fraud en absoluto.
3. **Alto, seguridad**: suavizada/corregida la justificación del bypass del gate anti-abuso (sección 7) — la v1 afirmaba que teléfono era "al menos tan fuerte" que email verificado sin sustento; ahora se documenta el riesgo real y se condiciona a App Check.
4. **Medio, frontend**: agregada máquina de estados explícita (`currentView`/`setView`) — la v1 iba a extender el booleano `isSignupMode` existente a 4 estados sin un mecanismo claro.
5. **Medio, frontend**: agregado botón propio `#btn-phone-consent-confirm` (la v1 reutilizaba ambiguamente `#signup-only`/`#btn-signup`) y envuelto `handlePhoneSignupConsent` en `withLoadingState` (la v1 lo dejaba sin protección de doble-submit).
6. **Medio, frontend**: agregados `<label for=...>` explícitos y `autocomplete="one-time-code"` al markup (la v1 los omitía).
7. **Medio, frontend**: aclarado que el markup de teléfono vive fuera de `<form id="login-form">`, y dada una receta concreta para el CSS (o falta de él) del contenedor de reCAPTCHA (la v1 solo decía "nunca display:none", insuficiente).
8. **Bajo**: agregados `auth/captcha-check-failed`/`auth/invalid-app-credential` a `mapAuthError`, documentado explícitamente el patrón "solo se fija en creación" para `phoneNumber`, agregado test de la race condition.
