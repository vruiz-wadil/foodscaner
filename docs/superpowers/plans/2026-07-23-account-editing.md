# Editar mis datos (nombre/teléfono/correo/contraseña) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar edición de nombre, teléfono, correo y contraseña dentro de `account.html`, detrás de un botón "Editar mis datos".

**Architecture:** Todo vive inline en `account-ui.js` (sin página aparte, decisión del usuario) — `renderAccountHub()` renderiza también la sección de edición (oculta por default, un toggle la muestra). Nombre y teléfono-de-contacto reusan `PUT /api/me/profile` (ya existe). Teléfono de cuentas phone-login usa un endpoint nuevo, `POST /api/me/phone/change`, que relinkea `phoneIndex` y empuja el claim `phone_number` a la cuenta Auth vía Identity Toolkit REST (`accounts:update`) para que sobreviva el próximo refresh silencioso del token sin requerir relogin. Correo usa `verifyBeforeUpdateEmail` (link de confirmación, no el `updateEmail` deprecado). Contraseña usa `reauthenticateWithCredential` + `updatePassword`.

**Tech Stack:** Express (`api/index.js`), Firebase JS SDK modular (`firebase-init.js`), REST a Firestore/Identity Toolkit (sin firebase-admin), vitest + jsdom.

Spec de referencia: `docs/superpowers/specs/2026-07-23-account-editing-design.md`.

## Global Constraints

- `POST /api/me/phone/change` monta con `requireUser` SOLO (no `requireActiveMembership`) — editar tus propios datos no depende de tener membresía activa.
- `GET /api/me` debe reflejar `email`/`phoneNumber` VIVOS del token verificado (`req.user`), nunca la copia potencialmente obsoleta de Firestore, para esos 2 campos específicos.
- El endpoint de cambio de teléfono nunca toca `profile.phone` (contacto) — con el fix de `GET /api/me`, el dato vivo del token ya es suficiente, evita doble fuente de verdad.
- `setPhoneNumberClaim` usa `FIREBASE_SERVICE_ACCOUNT_KEY_DEV` (credencial del proyecto Auth) — nunca mezclar con `FIREBASE_SERVICE_ACCOUNT_KEY` (proyecto Firestore, usado en todo el resto del archivo).
- Distinción contacto-vs-login de teléfono: `!profile.email` (top-level, no `profile.profile.email`) ⇒ cuenta phone-login, requiere verificación SMS para cambiar; si existe, es solo dato de contacto.
- Contraseña: el sub-form solo se renderiza si `firebaseAuth.currentUser.providerData` incluye `{providerId: 'password'}` — nunca para cuentas Google/teléfono puro.
- Todos los tests de backend siguen el patrón `createRequire` + mutación de `module.exports` ya usado en `tests/putProfile.test.js`/`tests/payMembership.test.js`. Los tests de frontend siguen el patrón de mocks de `tests/account-ui.test.js` (jsdom, `vi.mock('../firebase-init.js', ...)`, `vi.mock('../authClient.js', ...)`).

---

### Task 1: `firebase-init.js` — exportar funciones de reauth/actualización

**Files:**
- Modify: `firebase-init.js`
- Test: `tests/firebase-init.test.js`

**Interfaces:**
- Produces: re-exporta `updatePassword`, `verifyBeforeUpdateEmail`, `reauthenticateWithCredential`, `EmailAuthProvider` desde el SDK de Firebase Auth, mismo patrón que las funciones ya re-exportadas.

- [ ] **Step 1: Escribir el test que falla**

Agrega al `vi.mock(AUTH_URL, ...)` existente en `tests/firebase-init.test.js` (línea 36-45) las 4 funciones nuevas:

```js
const updatePassword = vi.fn()
const verifyBeforeUpdateEmail = vi.fn()
const reauthenticateWithCredential = vi.fn()
class EmailAuthProvider {
  static credential(email, password) { return { email, password } }
}
```

Y agrégalas al objeto que retorna `vi.mock(AUTH_URL, () => ({...}))`. Luego extiende la prueba `'re-exports the auth SDK functions the app depends on'` (línea 72-80) con:

```js
    expect(mod.updatePassword).toBe(updatePassword)
    expect(mod.verifyBeforeUpdateEmail).toBe(verifyBeforeUpdateEmail)
    expect(mod.reauthenticateWithCredential).toBe(reauthenticateWithCredential)
    expect(mod.EmailAuthProvider).toBe(EmailAuthProvider)
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/firebase-init.test.js`
Expected: FAIL — `mod.updatePassword` etc. son `undefined`.

- [ ] **Step 3: Implementar en `firebase-init.js`**

Cambia el import (líneas 7-16) a:

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
  EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
```

Y el export final (líneas 44-52) a:

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
  EmailAuthProvider
};
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/firebase-init.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add firebase-init.js tests/firebase-init.test.js
git commit -m "feat(firebase-init): export password/email reauth functions"
```

---

### Task 2: `GET /api/me` refleja `email`/`phoneNumber` vivos del token

**Files:**
- Modify: `api/index.js` (`getMeHandler`)
- Test: `tests/getMe.test.js`

**Interfaces:**
- Produces: `getMeHandler` — el body de respuesta usa `req.user.email`/`req.user.phoneNumber` (del JWT ya verificado) en vez de los campos guardados en el doc de Firestore para esos 2 campos específicos.

- [ ] **Step 1: Escribir el test que falla**

Agrega a `tests/getMe.test.js`:

```js
  it('reflects the live req.user.email/phoneNumber from the verified token, not the possibly-stale Firestore copy', async () => {
    fireGetUser.mockResolvedValue({ email: 'old@example.com', phoneNumber: null, membershipStatus: 'active' })
    const req = { user: { uid: 'uid-9', email: 'new@example.com', phoneNumber: '+525512345678' } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.body.email).toBe('new@example.com')
    expect(res.body.phoneNumber).toBe('+525512345678')
  })
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/getMe.test.js`
Expected: FAIL — el body todavía usa el `email`/`phoneNumber` guardados (`'old@example.com'`/`null`).

- [ ] **Step 3: Implementar en `api/index.js`**

En `getMeHandler`, cambia:

```js
    const { preferences, ...rest } = user;
    const body = { uid: req.user.uid, ...rest };
```

por:

```js
    const { preferences, ...rest } = user;
    const body = { uid: req.user.uid, ...rest, email: req.user.email, phoneNumber: req.user.phoneNumber };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/getMe.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/getMe.test.js
git commit -m "fix(me): reflect live token email/phoneNumber instead of stale Firestore copy"
```

---

### Task 3: `setPhoneNumberClaim` — Identity Toolkit REST, `api/phoneAuth.js`

**Files:**
- Modify: `api/phoneAuth.js` (agregar `getAuthServiceAccount`, `getAuthAccessToken`, `setPhoneNumberClaim`, exportarlas)
- Test: `tests/phoneAuth.test.js`

**Interfaces:**
- Produces: `setPhoneNumberClaim(uid, phone)` — `Promise<void>`, lanza si falla. Usa `FIREBASE_SERVICE_ACCOUNT_KEY_DEV` (NO `FIREBASE_SERVICE_ACCOUNT_KEY`).

- [ ] **Step 1: Escribir el test que falla**

Agrega a `tests/phoneAuth.test.js` (nuevo `describe`, después del de `createFirebaseCustomToken` — sigue el mismo patrón de `crypto.generateKeyPairSync` + `b64urlJsonDecode` ya definido arriba en el archivo):

```js
describe('setPhoneNumberClaim', () => {
  const ORIGINAL_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_DEV

  function fakeAuthServiceAccountKey(privateKey) {
    return JSON.stringify({
      project_id: 'foodscaner-dev',
      client_email: 'firebase-adminsdk@foodscaner-dev.iam.gserviceaccount.com',
      private_key: privateKey
    })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY_DEV = ORIGINAL_KEY
  })

  it('calls Identity Toolkit accounts:update with localId and customAttributes containing the phone claim', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY_DEV = fakeAuthServiceAccountKey(privateKey)

    let capturedUrl, capturedBody
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 'fake-token', expires_in: 3600 }) }
      }
      capturedUrl = url
      capturedBody = JSON.parse(options.body)
      return { ok: true, status: 200 }
    }))

    const { setPhoneNumberClaim } = await import('../api/phoneAuth.js')
    await setPhoneNumberClaim('a1b2c3d4-uuid', '+525512345678')

    expect(capturedUrl).toBe('https://identitytoolkit.googleapis.com/v1/projects/foodscaner-dev/accounts:update')
    expect(capturedBody.localId).toBe('a1b2c3d4-uuid')
    expect(JSON.parse(capturedBody.customAttributes)).toEqual({ phone_number: '+525512345678' })
  })

  it('throws when FIREBASE_SERVICE_ACCOUNT_KEY_DEV is missing', async () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY_DEV
    const { setPhoneNumberClaim } = await import('../api/phoneAuth.js')
    await expect(setPhoneNumberClaim('uid', '+525512345678')).rejects.toThrow('FIREBASE_SERVICE_ACCOUNT_KEY_DEV')
  })

  it('throws when Identity Toolkit responds non-ok', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY_DEV = fakeAuthServiceAccountKey(privateKey)
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 'fake-token', expires_in: 3600 }) }
      }
      return { ok: false, status: 400 }
    }))

    const { setPhoneNumberClaim } = await import('../api/phoneAuth.js')
    await expect(setPhoneNumberClaim('uid', '+525512345678')).rejects.toThrow('accounts:update failed: 400')
  })
})
```

Nota: como `tests/phoneAuth.test.js` ya usa `await import('../api/phoneAuth.js')` a nivel de módulo (línea 10) para las pruebas existentes, y este nuevo `describe` necesita reimportar tras cambiar `process.env` en cada test, usa `await import(...)` DENTRO de cada `it` (como se muestra arriba) en vez de depender del import de nivel de módulo — Node cachea el módulo, así que releer `process.env.FIREBASE_SERVICE_ACCOUNT_KEY_DEV` dentro de la función en cada llamada (no en import-time) es lo que realmente importa aquí, y el código de implementación (Step 3) ya lee `process.env` dentro de la función, no at top-level — así que el `await import` repetido es solo por claridad, no estrictamente necesario, pero sigue el estilo del resto del archivo.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/phoneAuth.test.js -t "setPhoneNumberClaim"`
Expected: FAIL — `setPhoneNumberClaim` no existe.

- [ ] **Step 3: Implementar en `api/phoneAuth.js`**

Agrega al final del archivo, antes de `module.exports`:

```js
// Credencial del proyecto Auth (foodscaner-dev), DISTINTA de
// FIREBASE_SERVICE_ACCOUNT_KEY (proyecto Firestore/cache) — mismo
// des-escapado que getServiceAccount() en api/firestore.js.
function getAuthServiceAccount() {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_DEV;
  if (!key) return null;
  const raw = key.includes('\\"')
    ? key.replace(/\x5c\x0a/g, '\x5c\x6e').replace(/\x5c\x22/g, '\x22')
    : key;
  return JSON.parse(raw);
}

let _authToken = null;
let _authTokenExpiry = 0;

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

// Empuja el claim phone_number directo a la cuenta Auth (Identity Toolkit
// accounts:update, customAttributes) — sobrevive el refresh automático del
// ID token, a diferencia de un developer claim de un custom token que ya no
// se vuelve a mintear. Ver spec 2026-07-23-account-editing-design.md.
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

Agrega `setPhoneNumberClaim` al `module.exports` existente (junto a `sendVerificationCode, checkVerificationCode, createFirebaseCustomToken`).

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/phoneAuth.test.js`
Expected: PASS (todas, incluidas las existentes)

- [ ] **Step 5: Commit**

```bash
git add api/phoneAuth.js tests/phoneAuth.test.js
git commit -m "feat(phoneAuth): push phone_number claim via Identity Toolkit accounts:update"
```

---

### Task 4: `POST /api/me/phone/change` — `api/index.js`

**Files:**
- Modify: `api/index.js` (nuevo handler + ruta)
- Test: `tests/meChangePhone.test.js` (nuevo)

**Interfaces:**
- Consumes: `checkVerificationCode`, `setPhoneNumberClaim` (Task 3, `api/phoneAuth.js`), `fireGetPhoneIndex`, `fireSetPhoneIndex`, `fireDeleteDoc` (ya existen, `api/firestore.js`), `E164_RE`, `isClientFaultTwilioError` (ya existen en `api/index.js`).
- Produces: `changePhoneHandler`, montado en `POST /api/me/phone/change` con `requireUser` (sin `requireActiveMembership`).

- [ ] **Step 1: Escribir el test que falla**

Crea `tests/meChangePhone.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)

const firestoreModule = requireFn('../api/firestore.js')
const fireGetPhoneIndex = vi.fn()
const fireSetPhoneIndex = vi.fn()
const fireDeleteDoc = vi.fn()
firestoreModule.fireGetPhoneIndex = fireGetPhoneIndex
firestoreModule.fireSetPhoneIndex = fireSetPhoneIndex
firestoreModule.fireDeleteDoc = fireDeleteDoc

const phoneAuthModule = requireFn('../api/phoneAuth.js')
const checkVerificationCode = vi.fn()
const setPhoneNumberClaim = vi.fn()
phoneAuthModule.checkVerificationCode = checkVerificationCode
phoneAuthModule.setPhoneNumberClaim = setPhoneNumberClaim

const { changePhoneHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

function twilioError(message, status) {
  const e = new Error(message)
  e.status = status
  return e
}

describe('changePhoneHandler', () => {
  beforeEach(() => {
    fireGetPhoneIndex.mockReset()
    fireSetPhoneIndex.mockReset()
    fireDeleteDoc.mockReset()
    checkVerificationCode.mockReset()
    setPhoneNumberClaim.mockReset()
  })

  it('400s on invalid phone/code format', async () => {
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: 'bad', code: '123456' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(checkVerificationCode).not.toHaveBeenCalled()
  })

  it('401s when the code is not approved', async () => {
    checkVerificationCode.mockResolvedValue('pending')
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: '+525512345678', code: '000000' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'invalid_code' })
  })

  it('401s (not 502) when Twilio rejects the check itself', async () => {
    checkVerificationCode.mockRejectedValue(twilioError('Max attempts', 429))
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: '+525512345678', code: '000000' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('502s when Twilio is down', async () => {
    checkVerificationCode.mockRejectedValue(new Error('network down'))
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(res.statusCode).toBe(502)
  })

  it('409s when the new phone already belongs to a different uid', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue({ uid: 'someone-else-uid' })
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'phone_in_use' })
    expect(fireSetPhoneIndex).not.toHaveBeenCalled()
  })

  it('succeeds: deletes the old index, creates the new one, pushes the claim', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue(null)
    fireDeleteDoc.mockResolvedValue(true)
    fireSetPhoneIndex.mockResolvedValue(undefined)
    setPhoneNumberClaim.mockResolvedValue(undefined)
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(fireDeleteDoc).toHaveBeenCalledWith('phoneIndex', '+525500000000')
    expect(fireSetPhoneIndex).toHaveBeenCalledWith('+525512345678', 'uid-1')
    expect(setPhoneNumberClaim).toHaveBeenCalledWith('uid-1', '+525512345678')
    expect(res.body).toEqual({ ok: true })
  })

  it('succeeds without deleting an old index when the user had no phoneNumber before (edge case, unlikely for a phone-login account)', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue(null)
    fireSetPhoneIndex.mockResolvedValue(undefined)
    setPhoneNumberClaim.mockResolvedValue(undefined)
    const req = { user: { uid: 'uid-1', phoneNumber: null }, body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(fireDeleteDoc).not.toHaveBeenCalled()
    expect(res.body).toEqual({ ok: true })
  })

  it('500s when setPhoneNumberClaim fails', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue(null)
    fireSetPhoneIndex.mockResolvedValue(undefined)
    setPhoneNumberClaim.mockRejectedValue(new Error('Identity Toolkit down'))
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'internal_error' })
  })

  it('500s when the phoneIndex ownership check itself fails (Firestore error)', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockRejectedValue(new Error('Firestore down'))
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/meChangePhone.test.js`
Expected: FAIL — `changePhoneHandler` no existe.

- [ ] **Step 3: Implementar en `api/index.js`**

Agrega después de la ruta de `payMembershipHandler` (o junto a los demás endpoints `/api/me/*`):

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

Confirma que `fireGetPhoneIndex`, `fireSetPhoneIndex`, `fireDeleteDoc` estén en el `require('./firestore')` destructurado al inicio de `api/index.js`, y `setPhoneNumberClaim` en el `require('./phoneAuth')` — agrégalos si falta alguno. Agrega `module.exports.changePhoneHandler = changePhoneHandler;` junto a los demás exports de handlers para tests.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/meChangePhone.test.js`
Expected: PASS

- [ ] **Step 5: Correr la suite completa**

Run: `npx vitest run`
Expected: PASS (único fallo esperado: el preexistente de Playwright/e2e, sin relación).

- [ ] **Step 6: Commit**

```bash
git add api/index.js tests/meChangePhone.test.js
git commit -m "feat(me): add POST /api/me/phone/change (relink phoneIndex + push Auth claim)"
```

---

### Task 5: `account-ui.js` — toggle "Editar mis datos" + sub-form Nombre

**Files:**
- Modify: `account.html` (agregar estilos de error/form si faltan), `account-ui.js`
- Test: `tests/account-ui.test.js`

**Interfaces:**
- Produces: `renderAccountHub()` ahora también renderiza (oculta por default) la sección de edición con el sub-form de nombre. `submitNameEdit()` exportada.

- [ ] **Step 1: Escribir los tests que fallan**

Agrega a `tests/account-ui.test.js` (nuevo `describe`, después de `handleRenewMembership`; agrega `submitNameEdit` a las funciones importadas del módulo en el `beforeEach` de arriba):

```js
describe('toggle de edición + submitNameEdit', () => {
  it('el botón "Editar mis datos" muestra la sección oculta al hacer click', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    const section = document.getElementById('account-edit-section')
    expect(section.classList.contains('hidden')).toBe(true)
    document.getElementById('btn-toggle-edit').click()
    expect(section.classList.contains('hidden')).toBe(false)
  })

  it('precarga el nombre actual en el input (profile.profile.displayName)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', profile: { displayName: 'Ana Ruiz' } })
    renderAccountHub()
    expect(document.getElementById('input-edit-name').value).toBe('Ana Ruiz')
  })

  it('submitNameEdit rechaza un nombre vacío sin llamar a fetch', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    global.fetch = vi.fn()
    document.getElementById('input-edit-name').value = '   '
    await expect(submitNameEdit()).rejects.toThrow()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('submitNameEdit llama PUT /api/me/profile con el nombre y re-sincroniza', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    document.getElementById('input-edit-name').value = 'Ana Ruiz'

    await submitNameEdit()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/me/profile')
    expect(options.method).toBe('PUT')
    expect(JSON.parse(options.body)).toEqual({ displayName: 'Ana Ruiz' })
    expect(syncUserProfile).toHaveBeenCalled()
  })

  it('submitNameEdit muestra error y no re-sincroniza si el PUT falla', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    document.getElementById('input-edit-name').value = 'Ana Ruiz'

    await expect(submitNameEdit()).rejects.toThrow()

    expect(syncUserProfile).not.toHaveBeenCalled()
    const errorEl = document.getElementById('edit-name-error')
    expect(errorEl.classList.contains('hidden')).toBe(false)
  })
})
```

Agrega `submitNameEdit` a la lista de `let renderAccountHub, handleLogout, ...` y a la asignación desde `mod` en el `beforeEach` superior del archivo.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/account-ui.test.js`
Expected: FAIL — `#btn-toggle-edit`/`#account-edit-section`/`#input-edit-name`/`submitNameEdit` no existen.

- [ ] **Step 3: Implementar en `account-ui.js`**

Agrega el bloque de edición dentro del template de `renderAccountHub()` (justo antes del `<button type="button" id="btn-logout"...` final), y agrega las funciones nuevas. El template completo del `content-card` queda así (solo se muestra el fragmento nuevo, el resto de `renderAccountHub` — badge, stats, preferencias, renew-cta — no cambia):

```js
      <div class="row-card">
        <button type="button" id="btn-toggle-edit" class="btn btn-secondary">Editar mis datos</button>
      </div>
      <div id="account-edit-section" class="hidden">
        <form id="form-edit-name">
          <div class="form-field">
            <label for="input-edit-name">Nombre</label>
            <input id="input-edit-name" class="form-input" type="text" value="${(profile.profile && profile.profile.displayName) || profile.displayName || ''}">
          </div>
          <button type="submit" class="btn btn-primary">Guardar nombre</button>
          <p id="edit-name-error" class="hidden" role="alert"></p>
        </form>
      </div>
      <button type="button" id="btn-logout" class="btn btn-secondary">Cerrar sesión</button>
```

(Nota: sin escapar `displayName` en el `value` del input — mismo patrón ya existente en este archivo para `profile.email`/`phoneNumber` en la línea de `account-email`, no se introduce un mecanismo de escape nuevo aquí.)

Agrega el wiring del toggle al final de `renderAccountHub()` (junto a los demás `addEventListener`):

```js
  document.getElementById('btn-toggle-edit')?.addEventListener('click', () => {
    document.getElementById('account-edit-section')?.classList.toggle('hidden');
  });
  document.getElementById('form-edit-name')?.addEventListener('submit', e => {
    e.preventDefault();
    submitNameEdit().catch(() => {});
  });
```

Y agrega la función `submitNameEdit` (después de `handleRenewMembership`):

```js
function showNameError(message) {
  const el = document.getElementById('edit-name-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function submitNameEdit() {
  const input = document.getElementById('input-edit-name');
  const name = input ? input.value.trim() : '';
  const errorEl = document.getElementById('edit-name-error');
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
  if (!name) {
    showNameError('Escribe tu nombre.');
    throw new Error('invalid_display_name');
  }
  const token = await getIdToken();
  const res = await fetch('/api/me/profile', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: name })
  });
  if (!res.ok) {
    showNameError('No se pudo guardar tu nombre. Intenta de nuevo.');
    throw new Error('save_failed');
  }
  await syncUserProfile();
  renderAccountHub();
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/account-ui.test.js`
Expected: PASS (todas, incluidas las existentes de `renderAccountHub`/`handleRenewMembership`)

- [ ] **Step 5: Commit**

```bash
git add account.html account-ui.js tests/account-ui.test.js
git commit -m "feat(account): add edit-mode toggle and name edit sub-form"
```

---

### Task 6: sub-form Teléfono (contacto vs phone-login)

**Files:**
- Modify: `account-ui.js`
- Test: `tests/account-ui.test.js`

**Interfaces:**
- Produces: `submitPhoneContactEdit()` (cuenta con email — dato de contacto), `submitPhoneSendCode()` + `submitPhoneChangeConfirm()` (cuenta phone-login — 2 pasos).

- [ ] **Step 1: Escribir los tests que fallan**

Agrega a `tests/account-ui.test.js`:

```js
describe('sub-form Teléfono — cuenta CON email (contacto, sin SMS)', () => {
  it('renderiza un solo input + botón Guardar cuando profile.email existe', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    expect(document.getElementById('input-edit-phone-contact')).toBeTruthy()
    expect(document.getElementById('phone-login-flow')).toBeNull()
  })

  it('submitPhoneContactEdit llama PUT /api/me/profile con { phone } y re-sincroniza', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    document.getElementById('input-edit-phone-contact').value = '+525512345678'

    await submitPhoneContactEdit()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/me/profile')
    expect(JSON.parse(options.body)).toEqual({ phone: '+525512345678' })
    expect(syncUserProfile).toHaveBeenCalled()
  })
})

describe('sub-form Teléfono — cuenta SIN email (phone-login, requiere SMS)', () => {
  it('renderiza el flujo de 2 pasos (enviar código / confirmar) cuando no hay profile.email', () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    renderAccountHub()
    expect(document.getElementById('phone-login-flow')).toBeTruthy()
    expect(document.getElementById('input-edit-phone-contact')).toBeNull()
  })

  it('submitPhoneSendCode llama /api/auth/phone/send con el número nuevo', async () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    renderAccountHub()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'pending' }) })
    document.getElementById('input-new-phone').value = '+525512345678'

    await submitPhoneSendCode()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/auth/phone/send')
    expect(JSON.parse(options.body)).toEqual({ phone: '+525512345678' })
  })

  it('submitPhoneChangeConfirm llama POST /api/me/phone/change con phone+code y re-sincroniza', async () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    document.getElementById('input-new-phone').value = '+525512345678'
    document.getElementById('input-phone-code').value = '123456'

    await submitPhoneChangeConfirm()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/me/phone/change')
    expect(options.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(options.body)).toEqual({ phone: '+525512345678', code: '123456' })
    expect(syncUserProfile).toHaveBeenCalled()
  })

  it('submitPhoneChangeConfirm muestra "phone_in_use" de forma legible si el 409 ocurre', async () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'phone_in_use' }) })
    document.getElementById('input-new-phone').value = '+525512345678'
    document.getElementById('input-phone-code').value = '123456'

    await expect(submitPhoneChangeConfirm()).rejects.toThrow()

    expect(syncUserProfile).not.toHaveBeenCalled()
    const errorEl = document.getElementById('edit-phone-error')
    expect(errorEl.textContent).toMatch(/ya está en uso/)
  })
})
```

Agrega `submitPhoneContactEdit, submitPhoneSendCode, submitPhoneChangeConfirm` al import del módulo en el `beforeEach` superior.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/account-ui.test.js`
Expected: FAIL

- [ ] **Step 3: Implementar en `account-ui.js`**

Dentro del template de `renderAccountHub()`, agrega justo después del form de nombre (dentro de `#account-edit-section`) el sub-form de teléfono, condicional según `profile.email`:

```js
        <form id="form-edit-phone">
          ${profile.email ? `
            <div class="form-field">
              <label for="input-edit-phone-contact">Teléfono</label>
              <input id="input-edit-phone-contact" class="form-input" type="tel" value="${profile.phoneNumber || (profile.profile && profile.profile.phone) || ''}">
            </div>
            <button type="submit" class="btn btn-primary">Guardar teléfono</button>
          ` : `
            <div id="phone-login-flow">
              <div class="form-field">
                <label for="input-new-phone">Nuevo número</label>
                <input id="input-new-phone" class="form-input" type="tel" placeholder="+525512345678">
              </div>
              <button type="button" id="btn-phone-send-code" class="btn btn-secondary">Enviar código</button>
              <div class="form-field">
                <label for="input-phone-code">Código de verificación</label>
                <input id="input-phone-code" class="form-input" type="text" inputmode="numeric" maxlength="6">
              </div>
              <button type="button" id="btn-phone-confirm-change" class="btn btn-primary">Confirmar cambio</button>
            </div>
          `}
          <p id="edit-phone-error" class="hidden" role="alert"></p>
        </form>
```

Wiring, junto al de `form-edit-name`:

```js
  document.getElementById('form-edit-phone')?.addEventListener('submit', e => {
    e.preventDefault();
    submitPhoneContactEdit().catch(() => {});
  });
  document.getElementById('btn-phone-send-code')?.addEventListener('click', () => {
    submitPhoneSendCode().catch(() => {});
  });
  document.getElementById('btn-phone-confirm-change')?.addEventListener('click', () => {
    submitPhoneChangeConfirm().catch(() => {});
  });
```

Funciones nuevas (después de `submitNameEdit`):

```js
function showPhoneError(message) {
  const el = document.getElementById('edit-phone-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function submitPhoneContactEdit() {
  const input = document.getElementById('input-edit-phone-contact');
  const phone = input ? input.value.trim() : '';
  const token = await getIdToken();
  const res = await fetch('/api/me/profile', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  if (!res.ok) {
    showPhoneError('No se pudo guardar tu teléfono. Intenta de nuevo.');
    throw new Error('save_failed');
  }
  await syncUserProfile();
  renderAccountHub();
}

export async function submitPhoneSendCode() {
  const input = document.getElementById('input-new-phone');
  const phone = input ? input.value.trim() : '';
  const res = await fetch('/api/auth/phone/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  if (!res.ok) {
    showPhoneError('No se pudo enviar el código. Intenta de nuevo.');
    throw new Error('send_failed');
  }
}

const PHONE_CHANGE_ERROR_MESSAGES = {
  invalid_code: 'Código incorrecto o expirado.',
  phone_in_use: 'Ese número ya está en uso por otra cuenta.',
  verify_failed: 'No se pudo verificar el código. Intenta más tarde.'
};

export async function submitPhoneChangeConfirm() {
  const phoneInput = document.getElementById('input-new-phone');
  const codeInput = document.getElementById('input-phone-code');
  const phone = phoneInput ? phoneInput.value.trim() : '';
  const code = codeInput ? codeInput.value.trim() : '';
  const token = await getIdToken();
  const res = await fetch('/api/me/phone/change', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    showPhoneError(PHONE_CHANGE_ERROR_MESSAGES[data.error] || 'No se pudo cambiar tu teléfono. Intenta de nuevo.');
    throw new Error(data.error || 'change_failed');
  }
  await syncUserProfile();
  renderAccountHub();
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/account-ui.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add account-ui.js tests/account-ui.test.js
git commit -m "feat(account): add phone edit sub-form (contact-only vs phone-login 2-step SMS)"
```

---

### Task 7: sub-form Correo (`verifyBeforeUpdateEmail`)

**Files:**
- Create: `authErrors.js` (extraído de `auth-ui.js`)
- Modify: `auth-ui.js` (usa el módulo nuevo en vez de definir el mapeo inline), `account-ui.js`
- Test: `tests/authErrors.test.js` (nuevo), `tests/auth-ui.test.js` (ajuste mínimo si `mapAuthError` se importaba directo del módulo en el test), `tests/account-ui.test.js`

**Por qué se extrae primero:** `account-ui.js` necesita el mismo mapeo de errores de Firebase que ya usa `auth-ui.js` (`mapAuthError`) para los mensajes de reauth/`verifyBeforeUpdateEmail`/`updatePassword`. Importar `mapAuthError` directo desde `auth-ui.js` arrastraría su efecto secundario de módulo — `setAutoSyncSuppressed(true)` corre a nivel de módulo en `auth-ui.js` (ver el comentario que ya existe junto a ese import en el propio archivo, hallazgo de una revisión anterior: "auth-ui.js NUNCA había importado authClient.js antes... el simple hecho de importarlo activa su listener"). Cargar `auth-ui.js` desde `account.html` suprimiría el auto-sync de `authClient.js` ahí también, sin ninguna razón — mismo tipo de landmine, evitado extrayendo el mapeo a un módulo sin efectos secundarios que ambos archivos importen.

**Interfaces:**
- Produces: `authErrors.js` exporta `mapAuthError(code)` — idéntico al actual, más el código `'auth/requires-recent-login'` (relevante para reauth en Tasks 7/8, no estaba mapeado antes).
- Consumes (Task 7 en sí): `reauthenticateWithCredential`, `EmailAuthProvider`, `verifyBeforeUpdateEmail` (Task 1, `firebase-init.js`), `mapAuthError` (este módulo nuevo).
- Produces (Task 7): `submitEmailEdit()` exportada desde `account-ui.js`.

- [ ] **Step 0: Extraer `authErrors.js` de `auth-ui.js`**

Crea `authErrors.js`:

```js
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
  'auth/account-exists-with-different-credential': 'Ya tienes una cuenta con ese correo usando otro método de acceso (ej. Google). Usa ese método para entrar.',
  'auth/requires-recent-login': 'Por seguridad, vuelve a confirmar tu contraseña actual para continuar.',
  'invalid_phone': 'Número de teléfono inválido.',
  'send_failed': 'No se pudo enviar el código. Intenta más tarde.',
  'invalid_code': 'Código incorrecto o expirado.',
  'verify_failed': 'Ocurrió un error al verificar tu código. Intenta de nuevo.'
};

export function mapAuthError(code) {
  return AUTH_ERROR_MESSAGES[code] || 'Ocurrió un error. Intenta de nuevo.';
}
```

En `auth-ui.js`, borra el bloque `const AUTH_ERROR_MESSAGES = {...}` y `export function mapAuthError(code) {...}` (líneas 34-54 actuales), y agrega al inicio del archivo:

```js
import { mapAuthError } from './authErrors.js';
```

(Re-exporta `mapAuthError` si algo más en el repo hace `import { mapAuthError } from './auth-ui.js'` — revisa `tests/auth-ui.test.js` y cualquier otro archivo; si algo lo importa así, agrega `export { mapAuthError };` en `auth-ui.js` para no romper esos imports, en vez de tocarlos uno por uno.)

Crea `tests/authErrors.test.js` (mueve las aserciones de mapeo que ya existan en `tests/auth-ui.test.js` para `mapAuthError`, si las hay, o escribe unas nuevas siguiendo el mismo estilo):

```js
import { describe, it, expect } from 'vitest'
import { mapAuthError } from '../authErrors.js'

describe('mapAuthError', () => {
  it('mapea auth/wrong-password a un mensaje genérico de credenciales incorrectas', () => {
    expect(mapAuthError('auth/wrong-password')).toBe('Correo o contraseña incorrectos.')
  })
  it('mapea auth/requires-recent-login a un mensaje de reautenticación', () => {
    expect(mapAuthError('auth/requires-recent-login')).toMatch(/vuelve a confirmar/)
  })
  it('regresa un mensaje genérico para un código desconocido', () => {
    expect(mapAuthError('auth/something-new')).toBe('Ocurrió un error. Intenta de nuevo.')
  })
})
```

Run: `npx vitest run tests/authErrors.test.js tests/auth-ui.test.js` — confirma que ambos pasan (el segundo no debe regresar, ya que `auth-ui.js` sigue exportando/usando `mapAuthError` igual que antes, solo que ahora importado).

Commit de este paso, separado del resto de la Task 7 (es un refactor mecánico, útil aislarlo):

```bash
git add authErrors.js auth-ui.js tests/authErrors.test.js
git commit -m "refactor(auth): extract mapAuthError into authErrors.js (no module side effects)"
```

- [ ] **Step 1: Escribir los tests que fallan (Task 7 propiamente)**

Agrega el import de las 3 funciones nuevas al `vi.mock('../firebase-init.js', ...)` existente en `tests/account-ui.test.js` (línea 12):

```js
const reauthenticateWithCredential = vi.fn()
const verifyBeforeUpdateEmail = vi.fn()
class EmailAuthProvider {
  static credential(email, password) { return { email, password } }
}
vi.mock('../firebase-init.js', () => ({ firebaseAuth: mockAuth, signOut, reauthenticateWithCredential, verifyBeforeUpdateEmail, EmailAuthProvider }))
```

Agrega `submitEmailEdit` al import del módulo. Nuevo `describe`:

```js
describe('sub-form Correo', () => {
  it('renderiza el input de correo nuevo + input de contraseña actual para reautenticar', () => {
    getCachedProfile.mockReturnValue({ email: 'old@example.com', membershipStatus: 'active' })
    renderAccountHub()
    expect(document.getElementById('input-edit-email')).toBeTruthy()
    expect(document.getElementById('input-email-current-password')).toBeTruthy()
  })

  it('submitEmailEdit reautentica y llama verifyBeforeUpdateEmail, muestra el mensaje de "revisa tu correo"', async () => {
    getCachedProfile.mockReturnValue({ email: 'old@example.com', membershipStatus: 'active' })
    renderAccountHub()
    mockAuth.currentUser = { email: 'old@example.com' }
    reauthenticateWithCredential.mockResolvedValue({})
    verifyBeforeUpdateEmail.mockResolvedValue(undefined)
    document.getElementById('input-edit-email').value = 'new@example.com'
    document.getElementById('input-email-current-password').value = 'secret123'

    await submitEmailEdit()

    expect(reauthenticateWithCredential).toHaveBeenCalledWith(mockAuth.currentUser, { email: 'old@example.com', password: 'secret123' })
    expect(verifyBeforeUpdateEmail).toHaveBeenCalledWith(mockAuth.currentUser, 'new@example.com')
    const successEl = document.getElementById('edit-email-success')
    expect(successEl.classList.contains('hidden')).toBe(false)
    expect(successEl.textContent).toMatch(/revisa tu correo/i)
  })

  it('submitEmailEdit muestra error de contraseña incorrecta sin llamar verifyBeforeUpdateEmail', async () => {
    getCachedProfile.mockReturnValue({ email: 'old@example.com', membershipStatus: 'active' })
    renderAccountHub()
    mockAuth.currentUser = { email: 'old@example.com' }
    reauthenticateWithCredential.mockRejectedValue({ code: 'auth/wrong-password' })
    document.getElementById('input-edit-email').value = 'new@example.com'
    document.getElementById('input-email-current-password').value = 'wrong'

    await expect(submitEmailEdit()).rejects.toBeTruthy()

    expect(verifyBeforeUpdateEmail).not.toHaveBeenCalled()
    const errorEl = document.getElementById('edit-email-error')
    expect(errorEl.classList.contains('hidden')).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/account-ui.test.js`
Expected: FAIL

- [ ] **Step 3: Implementar en `account-ui.js`**

Cambia el import de `firebase-init.js` al inicio del archivo:

```js
import { firebaseAuth, signOut, reauthenticateWithCredential, verifyBeforeUpdateEmail, EmailAuthProvider } from './firebase-init.js';
```

Agrega el import de `mapAuthError` desde el módulo nuevo del Step 0 (reusa el mismo mapeo de códigos de Firebase que usa el signup/login, sin arrastrar el efecto secundario de `auth-ui.js`):

```js
import { mapAuthError } from './authErrors.js';
```

Sub-form de correo dentro de `#account-edit-section` (después del form de teléfono):

```js
        <form id="form-edit-email">
          <div class="form-field">
            <label for="input-edit-email">Correo nuevo</label>
            <input id="input-edit-email" class="form-input" type="email" placeholder="${profile.email || ''}">
          </div>
          <div class="form-field">
            <label for="input-email-current-password">Confirma tu contraseña actual</label>
            <input id="input-email-current-password" class="form-input" type="password">
          </div>
          <button type="submit" class="btn btn-primary">Guardar correo</button>
          <p id="edit-email-error" class="hidden" role="alert"></p>
          <p id="edit-email-success" class="hidden" role="status"></p>
        </form>
```

Wiring:

```js
  document.getElementById('form-edit-email')?.addEventListener('submit', e => {
    e.preventDefault();
    submitEmailEdit().catch(() => {});
  });
```

Función nueva:

```js
function showEmailError(message) {
  const el = document.getElementById('edit-email-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function showEmailSuccess(message) {
  const el = document.getElementById('edit-email-success');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function submitEmailEdit() {
  const emailInput = document.getElementById('input-edit-email');
  const passwordInput = document.getElementById('input-email-current-password');
  const newEmail = emailInput ? emailInput.value.trim() : '';
  const currentPassword = passwordInput ? passwordInput.value : '';
  const errorEl = document.getElementById('edit-email-error');
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }

  const user = firebaseAuth.currentUser;
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  } catch (err) {
    showEmailError(mapAuthError(err.code));
    throw err;
  }

  try {
    await verifyBeforeUpdateEmail(user, newEmail);
    showEmailSuccess('Revisa tu correo nuevo y confirma el cambio desde ahí.');
  } catch (err) {
    showEmailError(mapAuthError(err.code));
    throw err;
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/account-ui.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add account-ui.js tests/account-ui.test.js
git commit -m "feat(account): add email edit sub-form (reauth + verifyBeforeUpdateEmail)"
```

---

### Task 8: sub-form Contraseña (solo provider `password`)

**Files:**
- Modify: `account-ui.js`
- Test: `tests/account-ui.test.js`

**Interfaces:**
- Consumes: `updatePassword`, `reauthenticateWithCredential`, `EmailAuthProvider` (Task 1/7).
- Produces: `submitPasswordEdit()` exportada. El sub-form solo se renderiza si `firebaseAuth.currentUser.providerData` incluye `{providerId:'password'}`.

- [ ] **Step 1: Escribir los tests que fallan**

Agrega `updatePassword` al mock de `firebase-init.js` en `tests/account-ui.test.js` (junto a los de Task 7) y `submitPasswordEdit` al import del módulo. Nuevo `describe`:

```js
describe('sub-form Contraseña', () => {
  it('se renderiza cuando el provider incluye password', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    expect(document.getElementById('form-edit-password')).toBeTruthy()
  })

  it('NO se renderiza para una cuenta Google (sin provider password)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'google.com' }] }
    renderAccountHub()
    expect(document.getElementById('form-edit-password')).toBeNull()
  })

  it('submitPasswordEdit rechaza si nueva y confirmar no coinciden, sin llamar a Firebase', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    document.getElementById('input-current-password').value = 'old123'
    document.getElementById('input-new-password').value = 'new123'
    document.getElementById('input-confirm-password').value = 'different'

    await expect(submitPasswordEdit()).rejects.toThrow()

    expect(reauthenticateWithCredential).not.toHaveBeenCalled()
  })

  it('submitPasswordEdit reautentica y llama updatePassword cuando coinciden', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    reauthenticateWithCredential.mockResolvedValue({})
    updatePassword.mockResolvedValue(undefined)
    document.getElementById('input-current-password').value = 'old123'
    document.getElementById('input-new-password').value = 'new12345'
    document.getElementById('input-confirm-password').value = 'new12345'

    await submitPasswordEdit()

    expect(reauthenticateWithCredential).toHaveBeenCalledWith(mockAuth.currentUser, { email: 'a@b.com', password: 'old123' })
    expect(updatePassword).toHaveBeenCalledWith(mockAuth.currentUser, 'new12345')
    const successEl = document.getElementById('edit-password-success')
    expect(successEl.classList.contains('hidden')).toBe(false)
  })

  it('submitPasswordEdit muestra error si la contraseña actual es incorrecta, sin llamar updatePassword', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    reauthenticateWithCredential.mockRejectedValue({ code: 'auth/wrong-password' })
    document.getElementById('input-current-password').value = 'wrong'
    document.getElementById('input-new-password').value = 'new12345'
    document.getElementById('input-confirm-password').value = 'new12345'

    await expect(submitPasswordEdit()).rejects.toBeTruthy()

    expect(updatePassword).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/account-ui.test.js`
Expected: FAIL

- [ ] **Step 3: Implementar en `account-ui.js`**

Agrega `updatePassword` al import de `firebase-init.js`:

```js
import { firebaseAuth, signOut, reauthenticateWithCredential, verifyBeforeUpdateEmail, updatePassword, EmailAuthProvider } from './firebase-init.js';
```

Sub-form de contraseña, condicional en `renderAccountHub()` (después del form de correo, dentro de `#account-edit-section`) — usa una función helper para el chequeo de provider:

```js
function hasPasswordProvider() {
  const user = firebaseAuth.currentUser;
  return !!(user && Array.isArray(user.providerData) && user.providerData.some(p => p.providerId === 'password'));
}
```

Template (agrega dentro del `${...}` del `content-card`, condicionado):

```js
        ${hasPasswordProvider() ? `
          <form id="form-edit-password">
            <div class="form-field">
              <label for="input-current-password">Contraseña actual</label>
              <input id="input-current-password" class="form-input" type="password">
            </div>
            <div class="form-field">
              <label for="input-new-password">Nueva contraseña</label>
              <input id="input-new-password" class="form-input" type="password" minlength="6">
            </div>
            <div class="form-field">
              <label for="input-confirm-password">Confirmar nueva contraseña</label>
              <input id="input-confirm-password" class="form-input" type="password" minlength="6">
            </div>
            <button type="submit" class="btn btn-primary">Guardar contraseña</button>
            <p id="edit-password-error" class="hidden" role="alert"></p>
            <p id="edit-password-success" class="hidden" role="status"></p>
          </form>
        ` : ''}
```

Wiring:

```js
  document.getElementById('form-edit-password')?.addEventListener('submit', e => {
    e.preventDefault();
    submitPasswordEdit().catch(() => {});
  });
```

Función nueva:

```js
function showPasswordError(message) {
  const el = document.getElementById('edit-password-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function submitPasswordEdit() {
  const currentInput = document.getElementById('input-current-password');
  const newInput = document.getElementById('input-new-password');
  const confirmInput = document.getElementById('input-confirm-password');
  const currentPassword = currentInput ? currentInput.value : '';
  const newPassword = newInput ? newInput.value : '';
  const confirmPassword = confirmInput ? confirmInput.value : '';
  const errorEl = document.getElementById('edit-password-error');
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }

  if (newPassword !== confirmPassword) {
    showPasswordError('Las contraseñas nuevas no coinciden.');
    throw new Error('password_mismatch');
  }

  const user = firebaseAuth.currentUser;
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  } catch (err) {
    showPasswordError(mapAuthError(err.code));
    throw err;
  }

  try {
    await updatePassword(user, newPassword);
    const successEl = document.getElementById('edit-password-success');
    if (successEl) { successEl.textContent = 'Tu contraseña se actualizó correctamente.'; successEl.classList.remove('hidden'); }
  } catch (err) {
    showPasswordError(mapAuthError(err.code));
    throw err;
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/account-ui.test.js`
Expected: PASS

- [ ] **Step 5: Correr la suite completa**

Run: `npx vitest run`
Expected: PASS (único fallo esperado: el preexistente de Playwright/e2e).

- [ ] **Step 6: Commit**

```bash
git add account-ui.js tests/account-ui.test.js
git commit -m "feat(account): add password edit sub-form (reauth + updatePassword, password-provider only)"
```

---

## Al terminar todas las tasks

Correr la suite completa una última vez (`npx vitest run`) y usar `superpowers:finishing-a-development-branch` para decidir merge/PR — no se hace commit a `master`/producción sin instrucción explícita del usuario (regla de sesión: `develop` únicamente). Antes de dar por cerrado, considerar un smoke test manual: cambio de contraseña, cambio de correo (revisar que llegue el link de confirmación), y cambio de teléfono en una cuenta phone-login real (confirmar que el claim se refleja tras un refresh de sesión) — ninguno de los 3 es automatizable con vitest solo.
