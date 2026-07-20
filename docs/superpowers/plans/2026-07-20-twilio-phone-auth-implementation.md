# Migrar autenticación por teléfono de Firebase a Twilio Verify — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar Firebase Phone Auth (limitado a 10 SMS/día en plan gratuito) por Twilio Verify para el login/registro por teléfono, sin tocar el login por email/contraseña ni Google (siguen 100% en Firebase Auth).

**Architecture:** El cliente llama 2 endpoints nuevos del propio backend (`/api/auth/phone/send`, `/api/auth/phone/verify`) que hablan con Twilio Verify por `fetch` plano (sin SDK de Twilio). Al aprobar Twilio el código, el backend firma un Firebase custom token (JWT RS256 manual, sin `firebase-admin`) para `uid = "phone:" + <E.164>`, reutilizando la MISMA service account que ya usa `api/firestore.js` (`FIREBASE_SERVICE_ACCOUNT_KEY`) — no hace falta credencial nueva. El cliente intercambia ese custom token con `signInWithCustomToken`, y de ahí en adelante es una sesión Firebase idéntica a la de email/Google.

**Tech Stack:** Node/Express (backend existente), `crypto` nativo (sin deps nuevas), Firebase JS SDK v11.6.0 (cliente, ya en uso), Twilio Verify REST API (llamada directa vía `fetch`, sin paquete `twilio`), Vitest (tests).

## Global Constraints

- Email/contraseña y Google **no cambian** — cero modificaciones a `handleLogin`, `handleSignup`, `handleGoogleSignIn`.
- Esquema de UID para teléfono: `"phone:" + <teléfono E.164 completo>` (ej. `phone:+5215512345678`). Determinístico, sin llamadas a Identity Toolkit para buscar/crear usuario.
- **Cero secretos nuevos de Firebase**: `FIREBASE_SERVICE_ACCOUNT_KEY` ya existe (documentado en README, ya usado por `api/firestore.js:getAccessToken`) y ya tiene permiso de firmar tokens para este proyecto — se reutiliza tal cual, mismo parseo dotenvx-unescape.
- Nunca usar `firebase-admin` ni el paquete npm `twilio` — todo vía `fetch`/`crypto` nativos, mismo patrón que `api/auth.js`.
- Nunca leer `alg` de un JWT entrante para decidir cómo verificarlo (no aplica aquí — solo se FIRMAN tokens propios, no se verifican tokens de terceros).
- No se agrega rate-limit propio para los endpoints de teléfono (decisión explícita: Twilio Verify ya limita reintentos/expira códigos; el limiter genérico de `/api/*` ya existente sigue aplicando sin cambios).
- Cero entradas CSP nuevas: Twilio se llama servidor-a-servidor, nunca desde el browser. Las entradas de `https://www.google.com`/`https://firebaseappcheck.googleapis.com` en las 8 declaraciones de CSP (6 páginas HTML + `vercel.json` + `api/index.js`) se QUEDAN — son de Firebase App Check, ortogonal a este cambio, sigue protegiendo el login de email/Google.
- `country-codes.js`, `setView()`, el consent-gate (checkboxes de Términos/edad), `fireUpsertUser` — sin cambios. `authClient.js` solo cambia en un comentario obsoleto (Task 6, Step 3b) — su lógica (`setAutoSyncSuppressed`) no se toca.
- Mapeo de status HTTP de Twilio → status HTTP propio: `sendVerificationCode`/`checkVerificationCode` (Task 1) adjuntan `error.status = resp.status` en cualquier error que lancen. Los route handlers (Task 3) usan ese `status` para distinguir "el usuario se equivocó" (4xx de Twilio → 400/401 propio) de "Twilio/nuestra config falló" (5xx o sin `status` → 502/500 propio) — nunca colapsan todo a un solo código genérico, para no perder la distinción que ya pedía el spec original.
- `FIREBASE_SERVICE_ACCOUNT_KEY` se parsea en UN solo lugar (`api/firestore.js:getServiceAccount()`, exportada); `api/phoneAuth.js` la importa en vez de reimplementar el des-escape dotenvx — evita una 3ra copia del mismo parseo sensible a secretos.
- Twilio real no se puede probar en CI — cada test mockea `fetch`/Twilio. Un smoke-test manual con teléfono real es obligatorio antes de mergear (no lo hace este plan; queda como paso final para el humano).

**Cambios de esta revisión** (equipo de 3 agentes especializados — Security Architect, Backend Architect, Frontend Developer — revisó spec+plan; 0 Critical, 4 Important, varios Minor, todos aplicados abajo): `phoneVerifyHandler` ahora valida el formato E.164 del teléfono (antes solo `phoneSendHandler` lo hacía — permitía mintear un uid distinto para el mismo teléfono real vía variantes de formato); status HTTP de Twilio ya no se colapsa todo a 502 (ver bullet arriba); firma de custom token fallida es 500 dedicado, nunca 502 (antes ambos caían en el mismo catch); parseo de `FIREBASE_SERVICE_ACCOUNT_KEY` extraído a un solo lugar; `handleVerifyCode` ya no traga `err.code` en su catch (Task 6); comentario obsoleto de `confirmationResult` en `authClient.js` corregido (Task 6); nombre de test en `firebase-init.test.js` corregido para no atribuir las entradas CSP de `google.com` al login por teléfono (son de App Check).

---

### Task 1: `api/firestore.js` (extrae `getServiceAccount`) + `api/phoneAuth.js` — Twilio Verify + firma de Firebase custom token

**Files:**
- Modify: `api/firestore.js:8-61` (extrae el parseo de `FIREBASE_SERVICE_ACCOUNT_KEY` a una función `getServiceAccount()` exportada, sin cambiar su comportamiento)
- Create: `api/phoneAuth.js`
- Test: `tests/phoneAuth.test.js`
- Test: correr `tests/firestore-*.test.js` existentes (regresión, el refactor de `firestore.js` no debe cambiar su comportamiento)

**Interfaces:**
- Produces (`api/firestore.js`, nuevo export): `getServiceAccount(): object | null` (parsea `FIREBASE_SERVICE_ACCOUNT_KEY` con el des-escape dotenvx; `null` si la env var no existe — mismo comportamiento que hoy, solo extraído a función nombrada).
- Produces (`api/phoneAuth.js`): `sendVerificationCode(phone: string): Promise<string>` (retorna `data.status`, ej. `"pending"`; lanza `Error` con `.status = resp.status` si Twilio responde no-ok), `checkVerificationCode(phone: string, code: string): Promise<string>` (mismo contrato), `createFirebaseCustomToken(uid: string): string` (JWT RS256 firmado, lanza `Error` si `getServiceAccount()` devuelve `null`).

Nota: NO se exporta un `phoneFromUid` desde `api/phoneAuth.js` — Task 2 necesita la misma lógica de un lado (`api/auth.js`) sin acoplarse a este módulo, así que la repite inline en una línea. Repetir una línea es más barato que la dependencia cruzada (YAGNI). El caso de `getServiceAccount()` es distinto: es lógica de parseo de un secreto (dotenvx-unescape) ya duplicada 2 veces en `api/firestore.js` — una 3ra copia en `phoneAuth.js` sería el mismo bug-en-2-lugares esperando pasar si la convención de escape cambia algún día; por eso esta sí se comparte.
- Consumes: `getServiceAccount` de `./firestore` (única dependencia interna del proyecto).

- [ ] **Step 1a: Extrae `getServiceAccount()` en `api/firestore.js` (refactor sin cambio de comportamiento)**

En `api/firestore.js`, reemplaza el bloque de `getAccessToken` (líneas 8-50) y la lectura duplicada dentro de `getProjectId` (líneas 54-61):

```js
let _token = null;
let _tokenExpiry = 0;
let _projectId = null;

// dotenvx deja \" para comillas y \+LF para saltos de línea del PEM en el
// blob JSON de la service account — se des-escapa antes de parsear. Se usa
// tanto para el OAuth2 de Firestore (abajo) como para firmar Firebase custom
// tokens (api/phoneAuth.js) — MISMA credencial, un solo lugar que mantener.
function getServiceAccount() {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!key) return null;
  const raw = key.includes('\\"')
    ? key.replace(/\x5c\x0a/g, '\x5c\x6e').replace(/\x5c\x22/g, '\x22')
    : key;
  return JSON.parse(raw);
}

async function getAccessToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  try {
    const sa = getServiceAccount();
    if (!sa) return null;
    _projectId = sa.project_id;
    const jwtHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const claim = JSON.stringify({
      iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now
    });
    const jwtPayload = Buffer.from(claim).toString('base64url');
    const { createSign } = require('crypto');
    const sign = createSign('RSA-SHA256');
    sign.update(jwtHeader + '.' + jwtPayload);
    const signature = sign.sign(sa.private_key, 'base64url');
    const assertion = jwtHeader + '.' + jwtPayload + '.' + signature;

    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      }),
      signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    _token = data.access_token;
    _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return _token;
  } catch (e) {
    console.warn('[Firestore] Auth error:', e.message);
    return null;
  }
}

const BASE = 'https://firestore.googleapis.com/v1';

function getProjectId() {
  if (_projectId) return _projectId;
  try {
    const sa = getServiceAccount();
    if (sa) _projectId = sa.project_id;
  } catch {}
  return _projectId || 'foodscaner-cache-v2';
}
```

(Comportamiento idéntico al original: `getAccessToken` seguía retornando `null` cuando falta la key ANTES de entrar al `try` — ahora ese `return null` vive dentro del `try` vía `if (!sa) return null`, mismo resultado observable. `getProjectId` seguía tragando cualquier error de parseo — sigue igual, solo que ahora llama a `getServiceAccount()` en vez de repetir el des-escape.)

Al final del archivo, en `module.exports`, agrega `getServiceAccount` a la lista existente (línea 649-658):

```js
module.exports = {
  getAccessToken, getServiceAccount,
  fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache,
  fireGetOcrData, fireSetOcrData,
  fireGetNutritionOcr, fireSetNutritionOcr,
  fireListDocs, fireListAll, fireDeleteDoc, fireLogScan, fireMarkScanNotFound, fireMarkScanHasOcr, fireMarkScanHasNutrition, fireMarkScanConfidence, fireMarkScanSource, fireMarkScanSources, fireLogReport, ADMIN_COLLECTIONS,
  fireGetUser, fireUpsertUser, firePatchUserFields,
  fireGetUserRaw, firePatchUserFieldsWithPrecondition, fireIncrementUsageCounter,
  fireLogUserHistory, fireListUserHistory
};
```

- [ ] **Step 1b: Corre la suite de Firestore existente para confirmar cero regresión**

Run: `npx vitest run tests/firestore-history.test.js tests/firestore-usage.test.js tests/firestore-users.test.js`
Expected: PASS — mismos tests, mismo resultado que antes del refactor (es un refactor puro, sin cambio de comportamiento observable).

- [ ] **Step 2: Escribe el test completo de `api/phoneAuth.js`**

Crea `tests/phoneAuth.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import crypto from 'crypto'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const getServiceAccount = vi.fn()
firestoreModule.getServiceAccount = getServiceAccount

const { sendVerificationCode, checkVerificationCode, createFirebaseCustomToken } = await import('../api/phoneAuth.js')

function b64urlJsonDecode(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
}

describe('sendVerificationCode', () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_test'
    process.env.TWILIO_AUTH_TOKEN = 'token_test'
    process.env.TWILIO_VERIFY_SERVICE_SID = 'VA_test'
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('calls the Twilio Verify Verifications endpoint with Basic Auth and the phone number', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'pending' }) })
    vi.stubGlobal('fetch', fetchMock)

    const status = await sendVerificationCode('+525512345678')

    expect(status).toBe('pending')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://verify.twilio.com/v2/Services/VA_test/Verifications')
    expect(opts.headers.Authorization).toBe('Basic ' + Buffer.from('AC_test:token_test').toString('base64'))
    expect(opts.body.toString()).toBe('To=%2B525512345678&Channel=sms')
  })

  it('throws with .status set to the Twilio HTTP status when Twilio responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'Invalid phone' }) }))
    await expect(sendVerificationCode('bad')).rejects.toThrow('Invalid phone')
    try {
      await sendVerificationCode('bad')
    } catch (e) {
      expect(e.status).toBe(400)
    }
  })
})

describe('checkVerificationCode', () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_test'
    process.env.TWILIO_AUTH_TOKEN = 'token_test'
    process.env.TWILIO_VERIFY_SERVICE_SID = 'VA_test'
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('calls the Twilio Verify VerificationCheck endpoint and returns the status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'approved' }) })
    vi.stubGlobal('fetch', fetchMock)

    const status = await checkVerificationCode('+525512345678', '123456')

    expect(status).toBe('approved')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://verify.twilio.com/v2/Services/VA_test/VerificationCheck')
    expect(opts.body.toString()).toBe('To=%2B525512345678&Code=123456')
  })

  it('throws with .status set to the Twilio HTTP status when Twilio responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ message: 'Not found' }) }))
    try {
      await checkVerificationCode('+525512345678', '000000')
      expect.unreachable()
    } catch (e) {
      expect(e.message).toBe('Not found')
      expect(e.status).toBe(404)
    }
  })
})

describe('createFirebaseCustomToken', () => {
  let publicKey

  beforeEach(() => {
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    publicKey = keyPair.publicKey
    getServiceAccount.mockReturnValue({
      client_email: 'firebase-adminsdk@foodscaner-dev.iam.gserviceaccount.com',
      private_key: keyPair.privateKey.export({ type: 'pkcs1', format: 'pem' }),
      project_id: 'foodscaner-dev'
    })
  })

  it('signs a JWT with the claims Firebase custom tokens require', () => {
    const token = createFirebaseCustomToken('phone:+525512345678')
    const [headerB64, payloadB64, sigB64] = token.split('.')

    expect(b64urlJsonDecode(headerB64)).toEqual({ alg: 'RS256', typ: 'JWT' })

    const payload = b64urlJsonDecode(payloadB64)
    expect(payload.uid).toBe('phone:+525512345678')
    expect(payload.iss).toBe('firebase-adminsdk@foodscaner-dev.iam.gserviceaccount.com')
    expect(payload.sub).toBe(payload.iss)
    expect(payload.aud).toBe('https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit')
    expect(payload.exp - payload.iat).toBe(3600)

    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`)
    const signature = Buffer.from(sigB64, 'base64url')
    expect(crypto.verify('RSA-SHA256', signingInput, publicKey, signature)).toBe(true)
  })

  it('throws when getServiceAccount() returns null (FIREBASE_SERVICE_ACCOUNT_KEY missing)', () => {
    getServiceAccount.mockReturnValue(null)
    expect(() => createFirebaseCustomToken('phone:+525512345678')).toThrow(/FIREBASE_SERVICE_ACCOUNT_KEY/)
  })
})
```

- [ ] **Step 3: Corre el test y verifica que falla**

Run: `npx vitest run tests/phoneAuth.test.js`
Expected: FAIL — `Cannot find module '../api/phoneAuth.js'`

- [ ] **Step 4: Implementa `api/phoneAuth.js`**

```js
// Twilio Verify (envío/checo de código SMS) + firma manual de Firebase custom
// tokens (RS256, sin firebase-admin — mismo patrón que api/auth.js) para que
// un teléfono verificado por Twilio termine siendo una sesión Firebase normal.
// Reutiliza la MISMA service account que ya usa api/firestore.js
// (FIREBASE_SERVICE_ACCOUNT_KEY) — ya tiene permiso de firmar tokens para
// este proyecto, no hace falta una credencial nueva.
const crypto = require('crypto');
const { getServiceAccount } = require('./firestore');

const TWILIO_VERIFY_BASE = 'https://verify.twilio.com/v2';
const CUSTOM_TOKEN_AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

function twilioAuthHeader() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
}

async function sendVerificationCode(phone) {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  const resp = await fetch(`${TWILIO_VERIFY_BASE}/Services/${serviceSid}/Verifications`, {
    method: 'POST',
    headers: { Authorization: twilioAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: phone, Channel: 'sms' }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data?.message || `Twilio Verify error (status ${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  return data.status;
}

async function checkVerificationCode(phone, code) {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  const resp = await fetch(`${TWILIO_VERIFY_BASE}/Services/${serviceSid}/VerificationCheck`, {
    method: 'POST',
    headers: { Authorization: twilioAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: phone, Code: code }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data?.message || `Twilio Verify error (status ${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  return data.status;
}

function base64UrlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function createFirebaseCustomToken(uid) {
  const sa = getServiceAccount();
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY no configurada');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email, sub: sa.client_email, aud: CUSTOM_TOKEN_AUD,
    uid, iat: now, exp: now + 3600
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(sa.private_key, 'base64url');
  return `${signingInput}.${signature}`;
}

module.exports = { sendVerificationCode, checkVerificationCode, createFirebaseCustomToken };
```

- [ ] **Step 5: Corre el test y verifica que pasa**

Run: `npx vitest run tests/phoneAuth.test.js`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add api/firestore.js api/phoneAuth.js tests/phoneAuth.test.js
git commit -m "feat(auth): add Twilio Verify client + Firebase custom token signing

Extracts getServiceAccount() out of api/firestore.js:getAccessToken (pure
refactor, same dotenvx-unescape logic, no behavior change) so
api/phoneAuth.js can reuse the same parsed service account credential
instead of a 3rd copy of the same secret-parsing code. Twilio errors
carry .status so callers can distinguish client-fault (4xx) from
outage (5xx)."
```

---

### Task 2: `api/auth.js` — derivar `phoneNumber` del `uid` cuando falta el claim

**Files:**
- Modify: `api/auth.js:83`
- Test: `tests/auth.test.js`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `verifyFirebaseIdToken` sigue devolviendo `{ uid, email, emailVerified, phoneNumber }`, ahora con `phoneNumber` correcto también para uids `"phone:"+...` sin claim `phone_number` en el token (custom-token bridge de Twilio).

- [ ] **Step 1: Escribe el test que falla**

Agrega a `tests/auth.test.js`, dentro de `describe('verifyFirebaseIdToken', ...)`, después del test `'extracts phone_number from a phone-authenticated token'` (línea 70):

```js
  it('derives phoneNumber from a "phone:"-prefixed uid when the token has no phone_number claim (Twilio custom-token bridge)', async () => {
    mockJwks()
    const token = signRS256({ sub: 'phone:+525512345678', email: undefined, email_verified: undefined }, privateKey)
    const result = await verifyFirebaseIdToken(token, PROJECT_ID)
    expect(result).toEqual({ uid: 'phone:+525512345678', email: null, emailVerified: false, phoneNumber: '+525512345678' })
  })

  it('does not derive a phoneNumber for a non-"phone:" uid with no phone_number claim', async () => {
    mockJwks()
    const token = signRS256({ email: undefined, email_verified: undefined }, privateKey)
    const result = await verifyFirebaseIdToken(token, PROJECT_ID)
    expect(result.phoneNumber).toBeNull()
  })
```

- [ ] **Step 2: Corre el test y verifica que falla**

Run: `npx vitest run tests/auth.test.js`
Expected: FAIL — el primer test nuevo espera `phoneNumber: '+525512345678'` pero recibe `null`.

- [ ] **Step 3: Implementa el fix**

En `api/auth.js:83`, reemplaza:

```js
  return { uid: payload.sub, email: payload.email || null, emailVerified: !!payload.email_verified, phoneNumber: payload.phone_number || null };
```

por:

```js
  const derivedPhoneNumber = payload.phone_number || (payload.sub.startsWith('phone:') ? payload.sub.slice(6) : null);
  return { uid: payload.sub, email: payload.email || null, emailVerified: !!payload.email_verified, phoneNumber: derivedPhoneNumber };
```

- [ ] **Step 4: Corre el test y verifica que pasa**

Run: `npx vitest run tests/auth.test.js`
Expected: PASS (todos los tests del archivo, incluyendo los 2 nuevos)

- [ ] **Step 5: Commit**

```bash
git add api/auth.js tests/auth.test.js
git commit -m "fix(auth): derive phoneNumber from uid for Twilio custom-token sessions

Custom tokens minted for Twilio-verified phone logins carry no
phone_number ID-token claim (that claim only exists for Firebase's own
native Phone Auth provider) — and it can't be faked via a transient
custom-token claim either, since those don't survive the SDK's silent
token refresh ~1h later. Since the uid is deterministic ("phone:"+E.164)
and stable across every refresh, derive phoneNumber from it directly
instead. Fixes the OCR-gate premium bypass for Twilio-verified users."
```

---

### Task 3: rutas `/api/auth/phone/send` y `/api/auth/phone/verify`

**Files:**
- Modify: `api/index.js` (agrega import de `./phoneAuth`, 2 handlers + 2 rutas cerca de `authSyncHandler`/`app.post('/api/auth/sync', ...)` — línea ~1358, y 2 líneas de `module.exports` al final)
- Test: `tests/phoneAuthRoutes.test.js`

**Interfaces:**
- Consumes: `sendVerificationCode`, `checkVerificationCode`, `createFirebaseCustomToken` de `./phoneAuth` (Task 1); `fireGetUser` de `./firestore` (ya importado en `api/index.js`).
- Produces: `phoneSendHandler(req, res)`, `phoneVerifyHandler(req, res)` exportados igual que `authSyncHandler`/`getMeHandler`, montados en `POST /api/auth/phone/send` y `POST /api/auth/phone/verify` (sin `requireUser` — el usuario aún no tiene sesión en este punto).

- [ ] **Step 1: Escribe el test completo**

Crea `tests/phoneAuthRoutes.test.js` (mismo patrón CJS-require-patching que `tests/requireUser.test.js`/`tests/authSync.test.js` — `vi.mock` no intercepta requires anidados CJS→CJS):

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const phoneAuthModule = requireFn('../api/phoneAuth.js')
const sendVerificationCode = vi.fn()
const checkVerificationCode = vi.fn()
const createFirebaseCustomToken = vi.fn()
phoneAuthModule.sendVerificationCode = sendVerificationCode
phoneAuthModule.checkVerificationCode = checkVerificationCode
phoneAuthModule.createFirebaseCustomToken = createFirebaseCustomToken

const firestoreModule = requireFn('../api/firestore.js')
const fireGetUser = vi.fn()
firestoreModule.fireGetUser = fireGetUser

const { phoneSendHandler, phoneVerifyHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

function twilioError(message, status) {
  const e = new Error(message)
  e.status = status
  return e
}

describe('phoneSendHandler', () => {
  beforeEach(() => { sendVerificationCode.mockReset() })

  it('400s on a missing/invalid phone (must be E.164: + followed by digits)', async () => {
    const req = { body: { phone: 'not-a-phone' } }
    const res = makeRes()
    await phoneSendHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_phone' })
    expect(sendVerificationCode).not.toHaveBeenCalled()
  })

  it('sends the code via Twilio and responds { status }', async () => {
    sendVerificationCode.mockResolvedValue('pending')
    const req = { body: { phone: '+525512345678' } }
    const res = makeRes()
    await phoneSendHandler(req, res)
    expect(sendVerificationCode).toHaveBeenCalledWith('+525512345678')
    expect(res.body).toEqual({ status: 'pending' })
  })

  it('400s (not 502) when Twilio itself rejects the number (4xx from Twilio)', async () => {
    sendVerificationCode.mockRejectedValue(twilioError('Invalid parameter', 400))
    const req = { body: { phone: '+525512345678' } }
    const res = makeRes()
    await phoneSendHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_phone' })
  })

  it('502s when Twilio is down (5xx or no status)', async () => {
    sendVerificationCode.mockRejectedValue(new Error('network error'))
    const req = { body: { phone: '+525512345678' } }
    const res = makeRes()
    await phoneSendHandler(req, res)
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: 'send_failed' })
  })
})

describe('phoneVerifyHandler', () => {
  beforeEach(() => {
    checkVerificationCode.mockReset()
    createFirebaseCustomToken.mockReset()
    fireGetUser.mockReset()
  })

  it('400s on a missing/invalid phone, same E.164 check as phoneSendHandler (hallazgo de seguridad: sin esto, el mismo teléfono real podía mintear varios uids con formatos distintos)', async () => {
    const req = { body: { phone: 'not-a-phone', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(checkVerificationCode).not.toHaveBeenCalled()
  })

  it('401s when Twilio does not approve the code', async () => {
    checkVerificationCode.mockResolvedValue('pending')
    const req = { body: { phone: '+525512345678', code: '000000' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'invalid_code' })
    expect(createFirebaseCustomToken).not.toHaveBeenCalled()
  })

  it('401s (not 502) when Twilio rejects the check itself (4xx, e.g. expired/max attempts)', async () => {
    checkVerificationCode.mockRejectedValue(twilioError('Max check attempts reached', 429))
    const req = { body: { phone: '+525512345678', code: '000000' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'invalid_code' })
  })

  it('502s when Twilio is down (5xx or no status) during the check', async () => {
    checkVerificationCode.mockRejectedValue(new Error('network error'))
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: 'verify_failed' })
  })

  it('mints a custom token for uid "phone:"+phone and reports isNewUser:true for a first-time phone', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetUser.mockResolvedValue(null)
    createFirebaseCustomToken.mockReturnValue('signed.jwt.token')
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(createFirebaseCustomToken).toHaveBeenCalledWith('phone:+525512345678')
    expect(fireGetUser).toHaveBeenCalledWith('phone:+525512345678')
    expect(res.body).toEqual({ customToken: 'signed.jwt.token', isNewUser: true })
  })

  it('reports isNewUser:false when the user doc already exists', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetUser.mockResolvedValue({ uid: 'phone:+525512345678' })
    createFirebaseCustomToken.mockReturnValue('signed.jwt.token')
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.body).toEqual({ customToken: 'signed.jwt.token', isNewUser: false })
  })

  it('defaults isNewUser to true (fail-safe) when the Firestore lookup itself fails, without blocking the response (diseño: Firestore ambiguo -> trata como nuevo)', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetUser.mockRejectedValue(new Error('Firestore unavailable'))
    createFirebaseCustomToken.mockReturnValue('signed.jwt.token')
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.body).toEqual({ customToken: 'signed.jwt.token', isNewUser: true })
  })

  it('500s (dedicated, not 502) when custom-token signing fails — distinct from a Twilio outage (diseño: falla firma de custom token -> 500)', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetUser.mockResolvedValue(null)
    createFirebaseCustomToken.mockImplementation(() => { throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY no configurada') })
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'server_error' })
  })
})
```

- [ ] **Step 2: Corre el test y verifica que falla**

Run: `npx vitest run tests/phoneAuthRoutes.test.js`
Expected: FAIL — `phoneSendHandler`/`phoneVerifyHandler` no existen todavía en `api/index.js`.

- [ ] **Step 3: Implementa las rutas**

En `api/index.js`, agrega el import junto a los demás (línea 8, después de `const { verifyFirebaseIdToken } = require('./auth');`):

```js
const { sendVerificationCode, checkVerificationCode, createFirebaseCustomToken } = require('./phoneAuth');
```

Agrega los 2 handlers y sus rutas inmediatamente ANTES de `app.post('/api/auth/sync', requireUser, authSyncHandler);` (línea 1358):

```js
const E164_RE = /^\+[1-9]\d{6,14}$/;

// Twilio 4xx (número inválido, código incorrecto/expirado, límite de
// intentos) es culpa del usuario -> mapeamos a un 4xx propio. Cualquier otra
// cosa (5xx de Twilio, timeout, sin .status) es una falla nuestra/de Twilio
// -> 502, nunca confundido con el 4xx de "te equivocaste".
function isClientFaultTwilioError(e) {
  return typeof e.status === 'number' && e.status < 500;
}

async function phoneSendHandler(req, res) {
  const phone = req.body?.phone;
  if (typeof phone !== 'string' || !E164_RE.test(phone)) {
    return res.status(400).json({ error: 'invalid_phone' });
  }
  try {
    const status = await sendVerificationCode(phone);
    res.json({ status });
  } catch (e) {
    if (isClientFaultTwilioError(e)) return res.status(400).json({ error: 'invalid_phone' });
    console.warn('[auth/phone/send] Twilio error:', e.message);
    res.status(502).json({ error: 'send_failed' });
  }
}

app.post('/api/auth/phone/send', phoneSendHandler);

async function phoneVerifyHandler(req, res) {
  const { phone, code } = req.body || {};
  // Mismo E164_RE que phoneSendHandler (hallazgo de seguridad: sin esto, un
  // mismo teléfono real podía verificarse con un formato y mintear el custom
  // token con OTRO formato de la misma variable `phone`, generando un uid
  // distinto — rompiendo la garantía de "mismo teléfono siempre mapea al
  // mismo uid" de la que depende toda esta arquitectura).
  if (typeof phone !== 'string' || !E164_RE.test(phone) || typeof code !== 'string') {
    return res.status(400).json({ error: 'invalid_request' });
  }

  let status;
  try {
    status = await checkVerificationCode(phone, code);
  } catch (e) {
    if (isClientFaultTwilioError(e)) return res.status(401).json({ error: 'invalid_code' });
    console.warn('[auth/phone/verify] Twilio error:', e.message);
    return res.status(502).json({ error: 'verify_failed' });
  }
  if (status !== 'approved') return res.status(401).json({ error: 'invalid_code' });

  const uid = 'phone:' + phone;
  // Firestore ambiguo/inaccesible -> trata como usuario nuevo (fail-safe,
  // mismo criterio que el resto de la app) — nunca bloquea la respuesta.
  let isNewUser = true;
  try {
    const existing = await fireGetUser(uid);
    isNewUser = !existing;
  } catch (e) {
    console.warn('[auth/phone/verify] Firestore isNewUser check failed, defaulting to new:', e.message);
  }

  try {
    const customToken = createFirebaseCustomToken(uid);
    res.json({ customToken, isNewUser });
  } catch (e) {
    // Distinto del catch de arriba a propósito: firmar el token es lo único
    // de lo que no hay forma de "fallar hacia adelante" — sin token no hay
    // sesión. Diseño pide 500 dedicado aquí, nunca el mismo 502 que un
    // problema de Twilio (para que on-call no confunda "Twilio caído" con
    // "nuestra service account está mal configurada").
    console.warn('[auth/phone/verify] custom token signing error:', e.message);
    res.status(500).json({ error: 'server_error' });
  }
}

app.post('/api/auth/phone/verify', phoneVerifyHandler);
```

Agrega al final del archivo, junto a los demás `module.exports.*`:

```js
module.exports.phoneSendHandler = phoneSendHandler;
module.exports.phoneVerifyHandler = phoneVerifyHandler;
```

- [ ] **Step 4: Corre el test y verifica que pasa**

Run: `npx vitest run tests/phoneAuthRoutes.test.js`
Expected: PASS (12 tests)

- [ ] **Step 5: Corre toda la suite para descartar regresiones**

Run: `npx vitest run`
Expected: mismos archivos/tests que antes + los nuevos, todos PASS (salvo el fallo pre-existente no relacionado de `tests/e2e/scan-cycle.spec.js`, config de Playwright).

- [ ] **Step 6: Commit**

```bash
git add api/index.js tests/phoneAuthRoutes.test.js
git commit -m "feat(auth): wire /api/auth/phone/send and /verify to Twilio + custom token minting

phoneVerifyHandler validates E.164 the same way phoneSendHandler already
did (a missing check here let the same real phone mint different uids
via formatting variants). Twilio 4xx vs 5xx errors map to distinct
client-facing codes (400/401 vs 502) instead of collapsing everything
to one generic status. Custom-token signing failure gets its own 500,
never confused with a Twilio outage. Firestore's isNewUser check
fails safe (defaults to true) without ever blocking the response."
```

---

### Task 4: `firebase-init.js` — quitar Firebase Phone Auth, agregar `signInWithCustomToken`

**Files:**
- Modify: `firebase-init.js`
- Test: `tests/firebase-init.test.js`

**Interfaces:**
- Produces: re-exporta `signInWithCustomToken` (nuevo). Deja de exportar `RecaptchaVerifier`, `signInWithPhoneNumber`, `getAdditionalUserInfo`.
- Consumes: nada nuevo.

- [ ] **Step 1: Actualiza el test**

En `tests/firebase-init.test.js`, en el bloque `vi.mock(AUTH_URL, ...)` (líneas 34-45), reemplaza `RecaptchaVerifier`/`signInWithPhoneNumber`/`getAdditionalUserInfo` por `signInWithCustomToken`:

```js
const onAuthStateChanged = vi.fn()
const signInWithEmailAndPassword = vi.fn()
const createUserWithEmailAndPassword = vi.fn()
const signInWithPopup = vi.fn()
const signOut = vi.fn()
class GoogleAuthProvider {}
const signInWithCustomToken = vi.fn()

vi.mock(APP_URL, () => ({ initializeApp }))
vi.mock(APP_CHECK_URL, () => ({ initializeAppCheck, ReCaptchaV3Provider }))
vi.mock(AUTH_URL, () => ({
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  signInWithCustomToken
}))
```

En el test `'re-exports the auth SDK functions Task 11/12/phone-auth depend on'` (línea 72-82), reemplaza las 2 aserciones de `RecaptchaVerifier`/`signInWithPhoneNumber`/`getAdditionalUserInfo` por una de `signInWithCustomToken`:

```js
  it('re-exports the auth SDK functions the app depends on', async () => {
    const mod = await import('../firebase-init.js')
    expect(mod.onAuthStateChanged).toBe(onAuthStateChanged)
    expect(mod.signInWithEmailAndPassword).toBe(signInWithEmailAndPassword)
    expect(mod.createUserWithEmailAndPassword).toBe(createUserWithEmailAndPassword)
    expect(mod.signInWithPopup).toBe(signInWithPopup)
    expect(mod.GoogleAuthProvider).toBe(GoogleAuthProvider)
    expect(mod.signInWithCustomToken).toBe(signInWithCustomToken)
  })
```

También en `tests/firebase-init.test.js`, dentro de `describe('auth.html wiring', ...)`, el test `'CSP allows loading the Firebase SDK and reCAPTCHA (google.com) for phone login'` queda con un nombre engañoso: esas entradas de `google.com` ya no las usa el login por teléfono (Twilio no corre nada en el browser) — las sigue necesitando Firebase App Check. Renómbralo:

```js
  it('CSP allows loading the Firebase SDK and Firebase App Check (google.com reCAPTCHA v3)', () => {
```

(El cuerpo del test no cambia — mismas aserciones sobre las mismas entradas CSP, que siguen ahí por App Check.)

- [ ] **Step 2: Corre el test y verifica que falla**

Run: `npx vitest run tests/firebase-init.test.js`
Expected: FAIL — `mod.signInWithCustomToken` es `undefined` (aún no exportado).

- [ ] **Step 3: Implementa el cambio**

En `firebase-init.js`, reemplaza el bloque de import de `firebase-auth.js`:

```js
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  getAdditionalUserInfo
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
```

por:

```js
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  signInWithCustomToken
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
```

Y el bloque `export { ... }` al final:

```js
export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  signInWithCustomToken
};
```

- [ ] **Step 4: Corre el test y verifica que pasa**

Run: `npx vitest run tests/firebase-init.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add firebase-init.js tests/firebase-init.test.js
git commit -m "feat(auth): swap Firebase Phone Auth SDK exports for signInWithCustomToken"
```

---

### Task 5: `auth.html` — quitar `#recaptcha-container`

**Files:**
- Modify: `auth.html:108`

**Interfaces:** ninguna (solo markup, sin lógica).

- [ ] **Step 1: Elimina la línea**

En `auth.html`, elimina la línea 108:

```html
        <div id="recaptcha-container"></div>
```

(Ya no hace falta ningún contenedor de reCAPTCHA — Twilio no requiere ningún widget cliente. El reCAPTCHA de App Check, si se reactiva, no usa este div.)

- [ ] **Step 2: Verifica manualmente**

Run: `grep -n "recaptcha-container" auth.html`
Expected: sin resultados.

- [ ] **Step 3: Commit**

```bash
git add auth.html
git commit -m "fix(auth): remove unused recaptcha-container div (Twilio needs no client widget)"
```

---

### Task 6: `auth-ui.js` — cambiar el flujo de teléfono a Twilio + `signInWithCustomToken`

**Files:**
- Modify: `auth-ui.js`
- Modify: `authClient.js:54` (un comentario obsoleto, sin cambio de lógica — ver Step 4)
- Test: `tests/auth-ui.test.js`

**Interfaces:**
- Consumes: `signInWithCustomToken` de `./firebase-init.js` (Task 4); `POST /api/auth/phone/send` y `POST /api/auth/phone/verify` (Task 3, vía `fetch`, mockeado en tests).
- Produces: `handleSendCode`, `handleVerifyCode`, `handlePhoneSignupConsent`, `setView` sin cambios de firma (mismos parámetros/nombres). Cambio de contrato real, a propósito: `handleSendCode`/`handleVerifyCode` ya NO relanzan (`throw`) en su rama de error — siempre resuelven, igual que `handlePhoneSignupConsent` ya hacía desde la ronda de fixes anterior. Ningún llamador actual dependía del `throw` (los click handlers nunca hacen `.catch()`), así que esto no es una regresión — evita además el ruido de "Uncaught (in promise)" en consola que este mismo proyecto ya venía persiguiendo.

- [ ] **Step 1: Reescribe `tests/auth-ui.test.js` completo**

Reemplaza el archivo completo con este contenido (cambios: mocks de `firebase-init.js` sin `RecaptchaVerifier`/`signInWithPhoneNumber`/`getAdditionalUserInfo`, con `signInWithCustomToken`; fixture sin `#recaptcha-container`; `mapAuthError — phone codes` con los códigos nuevos del backend; `handleSendCode`/`handleVerifyCode`/`handlePhoneSignupConsent` reescritos contra `fetch` mockeado; el resto de describes — `handleLogin`, `handleSignup`, `handleGoogleSignIn`, `setView`, wiring de DOMContentLoaded, password toggle, login validation — sin cambios de comportamiento, solo re-teclados en el mismo archivo):

```js
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuth = { currentUser: null }
const signInWithEmailAndPassword = vi.fn()
const createUserWithEmailAndPassword = vi.fn()
const signInWithPopup = vi.fn()
const signInWithCustomToken = vi.fn()
class GoogleAuthProvider {}

vi.mock('../firebase-init.js', () => ({
  firebaseAuth: mockAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithCustomToken
}))

const setAutoSyncSuppressed = vi.fn()
vi.mock('../authClient.js', () => ({ setAutoSyncSuppressed }))

vi.mock('../country-codes.js', () => ({
  COUNTRY_CODES: [{ name: 'México', iso2: 'MX', dial: '+52' }, { name: 'Argentina', iso2: 'AR', dial: '+54' }],
  flagEmoji: () => '🏳️'
}))

let mapAuthError, handleLogin, handleSignup, handleGoogleSignIn, handleSendCode, handleVerifyCode, handlePhoneSignupConsent, setView

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  mockAuth.currentUser = null
  global.fetch = vi.fn().mockResolvedValue({ ok: true })
  document.body.innerHTML = `
    <h1 id="auth-heading-title">Inicia sesión</h1>
    <div id="login-view">
      <button id="btn-google">Continuar con Google</button>
      <button type="button" id="btn-phone">Continuar con teléfono</button>
      <form id="login-form" novalidate>
        <input id="login-email" type="email" required>
        <input id="login-password" type="password" required minlength="6">
        <button type="button" id="btn-toggle-password" aria-label="Mostrar contraseña">Ver</button>
        <button type="submit" id="btn-login">Iniciar sesión</button>
        <button type="button" id="btn-back-to-login" class="hidden">¿Ya tienes cuenta? Inicia sesión</button>
        <button type="button" id="btn-signup">Crear cuenta</button>
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
    <div id="signup-only" class="hidden">
      <input type="checkbox" id="terms-checkbox">
      <input type="checkbox" id="age-checkbox">
      <button type="button" id="btn-phone-consent-confirm" class="hidden">Confirmar y continuar</button>
    </div>
    <p id="auth-error" class="hidden" role="alert"></p>
  `
  const mod = await import('../auth-ui.js')
  mapAuthError = mod.mapAuthError
  handleLogin = mod.handleLogin
  handleSignup = mod.handleSignup
  handleGoogleSignIn = mod.handleGoogleSignIn
  handleSendCode = mod.handleSendCode
  handleVerifyCode = mod.handleVerifyCode
  handlePhoneSignupConsent = mod.handlePhoneSignupConsent
  setView = mod.setView
})

describe('mapAuthError', () => {
  it('maps email-already-in-use to a clear Spanish message', () => {
    expect(mapAuthError('auth/email-already-in-use')).toBe('Ya existe una cuenta con ese correo.')
  })

  it('maps wrong-password, user-not-found and invalid-credential to the SAME generic message (hallazgo de seguridad: evita enumeración de cuentas — antes revelaban si un correo estaba registrado)', () => {
    const generic = 'Correo o contraseña incorrectos.'
    expect(mapAuthError('auth/wrong-password')).toBe(generic)
    expect(mapAuthError('auth/user-not-found')).toBe(generic)
    expect(mapAuthError('auth/invalid-credential')).toBe(generic)
  })

  it('maps common real-world Firebase Auth codes a Mexican user will actually trigger (hallazgo UX)', () => {
    expect(mapAuthError('auth/too-many-requests')).toBe('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.')
    expect(mapAuthError('auth/network-request-failed')).toBe('Sin conexión a internet. Revisa tu red e inténtalo de nuevo.')
    expect(mapAuthError('auth/popup-blocked')).toBe('Tu navegador bloqueó la ventana de Google. Habilítala e inténtalo de nuevo.')
    expect(mapAuthError('auth/account-exists-with-different-credential')).toBe('Ya tienes una cuenta con ese correo usando otro método de acceso (ej. Google). Usa ese método para entrar.')
  })

  it('falls back to a generic message for unknown codes', () => {
    expect(mapAuthError('auth/some-unknown-code')).toBe('Ocurrió un error. Intenta de nuevo.')
  })
})

describe('handleLogin', () => {
  it('calls signInWithEmailAndPassword with the firebaseAuth instance and credentials', async () => {
    signInWithEmailAndPassword.mockResolvedValueOnce({ user: { uid: 'abc' } })
    await handleLogin('test@example.com', 'secret123')
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(mockAuth, 'test@example.com', 'secret123')
  })

  it('shows a mapped error message and re-throws when sign-in fails', async () => {
    signInWithEmailAndPassword.mockRejectedValueOnce({ code: 'auth/wrong-password' })
    await expect(handleLogin('test@example.com', 'bad')).rejects.toBeTruthy()
    const errEl = document.getElementById('auth-error')
    expect(errEl.textContent).toBe('Correo o contraseña incorrectos.')
    expect(errEl.classList.contains('hidden')).toBe(false)
  })

  it('disables the submit button while the request is in flight and re-enables it after (hallazgo UX: sin esto el botón "se congela" sin feedback)', async () => {
    let resolveSignIn
    signInWithEmailAndPassword.mockReturnValueOnce(new Promise(resolve => { resolveSignIn = resolve }))
    const btn = document.getElementById('btn-login')
    const promise = handleLogin('test@example.com', 'secret123')
    expect(btn.disabled).toBe(true)
    resolveSignIn({ user: { uid: 'abc' } })
    await promise
    expect(btn.disabled).toBe(false)
  })
})

describe('handleSignup', () => {
  it('rechaza si el checkbox de Términos no está marcado (hallazgo legal: no se puede facturar sin evidencia de aceptación)', async () => {
    document.getElementById('age-checkbox').checked = true
    document.getElementById('terms-checkbox').checked = false
    await expect(handleSignup('new@example.com', 'secret123')).rejects.toThrow(/[Tt]érminos/)
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled()
  })

  it('rechaza si el checkbox de mayoría de edad no está marcado', async () => {
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = false
    await expect(handleSignup('new@example.com', 'secret123')).rejects.toThrow(/edad/i)
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled()
  })

  it('crea la cuenta y sincroniza termsAccepted/ageConfirmed a /api/auth/sync cuando ambos checkboxes están marcados', async () => {
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true
    const getIdToken = vi.fn().mockResolvedValue('tok-new')
    createUserWithEmailAndPassword.mockResolvedValueOnce({ user: { uid: 'abc', getIdToken } })

    await handleSignup('new@example.com', 'secret123')

    expect(createUserWithEmailAndPassword).toHaveBeenCalledWith(mockAuth, 'new@example.com', 'secret123')
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-new', 'Content-Type': 'application/json' },
      body: JSON.stringify({ termsAccepted: true, ageConfirmed: true, termsVersion: 'v1' })
    })
  })
})

describe('handleGoogleSignIn', () => {
  it('calls signInWithPopup with the firebaseAuth instance and a GoogleAuthProvider', async () => {
    signInWithPopup.mockResolvedValueOnce({ user: { uid: 'abc' } })
    await handleGoogleSignIn()
    expect(signInWithPopup).toHaveBeenCalledTimes(1)
    expect(signInWithPopup.mock.calls[0][0]).toBe(mockAuth)
    expect(signInWithPopup.mock.calls[0][1]).toBeInstanceOf(GoogleAuthProvider)
  })

  it('shows a mapped error when the popup is closed by the user', async () => {
    signInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-closed-by-user' })
    await expect(handleGoogleSignIn()).rejects.toBeTruthy()
    expect(document.getElementById('auth-error').textContent).toBe('Se cerró la ventana de Google antes de terminar.')
  })
})

describe('mapAuthError — phone codes (Twilio backend)', () => {
  it('maps the backend error codes returned by /api/auth/phone/send and /verify', () => {
    expect(mapAuthError('invalid_phone')).toBe('Número de teléfono inválido.')
    expect(mapAuthError('send_failed')).toBe('No se pudo enviar el código. Intenta más tarde.')
    expect(mapAuthError('invalid_code')).toBe('Código incorrecto o expirado.')
    expect(mapAuthError('verify_failed')).toBe('Ocurrió un error al verificar tu código. Intenta de nuevo.')
  })
})

describe('setView', () => {
  it('shows only #login-view by default', () => {
    setView('login')
    expect(document.getElementById('login-view').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('phone-code-step').classList.contains('hidden')).toBe(true)
  })

  it('shows only #phone-step for "phone-number"', () => {
    setView('phone-number')
    expect(document.getElementById('login-view').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('phone-code-step').classList.contains('hidden')).toBe(true)
  })

  it('shows only #phone-code-step for "phone-code"', () => {
    setView('phone-code')
    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('phone-code-step').classList.contains('hidden')).toBe(false)
  })

  it('shows #signup-only for "phone-consent"', () => {
    setView('phone-consent')
    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('login-view').classList.contains('hidden')).toBe(true)
  })
})

describe('handleSendCode', () => {
  it('POSTs the concatenated dial code + digits to /api/auth/phone/send and moves to phone-code view', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'pending' }) })
    await handleSendCode('+52', '55 1234 5678')
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/phone/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+525512345678' })
    })
    expect(document.getElementById('phone-code-step').classList.contains('hidden')).toBe(false)
  })

  it('shows a mapped error and stays on the phone-number view when the backend rejects the phone', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'invalid_phone' }) })
    await handleSendCode('+52', 'abc')
    expect(document.getElementById('auth-error').textContent).toBe('Número de teléfono inválido.')
    expect(document.getElementById('phone-code-step').classList.contains('hidden')).toBe(true)
  })

  it('shows a generic error when the fetch itself throws (network failure)', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('offline'))
    await handleSendCode('+52', '5512345678')
    expect(document.getElementById('auth-error').textContent).toBe('Ocurrió un error. Intenta de nuevo.')
  })
})

describe('module load — auto-sync suppression', () => {
  it('suprime el auto-sync genérico de authClient.js apenas se carga el módulo, para TODOS los flujos de esta página (hallazgo de revisión del plan: importar authClient.js activaba su listener por primera vez en auth.html)', () => {
    expect(setAutoSyncSuppressed).toHaveBeenCalledWith(true)
  })
})

describe('handleVerifyCode', () => {
  async function sendThenVerify(verifyResponse) {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'pending' }) })
      .mockResolvedValueOnce(verifyResponse)
    await handleSendCode('+52', '5512345678')
    await handleVerifyCode('123456')
  }

  it('does not open the consent step for an existing user', async () => {
    signInWithCustomToken.mockResolvedValueOnce({ user: { uid: 'phone:+525512345678' } })
    await sendThenVerify({ ok: true, json: async () => ({ customToken: 'jwt-1', isNewUser: false }) })

    expect(signInWithCustomToken).toHaveBeenCalledWith(mockAuth, 'jwt-1')
    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(true)
  })

  it('shows the consent step (does not redirect yet) for a new user', async () => {
    signInWithCustomToken.mockResolvedValueOnce({ user: { uid: 'phone:+525512345678' } })
    await sendThenVerify({ ok: true, json: async () => ({ customToken: 'jwt-2', isNewUser: true }) })

    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(false)
  })

  it('shows the consent step (fails safe) when isNewUser is ambiguous/undefined', async () => {
    signInWithCustomToken.mockResolvedValueOnce({ user: { uid: 'phone:+525512345678' } })
    await sendThenVerify({ ok: true, json: async () => ({ customToken: 'jwt-3' }) })

    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(false)
  })

  it('shows a mapped error when the code is wrong', async () => {
    await sendThenVerify({ ok: false, json: async () => ({ error: 'invalid_code' }) })

    expect(document.getElementById('auth-error').textContent).toBe('Código incorrecto o expirado.')
    expect(signInWithCustomToken).not.toHaveBeenCalled()
  })

  it('maps signInWithCustomToken failures by their Firebase error code (hallazgo de revisión: un catch sin err perdía el mapeo específico, ej. sin conexión)', async () => {
    signInWithCustomToken.mockRejectedValueOnce({ code: 'auth/network-request-failed' })
    await sendThenVerify({ ok: true, json: async () => ({ customToken: 'jwt-4', isNewUser: false }) })

    expect(document.getElementById('auth-error').textContent).toBe('Sin conexión a internet. Revisa tu red e inténtalo de nuevo.')
  })
})

describe('handlePhoneSignupConsent', () => {
  async function arriveAtConsentStep() {
    const getIdToken = vi.fn().mockResolvedValue('tok-phone-new')
    signInWithCustomToken.mockResolvedValueOnce({ user: { uid: 'phone:+525512345678', getIdToken } })
    mockAuth.currentUser = { getIdToken }
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'pending' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ customToken: 'jwt-new', isNewUser: true }) })
    await handleSendCode('+52', '5512345678')
    await handleVerifyCode('123456')
    return getIdToken
  }

  it('rechaza si los checkboxes no están marcados', async () => {
    await arriveAtConsentStep()
    document.getElementById('terms-checkbox').checked = false
    document.getElementById('age-checkbox').checked = false
    await handlePhoneSignupConsent()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/auth/sync', expect.anything())
  })

  it('sincroniza con termsAccepted/ageConfirmed y redirige cuando ambos checkboxes están marcados', async () => {
    const getIdToken = await arriveAtConsentStep()
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true })

    await handlePhoneSignupConsent()

    expect(getIdToken).toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-phone-new', 'Content-Type': 'application/json' },
      body: JSON.stringify({ termsAccepted: true, ageConfirmed: true, termsVersion: 'v1' })
    })
  })

  it('deshabilita el botón de confirmar mientras la petición está en curso', async () => {
    await arriveAtConsentStep()
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true
    let resolveFetch
    global.fetch = vi.fn().mockReturnValueOnce(new Promise(r => { resolveFetch = r }))
    const btn = document.getElementById('btn-phone-consent-confirm')
    const promise = handlePhoneSignupConsent()
    expect(btn.disabled).toBe(true)
    resolveFetch({ ok: true })
    await promise
    expect(btn.disabled).toBe(false)
  })

  it('muestra un error y no revienta si el sync responde con !res.ok', async () => {
    await arriveAtConsentStep()
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false })

    await expect(handlePhoneSignupConsent()).resolves.toBeUndefined()

    expect(document.getElementById('auth-error').textContent).toBe('Ocurrió un error. Intenta de nuevo.')
  })

  it('muestra un error mapeado (sin throw) si falla el fetch de sync', async () => {
    await arriveAtConsentStep()
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true
    global.fetch = vi.fn().mockRejectedValueOnce({ code: 'auth/network-request-failed' })

    await expect(handlePhoneSignupConsent()).resolves.toBeUndefined()

    expect(document.getElementById('auth-error').textContent).toBe('Sin conexión a internet. Revisa tu red e inténtalo de nuevo.')
  })
})

describe('phone-step wiring (DOMContentLoaded)', () => {
  beforeEach(() => {
    document.dispatchEvent(new Event('DOMContentLoaded'))
  })

  it('populates #phone-country from COUNTRY_CODES with México first/selected', () => {
    const select = document.getElementById('phone-country')
    expect(select.options.length).toBe(2)
    expect(select.options[0].value).toBe('+52')
    expect(select.value).toBe('+52')
  })

  it('#btn-phone switches to the phone-number view', () => {
    document.getElementById('btn-phone').click()
    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(false)
  })

  it('#btn-phone exits any in-progress email signup mode first (hallazgo de revisión: sin esto, los checkboxes de Términos del signup por correo abandonado quedan visibles junto a la UI de teléfono)', () => {
    document.getElementById('btn-signup').click()
    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(false)

    document.getElementById('btn-phone').click()

    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('auth-heading-title').textContent).toBe('Inicia sesión')
  })

  it('#btn-phone-cancel returns to the login view', () => {
    document.getElementById('btn-phone').click()
    document.getElementById('btn-phone-cancel').click()
    expect(document.getElementById('login-view').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(true)
  })
})

describe('signup-mode toggle (hallazgos #1, #2, #14: btn-login robaba el Enter en modo signup y no había forma de volver a login)', () => {
  beforeEach(() => {
    document.dispatchEvent(new Event('DOMContentLoaded'))
  })

  it('entering signup mode hides btn-login (its only type="submit") and reveals the back-to-login link', () => {
    document.getElementById('btn-signup').click()
    expect(document.getElementById('btn-login').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('btn-back-to-login').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('auth-heading-title').textContent).toBe('Crea tu cuenta')
  })

  it('clicking the back-to-login link restores login mode', () => {
    document.getElementById('btn-signup').click()
    document.getElementById('btn-back-to-login').click()
    expect(document.getElementById('btn-login').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('btn-back-to-login').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('auth-heading-title').textContent).toBe('Inicia sesión')
    expect(document.getElementById('btn-signup').textContent).toBe('Crear cuenta')
  })
})

describe('password toggle aria-label (hallazgo #12)', () => {
  beforeEach(() => {
    document.dispatchEvent(new Event('DOMContentLoaded'))
  })

  it('updates aria-label along with the text content when toggled', () => {
    const btn = document.getElementById('btn-toggle-password')
    btn.click()
    expect(btn.textContent).toBe('Ocultar')
    expect(btn.getAttribute('aria-label')).toBe('Ocultar contraseña')
    btn.click()
    expect(btn.textContent).toBe('Ver')
    expect(btn.getAttribute('aria-label')).toBe('Mostrar contraseña')
  })
})

describe('login submit validation (hallazgo #13)', () => {
  beforeEach(() => {
    document.dispatchEvent(new Event('DOMContentLoaded'))
  })

  it('does not call handleLogin/signInWithEmailAndPassword when required fields are invalid', () => {
    const form = document.getElementById('login-form')
    form.reportValidity = () => false
    document.getElementById('login-email').value = ''
    document.getElementById('login-password').value = ''
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled()
  })
})
```

**Nota importante sobre por qué el archivo puede reordenarse así (hallazgo de revisión — la explicación original era imprecisa):** el archivo actual trae un comentario que dice "estos tests van al final porque los describes de arriba no disparan `DOMContentLoaded`". Eso es cierto pero no es el invariante real. Cada `describe` cuyo `beforeEach` hace `document.dispatchEvent(new Event('DOMContentLoaded'))` re-dispara TODOS los listeners de `DOMContentLoaded` acumulados en `document` desde el inicio del archivo (uno por cada `import('../auth-ui.js')` de un test anterior — jsdom nunca los limpia). El test `'password toggle aria-label'` es sensible a la PARIDAD de esa cuenta (par = el toggle queda pegado, impar = funciona) — lo que importa es cuántos tests con IMPORT del módulo corrieron ANTES de él, no si los describes intermedios disparan o no el evento. Este plan agrega 4 tests nuevos antes de ese punto (uno en `handleSendCode`, uno en `handleVerifyCode` para el fix de `err.code`, y ninguno neto en `handlePhoneSignupConsent` — ya traía 5, sigue con 5) — un número par, así que la paridad total se preserva y el archivo de arriba (reescrito completo, tal cual aparece en este Step 1) ya quedó verificado con el conteo correcto. Si en el futuro se agrega o quita un test ANTES de `describe('password toggle aria-label', ...)`, hay que verificar la paridad total, no si el describe recién tocado dispara el evento.

- [ ] **Step 2: Corre el test y verifica que falla**

Run: `npx vitest run tests/auth-ui.test.js`
Expected: FAIL — `auth-ui.js` todavía importa `RecaptchaVerifier`/`signInWithPhoneNumber`/`getAdditionalUserInfo` (no existen en el mock nuevo) y usa fns que ya no calzan con los tests reescritos.

- [ ] **Step 3: Reescribe `auth-ui.js`**

Reemplaza el import (líneas 1-10):

```js
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
```

Reemplaza `AUTH_ERROR_MESSAGES` (líneas 36-55) por:

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
  'invalid_phone': 'Número de teléfono inválido.',
  'send_failed': 'No se pudo enviar el código. Intenta más tarde.',
  'invalid_code': 'Código incorrecto o expirado.',
  'verify_failed': 'Ocurrió un error al verificar tu código. Intenta de nuevo.'
};
```

Reemplaza el bloque de estado de teléfono (líneas 88-90):

```js
let recaptchaVerifier = null;
let confirmationResult = null;
let pendingPhoneCredentialResult = null;
```

por:

```js
let pendingPhone = null;
```

Elimina `getRecaptchaVerifier()` (líneas 112-117) por completo.

Reemplaza `clearPhoneFlowState()` (líneas 119-122):

```js
function clearPhoneFlowState() {
  pendingPhone = null;
}
```

Reemplaza `handleSendCode` (líneas 190-205):

```js
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
```

Reemplaza `handleVerifyCode` (líneas 207-228):

```js
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
```

En `handlePhoneSignupConsent` (línea 240), reemplaza:

```js
      const token = await pendingPhoneCredentialResult.user.getIdToken();
```

por:

```js
      const token = await firebaseAuth.currentUser.getIdToken();
```

En el wiring de `DOMContentLoaded`, en `btnPhoneCancel` (líneas 376-384), elimina las 2 líneas de `recaptchaVerifier`:

```js
  if (btnPhoneCancel) {
    btnPhoneCancel.addEventListener('click', () => {
      clearError();
      clearPhoneFlowState();
      setView('login');
    });
  }
```

En `btnVerifyCode` (líneas 385-390) sin cambios.

En `btnResendCode` (líneas 391-399), elimina las 2 líneas de `recaptchaVerifier`:

```js
  if (btnResendCode) {
    btnResendCode.addEventListener('click', () => {
      const dialCode = phoneCountrySelect.value;
      const localNumber = document.getElementById('phone-number').value;
      handleSendCode(dialCode, localNumber);
    });
  }
```

En `btnPhoneCodeBack` (líneas 400-406), elimina la referencia a `confirmationResult`:

```js
  if (btnPhoneCodeBack) {
    btnPhoneCodeBack.addEventListener('click', () => {
      clearError();
      setView('phone-number');
    });
  }
```

- [ ] **Step 4: Corrige un comentario obsoleto en `authClient.js` (sin cambio de lógica)**

`authClient.js` no cambia de comportamiento, pero su comentario junto a `setAutoSyncSuppressed` (línea 54) menciona `confirmationResult.confirm()` — un símbolo que este Task acaba de eliminar por completo de `auth-ui.js`. Reemplaza esa línea:

```js
// Escape hatch para auth.html: motivado por el flujo de teléfono
// (confirmationResult.confirm() dispara este listener ANTES de que el
```

por:

```js
// Escape hatch para auth.html: motivado por el flujo de teléfono
// (signInWithCustomToken() dispara este listener ANTES de que el
```

(El resto del comentario, líneas 55-60, no cambia — la razón de fondo sigue siendo la misma: cualquier sign-in exitoso dispara `onAuthStateChanged` antes de que el usuario nuevo vea el paso de consentimiento.)

- [ ] **Step 5: Corre el test y verifica que pasa**

Run: `npx vitest run tests/auth-ui.test.js`
Expected: PASS (todos los tests)

- [ ] **Step 6: Corre toda la suite para descartar regresiones**

Run: `npx vitest run`
Expected: todos los archivos PASS salvo el fallo pre-existente no relacionado de `tests/e2e/scan-cycle.spec.js`.

- [ ] **Step 7: Commit**

```bash
git add auth-ui.js authClient.js tests/auth-ui.test.js
git commit -m "feat(auth): switch phone login flow to Twilio Verify + signInWithCustomToken

Replaces RecaptchaVerifier/signInWithPhoneNumber/getAdditionalUserInfo
with 2 backend calls (/api/auth/phone/send, /verify) + signInWithCustomToken.
isNewUser now comes from the backend's Firestore check instead of
getAdditionalUserInfo — same fail-safe default (ambiguous/missing treated
as new user). handleVerifyCode's catch now preserves err.code so a real
signInWithCustomToken failure (e.g. network) still shows its specific
mapped message instead of the generic fallback."
```

---

### Task 7: documentar las 3 env vars nuevas de Twilio en README

**Files:**
- Modify: `README.md` (sección "Variables de entorno", línea ~702-729)

**Interfaces:** ninguna (solo documentación).

- [ ] **Step 1: Agrega las 3 variables al bloque de ejemplo**

En `README.md`, dentro del bloque ```env``` de la sección "Variables de entorno" (después de la línea de `FIREBASE_SERVICE_ACCOUNT_KEY`, línea 708), agrega:

```env
# Twilio Verify — envío/verificación de código SMS para login por teléfono
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_VERIFY_SERVICE_SID=VA...
```

Y actualiza la frase de la línea 729 (`Solo GROQ_API_KEY es estrictamente requerida...`) agregando al final:

```
Sin las 3 variables de Twilio, el login por teléfono responde 502 (Twilio Verify no configurado) — el resto de la app (incluyendo email/Google) sigue funcionando normal. `FIREBASE_SERVICE_ACCOUNT_KEY` ahora también se usa para firmar el Firebase custom token del login por teléfono, además de para la caché de Firestore.
```

- [ ] **Step 2: Verifica manualmente**

Run: `grep -n "TWILIO_" README.md`
Expected: 3 líneas nuevas visibles.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Twilio Verify env vars for phone login"
```

---

## Después de completar todas las tareas

1. Corre la suite completa una vez más: `npx vitest run` — debe seguir en verde salvo el fallo pre-existente de Playwright.
2. Revisión final de rama completa (whole-branch review).
3. **Paso manual obligatorio, fuera de este plan**: configurar en Vercel (Preview/develop) las 3 env vars `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` con los valores reales de la cuenta Twilio ya existente, y hacer un smoke-test real con un teléfono de prueba (enviar código, recibir SMS de verdad, verificarlo, confirmar que crea la sesión y el doc en Firestore) antes de mergear a producción — esto no se puede automatizar ni cubrir con los tests de este plan.
