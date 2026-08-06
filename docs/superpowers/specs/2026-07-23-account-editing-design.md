# Editar mis datos (nombre/teléfono/correo/contraseña) — diseño

Fecha: 2026-07-23
Ambiente objetivo: `develop` (Firebase project `foodscaner-dev` para Auth, `foodscaner-cache-v2` para Firestore). Se replica a prod cuando se promueva.

## Contexto

Hoy `account.html` no tiene ninguna forma de editar los datos de la cuenta — solo muestra email/teléfono de solo lectura, preferencias, membresía y logout. Este spec agrega edición de nombre, teléfono, correo y contraseña, directo en `account.html` (sin página aparte), detrás de un botón "Editar mis datos".

Depende del spec/plan ya implementado `2026-07-23-phone-identity-decoupling` (uid de phone-login independiente del número, vía `phoneIndex/{telefono}→uid`) — sin eso, cambiar teléfono en una cuenta phone-login habría requerido migrar la cuenta completa.

Fuera de alcance: recuperación de cuenta olvidada/"forgot password" (flujo distinto, sin sesión activa); vincular/desvincular providers (ej. "agregar Google a mi cuenta de correo"); eliminar cuenta.

## Hallazgo — los claims de un custom token no se actualizan solos

Investigado con la documentación oficial de Firebase (Context7): los "developer claims" de un custom token (`createCustomToken(uid, claims)`) SÍ se persisten como custom claims de la cuenta al iniciar sesión con ese token — pero **cambiar el `phoneIndex` no reautentica al usuario**, así que su sesión actual sigue con el claim viejo hasta el próximo refresh de su ID token, y ese refresh no vuelve a ejecutar nuestro código de mint. Para que el cambio de teléfono se refleje sin pedirle cerrar sesión, hay que escribir el claim directo en la cuenta Auth vía Identity Toolkit REST (`accounts:update` con `customAttributes`) — eso sí sobrevive el refresh automático (mismo mecanismo que `setCustomUserClaims` del Admin SDK, pero vía REST puro, sin instalar `firebase-admin`).

Esto requiere la credencial admin del proyecto Auth (`FIREBASE_SERVICE_ACCOUNT_KEY_DEV`, ya en `.env`/Vercel, hoy sin usar en código de producción) — primera vez que se usa en el backend. Aprobado explícitamente por el usuario.

## Detección: ¿esta cuenta usa teléfono como login, o solo como contacto?

Señal ya disponible sin campos nuevos: el `email` de nivel superior en `GET /api/me` (el campo `email` del doc, poblado desde `req.user.email` — el claim del JWT, nunca null para password/Google, siempre null para una sesión phone-login pura). Si `!body.email`, el teléfono ES la credencial de login → editar teléfono exige verificar SMS. Si `body.email` existe, teléfono es solo `profile.phone` (contacto) → edición directa, sin SMS.

(Nota: `profile.email`/`profile.phone`, del onboarding, son datos de contacto secundarios — no confundir con el `email` de nivel superior, que es el correo real de Firebase Auth.)

## Hallazgo relacionado — `GET /api/me` nunca refleja cambios de `email`/`phoneNumber` en el token

`getMeHandler` (`api/index.js:1456-1469`) construye la respuesta puramente desde el doc de Firestore (`fireGetUser`), nunca desde `req.user` (el JWT ya verificado de la petición actual). Pero `fireUpsertUser` (`api/firestore.js`) solo escribe `email`/`phoneNumber` en la creación del doc — en el branch de actualización (usuario ya existente) solo toca `lastLoginAt`/`providers`. Si el correo de Auth cambia (`verifyBeforeUpdateEmail`) o el teléfono cambia (vía el nuevo endpoint de abajo), el doc de Firestore queda con el valor viejo para siempre, y `/api/me` seguiría mostrando el dato viejo aunque el token ya tenga el nuevo.

**Fix (parte de este spec, no del plan de identidad):** `getMeHandler` debe sobreponer los valores VIVOS del token verificado sobre la copia guardada en Firestore:

```js
// api/index.js — getMeHandler, reemplaza el body actual
const { preferences, ...rest } = user;
const body = { uid: req.user.uid, ...rest, email: req.user.email, phoneNumber: req.user.phoneNumber };
if (user.membershipStatus === 'active' && preferences) body.preferences = preferences;
```

Con esto, en cuanto la sesión del usuario tenga un token con el `email`/`phoneNumber` nuevo (login siguiente, o refresh automático tras el `accounts:update` del caso de teléfono), `/api/me` lo refleja solo — sin necesidad de re-sincronizar el doc de Firestore en cada cambio.

## Frontend — `firebase-init.js`

Agrega a los imports/re-exports (junto a `signInWithEmailAndPassword` etc.):

```js
import {
  ...,
  updatePassword,
  verifyBeforeUpdateEmail,
  reauthenticateWithCredential,
  EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

export {
  ...,
  updatePassword,
  verifyBeforeUpdateEmail,
  reauthenticateWithCredential,
  EmailAuthProvider
};
```

## UI — `account.html`/`account-ui.js`

Botón "Editar mis datos" (junto al badge de membresía) revela un bloque con 4 sub-forms independientes, cada uno con su propio botón Guardar:

1. **Nombre** — un input, precargado con `profile.displayName || displayName`. Guardar → `PUT /api/me/profile { displayName }` (endpoint existente, sin cambios).
2. **Teléfono** — comportamiento depende de si `profile.email` (top-level) existe:
   - **Con email:** un input (nuevo número), Guardar → `PUT /api/me/profile { phone }` directo (sin SMS).
   - **Sin email (phone-login):** flujo de 2 pasos dentro del mismo sub-form — input de número + botón "Enviar código" (llama `/api/auth/phone/send`, ya existente, sin cambios), luego input de código + botón "Confirmar" → `POST /api/me/phone/change { phone, code }` (nuevo, ver abajo).
3. **Correo** — un input (nuevo correo). Guardar:
   - `reauthenticateWithCredential(firebaseAuth.currentUser, EmailAuthProvider.credential(currentEmail, currentPasswordInput))` — pide la contraseña actual en el mismo submit (un input adicional "confirma tu contraseña para continuar", solo si el provider es `password`; si el usuario es Google, Firebase reautentica reabriendo el popup de Google en vez de pedir contraseña — usar `reauthenticateWithPopup` en ese caso).
   - `verifyBeforeUpdateEmail(firebaseAuth.currentUser, newEmail)`.
   - Muestra "Revisa tu correo nuevo y confirma el cambio desde ahí." — el campo de correo mostrado en el resumen de la cuenta NO cambia hasta que `firebaseAuth.currentUser.email` (tras el próximo login/refresh) realmente sea el nuevo.
4. **Contraseña** (solo visible si el provider incluye `password` — chequear `firebaseAuth.currentUser.providerData.some(p => p.providerId === 'password')`) — 3 inputs: actual, nueva, confirmar nueva. Guardar:
   - Si nueva ≠ confirmar → error de cliente, no llama a Firebase.
   - `reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPasswordInput))` — si falla (contraseña actual incorrecta), muestra error ahí mismo, no intenta `updatePassword`.
   - `updatePassword(user, newPassword)`.

## Backend — `POST /api/me/phone/change` (nuevo, solo para cuentas phone-login)

`requireUser` (no `requireActiveMembership` — cambiar tus propios datos de contacto/login no debe depender de tener membresía activa).

```js
async function changePhoneHandler(req, res) {
  const { phone, code } = req.body || {};
  if (typeof phone !== 'string' || !E164_RE.test(phone) || typeof code !== 'string') {
    return res.status(400).json({ error: 'invalid_request' });
  }

  let status;
  try {
    status = await checkVerificationCode(phone, code);
  } catch (e) {
    if (isClientFaultTwilioError(e)) return res.status(401).json({ error: 'invalid_code' });
    console.warn('[me/phone/change] Twilio error:', e.message);
    return res.status(502).json({ error: 'verify_failed' });
  }
  if (status !== 'approved') return res.status(401).json({ error: 'invalid_code' });

  try {
    const existingIndex = await fireGetPhoneIndex(phone);
    if (existingIndex && existingIndex.uid && existingIndex.uid !== req.user.uid) {
      return res.status(409).json({ error: 'phone_in_use' });
    }
  } catch (e) {
    console.warn('[me/phone/change] phone index check failed, uid:', req.user.uid, e.message);
    return res.status(500).json({ error: 'internal_error' });
  }

  try {
    if (req.user.phoneNumber && req.user.phoneNumber !== phone) {
      await fireDeleteDoc('phoneIndex', req.user.phoneNumber).catch(e =>
        console.warn('[me/phone/change] old phoneIndex cleanup failed (non-fatal), uid:', req.user.uid, e.message)
      );
    }
    await fireSetPhoneIndex(phone, req.user.uid);
    await setPhoneNumberClaim(req.user.uid, phone);
    res.json({ ok: true });
  } catch (e) {
    console.warn('[me/phone/change] error, uid:', req.user.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}
app.post('/api/me/phone/change', requireUser, changePhoneHandler);
```

Decisión deliberada: NO se toca `profile.phone` (dato de contacto) en este endpoint — con el fix de `getMeHandler` de arriba, el `phoneNumber` que ve el frontend ya viene vivo del token, no hace falta duplicarlo en el doc.

### `setPhoneNumberClaim(uid, phone)` — nuevo, `api/phoneAuth.js`

Usa `FIREBASE_SERVICE_ACCOUNT_KEY_DEV` (credencial del proyecto Auth, distinta de `FIREBASE_SERVICE_ACCOUNT_KEY` que usa Firestore) para llamar a Identity Toolkit `accounts:update` con scope `identitytoolkit`:

```js
function getAuthServiceAccount() {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_DEV;
  if (!key) return null;
  const raw = key.includes('\\"')
    ? key.replace(/\x5c\x0a/g, '\x5c\x6e').replace(/\x5c\x22/g, '\x22')
    : key;
  return JSON.parse(raw);
}

let _authToken = null, _authTokenExpiry = 0;

async function getAuthAccessToken() {
  if (_authToken && Date.now() < _authTokenExpiry) return _authToken;
  const sa = getAuthServiceAccount();
  if (!sa) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
  const payload = base64UrlJson({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now
  });
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(sa.private_key, 'base64url');
  const assertion = `${header}.${payload}.${signature}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  _authToken = data.access_token;
  _authTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _authToken;
}

async function setPhoneNumberClaim(uid, phone) {
  const token = await getAuthAccessToken();
  const sa = getAuthServiceAccount();
  if (!token || !sa) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY_DEV no configurada');
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:update`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify({ phone_number: phone }) })
  });
  if (!resp.ok) throw new Error(`Identity Toolkit accounts:update failed: ${resp.status}`);
}
```

**Nota de seguridad:** `customAttributes` vía Identity Toolkit tiene un límite de 1000 bytes (documentado por Firebase) — `{phone_number: "+521234567890"}` está muy por debajo, sin riesgo. No confundir este mecanismo con datos de negocio (membresía/preferencias) — siguen viviendo SOLO en Firestore, esto es exclusivamente para que el claim de identidad del token se actualice.

## Manejo de errores

- `POST /api/me/phone/change`: 400 `invalid_request` (formato), 401 `invalid_code`, 502 `verify_failed` (Twilio caído), 409 `phone_in_use` (el número ya es de otra cuenta), 500 `internal_error` (Firestore/Identity Toolkit).
- Cambios de correo/contraseña: los errores de Firebase (`auth/wrong-password`, `auth/requires-recent-login`, `auth/email-already-in-use`) se mapean a mensajes en español, mismo patrón que `AUTH_ERROR_MESSAGES` en `auth-ui.js`.

## Testing

- `tests/phoneAuth.test.js` — `getAuthServiceAccount`/`getAuthAccessToken`/`setPhoneNumberClaim`, mismo patrón de mock de `fetch` que el resto del archivo.
- `tests/meChangePhone.test.js` (nuevo) — `changePhoneHandler`: 400 formato inválido, 401 código no aprobado, 409 número ya usado por otro uid, éxito (borra índice viejo, crea nuevo, llama `setPhoneNumberClaim`), 500 si `setPhoneNumberClaim` falla.
- `tests/getMe.test.js` — nueva prueba: `body.email`/`body.phoneNumber` reflejan `req.user.email`/`req.user.phoneNumber` (el token), no el valor guardado en el doc, aunque difieran.
- `tests/account-ui.test.js` — nuevas pruebas para el toggle "Editar mis datos", envío de cada sub-form (nombre/teléfono-con-email/teléfono-sin-email/correo/contraseña), y el gate de "solo mostrar contraseña si provider === password".
- Sigue el patrón/convenciones ya existentes en `tests/` (vitest, `createRequire` + mutación de `module.exports` para mockear `api/firestore.js`/`api/phoneAuth.js` desde `api/index.js`).

## Preguntas abiertas (no bloquean este spec)

- ¿Reenviar correo de bienvenida/notificación de seguridad cuando cambian contraseña o correo? No se construye aquí — es un feature de producto aparte (requeriría un proveedor de email transaccional, hoy inexistente en esta app).
- Rate-limiting específico para `POST /api/me/phone/change` más allá del limiter global de `/api/` ya existente (60 req/min) — no se agrega uno dedicado, se reusa el existente por ahora.
