# Cuentas de Usuario + Personalización Premium — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar cuentas de usuario (Firebase Auth) a Yomi con verificación manual de JWT (sin `firebase-admin`), cuota diaria de OCR por usuario, y personalización del veredicto de producto para usuarios premium según sus preferencias dietéticas/alergias/condiciones de salud.

**Architecture:** Firebase Authentication (email/password + Google) en el frontend vía SDK CDN; backend Express verifica el ID token manualmente (RS256, crypto nativo, fail-closed) sin dependencias nuevas; perfil en Firestore `users/{uid}` con campos nativos (no el patrón blob-JSON usado por las funciones de caché existentes); `computeVerdict()` se extiende con un segundo parámetro opcional retrocompatible.

**Tech Stack:** Node/Express (Vercel), Firestore REST API, Firebase JS SDK (CDN), vitest.

## Global Constraints

- Cero dependencias nuevas de npm (nada de `firebase-admin`, `jsonwebtoken`, `supertest`) — todo con `crypto`/`fetch` nativos, siguiendo el patrón ya establecido en `api/firestore.js`.
- `users/{uid}` usa campos Firestore nativos (maps/strings/ints tipados vía `toFirestoreValue`/`fromFirestoreValue`), **no** el patrón blob-JSON-en-un-string-field de `fireSetCache`/`fireSetOcrData`.
- Todo `PATCH` a `users/{uid}` usa `updateMask.fieldPaths` explícito — nunca se acepta/mergea el body crudo del cliente como estado nuevo del doc.
- JWT: `alg` hardcodeado a `RS256` en el código (nunca leído del header del token), `iss` completo (`https://securetoken.google.com/<project-id>`), `aud` = project ID exacto, `sub` no vacío, cache de certs respeta `Cache-Control` de Google, fail-closed en cualquier error.
- Tests siguen el patrón ya usado en el repo: import directo de funciones/handlers exportados + `vi.stubGlobal('fetch', ...)`, sin supertest ni servidor HTTP real.
- Variable de entorno nueva: `FIREBASE_PROJECT_ID` (usada por `requireUser`/`optionalUser`) — debe configurarse en Vercel (Preview branch `develop` → `foodscaner-dev`) antes de probar end-to-end; no es parte del código de ninguna tarea, es config de despliegue.

---

## Backend

### Task 1: Módulo de verificación de JWT (Firebase ID tokens, RS256 fail-closed)

**Files:**
- Create: `api/auth.js`
- Test: `tests/auth.test.js`

**Interfaces:**
- Consumes: nada (módulo base).
- Produces: `verifyFirebaseIdToken(idToken: string, projectId: string): Promise<{uid, email, emailVerified}>` (rechaza/`throw` en cualquier caso inválido — fail-closed); `getGooglePublicKeys(): Promise<JWK[]>`; `_resetJwksCacheForTests()`. Consumido por Task 2 y Task 9.

- [ ] **Step 1: Escribe el test que falla**

```js
// tests/auth.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

const { verifyFirebaseIdToken, _resetJwksCacheForTests } = await import('../api/auth.js')

const PROJECT_ID = 'foodscaner-dev'
const KID = 'test-kid-1'

function b64url(input) {
  return Buffer.from(input).toString('base64url')
}

function signRS256(payloadOverrides, privateKey, headerOverrides = {}) {
  const header = { alg: 'RS256', typ: 'JWT', kid: KID, ...headerOverrides }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: 'user-123',
    iat: now,
    exp: now + 3600,
    email: 'user@example.com',
    email_verified: true,
    ...payloadOverrides
  }
  const headerB64 = b64url(JSON.stringify(header))
  const payloadB64 = b64url(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey)
  return `${signingInput}.${signature.toString('base64url')}`
}

describe('verifyFirebaseIdToken', () => {
  let privateKey, jwk

  beforeEach(() => {
    _resetJwksCacheForTests()
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    privateKey = keyPair.privateKey
    jwk = keyPair.publicKey.export({ format: 'jwk' })
    jwk.kid = KID
    jwk.alg = 'RS256'
    jwk.use = 'sig'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockJwks(keys, cacheControl = 'public, max-age=21600') {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (name) => (name.toLowerCase() === 'cache-control' ? cacheControl : null) },
      json: async () => ({ keys: keys || [jwk] })
    }))
  }

  it('accepts a validly signed token and returns {uid, email, emailVerified}', async () => {
    mockJwks()
    const token = signRS256({}, privateKey)
    const result = await verifyFirebaseIdToken(token, PROJECT_ID)
    expect(result).toEqual({ uid: 'user-123', email: 'user@example.com', emailVerified: true })
  })

  it('rejects an expired token', async () => {
    mockJwks()
    const token = signRS256({ exp: Math.floor(Date.now() / 1000) - 10 }, privateKey)
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow()
  })

  it('rejects a token with the wrong aud (cross-project token)', async () => {
    mockJwks()
    const token = signRS256({ aud: 'other-project' }, privateKey)
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow()
  })

  it('rejects a token whose iss is only the bare project id (must be the full URL)', async () => {
    mockJwks()
    const token = signRS256({ iss: PROJECT_ID }, privateKey)
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow()
  })

  it('rejects a token with an empty sub', async () => {
    mockJwks()
    const token = signRS256({ sub: '' }, privateKey)
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow()
  })

  it('rejects an algorithm-confusion attack (alg:HS256 signed with the RSA public key as HMAC secret)', async () => {
    mockJwks()
    const header = { alg: 'HS256', typ: 'JWT', kid: KID }
    const now = Math.floor(Date.now() / 1000)
    const payload = {
      iss: `https://securetoken.google.com/${PROJECT_ID}`, aud: PROJECT_ID,
      sub: 'attacker', iat: now, exp: now + 3600
    }
    const headerB64 = b64url(JSON.stringify(header))
    const payloadB64 = b64url(JSON.stringify(payload))
    const signingInput = `${headerB64}.${payloadB64}`
    const publicKeyPem = crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' })
    const hmacSig = crypto.createHmac('sha256', publicKeyPem).update(signingInput).digest('base64url')
    const forgedToken = `${signingInput}.${hmacSig}`

    await expect(verifyFirebaseIdToken(forgedToken, PROJECT_ID)).rejects.toThrow(/Algoritmo no soportado/)
  })

  it('rejects a token with a tampered payload (signature no longer matches)', async () => {
    mockJwks()
    const token = signRS256({}, privateKey)
    const [headerB64, , sigB64] = token.split('.')
    const tamperedPayloadB64 = b64url(JSON.stringify({
      iss: `https://securetoken.google.com/${PROJECT_ID}`, aud: PROJECT_ID,
      sub: 'attacker', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600
    }))
    const tamperedToken = `${headerB64}.${tamperedPayloadB64}.${sigB64}`
    await expect(verifyFirebaseIdToken(tamperedToken, PROJECT_ID)).rejects.toThrow()
  })

  it('fails closed when fetching Google public keys throws (network error/timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const token = signRS256({}, privateKey)
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow()
  })

  it('fails closed when the Google JWKS endpoint responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, headers: { get: () => null } }))
    const token = signRS256({}, privateKey)
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow()
  })

  it('respects Cache-Control max-age and does not re-fetch keys within the TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (name) => (name.toLowerCase() === 'cache-control' ? 'public, max-age=21600' : null) },
      json: async () => ({ keys: [jwk] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const token1 = signRS256({}, privateKey)
    const token2 = signRS256({ sub: 'user-456' }, privateKey)
    await verifyFirebaseIdToken(token1, PROJECT_ID)
    await verifyFirebaseIdToken(token2, PROJECT_ID)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/auth.test.js`
Expected: `Error: Failed to resolve import "../api/auth.js" from "tests/auth.test.js". Does the file exist?`

- [ ] **Step 3: Implementación mínima**

```js
// api/auth.js
// Verificación de Firebase ID tokens (JWT RS256) sin firebase-admin — solo crypto nativo + fetch.
const crypto = require('crypto');

// Endpoint JWKS de Google para las llaves de firma de Firebase Auth (formato JWK — misma
// llave de firma que el endpoint X.509 legacy, pero verificable sin parsear certificados).
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// Hardcodeado — NUNCA leer el algoritmo del header del propio token. Si se leyera de ahí,
// un atacante podría mandar alg:"HS256" y firmar con la llave pública de Google (que es
// pública) como si fuera un secreto HMAC, logrando bypass total (algorithm confusion attack).
const REQUIRED_ALG = 'RS256';

let _jwksCache = { keys: null, expiresAt: 0 };

function base64UrlJsonDecode(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function parseMaxAgeSeconds(cacheControlHeader) {
  if (!cacheControlHeader) return 0;
  const match = cacheControlHeader.match(/max-age=(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

async function getGooglePublicKeys() {
  if (_jwksCache.keys && Date.now() < _jwksCache.expiresAt) {
    return _jwksCache.keys;
  }
  // Fail-closed: cualquier error de red/timeout se propaga (throw), nunca se cae a
  // "sin llaves = dejar pasar".
  const resp = await fetch(JWKS_URL, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) throw new Error(`No se pudieron obtener las llaves públicas de Google (status ${resp.status})`);
  const data = await resp.json();
  if (!data || !Array.isArray(data.keys) || data.keys.length === 0) {
    throw new Error('Respuesta de JWKS inválida o vacía');
  }
  // Respeta el TTL real que Google declara — nunca un TTL propio inventado.
  const maxAgeSeconds = parseMaxAgeSeconds(resp.headers.get('cache-control'));
  _jwksCache = { keys: data.keys, expiresAt: Date.now() + Math.max(0, maxAgeSeconds) * 1000 };
  return data.keys;
}

async function verifyFirebaseIdToken(idToken, projectId) {
  if (!idToken || typeof idToken !== 'string') throw new Error('Token ausente');
  if (!projectId) throw new Error('projectId requerido para verificar aud/iss');

  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Formato de token inválido');
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = base64UrlJsonDecode(headerB64);
    payload = base64UrlJsonDecode(payloadB64);
  } catch {
    throw new Error('No se pudo parsear el header/payload del token');
  }

  if (header.alg !== REQUIRED_ALG) {
    throw new Error(`Algoritmo no soportado: se requiere ${REQUIRED_ALG}`);
  }
  if (!header.kid) throw new Error('Token sin kid');

  const keys = await getGooglePublicKeys(); // si falla, se propaga → 401 fail-closed en requireUser
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('No se encontró la llave pública para el kid del token');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signingInput = Buffer.from(headerB64 + '.' + payloadB64);
  const signature = Buffer.from(sigB64, 'base64url');
  const validSignature = crypto.verify('RSA-SHA256', signingInput, publicKey, signature);
  if (!validSignature) throw new Error('Firma inválida');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('Token expirado');
  if (typeof payload.iat !== 'number' || payload.iat > now + 60) throw new Error('Token emitido en el futuro (iat inválido)');

  const expectedIss = `https://securetoken.google.com/${projectId}`;
  if (payload.iss !== expectedIss) throw new Error('Issuer inválido');
  if (payload.aud !== projectId) throw new Error('Audience inválido');
  if (typeof payload.sub !== 'string' || payload.sub.trim() === '') throw new Error('Subject (sub) vacío o ausente');

  return { uid: payload.sub, email: payload.email || null, emailVerified: !!payload.email_verified };
}

function _resetJwksCacheForTests() {
  _jwksCache = { keys: null, expiresAt: 0 };
}

module.exports = { verifyFirebaseIdToken, getGooglePublicKeys, _resetJwksCacheForTests };
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/auth.test.js`
Expected: `Test Files 1 passed (1)`, `Tests 10 passed (10)`

- [ ] **Step 5: Commit**

```bash
git add api/auth.js tests/auth.test.js
git commit -m "feat(auth): add Firebase ID token verification module (RS256 hardcoded, fail-closed)"
```

---

### Task 2: Middleware `requireUser`

**Files:**
- Modify: `api/index.js:7` (agregar require), `api/index.js:43-70` (nueva sección, después del rate limiter), `api/index.js:1466` (module.exports)
- Test: `tests/requireUser.test.js`

**Interfaces:**
- Consumes: `verifyFirebaseIdToken(idToken, projectId)` de `api/auth.js` (Task 1).
- Produces: `requireUser(req, res, next)` — adjunta `req.user = {uid, email, emailVerified}`, 401 si inválido, 503 si `FIREBASE_PROJECT_ID` no está configurado. Exportado como `module.exports.requireUser`. Consumido por Tasks 4-7. `emailVerified` se incluye aquí (no solo en `verifyFirebaseIdToken`) porque Task 9 lo necesita vía `req.user`.

- [ ] **Step 1: Escribe el test que falla**

```js
// tests/requireUser.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../api/auth.js', () => ({
  verifyFirebaseIdToken: vi.fn()
}))

const { requireUser } = await import('../api/index.js')
const { verifyFirebaseIdToken } = await import('../api/auth.js')

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('requireUser', () => {
  const ORIGINAL_PROJECT_ID = process.env.FIREBASE_PROJECT_ID

  beforeEach(() => {
    verifyFirebaseIdToken.mockReset()
    process.env.FIREBASE_PROJECT_ID = 'foodscaner-dev'
  })

  afterEach(() => {
    process.env.FIREBASE_PROJECT_ID = ORIGINAL_PROJECT_ID
  })

  it('attaches req.user = {uid, email, emailVerified} and calls next() on a valid token', async () => {
    verifyFirebaseIdToken.mockResolvedValue({ uid: 'user-123', email: 'user@example.com', emailVerified: true })
    const req = { get: (name) => (name.toLowerCase() === 'authorization' ? 'Bearer valid-token' : undefined) }
    const res = makeRes()
    const next = vi.fn()

    await requireUser(req, res, next)

    expect(req.user).toEqual({ uid: 'user-123', email: 'user@example.com', emailVerified: true })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('responds 401 when there is no Authorization header', async () => {
    const req = { get: () => undefined }
    const res = makeRes()
    const next = vi.fn()

    await requireUser(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'unauthorized' })
    expect(next).not.toHaveBeenCalled()
  })

  it('responds 401 when the Authorization header is not Bearer', async () => {
    const req = { get: (name) => (name.toLowerCase() === 'authorization' ? 'Basic abc123' : undefined) }
    const res = makeRes()
    const next = vi.fn()

    await requireUser(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('responds 401 when verifyFirebaseIdToken rejects (invalid/expired token)', async () => {
    verifyFirebaseIdToken.mockRejectedValue(new Error('Token expirado'))
    const req = { get: (name) => (name.toLowerCase() === 'authorization' ? 'Bearer expired-token' : undefined) }
    const res = makeRes()
    const next = vi.fn()

    await requireUser(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'unauthorized' })
    expect(next).not.toHaveBeenCalled()
  })

  it('responds 503 when FIREBASE_PROJECT_ID is not configured', async () => {
    delete process.env.FIREBASE_PROJECT_ID
    const req = { get: (name) => (name.toLowerCase() === 'authorization' ? 'Bearer valid-token' : undefined) }
    const res = makeRes()
    const next = vi.fn()

    await requireUser(req, res, next)

    expect(res.statusCode).toBe(503)
    expect(next).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/requireUser.test.js`
Expected: `TypeError: requireUser is not a function`

- [ ] **Step 3: Implementación mínima**

En `api/index.js:7`, agregar debajo del require existente de `./firestore`:

```js
const { verifyFirebaseIdToken } = require('./auth');
```

En `api/index.js`, después de la sección del rate limiter (línea ~43), nueva sección:

```js
// --- Auth Middleware (Firebase ID token, verificación manual sin firebase-admin) ---
async function requireUser(req, res, next) {
  try {
    const authHeader = req.get('authorization') || req.get('Authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!match) return res.status(401).json({ error: 'unauthorized' });

    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (!projectId) return res.status(503).json({ error: 'auth_not_configured' });

    const { uid, email, emailVerified } = await verifyFirebaseIdToken(match[1], projectId);
    req.user = { uid, email, emailVerified };
    next();
  } catch (e) {
    // Fail-closed: cualquier error (token inválido, expirado, certs de Google
    // inalcanzables) resulta en 401, nunca en dejar pasar la petición.
    return res.status(401).json({ error: 'unauthorized' });
  }
}
```

Al final del archivo, junto a los demás exports de funciones (línea ~1467):

```js
module.exports.requireUser = requireUser;
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/requireUser.test.js`
Expected: `Test Files 1 passed (1)`, `Tests 5 passed (5)`

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/requireUser.test.js
git commit -m "feat(auth): add requireUser middleware backed by verifyFirebaseIdToken"
```

---

### Task 3: Capa de datos Firestore para `users/{uid}` (campos nativos)

**Files:**
- Modify: `api/firestore.js:410-418` (nuevas funciones antes de `module.exports`, y actualización del propio `module.exports`)
- Test: `tests/firestore-users.test.js`

**Interfaces:**
- Consumes: `getAccessToken()`, `docPath(col, id)` (ya existentes en `api/firestore.js`).
- Produces: `fireGetUser(uid): Promise<object|null>`, `fireUpsertUser(uid, data): Promise<{created: boolean}>`, `firePatchUserFields(uid, fieldPaths: string[], data: object): Promise<true>`, y las funciones internas `toFirestoreValue`/`toFirestoreFields`/`fromFirestoreValue`/`fromFirestoreFields` (no exportadas, pero reutilizadas por Task 8). Consumido por Tasks 4-9.

- [ ] **Step 1: Escribe el test que falla**

```js
// tests/firestore-users.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import crypto from 'crypto'

const { fireGetUser, fireUpsertUser, firePatchUserFields } = await import('../api/firestore.js')

function buildFetchMock(userDocHandler) {
  return vi.fn(async (url, options = {}) => {
    if (url.includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'fake-access-token', expires_in: 3600 }) }
    }
    return userDocHandler(url, options)
  })
}

function fakeServiceAccountKey() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  })
  return JSON.stringify({
    project_id: 'foodscaner-test',
    client_email: 'test@foodscaner-test.iam.gserviceaccount.com',
    private_key: privateKey
  })
}

describe('users/{uid} data layer', () => {
  const ORIGINAL_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = ORIGINAL_KEY
  })

  it('fireGetUser returns null when the document does not exist (404)', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({ status: 404, ok: false })))
    const result = await fireGetUser('uid-does-not-exist')
    expect(result).toBeNull()
  })

  it('fireGetUser converts native Firestore fields into a plain object', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        fields: {
          email: { stringValue: 'user@example.com' },
          emailVerified: { booleanValue: true },
          plan: { stringValue: 'free' },
          providers: { arrayValue: { values: [{ stringValue: 'password' }] } },
          usage: { mapValue: { fields: {
            date: { stringValue: '2026-07-15' },
            ocrCount: { integerValue: '2' },
            cacheRefreshCount: { integerValue: '0' }
          } } }
        }
      })
    })))
    const result = await fireGetUser('uid-123')
    expect(result).toEqual({
      email: 'user@example.com',
      emailVerified: true,
      plan: 'free',
      providers: ['password'],
      usage: { date: '2026-07-15', ocrCount: 2, cacheRefreshCount: 0 }
    })
  })

  it('fireUpsertUser creates a new doc with plan:"free" when none exists (no updateMask — creación completa)', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    const patchCalls = []
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) return { status: 404, ok: false }
      patchCalls.push({ url, body: JSON.parse(options.body) })
      return { ok: true, status: 200 }
    }))

    await fireUpsertUser('uid-new', { email: 'new@example.com', providers: ['password'] })

    expect(patchCalls.length).toBe(1)
    expect(patchCalls[0].url).not.toContain('updateMask')
    expect(patchCalls[0].body.fields.plan.stringValue).toBe('free')
    expect(patchCalls[0].body.fields.usage.mapValue.fields.ocrCount.integerValue).toBe('0')
    expect(patchCalls[0].body.fields.billing.mapValue.fields.isFounderPricing.booleanValue).toBe(false)
    expect(patchCalls[0].body.fields.billing.mapValue.fields.billingCycle).toEqual({ nullValue: null })
  })

  it('fireUpsertUser only updates lastLoginAt/providers when the doc already exists', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    const patchCalls = []
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return { ok: true, status: 200, json: async () => ({ fields: { plan: { stringValue: 'premium' } } }) }
      }
      patchCalls.push({ url, body: JSON.parse(options.body) })
      return { ok: true, status: 200 }
    }))

    await fireUpsertUser('uid-existing', { providers: ['password', 'google.com'] })

    expect(patchCalls.length).toBe(1)
    expect(patchCalls[0].url).toContain('updateMask.fieldPaths=lastLoginAt')
    expect(patchCalls[0].url).toContain('updateMask.fieldPaths=providers')
    expect(patchCalls[0].body.fields.plan).toBeUndefined()
  })

  it('firePatchUserFields sends an explicit updateMask.fieldPaths for only the given fields', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedUrl, capturedBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      capturedUrl = url
      capturedBody = JSON.parse(options.body)
      return { ok: true, status: 200 }
    }))

    await firePatchUserFields('uid-1', ['dietary', 'allergens', 'healthConditions'], {
      dietary: ['vegan'],
      allergens: [{ code: 'cacahuate', severity: 'severe' }],
      healthConditions: ['diabet']
    })

    expect(capturedUrl).toContain('updateMask.fieldPaths=dietary')
    expect(capturedUrl).toContain('updateMask.fieldPaths=allergens')
    expect(capturedUrl).toContain('updateMask.fieldPaths=healthConditions')
    expect(capturedBody.fields.dietary.arrayValue.values[0].stringValue).toBe('vegan')
    expect(capturedBody.fields.allergens.arrayValue.values[0].mapValue.fields.code.stringValue).toBe('cacahuate')
  })

  it('firePatchUserFields deletes a field when omitted from data but present in fieldPaths', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedUrl, capturedBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      capturedUrl = url
      capturedBody = JSON.parse(options.body)
      return { ok: true, status: 200 }
    }))

    await firePatchUserFields('uid-1', ['preferences'], {})

    expect(capturedUrl).toContain('updateMask.fieldPaths=preferences')
    expect(capturedBody.fields).toEqual({})
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/firestore-users.test.js`
Expected: `TypeError: fireGetUser is not a function`

- [ ] **Step 3: Implementación mínima**

En `api/firestore.js`, antes de `module.exports` (línea ~412):

```js
// --- Field conversion helpers: objeto JS <-> tipos nativos de Firestore ---
// A diferencia de fireSetCache/fireSetOcrData (blob _data.stringValue), users/{uid} usa
// campos nativos tipados para permitir updateMask.fieldPaths granular (ver PUT /preferences).
function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFirestoreFields(v) } };
  throw new Error(`Tipo no soportado para Firestore: ${typeof v}`);
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFirestoreValue(v);
  return fields;
}

function fromFirestoreValue(v) {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in v) return fromFirestoreFields(v.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields || {})) obj[k] = fromFirestoreValue(v);
  return obj;
}

// --- users/{uid}: perfil de cuenta, campos nativos (no blob _data) ---
async function fireGetUser(uid) {
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const resp = await fetch(docPath('users', uid), {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(5000)
    });
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    const data = await resp.json();
    return fromFirestoreFields(data.fields || {});
  } catch (e) {
    console.warn('[Firestore] getUser error, uid:', uid, e.message);
    return null;
  }
}

async function fireUpsertUser(uid, data) {
  const token = await getAccessToken();
  if (!token) throw new Error('No Firestore access token');
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  const existingResp = await fetch(docPath('users', uid), {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(5000)
  });

  if (existingResp.status === 404) {
    const fields = toFirestoreFields({
      email: data.email || null,
      emailVerified: !!data.emailVerified,
      displayName: data.displayName || null,
      photoURL: data.photoURL || null,
      providers: data.providers || [],
      createdAt: nowIso,
      lastLoginAt: nowIso,
      disabled: false,
      plan: 'free',
      planUpdatedAt: nowIso,
      // Evidencia de aceptación de Términos/edad (hallazgo de revisión legal —
      // no se puede facturar una suscripción sin esto). Se capturan en el
      // checkbox de signup (Task 11) y se registran aquí, solo en la creación,
      // como termsAcceptedAt/ageConfirmedAt/termsVersion.
      termsAcceptedAt: data.termsAccepted ? nowIso : null,
      termsVersion: data.termsAccepted ? (data.termsVersion || 'v1') : null,
      ageConfirmedAt: data.ageConfirmed ? nowIso : null,
      billing: {
        stripeCustomerId: null, subscriptionId: null,
        subscriptionStatus: null, currentPeriodEnd: null,
        isFounderPricing: false, billingCycle: null
      },
      usage: { date: today, ocrCount: 0, cacheRefreshCount: 0 }
    });
    const resp = await fetch(docPath('users', uid), {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
      signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) throw new Error(`Firestore create user failed: ${resp.status}`);
    return { created: true };
  }

  if (!existingResp.ok) throw new Error(`Firestore get user failed: ${existingResp.status}`);

  const mask = '?updateMask.fieldPaths=lastLoginAt&updateMask.fieldPaths=providers';
  const fields = toFirestoreFields({ lastLoginAt: nowIso, providers: data.providers || [] });
  const resp = await fetch(docPath('users', uid) + mask, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(5000)
  });
  if (!resp.ok) throw new Error(`Firestore update user failed: ${resp.status}`);
  return { created: false };
}

async function firePatchUserFields(uid, fieldPaths, data) {
  const token = await getAccessToken();
  if (!token) throw new Error('No Firestore access token');
  const mask = fieldPaths.map(fp => `updateMask.fieldPaths=${encodeURIComponent(fp)}`).join('&');
  const fields = toFirestoreFields(data);
  const resp = await fetch(docPath('users', uid) + '?' + mask, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(5000)
  });
  if (!resp.ok) throw new Error(`Firestore patch user fields failed: ${resp.status}`);
  return true;
}
```

Actualizar `module.exports` (línea ~412-418):

```js
module.exports = {
  getAccessToken,
  fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache,
  fireGetOcrData, fireSetOcrData,
  fireGetNutritionOcr, fireSetNutritionOcr,
  fireListDocs, fireListAll, fireDeleteDoc, fireLogScan, fireMarkScanNotFound, fireMarkScanHasOcr, fireMarkScanHasNutrition, fireMarkScanConfidence, fireMarkScanSource, fireMarkScanSources, fireLogReport, ADMIN_COLLECTIONS,
  fireGetUser, fireUpsertUser, firePatchUserFields
};
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/firestore-users.test.js`
Expected: `Test Files 1 passed (1)`, `Tests 6 passed (6)`

- [ ] **Step 5: Commit**

```bash
git add api/firestore.js tests/firestore-users.test.js
git commit -m "feat(firestore): add users/{uid} data layer with native fields and explicit updateMask"
```

---

### Task 4: `POST /api/auth/sync`

**Files:**
- Modify: `api/index.js:7` (extender require de `./firestore`), `api/index.js:1230-1250` (nueva sección `--- User Accounts API ---`), `api/index.js:1467`
- Test: `tests/authSync.test.js`

**Interfaces:**
- Consumes: `requireUser` (Task 2), `fireUpsertUser(uid, data)` (Task 3).
- Produces: `authSyncHandler(req, res)` exportado, montado en `app.post('/api/auth/sync', requireUser, authSyncHandler)`. El rate limit ya aplica automáticamente vía `app.use('/api/', limiter)` (línea 42) — no requiere wiring adicional.

- [ ] **Step 1: Escribe el test que falla**

```js
// tests/authSync.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/firestore.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, fireUpsertUser: vi.fn() }
})

const { authSyncHandler } = await import('../api/index.js')
const { fireUpsertUser } = await import('../api/firestore.js')

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('authSyncHandler', () => {
  beforeEach(() => { fireUpsertUser.mockReset() })

  it('upserts the user doc using req.user and responds { ok: true }', async () => {
    fireUpsertUser.mockResolvedValue({ created: true })
    const req = { user: { uid: 'user-123', email: 'user@example.com' }, body: { providers: ['password'] } }
    const res = makeRes()

    await authSyncHandler(req, res)

    expect(fireUpsertUser).toHaveBeenCalledWith('user-123', expect.objectContaining({
      email: 'user@example.com', providers: ['password']
    }))
    expect(res.body).toEqual({ ok: true })
  })

  it('does not block on a transient Firestore failure and still responds ok:true', async () => {
    fireUpsertUser.mockRejectedValue(new Error('Firestore unavailable'))
    const req = { user: { uid: 'user-456', email: 'x@example.com' }, body: {} }
    const res = makeRes()

    await authSyncHandler(req, res)

    expect(res.body).toEqual({ ok: true, warning: 'sync_deferred' })
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/authSync.test.js`
Expected: `TypeError: authSyncHandler is not a function`

- [ ] **Step 3: Implementación mínima**

En `api/index.js:7`, extender el destructure de `./firestore`:

```js
const { getAccessToken, fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache, fireGetOcrData, fireSetOcrData, fireGetNutritionOcr, fireSetNutritionOcr, fireListDocs, fireListAll, fireDeleteDoc, fireLogScan, fireMarkScanNotFound, fireMarkScanHasOcr, fireMarkScanHasNutrition, fireMarkScanConfidence, fireMarkScanSource, fireMarkScanSources, fireLogReport, ADMIN_COLLECTIONS, fireUpsertUser } = require('./firestore');
```

Nueva sección antes de `// --- Admin Panel API ---` (línea ~1230):

```js
// --- User Accounts API ---
const MAX_DISPLAY_NAME_LEN = 100;

// Hallazgo de revisión de seguridad: displayName/photoURL venían de req.body sin
// límite ni validación — riesgo de XSS almacenado si una vista futura los
// renderiza vía innerHTML, y de abuso de almacenamiento con strings arbitrarios.
function sanitizeDisplayName(name) {
  if (typeof name !== 'string') return null;
  return name.slice(0, MAX_DISPLAY_NAME_LEN);
}

function sanitizePhotoURL(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  return url.slice(0, 500);
}

async function authSyncHandler(req, res) {
  try {
    await fireUpsertUser(req.user.uid, {
      email: req.user.email,
      providers: Array.isArray(req.body?.providers) ? req.body.providers : [],
      displayName: sanitizeDisplayName(req.body?.displayName),
      photoURL: sanitizePhotoURL(req.body?.photoURL),
      // Solo relevantes en la creación (fireUpsertUser los ignora si el doc ya existe) —
      // vienen del checkbox de Términos/edad en el signup (Task 11).
      termsAccepted: req.body?.termsAccepted === true,
      termsVersion: req.body?.termsVersion,
      ageConfirmed: req.body?.ageConfirmed === true
    });
    res.json({ ok: true });
  } catch (e) {
    // No bloquea el login: Firebase Auth ya autenticó del lado del cliente; el doc
    // se reintenta en el próximo sync. Loguear SOLO el uid, nunca el doc (datos de salud).
    console.warn('[auth/sync] Firestore error, uid:', req.user?.uid, e.message);
    res.json({ ok: true, warning: 'sync_deferred' });
  }
}

app.post('/api/auth/sync', requireUser, authSyncHandler);
```

Al final del archivo (línea ~1467):

```js
module.exports.authSyncHandler = authSyncHandler;
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/authSync.test.js`
Expected: `Test Files 1 passed (1)`, `Tests 2 passed (2)`

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/authSync.test.js
git commit -m "feat(auth): add POST /api/auth/sync endpoint (upsert on login, never blocks auth)"
```

---

### Task 5: `GET /api/me`

**Files:**
- Modify: `api/index.js:7` (extender require), `api/index.js:1250-1265`, `api/index.js:1468`
- Test: `tests/getMe.test.js`

**Interfaces:**
- Consumes: `requireUser` (Task 2), `fireGetUser(uid)` (Task 3).
- Produces: `getMeHandler(req, res)` exportado, montado en `app.get('/api/me', requireUser, getMeHandler)`.

- [ ] **Step 1: Escribe el test que falla**

```js
// tests/getMe.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/firestore.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, fireGetUser: vi.fn() }
})

const { getMeHandler } = await import('../api/index.js')
const { fireGetUser } = await import('../api/firestore.js')

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('getMeHandler', () => {
  beforeEach(() => { fireGetUser.mockReset() })

  it('returns the profile without preferences for a free-plan user', async () => {
    fireGetUser.mockResolvedValue({ email: 'a@b.com', plan: 'free' })
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.body).toEqual({ uid: 'uid-1', email: 'a@b.com', plan: 'free' })
  })

  it('includes preferences for a premium-plan user', async () => {
    fireGetUser.mockResolvedValue({
      email: 'a@b.com', plan: 'premium',
      preferences: { dietary: ['vegan'], allergens: [], healthConditions: [] }
    })
    const req = { user: { uid: 'uid-2' } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.body.preferences).toEqual({ dietary: ['vegan'], allergens: [], healthConditions: [] })
  })

  it('never includes preferences for a free-plan user even if present in the doc (defensive)', async () => {
    fireGetUser.mockResolvedValue({ email: 'a@b.com', plan: 'free', preferences: { dietary: ['vegan'] } })
    const req = { user: { uid: 'uid-3' } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.body.preferences).toBeUndefined()
  })

  it('responds 404 when the user document does not exist', async () => {
    fireGetUser.mockResolvedValue(null)
    const req = { user: { uid: 'uid-missing' } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: 'user_not_found' })
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/getMe.test.js`
Expected: `TypeError: getMeHandler is not a function`

- [ ] **Step 3: Implementación mínima**

En `api/index.js:7`, extender el destructure:

```js
const { getAccessToken, fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache, fireGetOcrData, fireSetOcrData, fireGetNutritionOcr, fireSetNutritionOcr, fireListDocs, fireListAll, fireDeleteDoc, fireLogScan, fireMarkScanNotFound, fireMarkScanHasOcr, fireMarkScanHasNutrition, fireMarkScanConfidence, fireMarkScanSource, fireMarkScanSources, fireLogReport, ADMIN_COLLECTIONS, fireUpsertUser, fireGetUser } = require('./firestore');
```

Debajo de `authSyncHandler`/su ruta:

```js
async function getMeHandler(req, res) {
  try {
    const user = await fireGetUser(req.user.uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    const { preferences, ...rest } = user;
    const body = { uid: req.user.uid, ...rest };
    if (user.plan === 'premium' && preferences) body.preferences = preferences;
    res.json(body);
  } catch (e) {
    console.warn('[GET /api/me] Firestore error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.get('/api/me', requireUser, getMeHandler);
```

Al final del archivo:

```js
module.exports.getMeHandler = getMeHandler;
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/getMe.test.js`
Expected: `Test Files 1 passed (1)`, `Tests 4 passed (4)`

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/getMe.test.js
git commit -m "feat(auth): add GET /api/me (preferences only exposed to premium plan)"
```

---

### Task 6: `PUT /api/me/preferences`

**Files:**
- Modify: `api/index.js:7` (extender require), `api/index.js:1266-1300`, `api/index.js:1469`
- Test: `tests/putPreferences.test.js`

**Interfaces:**
- Consumes: `requireUser` (Task 2), `fireGetUser(uid)` (Task 3, para chequear `plan`), `firePatchUserFields(uid, fieldPaths, data)` (Task 3).
- Produces: `putPreferencesHandler(req, res)` exportado, montado en `app.put('/api/me/preferences', requireUser, putPreferencesHandler)`. Consumido por Task 15 (frontend).

- [ ] **Step 1: Escribe el test que falla**

```js
// tests/putPreferences.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/firestore.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, fireGetUser: vi.fn(), firePatchUserFields: vi.fn() }
})

const { putPreferencesHandler } = await import('../api/index.js')
const { fireGetUser, firePatchUserFields } = await import('../api/firestore.js')

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('putPreferencesHandler', () => {
  beforeEach(() => {
    fireGetUser.mockReset()
    firePatchUserFields.mockReset()
  })

  it('responds 403 premium_required for a free-plan user', async () => {
    fireGetUser.mockResolvedValue({ plan: 'free' })
    const req = { user: { uid: 'uid-1' }, body: { dietary: ['vegan'], allergens: [], healthConditions: [] } }
    const res = makeRes()

    await putPreferencesHandler(req, res)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'premium_required' })
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('updates preferences with an explicit nested updateMask for a premium user', async () => {
    fireGetUser.mockResolvedValue({ plan: 'premium' })
    firePatchUserFields.mockResolvedValue(true)
    const req = {
      user: { uid: 'uid-2' },
      body: {
        dietary: ['vegan', 'glutenFree'],
        allergens: [{ code: 'cacahuate', severity: 'severe' }],
        healthConditions: ['diabet'],
        consent: true,
        consentNoticeVersion: 'aviso-v1'
      }
    }
    const res = makeRes()

    await putPreferencesHandler(req, res)

    expect(firePatchUserFields).toHaveBeenCalledWith(
      'uid-2',
      ['preferences.dietary', 'preferences.allergens', 'preferences.healthConditions', 'preferences.consentGivenAt', 'preferences.consentNoticeVersion', 'preferences.updatedAt'],
      expect.objectContaining({
        preferences: expect.objectContaining({
          dietary: ['vegan', 'glutenFree'],
          allergens: [{ code: 'cacahuate', severity: 'severe' }],
          healthConditions: ['diabet']
        })
      })
    )
    expect(res.body.ok).toBe(true)
  })

  it('rejects an unknown dietary key with 400', async () => {
    fireGetUser.mockResolvedValue({ plan: 'premium' })
    const req = { user: { uid: 'uid-3' }, body: { dietary: ['not-a-real-diet'], allergens: [], healthConditions: [], consent: true } }
    const res = makeRes()

    await putPreferencesHandler(req, res)

    expect(res.statusCode).toBe(400)
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('rejects an allergen with an invalid severity with 400', async () => {
    fireGetUser.mockResolvedValue({ plan: 'premium' })
    const req = {
      user: { uid: 'uid-4' },
      body: { dietary: [], allergens: [{ code: 'leche', severity: 'extreme' }], healthConditions: [], consent: true }
    }
    const res = makeRes()

    await putPreferencesHandler(req, res)

    expect(res.statusCode).toBe(400)
  })

  it('never merges the raw body directly — a spurious "plan" field cannot reach Firestore', async () => {
    fireGetUser.mockResolvedValue({ plan: 'premium' })
    firePatchUserFields.mockResolvedValue(true)
    const req = {
      user: { uid: 'uid-5' },
      body: { dietary: [], allergens: [], healthConditions: [], consent: true, plan: 'premium-forever' }
    }
    const res = makeRes()

    await putPreferencesHandler(req, res)

    const [, , data] = firePatchUserFields.mock.calls[0]
    expect(data.plan).toBeUndefined()
  })

  it('responds 400 consent_required when consent is missing or false (hallazgo de revisión legal/seguridad: el checkbox de preferences-ui.js solo valida en cliente — el servidor debe exigirlo también)', async () => {
    fireGetUser.mockResolvedValue({ plan: 'premium' })
    const req = {
      user: { uid: 'uid-6' },
      body: { dietary: ['vegan'], allergens: [], healthConditions: [], consent: false }
    }
    const res = makeRes()

    await putPreferencesHandler(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'consent_required' })
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('stores consentGivenAt and consentNoticeVersion as evidence of expreso consent when consent is true', async () => {
    fireGetUser.mockResolvedValue({ plan: 'premium' })
    firePatchUserFields.mockResolvedValue(true)
    const req = {
      user: { uid: 'uid-7' },
      body: { dietary: ['vegan'], allergens: [], healthConditions: [], consent: true, consentNoticeVersion: 'aviso-v1' }
    }
    const res = makeRes()

    await putPreferencesHandler(req, res)

    const [, fieldPaths, data] = firePatchUserFields.mock.calls[0]
    expect(fieldPaths).toContain('preferences.consentGivenAt')
    expect(fieldPaths).toContain('preferences.consentNoticeVersion')
    expect(data.preferences.consentNoticeVersion).toBe('aviso-v1')
    expect(typeof data.preferences.consentGivenAt).toBe('string')
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/putPreferences.test.js`
Expected: `TypeError: putPreferencesHandler is not a function`

- [ ] **Step 3: Implementación mínima**

En `api/index.js:7`, extender el destructure:

```js
const { getAccessToken, fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache, fireGetOcrData, fireSetOcrData, fireGetNutritionOcr, fireSetNutritionOcr, fireListDocs, fireListAll, fireDeleteDoc, fireLogScan, fireMarkScanNotFound, fireMarkScanHasOcr, fireMarkScanHasNutrition, fireMarkScanConfidence, fireMarkScanSource, fireMarkScanSources, fireLogReport, ADMIN_COLLECTIONS, fireUpsertUser, fireGetUser, firePatchUserFields } = require('./firestore');
```

Debajo de `getMeHandler`/su ruta:

```js
// Mismas claves que extractDietaryFromLabels en app.js, más glutenFree (spec de cuentas).
const ALLOWED_DIETARY = ['vegan', 'vegetarian', 'keto', 'kosher', 'halal', 'organic', 'nonGmo', 'noAdditives', 'palmOilFree', 'fairTrade', 'caseinFree', 'glutenFree'];
// Mismas claves que grupoClave() en app.js:2094.
const ALLOWED_HEALTH_CONDITIONS = ['diabet', 'hipert', 'lactos', 'fenilc', 'celiac', 'gluten', 'ninos'];
// Mismos labels canónicos que COMMON_ALLERGENS en app.js (normalizado a minúsculas sin acento).
const ALLOWED_ALLERGEN_CODES = ['lacteos', 'cacahuate', 'nueces', 'trigo', 'huevo', 'pescado', 'mariscos', 'soja'];
const ALLOWED_SEVERITY = ['severe', 'mild'];

async function putPreferencesHandler(req, res) {
  try {
    const user = await fireGetUser(req.user.uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    if (user.plan !== 'premium') return res.status(403).json({ error: 'premium_required' });

    const { dietary, allergens, healthConditions, consent, consentNoticeVersion } = req.body || {};
    if (!Array.isArray(dietary) || !Array.isArray(allergens) || !Array.isArray(healthConditions)) {
      return res.status(400).json({ error: 'invalid_preferences' });
    }
    // Hallazgo de revisión legal/seguridad: el checkbox de preferences-ui.js solo
    // validaba en cliente — cualquier llamada directa al endpoint (curl/Postman)
    // guardaba datos de salud sin haber pasado nunca por el consentimiento. El
    // servidor ahora lo exige y guarda evidencia (consentGivenAt/versión del
    // aviso) para poder demostrar consentimiento expreso ante una auditoría.
    if (consent !== true) {
      return res.status(400).json({ error: 'consent_required' });
    }
    if (!dietary.every(d => ALLOWED_DIETARY.includes(d))) {
      return res.status(400).json({ error: 'invalid_dietary' });
    }
    if (!healthConditions.every(h => ALLOWED_HEALTH_CONDITIONS.includes(h))) {
      return res.status(400).json({ error: 'invalid_health_conditions' });
    }
    if (!allergens.every(a => a && ALLOWED_ALLERGEN_CODES.includes(a.code) && ALLOWED_SEVERITY.includes(a.severity))) {
      return res.status(400).json({ error: 'invalid_allergens' });
    }

    const preferences = {
      dietary, allergens, healthConditions,
      consentGivenAt: new Date().toISOString(),
      consentNoticeVersion: consentNoticeVersion || 'v1',
      updatedAt: new Date().toISOString()
    };
    // updateMask explícito y ANIDADO sobre estos campos — nunca se acepta el
    // body crudo como estado nuevo del doc completo, así "plan"/"billing" nunca se pisan.
    await firePatchUserFields(req.user.uid, [
      'preferences.dietary', 'preferences.allergens', 'preferences.healthConditions',
      'preferences.consentGivenAt', 'preferences.consentNoticeVersion', 'preferences.updatedAt'
    ], { preferences });

    res.json({ ok: true, preferences });
  } catch (e) {
    console.warn('[PUT /api/me/preferences] Firestore error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.put('/api/me/preferences', requireUser, putPreferencesHandler);
```

Al final del archivo:

```js
module.exports.putPreferencesHandler = putPreferencesHandler;
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/putPreferences.test.js`
Expected: `Test Files 1 passed (1)`, `Tests 5 passed (5)`

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/putPreferences.test.js
git commit -m "feat(preferences): add PUT /api/me/preferences with explicit nested updateMask and premium gate"
```

---

### Task 7: `DELETE /api/me/preferences`

**Files:**
- Modify: `api/index.js:1301-1315`, `api/index.js:1470`
- Test: `tests/deletePreferences.test.js`

**Interfaces:**
- Consumes: `requireUser` (Task 2), `firePatchUserFields(uid, fieldPaths, data)` (Task 3, ya importado en Task 6).
- Produces: `deletePreferencesHandler(req, res)` exportado, montado en `app.delete('/api/me/preferences', requireUser, deletePreferencesHandler)`. Consumido por Task 15 (frontend).

- [ ] **Step 1: Escribe el test que falla**

```js
// tests/deletePreferences.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/firestore.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, firePatchUserFields: vi.fn() }
})

const { deletePreferencesHandler } = await import('../api/index.js')
const { firePatchUserFields } = await import('../api/firestore.js')

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('deletePreferencesHandler', () => {
  beforeEach(() => { firePatchUserFields.mockReset() })

  it('deletes the entire preferences field via updateMask (derechos ARCO)', async () => {
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await deletePreferencesHandler(req, res)

    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['preferences'], {})
    expect(res.body).toEqual({ ok: true })
  })

  it('responds 500 on a Firestore failure', async () => {
    firePatchUserFields.mockRejectedValue(new Error('Firestore down'))
    const req = { user: { uid: 'uid-2' } }
    const res = makeRes()

    await deletePreferencesHandler(req, res)

    expect(res.statusCode).toBe(500)
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/deletePreferences.test.js`
Expected: `TypeError: deletePreferencesHandler is not a function`

- [ ] **Step 3: Implementación mínima**

Debajo de `putPreferencesHandler`/su ruta:

```js
async function deletePreferencesHandler(req, res) {
  try {
    // Borra el campo preferences completo (derechos ARCO sobre datos de salud),
    // independiente de borrar la cuenta completa. Disponible sin importar el plan.
    await firePatchUserFields(req.user.uid, ['preferences'], {});
    res.json({ ok: true });
  } catch (e) {
    console.warn('[DELETE /api/me/preferences] Firestore error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.delete('/api/me/preferences', requireUser, deletePreferencesHandler);
```

Al final del archivo:

```js
module.exports.deletePreferencesHandler = deletePreferencesHandler;
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/deletePreferences.test.js`
Expected: `Test Files 1 passed (1)`, `Tests 2 passed (2)`

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/deletePreferences.test.js
git commit -m "feat(preferences): add DELETE /api/me/preferences (ARCO rights on health data)"
```

---

### Task 8: Contador de cuota con concurrencia optimista (`usage.ocrCount`/`cacheRefreshCount`)

**Files:**
- Modify: `api/firestore.js:410-418` (nuevas funciones antes de `module.exports`, y actualización de `module.exports`)
- Test: `tests/firestore-usage.test.js`

**Interfaces:**
- Consumes: `getAccessToken()`, `docPath`, `fromFirestoreFields`/`toFirestoreFields` (Task 3).
- Produces: `fireGetUserRaw(uid): Promise<{fields, updateTime}|null>`, `firePatchUserFieldsWithPrecondition(uid, fieldPaths, data, updateTime): Promise<Response>`, `fireIncrementUsageCounter(uid, field): Promise<{date, ocrCount, cacheRefreshCount}>`. Consumido por Task 9.

- [ ] **Step 1: Escribe el test que falla**

```js
// tests/firestore-usage.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

const { fireIncrementUsageCounter } = await import('../api/firestore.js')

function buildFetchMock(userDocHandler) {
  return vi.fn(async (url, options = {}) => {
    if (url.includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'fake-token', expires_in: 3600 }) }
    }
    return userDocHandler(url, options)
  })
}

function fakeServiceAccountKey() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  })
  return JSON.stringify({
    project_id: 'foodscaner-test',
    client_email: 'test@foodscaner-test.iam.gserviceaccount.com',
    private_key: privateKey
  })
}

describe('fireIncrementUsageCounter', () => {
  const ORIGINAL_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY

  beforeEach(() => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = ORIGINAL_KEY
  })

  it('resets counters to 0 before incrementing when usage.date is not today (UTC)', async () => {
    let patchBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-14' }, ocrCount: { integerValue: '5' }, cacheRefreshCount: { integerValue: '1' }
            } } } },
            updateTime: '2026-07-14T23:00:00.000000Z'
          })
        }
      }
      patchBody = JSON.parse(options.body)
      return { ok: true, status: 200 }
    }))

    const result = await fireIncrementUsageCounter('uid-1', 'ocrCount')

    expect(result).toEqual({ date: '2026-07-15', ocrCount: 1, cacheRefreshCount: 0 })
    expect(patchBody.currentDocument.updateTime).toBe('2026-07-14T23:00:00.000000Z')
  })

  it('increments the existing counter when usage.date is already today', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-15' }, ocrCount: { integerValue: '2' }, cacheRefreshCount: { integerValue: '0' }
            } } } },
            updateTime: '2026-07-15T10:00:00.000000Z'
          })
        }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireIncrementUsageCounter('uid-1', 'ocrCount')

    expect(result).toEqual({ date: '2026-07-15', ocrCount: 3, cacheRefreshCount: 0 })
  })

  it('retries with backoff on a 409 conflict and succeeds on the next attempt', async () => {
    let patchAttempts = 0
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-15' }, ocrCount: { integerValue: '0' }, cacheRefreshCount: { integerValue: '0' }
            } } } },
            updateTime: '2026-07-15T10:00:00.000000Z'
          })
        }
      }
      patchAttempts++
      if (patchAttempts === 1) return { ok: false, status: 409 }
      return { ok: true, status: 200 }
    }))
    vi.useRealTimers() // el backoff usa setTimeout real de 10-50ms

    const result = await fireIncrementUsageCounter('uid-1', 'ocrCount')

    expect(patchAttempts).toBe(2)
    expect(result.ocrCount).toBe(1)
  })

  it('gives up after repeated 409 conflicts and throws', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-15' }, ocrCount: { integerValue: '0' }, cacheRefreshCount: { integerValue: '0' }
            } } } },
            updateTime: '2026-07-15T10:00:00.000000Z'
          })
        }
      }
      return { ok: false, status: 409 }
    }))
    vi.useRealTimers()

    await expect(fireIncrementUsageCounter('uid-1', 'ocrCount')).rejects.toThrow()
  })

  it('throws when the user document does not exist', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) return { status: 404, ok: false }
      return { ok: true, status: 200 }
    }))

    await expect(fireIncrementUsageCounter('uid-missing', 'ocrCount')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/firestore-usage.test.js`
Expected: `TypeError: fireIncrementUsageCounter is not a function`

- [ ] **Step 3: Implementación mínima**

En `api/firestore.js`, antes de `module.exports` (después de las funciones de Task 3):

```js
async function fireGetUserRaw(uid) {
  const token = await getAccessToken();
  if (!token) throw new Error('No Firestore access token');
  const resp = await fetch(docPath('users', uid), {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(5000)
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Firestore get user failed: ${resp.status}`);
  const data = await resp.json();
  return { fields: fromFirestoreFields(data.fields || {}), updateTime: data.updateTime };
}

async function firePatchUserFieldsWithPrecondition(uid, fieldPaths, data, updateTime) {
  const token = await getAccessToken();
  if (!token) throw new Error('No Firestore access token');
  const mask = fieldPaths.map(fp => `updateMask.fieldPaths=${encodeURIComponent(fp)}`).join('&');
  const fields = toFirestoreFields(data);
  return fetch(docPath('users', uid) + '?' + mask, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, currentDocument: { updateTime } }),
    signal: AbortSignal.timeout(5000)
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Concurrencia optimista: GET captura updateTime, PATCH con precondición
// currentDocument.updateTime, reintento 2-3 veces con backoff 10-50ms si 409.
// Reset a 0 si usage.date !== hoy (UTC) — cubre doble-tap / 2 tabs sin perder ni duplicar conteo.
async function fireIncrementUsageCounter(uid, field) {
  if (!['ocrCount', 'cacheRefreshCount'].includes(field)) {
    throw new Error('Campo de uso inválido: ' + field);
  }
  const today = new Date().toISOString().slice(0, 10); // UTC, a propósito (ver spec)
  const MAX_ATTEMPTS = 3;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const doc = await fireGetUserRaw(uid);
    if (!doc) throw new Error('Usuario no encontrado: ' + uid);

    const currentUsage = doc.fields.usage || { date: today, ocrCount: 0, cacheRefreshCount: 0 };
    const isNewDay = currentUsage.date !== today;
    const newUsage = {
      date: today,
      ocrCount: isNewDay ? (field === 'ocrCount' ? 1 : 0) : currentUsage.ocrCount + (field === 'ocrCount' ? 1 : 0),
      cacheRefreshCount: isNewDay ? (field === 'cacheRefreshCount' ? 1 : 0) : currentUsage.cacheRefreshCount + (field === 'cacheRefreshCount' ? 1 : 0)
    };

    const resp = await firePatchUserFieldsWithPrecondition(uid, ['usage'], { usage: newUsage }, doc.updateTime);
    if (resp.ok) return newUsage;
    if (resp.status === 409) {
      const backoffMs = 10 + Math.floor(Math.random() * 40); // 10-50ms
      await sleep(backoffMs);
      continue;
    }
    throw new Error(`Firestore increment usage failed: ${resp.status}`);
  }
  throw new Error('No se pudo incrementar usage tras reintentos por conflictos de concurrencia');
}
```

Actualizar `module.exports`:

```js
module.exports = {
  getAccessToken,
  fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache,
  fireGetOcrData, fireSetOcrData,
  fireGetNutritionOcr, fireSetNutritionOcr,
  fireListDocs, fireListAll, fireDeleteDoc, fireLogScan, fireMarkScanNotFound, fireMarkScanHasOcr, fireMarkScanHasNutrition, fireMarkScanConfidence, fireMarkScanSource, fireMarkScanSources, fireLogReport, ADMIN_COLLECTIONS,
  fireGetUser, fireUpsertUser, firePatchUserFields,
  fireGetUserRaw, firePatchUserFieldsWithPrecondition, fireIncrementUsageCounter
};
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/firestore-usage.test.js`
Expected: `Test Files 1 passed (1)`, `Tests 5 passed (5)`

- [ ] **Step 5: Commit**

```bash
git add api/firestore.js tests/firestore-usage.test.js
git commit -m "feat(quota): add optimistic-concurrency usage counter with UTC daily reset and 409 retry"
```

---

### Task 9: Enforcement de cuota OCR en `/api/ocr/process`

**Files:**
- Modify: `api/index.js:7` (extender require con `fireIncrementUsageCounter`), `api/index.js:43-70` (nueva función `optionalUser`, junto a `requireUser`), `api/index.js:1059-1079` (reescribir el endpoint como handler nombrado), `api/index.js:1471`
- Test: `tests/ocrQuota.test.js`

**Interfaces:**
- Consumes: `verifyFirebaseIdToken` (Task 1), `fireGetUser`, `fireIncrementUsageCounter` (Tasks 3, 8), `callGroqVision` (ya existente, `api/index.js:199`).
- Produces: `optionalUser(req, res, next)` — nunca bloquea, adjunta `req.user = null` si no hay token válido (a diferencia de `requireUser`). `ocrProcessHandler(req, res)` exportado, reemplaza el handler inline actual de `/api/ocr/process`. Cierra el "prerequisito bloqueante" del doc de negocio (5 fotos/día free vs ilimitado premium) — es la única integración de cuota que se construye en este plan; `cacheRefreshCount` queda listo en el contador (Task 8) pero su endpoint de cara al usuario no existe todavía (es una feature separada, fuera de alcance aquí).

**Nota de producto (decisión provisional, no silenciosa):** hoy `/api/ocr/process` es 100% anónimo. Este task NO fuerza login para usar OCR — usuarios sin sesión pasan sin medir cuota (comportamiento actual sin cambios). Solo cuando SÍ hay sesión se aplica el límite. Esto es una interpretación provisional para no romper la UX free actual; si el negocio decide que OCR debe requerir login siempre para que la cuota "5/día" sea real (evitar que alguien simplemente no mande el token para saltarse el límite), es una decisión de producto explícita a tomar aparte, no algo que este plan resuelva en silencio.

- [ ] **Step 1: Escribe el test que falla**

```js
// tests/ocrQuota.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

const { ocrProcessHandler } = await import('../api/index.js')

const PROJECT_ID = 'foodscaner-dev'
const KID = 'test-kid-ocr'

function b64url(input) { return Buffer.from(input).toString('base64url') }

function signRS256(payloadOverrides, privateKey) {
  const header = { alg: 'RS256', typ: 'JWT', kid: KID }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID, sub: 'user-1', iat: now, exp: now + 3600,
    email: 'user@example.com', email_verified: true,
    ...payloadOverrides
  }
  const headerB64 = b64url(JSON.stringify(header))
  const payloadB64 = b64url(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey)
  return `${signingInput}.${signature.toString('base64url')}`
}

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

function toFields(obj) {
  const f = {}
  if (obj.plan) f.plan = { stringValue: obj.plan }
  if (obj.usage) f.usage = { mapValue: { fields: {
    date: { stringValue: obj.usage.date },
    ocrCount: { integerValue: String(obj.usage.ocrCount) },
    cacheRefreshCount: { integerValue: String(obj.usage.cacheRefreshCount || 0) }
  } } }
  return f
}

describe('ocrProcessHandler — enforcement de cuota', () => {
  let privateKey, jwk

  beforeEach(() => {
    process.env.FIREBASE_PROJECT_ID = PROJECT_ID
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    privateKey = keyPair.privateKey
    jwk = keyPair.publicKey.export({ format: 'jwk' })
    jwk.kid = KID
    jwk.alg = 'RS256'
    jwk.use = 'sig'
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('usuario no logueado pasa sin medir cuota (comportamiento actual sin cambios)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('api.groq.com')) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'ingredientes: harina' } }] }) }
      }
      return { ok: true, status: 200 }
    }))
    const req = { get: () => undefined, body: { imageData: 'base64...' } }
    const res = makeRes()
    await ocrProcessHandler(req, res)
    expect(res.body.status).toBe('ok')
  })

  it('usuario logueado con email no verificado → 403, no llama a Groq', async () => {
    const token = signRS256({ email_verified: false }, privateKey)
    let groqCalled = false
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('api.groq.com')) { groqCalled = true; return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) } }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await ocrProcessHandler(req, res)
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'email_not_verified' })
    expect(groqCalled).toBe(false)
  })

  it('usuario free bajo cuota (2/5) → procesa, responde ok, e incrementa el contador', async () => {
    const token = signRS256({}, privateKey)
    let incrementPatchCalled = false
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        if (options.method === 'PATCH') { incrementPatchCalled = true; return { ok: true, status: 200 } }
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ plan: 'free', usage: { date: '2026-07-15', ocrCount: 2 } }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) return { ok: true, json: async () => ({ choices: [{ message: { content: 'ingredientes: harina' } }] }) }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await ocrProcessHandler(req, res)
    expect(res.body.status).toBe('ok')
    expect(incrementPatchCalled).toBe(true)
  })

  it('usuario free en el límite (5/5) → 429 quota_exceeded, no llama a Groq', async () => {
    const token = signRS256({}, privateKey)
    let groqCalled = false
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ plan: 'free', usage: { date: '2026-07-15', ocrCount: 5 } }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) { groqCalled = true; return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) } }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await ocrProcessHandler(req, res)
    expect(res.statusCode).toBe(429)
    expect(res.body).toEqual({ error: 'quota_exceeded', limit: 5 })
    expect(groqCalled).toBe(false)
  })

  it('usuario premium sin límite, aunque ocrCount ya sea alto, y no intenta incrementar', async () => {
    const token = signRS256({}, privateKey)
    let incrementPatchCalled = false
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        if (options.method === 'PATCH') { incrementPatchCalled = true; return { ok: true, status: 200 } }
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ plan: 'premium', usage: { date: '2026-07-15', ocrCount: 40 } }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await ocrProcessHandler(req, res)
    expect(res.body.status).toBe('ok')
    expect(incrementPatchCalled).toBe(false)
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/ocrQuota.test.js`
Expected: `TypeError: ocrProcessHandler is not a function`

- [ ] **Step 3: Implementación mínima**

En `api/index.js:7`, extender el destructure (agregar a la lista ya extendida por Tasks 4-6):

```js
const { getAccessToken, fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache, fireGetOcrData, fireSetOcrData, fireGetNutritionOcr, fireSetNutritionOcr, fireListDocs, fireListAll, fireDeleteDoc, fireLogScan, fireMarkScanNotFound, fireMarkScanHasOcr, fireMarkScanHasNutrition, fireMarkScanConfidence, fireMarkScanSource, fireMarkScanSources, fireLogReport, ADMIN_COLLECTIONS, fireUpsertUser, fireGetUser, firePatchUserFields, fireIncrementUsageCounter } = require('./firestore');
```

Junto a `requireUser` (después de su definición, misma sección `--- Auth Middleware ---`):

```js
// A diferencia de requireUser, NUNCA bloquea — usuarios sin sesión pasan con
// req.user = null (comportamiento actual de /api/ocr/process sin cambios).
// Solo cuando SÍ hay un token válido se adjunta req.user, incluyendo emailVerified
// (necesario para la mitigación de bypass de cuota vía cuentas gratis ilimitadas).
async function optionalUser(req, res, next) {
  const authHeader = req.get('authorization') || req.get('Authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) { req.user = null; return next(); }
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (!projectId) { req.user = null; return next(); }
    const { uid, email, emailVerified } = await verifyFirebaseIdToken(match[1], projectId);
    req.user = { uid, email, emailVerified };
  } catch {
    req.user = null;
  }
  next();
}
```

Reemplazar el endpoint actual (`api/index.js:1059-1079`):

```js
// Process ingredients from image using vision LLM (no Tesseract)
const OCR_FREE_DAILY_LIMIT = 5;

async function ocrProcessHandler(req, res) {
  try {
    const { imageData } = req.body;
    if (!imageData) return res.status(400).json({ error: 'Missing imageData' });

    let shouldCountUsage = false;

    if (req.user) {
      if (!req.user.emailVerified) {
        return res.status(403).json({ error: 'email_not_verified' });
      }
      // Fail-closed (hallazgo de revisión de seguridad): si el perfil todavía no
      // se sincronizó (fireGetUser === null, ej. authSyncHandler falló o no corrió
      // aún), se trata como plan free con 0 fotos usadas — NUNCA se salta el
      // chequeo de cuota por falta de doc. Antes: `if (profile && ...)` dejaba
      // pasar sin medir cuando profile era null (fail-open).
      const profile = await fireGetUser(req.user.uid);
      const plan = profile ? profile.plan : 'free';
      if (plan !== 'premium') {
        const today = new Date().toISOString().slice(0, 10);
        const usage = profile && profile.usage;
        const currentCount = (usage && usage.date === today) ? usage.ocrCount : 0;
        if (currentCount >= OCR_FREE_DAILY_LIMIT) {
          return res.status(429).json({ error: 'quota_exceeded', limit: OCR_FREE_DAILY_LIMIT });
        }
        shouldCountUsage = true;
      }
    }

    const prompt = `Extrae el texto de ingredientes de esta imagen de etiqueta alimentaria.
Devuelve el texto tal como aparece, incluyendo ingredientes y cualquier declaración de alérgenos como "Contiene:", "Puede contener:", "Trazas de:" u otras advertencias similares.
Corrige errores obvios de lectura pero no inventes texto ni omitas secciones.
Si no puedes leer los ingredientes, responde con texto vacío.`;

    const result = await callGroqVision(imageData, prompt);
    if (!result?.content) throw new Error("No response from vision LLM");

    const cleanedText = result.content.trim();
    console.log('[OCR Vision] Extracted:', cleanedText.substring(0, 100));

    if (shouldCountUsage) {
      // Await deliberado, NO fire-and-forget (hallazgo de revisión de seguridad):
      // si esto se dispara sin esperar, requests OCR en paralelo del mismo usuario
      // leen el mismo snapshot de ocrCount antes de que cualquiera se persista y
      // todas pasan el chequeo de 429 — permite superar el límite de 5/día.
      try {
        await fireIncrementUsageCounter(req.user.uid, 'ocrCount');
      } catch (e) {
        console.warn('[OCR Vision] usage increment failed, uid:', req.user.uid, e.message);
      }
    }

    res.json({ status: 'ok', cleanedText });
  } catch (error) {
    console.error('[OCR Vision] Error:', error);
    res.status(500).json({ error: 'Error al procesar OCR: ' + (error?.message || error) });
  }
}

app.post('/api/ocr/process', optionalUser, ocrProcessHandler);
```

Al final del archivo:

```js
module.exports.optionalUser = optionalUser;
module.exports.ocrProcessHandler = ocrProcessHandler;
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/ocrQuota.test.js`
Expected: `Test Files 1 passed (1)`, `Tests 5 passed (5)`

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/ocrQuota.test.js
git commit -m "feat(quota): enforce 5/day free OCR limit via optionalUser + fireIncrementUsageCounter"
```

---

## Frontend

### Task 10: Cargar Firebase JS SDK vía CDN e inicializar la app

**Files:**
- Create: `firebase-init.js`
- Modify: `index.html:6` (CSP), `index.html:116` (nuevo script tag)
- Test: `tests/firebase-init.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `firebase-init.js` exporta (ESM) `firebaseApp`, `firebaseAuth`, y re-exporta `onAuthStateChanged`, `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`, `signInWithPopup`, `GoogleAuthProvider` desde el SDK — Tasks 11 y 12 importan TODO desde este único archivo (`./firebase-init.js`), nunca directo del CDN.

- [ ] **Step 1: Escribe el test que falla**

```js
// tests/firebase-init.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIREBASE_SDK_VERSION = '11.6.0'
const APP_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`
const AUTH_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`

const mockApp = { name: '[DEFAULT]' }
const mockAuthInstance = { currentUser: null }
const initializeApp = vi.fn(() => mockApp)
const getAuth = vi.fn(() => mockAuthInstance)
const onAuthStateChanged = vi.fn()
const signInWithEmailAndPassword = vi.fn()
const createUserWithEmailAndPassword = vi.fn()
const signInWithPopup = vi.fn()
class GoogleAuthProvider {}

vi.mock(APP_URL, () => ({ initializeApp }))
vi.mock(AUTH_URL, () => ({
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider
}))

describe('firebase-init.js', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('calls initializeApp exactly once with a config object using placeholder values (no real secrets)', async () => {
    const mod = await import('../firebase-init.js')
    expect(initializeApp).toHaveBeenCalledTimes(1)
    const configArg = initializeApp.mock.calls[0][0]
    expect(configArg).toHaveProperty('apiKey')
    expect(configArg).toHaveProperty('authDomain')
    expect(configArg).toHaveProperty('projectId')
    expect(configArg.apiKey).toMatch(/^__FIREBASE_.*__$/)
    expect(configArg.authDomain).toMatch(/^__FIREBASE_.*__$/)
    expect(configArg.projectId).toMatch(/^__FIREBASE_.*__$/)
    expect(mod.firebaseApp).toBe(mockApp)
  })

  it('calls getAuth with the initialized app and exports firebaseAuth', async () => {
    const mod = await import('../firebase-init.js')
    expect(getAuth).toHaveBeenCalledWith(mockApp)
    expect(mod.firebaseAuth).toBe(mockAuthInstance)
  })

  it('re-exports the auth SDK functions Task 11/12 depend on', async () => {
    const mod = await import('../firebase-init.js')
    expect(mod.onAuthStateChanged).toBe(onAuthStateChanged)
    expect(mod.signInWithEmailAndPassword).toBe(signInWithEmailAndPassword)
    expect(mod.createUserWithEmailAndPassword).toBe(createUserWithEmailAndPassword)
    expect(mod.signInWithPopup).toBe(signInWithPopup)
    expect(mod.GoogleAuthProvider).toBe(GoogleAuthProvider)
  })
})

describe('index.html wiring', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

  it('CSP allows loading the Firebase SDK from gstatic and talking to Identity Toolkit', () => {
    const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)
    expect(cspMatch).not.toBeNull()
    const csp = cspMatch[1]
    expect(csp).toMatch(/script-src[^;]*https:\/\/www\.gstatic\.com/)
    expect(csp).toMatch(/connect-src[^;]*https:\/\/identitytoolkit\.googleapis\.com/)
    expect(csp).toMatch(/connect-src[^;]*https:\/\/securetoken\.googleapis\.com/)
    expect(csp).toMatch(/frame-src[^;]*firebaseapp\.com/)
  })

  it('loads firebase-init.js as a module script', () => {
    expect(html).toMatch(/<script[^>]+type="module"[^>]+src="firebase-init\.js"/)
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/firebase-init.test.js`
Expected: `Cannot find module '../firebase-init.js'`

- [ ] **Step 3: Implementación mínima**

```js
// firebase-init.js
// Punto único de inicialización del Firebase JS SDK (Auth) — todo lo demás
// (auth-ui.js, authClient.js) importa DESDE ESTE archivo, nunca directo del
// CDN, para fijar la versión del SDK en un solo lugar y para poder mockear
// esta dependencia con una ruta relativa normal en tests.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

// Placeholders — los valores reales se inyectan como variables de entorno en
// build/deploy (Vercel). NUNCA reemplazar estos strings con valores reales
// commiteados al repo.
const firebaseConfig = {
  apiKey: "__FIREBASE_API_KEY__",
  authDomain: "__FIREBASE_AUTH_DOMAIN__",
  projectId: "__FIREBASE_PROJECT_ID__",
  storageBucket: "__FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
  appId: "__FIREBASE_APP_ID__"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider
};
```

Modificación en `index.html` — CSP (línea 6):

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://images.openfoodfacts.org https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-src https://*.firebaseapp.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self';">
```

Y después de línea 116 (junto al script de `home.js`, antes del registro del service worker):

```html
  <script src="home.js"></script>
  <script type="module" src="firebase-init.js"></script>
  <script type="module" src="authClient.js"></script>
  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js');
    }
  </script>
```

(el `<script type="module" src="authClient.js">` referencia el archivo de Task 12 — se agrega en el mismo punto de wiring; ambas tareas se mergean juntas en la práctica).

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/firebase-init.test.js`

- [ ] **Step 5: Commit**

```bash
git add firebase-init.js index.html tests/firebase-init.test.js
git commit -m "feat(auth): initialize Firebase JS SDK via CDN with env-injected config placeholders"
```

---

### Task 11: UI de login/signup (`auth.html` + `auth-ui.js`)

**Files:**
- Create: `auth.html`
- Create: `auth-ui.js`
- Test: `tests/auth-ui.test.js`

**Interfaces:**
- Consumes: `firebaseAuth`, `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`, `signInWithPopup`, `GoogleAuthProvider` desde `./firebase-init.js` (Task 10).
- Produces: `auth-ui.js` exporta `mapAuthError(code)`, `handleLogin(email, password)`, `handleSignup(email, password)`, `handleGoogleSignIn()`. Tras login exitoso redirige a `index.html`, donde `authClient.js` (Task 12) detecta el cambio de sesión vía `onAuthChange`.

- [ ] **Step 1: Escribe el test que falla**

```js
// tests/auth-ui.test.js
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuth = { currentUser: null }
const signInWithEmailAndPassword = vi.fn()
const createUserWithEmailAndPassword = vi.fn()
const signInWithPopup = vi.fn()
class GoogleAuthProvider {}

vi.mock('../firebase-init.js', () => ({
  firebaseAuth: mockAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider
}))

let mapAuthError, handleLogin, handleSignup, handleGoogleSignIn

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  global.fetch = vi.fn().mockResolvedValue({ ok: true })
  document.body.innerHTML = `
    <button id="btn-google">Continuar con Google</button>
    <form id="login-form" novalidate>
      <input id="login-email" type="email" required>
      <input id="login-password" type="password" required minlength="6">
      <button type="button" id="btn-toggle-password">Ver</button>
      <div id="signup-only" class="hidden">
        <input type="checkbox" id="terms-checkbox">
        <input type="checkbox" id="age-checkbox">
      </div>
      <button type="submit" id="btn-login">Iniciar sesión</button>
      <button type="button" id="btn-signup">Crear cuenta</button>
    </form>
    <p id="auth-error" class="hidden" role="alert"></p>
  `
  const mod = await import('../auth-ui.js')
  mapAuthError = mod.mapAuthError
  handleLogin = mod.handleLogin
  handleSignup = mod.handleSignup
  handleGoogleSignIn = mod.handleGoogleSignIn
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
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/auth-ui.test.js`
Expected: `Cannot find module '../auth-ui.js'`

- [ ] **Step 3: Implementación mínima**

```html
<!-- auth.html -->
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://images.openfoodfacts.org https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-src https://*.firebaseapp.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self';">
  <title>Yomi — Iniciar sesión</title>
  <link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#2DBC9E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <!-- home.css NO define estilos de input/botón (viven en styles.css) — hallazgo
       de revisión UX: sin este link el formulario se ve roto/sin marca. -->
  <link rel="stylesheet" href="home.css?v=15">
  <link rel="stylesheet" href="styles.css?v=15">
  <style>
    /* home.css solo scopea .hidden a selectores específicos — regla genérica
       para #auth-error, necesaria para que se oculte correctamente (hallazgo UX). */
    .hidden { display: none !important; }
    .auth-divider { display: flex; align-items: center; gap: 12px; margin: 16px 0; color: #6b6b6b; font-size: 14px; }
    .auth-divider::before, .auth-divider::after { content: ''; flex: 1; height: 1px; background: #ddd; }
    .password-field-wrap { position: relative; }
    .btn-toggle-password { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; font-size: 13px; }
    .consent-block { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin: 12px 0; background: #fafafa; }
  </style>
</head>
<body>
  <div class="app-shell">
    <header class="app-header">
      <img src="assets/redesign/logo.svg" alt="Yomi" class="app-logo">
    </header>
    <main class="app-main">
      <section class="section-heading">
        <h1 class="heading-title">Inicia sesión</h1>
        <p class="heading-sub">Guarda tu historial y personaliza tus resultados.</p>
      </section>

      <!-- Google primero (hallazgo UX: es la opción de menor fricción, un toque
           sin escribir nada) con divisor antes del formulario de email/password. -->
      <button type="button" id="btn-google">Continuar con Google</button>
      <div class="auth-divider">o con tu correo</div>

      <form id="login-form" novalidate>
        <label for="login-email">Correo electrónico</label>
        <input id="login-email" type="email" required autocomplete="email" placeholder="tucorreo@ejemplo.com">

        <label for="login-password">Contraseña</label>
        <div class="password-field-wrap">
          <input id="login-password" type="password" required minlength="6" autocomplete="current-password" placeholder="Mínimo 6 caracteres">
          <button type="button" id="btn-toggle-password" class="btn-toggle-password" aria-label="Mostrar contraseña">Ver</button>
        </div>

        <!-- Solo visibles/requeridos en modo signup — auth-ui.js los muestra vía
             #signup-only cuando el usuario elige "Crear cuenta" (hallazgo legal:
             sin esto no se puede facturar una suscripción sin evidencia de
             aceptación de términos, ni verificar declaración de edad). -->
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
        </div>

        <button type="submit" id="btn-login">Iniciar sesión</button>
        <button type="button" id="btn-signup">Crear cuenta nueva</button>
      </form>

      <p id="auth-error" class="hidden" role="alert"></p>
    </main>
  </div>
  <script type="module" src="firebase-init.js"></script>
  <script type="module" src="auth-ui.js"></script>
</body>
</html>
```

**Nota (hallazgo legal, no resuelto en este task):** `/terminos.html` y `/privacidad.html` ya existen en el repo (`terminos.html`, `privacidad.html` en la raíz) pero su CONTENIDO no fue auditado ni actualizado como parte de este plan — falta confirmar que mencionan explícitamente el tratamiento de datos de salud (LFPDPPP art. 3/VI), la política de suscripción/cancelación, y que declaran la jurisdicción aplicable dado el alcance LATAM. Esa redacción es una tarea de producto/legal separada, fuera de código.

```js
// auth-ui.js
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
      // no era type="submit" e ignoraba required/minlength del &lt;input&gt;,
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
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/auth-ui.test.js`

- [ ] **Step 5: Commit**

```bash
git add auth.html auth-ui.js tests/auth-ui.test.js
git commit -m "feat(auth): add email/password + Google sign-in UI"
```

---

### Task 12: Módulo `authClient.js` (sesión, token, perfil cacheado)

**Files:**
- Create: `authClient.js`
- Modify: `index.html:118` (ya agregado en Task 10 como parte del mismo wiring)
- Test: `tests/authClient.test.js`

**Interfaces:**
- Consumes: `firebaseAuth`, `onAuthStateChanged` desde `./firebase-init.js` (Task 10); backend `POST /api/auth/sync` (Task 4) y `GET /api/me` (Task 5), ambos con header `Authorization: Bearer <idToken>`.
- Produces: `authClient.js` exporta (ESM) `getIdToken(forceRefresh?)`, `onAuthChange(callback)`, `syncUserProfile()`, `getCachedProfile()` — y expone `window.authClient = { getIdToken, onAuthChange, syncUserProfile, getCachedProfile }` para que `app.js` (script clásico) los consuma en Task 14. `getCachedProfile()` regresa el objeto cacheado de `GET /api/me` (o `null`) — Task 14 lo usa para decidir si pasar `preferences` a `computeVerdict`, Task 15 lo usa para precargar el formulario de preferencias.

- [ ] **Step 1: Escribe el test que falla**

```js
// tests/authClient.test.js
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuth = { currentUser: null }
const onAuthStateChanged = vi.fn()

vi.mock('../firebase-init.js', () => ({
  firebaseAuth: mockAuth,
  onAuthStateChanged
}))

let getIdToken, onAuthChange, syncUserProfile, getCachedProfile

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  mockAuth.currentUser = null
  global.fetch = vi.fn()
  const mod = await import('../authClient.js')
  getIdToken = mod.getIdToken
  onAuthChange = mod.onAuthChange
  syncUserProfile = mod.syncUserProfile
  getCachedProfile = mod.getCachedProfile
})

describe('onAuthChange', () => {
  it('wraps onAuthStateChanged with the firebaseAuth instance', () => {
    const cb = vi.fn()
    onAuthChange(cb)
    expect(onAuthStateChanged).toHaveBeenCalledWith(mockAuth, cb)
  })
})

describe('getIdToken', () => {
  it('returns null when there is no signed-in user', async () => {
    mockAuth.currentUser = null
    const token = await getIdToken()
    expect(token).toBeNull()
  })

  it('returns the token from the current user, forcing refresh when requested', async () => {
    const getIdTokenMock = vi.fn().mockResolvedValue('fresh-token')
    mockAuth.currentUser = { getIdToken: getIdTokenMock }
    const token = await getIdToken(true)
    expect(getIdTokenMock).toHaveBeenCalledWith(true)
    expect(token).toBe('fresh-token')
  })
})

describe('syncUserProfile', () => {
  it('returns null and does not call fetch when there is no signed-in user', async () => {
    mockAuth.currentUser = null
    const profile = await syncUserProfile()
    expect(profile).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('POSTs to /api/auth/sync then GETs /api/me with the Bearer token, and caches the response', async () => {
    mockAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('tok-123') }
    global.fetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: 'premium', preferences: { dietary: ['vegan'] } }) })

    const profile = await syncUserProfile()

    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/auth/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-123' }
    })
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/me', {
      headers: { Authorization: 'Bearer tok-123' }
    })
    expect(profile).toEqual({ plan: 'premium', preferences: { dietary: ['vegan'] } })
    expect(getCachedProfile()).toEqual({ plan: 'premium', preferences: { dietary: ['vegan'] } })
  })

  it('clears the cached profile when GET /api/me fails', async () => {
    mockAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('tok-123') }
    global.fetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false })

    const profile = await syncUserProfile()
    expect(profile).toBeNull()
    expect(getCachedProfile()).toBeNull()
  })
})

describe('window.authClient', () => {
  it('exposes the four functions for non-module scripts', async () => {
    expect(window.authClient.getIdToken).toBe(getIdToken)
    expect(window.authClient.onAuthChange).toBe(onAuthChange)
    expect(window.authClient.syncUserProfile).toBe(syncUserProfile)
    expect(window.authClient.getCachedProfile).toBe(getCachedProfile)
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/authClient.test.js`
Expected: `Cannot find module '../authClient.js'`

- [ ] **Step 3: Implementación mínima**

```js
// authClient.js
import { firebaseAuth, onAuthStateChanged } from './firebase-init.js';

let cachedProfile = null;

export function onAuthChange(callback) {
  return onAuthStateChanged(firebaseAuth, callback);
}

export async function getIdToken(forceRefresh = false) {
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

export async function syncUserProfile() {
  const token = await getIdToken();
  if (!token) {
    cachedProfile = null;
    return null;
  }

  await fetch('/api/auth/sync', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });

  const res = await fetch('/api/me', {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    cachedProfile = null;
    return null;
  }

  cachedProfile = await res.json();
  return cachedProfile;
}

export function getCachedProfile() {
  return cachedProfile;
}

window.authClient = { getIdToken, onAuthChange, syncUserProfile, getCachedProfile };
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/authClient.test.js`

- [ ] **Step 5: Commit**

```bash
git add authClient.js index.html tests/authClient.test.js
git commit -m "feat(auth): add authClient module for token access, auth state, and cached profile sync"
```

---

### Task 13: Extender `computeVerdict(product, userPreferences)` con las 5 reglas de precedencia

**Files:**
- Modify: `app.js:1595-1606`
- Test: `tests/app.test.js` (agregar `computeVerdict`, `hasNoRealData` a la lista exportada)

**Interfaces:**
- Consumes: `product.allergens`, `product.notRecommended`, `product.dietary`, `product.sellos`; `COMMON_ALLERGENS` (línea 80, ya existente); `userPreferences` con la forma exacta del spec: `{ dietary: string[], allergens: {code, severity}[], healthConditions: string[] }`.
- Produces: `computeVerdict(product, userPreferences)` — retrocompatible (`computeVerdict(product)` sin segundo argumento se comporta igual que antes). Task 14 la consume pasando `userPreferences` cacheado por `authClient.js`.

- [ ] **Step 1: Escribe el test que falla**

Agregar al arreglo de imports en `tests/app.test.js` (líneas 13 y 16-24):

```js
let parseApiProduct, isGlutenRelated, extractDietaryFromLabels, eanChecksum, expandUpcE, validateBarcode, computeVerdict, hasNoRealData

beforeAll(() => {
  const fn = new Function(appCode + '\nreturn { parseApiProduct, isGlutenRelated, extractDietaryFromLabels, eanChecksum, expandUpcE, validateBarcode, computeVerdict, hasNoRealData }')
  const exports = fn()
  parseApiProduct = exports.parseApiProduct
  isGlutenRelated = exports.isGlutenRelated
  extractDietaryFromLabels = exports.extractDietaryFromLabels
  eanChecksum = exports.eanChecksum
  expandUpcE = exports.expandUpcE
  validateBarcode = exports.validateBarcode
  computeVerdict = exports.computeVerdict
  hasNoRealData = exports.hasNoRealData
})
```

Y agregar (nuevo bloque `describe`, al final del archivo):

```js
// ─── computeVerdict (personalización premium) ──────────────

describe('computeVerdict — sin userPreferences (retrocompatibilidad)', () => {
  it('regresa "regular" cuando no hay datos reales', () => {
    const product = { isFromFallback: true, sellos: [], notRecommended: [] }
    expect(computeVerdict(product)).toBe('regular')
  })

  it('regresa "sano" sin sellos ni notRecommended', () => {
    const product = { sellos: [], notRecommended: [] }
    expect(computeVerdict(product)).toBe('sano')
  })

  it('regresa "evitar" con 3+ sellos', () => {
    const product = { sellos: ['a', 'b', 'c'], notRecommended: [] }
    expect(computeVerdict(product)).toBe('evitar')
  })

  it('undefined como segundo argumento se comporta igual que sin argumento', () => {
    const product = { sellos: ['a'], notRecommended: [] }
    expect(computeVerdict(product, undefined)).toBe(computeVerdict(product))
  })
})

describe('computeVerdict — con userPreferences', () => {
  it('Regla 1: alérgeno severity "severe" detectado → evitar, incluso si el producto sería "sano"', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Cacahuate'] }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'severe' }], dietary: [], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('evitar')
  })

  it('Regla 1: no aplica si el alérgeno severo no está en product.allergens', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Huevo'] }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'severe' }], dietary: [], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('sano')
  })

  it('Regla 2: healthCondition matchea un grupo certain:true en notRecommended → evitar', () => {
    const product = { sellos: [], notRecommended: [{ grupo: 'Diabéticos', razon: 'Alto en azúcares', certain: true }] }
    const prefs = { allergens: [], dietary: [], healthConditions: ['diabet'] }
    expect(computeVerdict(product, prefs)).toBe('evitar')
  })

  it('Regla 2: no aplica si el grupo notRecommended no es certain:true', () => {
    const product = { sellos: [], notRecommended: [{ grupo: 'Diabéticos', razon: 'Posible', certain: false }] }
    const prefs = { allergens: [], dietary: [], healthConditions: ['diabet'] }
    expect(computeVerdict(product, prefs)).toBe('sano')
  })

  it('Regla 3: dieta violada explícitamente (dietary.vegan === false) → evitar', () => {
    const product = { sellos: [], notRecommended: [], dietary: { vegan: false } }
    const prefs = { allergens: [], dietary: ['vegan'], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('evitar')
  })

  it('Regla 3: no aplica si dietary[key] es null/undefined (sin datos, no violación)', () => {
    const product = { sellos: [], notRecommended: [], dietary: { vegan: null } }
    const prefs = { allergens: [], dietary: ['vegan'], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('sano')
  })

  it('Regla 4: alérgeno mild detectado topa "sano" a "regular"', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Lácteos'] }
    const prefs = { allergens: [{ code: 'leche', severity: 'mild' }], dietary: [], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('regular')
  })

  it('Regla 4: no sube el verdict si ya era "regular" o "evitar" por otras causas', () => {
    const product = { sellos: ['a'], notRecommended: [], allergens: ['Lácteos'] }
    const prefs = { allergens: [{ code: 'leche', severity: 'mild' }], dietary: [], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('regular')
  })

  it('Regla 5: sin conflictos, comportamiento normal', () => {
    const product = { sellos: [], notRecommended: [], allergens: [], dietary: {} }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'severe' }], dietary: ['vegan'], healthConditions: ['diabet'] }
    expect(computeVerdict(product, prefs)).toBe('sano')
  })

  it('precedencia: Regla 1 (severe) gana sobre Regla 3 (dieta) si ambas aplican', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Cacahuate'], dietary: { vegan: false } }
    const prefs = {
      allergens: [{ code: 'cacahuate', severity: 'severe' }],
      dietary: ['vegan'],
      healthConditions: []
    }
    expect(computeVerdict(product, prefs)).toBe('evitar')
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/app.test.js`
Expected: `computeVerdict is not a function` / `undefined`

- [ ] **Step 3: Implementación mínima**

Reemplaza `app.js:1595-1606`:

```js
// Normalizador de grupos de salud — misma lógica que el normalizador inline
// usado al mergear notRecommended de IA (ver línea ~2094): colapsa variantes
// de texto ("Diabéticos", "Diabetes") a una clave estable ("diabet") para
// poder compararla 1:1 contra userPreferences.healthConditions.
function grupoClaveVerdict(s) {
  const n = String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n.includes('diabet')) return 'diabet';
  if (n.includes('hipert')) return 'hipert';
  if (n.includes('lact')) return 'lactos';
  if (n.includes('fenilc')) return 'fenilc';
  if (n.includes('celiac') || n.includes('celiaq')) return 'celiac';
  if (n.includes('gluten')) return 'gluten';
  if (n.includes('nino') || n.includes('ninos') || n.includes('menor')) return 'ninos';
  return n;
}

// True cuando product.allergens (labels detectados, ej. "Lácteos", "Cacahuate")
// incluye el alérgeno identificado por `code` (ej. "leche", "cacahuate") —
// usa COMMON_ALLERGENS para traducir entre el code canónico de userPreferences
// y el label que ya usa el pipeline de parseApiProduct.
function isAllergenDetected(product, code) {
  if (!product.allergens || !Array.isArray(product.allergens)) return false;
  const codeLower = String(code).toLowerCase();
  const entry = COMMON_ALLERGENS.find(ca =>
    ca.match.some(m => m.toLowerCase() === codeLower) || ca.label.toLowerCase() === codeLower
  );
  const namesToMatch = entry
    ? [entry.label.toLowerCase(), ...entry.match.map(m => m.toLowerCase())]
    : [codeLower];
  return product.allergens.some(a => namesToMatch.includes(String(a).toLowerCase()));
}

// Verdict base SANO/REGULAR/EVITAR — misma lógica de siempre (NOM-051 sellos +
// notRecommended groups), sin conocimiento de preferencias de usuario.
// Never returns 'sano' when there's no real data to base that on — absence of
// seals/risk flags on an empty fallback record is not evidence of safety.
function computeBaseVerdict(product) {
  if (hasNoRealData(product)) return 'regular';
  const sellos = (product.sellos || []).length;
  const critical = (product.notRecommended || []).some(n => n.certain !== false);
  if (sellos >= 3 || (critical && sellos >= 2)) return 'evitar';
  if (sellos >= 1 || critical) return 'regular';
  return 'sano';
}

// Deriva el verdict SANO/REGULAR/EVITAR. `userPreferences` es opcional — si es
// null/undefined (usuario free o no logueado), el comportamiento es idéntico
// al de computeBaseVerdict (retrocompatible). Cuando se pasa, aplica 5 reglas
// de precedencia en orden — la primera que aplique gana:
//   1. Alérgeno severity:"severe" detectado en el producto → evitar.
//   2. healthCondition que matchea un grupo certain:true en notRecommended → evitar.
//   3. Dieta declarada explícitamente violada (product.dietary[key] === false) → evitar.
//   4. Alérgeno severity:"mild" detectado → tope "regular" (no sube a "sano").
//   5. Sin conflictos → verdict base normal.
function computeVerdict(product, userPreferences) {
  const base = computeBaseVerdict(product);
  if (!userPreferences) return base;

  const allergens = userPreferences.allergens || [];
  const healthConditions = userPreferences.healthConditions || [];
  const dietary = userPreferences.dietary || [];

  const severeHit = allergens.some(a => a && a.severity === 'severe' && isAllergenDetected(product, a.code));
  if (severeHit) return 'evitar';

  const conditionHit = healthConditions.some(cond =>
    (product.notRecommended || []).some(n => n.certain === true && grupoClaveVerdict(n.grupo) === cond)
  );
  if (conditionHit) return 'evitar';

  const dietHit = dietary.some(key => product.dietary && product.dietary[key] === false);
  if (dietHit) return 'evitar';

  const mildHit = allergens.some(a => a && a.severity === 'mild' && isAllergenDetected(product, a.code));
  if (mildHit && base === 'sano') return 'regular';

  return base;
}
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/app.test.js`

- [ ] **Step 5: Commit**

```bash
git add app.js tests/app.test.js
git commit -m "feat(verdict): add optional userPreferences param to computeVerdict with 5-rule precedence"
```

---

### Task 14: Wiring — pasar `userPreferences` cacheado en el punto de llamada a `computeVerdict`

**Files:**
- Modify: `app.js:1627-1628` (nueva función helper antes de `renderProductData`), `app.js:1640` (cambia la llamada a `computeVerdict`)
- Test: `tests/app.test.js` (agregar `getUserPreferencesForVerdict` a la lista exportada + nuevo `describe`)

**Interfaces:**
- Consumes: `window.authClient.getCachedProfile()` (Task 12); `computeVerdict(product, userPreferences)` (Task 13).
- Produces: `getUserPreferencesForVerdict()` — función interna de `app.js`, reutilizable si otro punto necesita las mismas preferencias cacheadas (ej. Task 15 la reutiliza para precargar el formulario de preferencias).

- [ ] **Step 1: Escribe el test que falla**

Agregar `getUserPreferencesForVerdict` al `let` y al `return` del `beforeAll` en `tests/app.test.js`:

```js
let parseApiProduct, isGlutenRelated, extractDietaryFromLabels, eanChecksum, expandUpcE, validateBarcode, computeVerdict, hasNoRealData, getUserPreferencesForVerdict, renderPersonalizedDisclaimer

beforeAll(() => {
  const fn = new Function(appCode + '\nreturn { parseApiProduct, isGlutenRelated, extractDietaryFromLabels, eanChecksum, expandUpcE, validateBarcode, computeVerdict, hasNoRealData, getUserPreferencesForVerdict, renderPersonalizedDisclaimer }')
  const exports = fn()
  parseApiProduct = exports.parseApiProduct
  isGlutenRelated = exports.isGlutenRelated
  extractDietaryFromLabels = exports.extractDietaryFromLabels
  eanChecksum = exports.eanChecksum
  expandUpcE = exports.expandUpcE
  validateBarcode = exports.validateBarcode
  computeVerdict = exports.computeVerdict
  hasNoRealData = exports.hasNoRealData
  getUserPreferencesForVerdict = exports.getUserPreferencesForVerdict
  renderPersonalizedDisclaimer = exports.renderPersonalizedDisclaimer
})
```

Nuevo bloque `describe` al final de `tests/app.test.js`:

```js
// ─── getUserPreferencesForVerdict (wiring con authClient) ───

describe('getUserPreferencesForVerdict', () => {
  afterEach(() => {
    delete window.authClient
  })

  it('regresa null cuando window.authClient no existe (usuario no logueado, authClient.js no cargó)', () => {
    delete window.authClient
    expect(getUserPreferencesForVerdict()).toBeNull()
  })

  it('regresa null cuando no hay perfil cacheado todavía', () => {
    window.authClient = { getCachedProfile: () => null }
    expect(getUserPreferencesForVerdict()).toBeNull()
  })

  it('regresa null cuando el usuario es "free" (aunque tenga preferences)', () => {
    window.authClient = { getCachedProfile: () => ({ plan: 'free', preferences: { dietary: ['vegan'] } }) }
    expect(getUserPreferencesForVerdict()).toBeNull()
  })

  it('regresa preferences cuando el usuario es "premium" y tiene preferences', () => {
    const prefs = { dietary: ['vegan'], allergens: [], healthConditions: [] }
    window.authClient = { getCachedProfile: () => ({ plan: 'premium', preferences: prefs }) }
    expect(getUserPreferencesForVerdict()).toEqual(prefs)
  })

  it('regresa null cuando el usuario es "premium" pero preferences está ausente (sin consentimiento aún)', () => {
    window.authClient = { getCachedProfile: () => ({ plan: 'premium' }) }
    expect(getUserPreferencesForVerdict()).toBeNull()
  })
})

// ─── Disclaimer médico (hallazgo de revisión legal) ─────────

describe('renderPersonalizedDisclaimer', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="verdict-banner"></div><p id="personalized-disclaimer" class="hidden"></p>'
  })

  it('muestra el disclaimer cuando el veredicto SÍ fue personalizado (userPreferences no nulo)', () => {
    renderPersonalizedDisclaimer({ dietary: ['vegan'], allergens: [], healthConditions: [] })
    const el = document.getElementById('personalized-disclaimer')
    expect(el.classList.contains('hidden')).toBe(false)
    expect(el.textContent).toMatch(/no sustituye el consejo/i)
  })

  it('no muestra nada cuando no hubo personalización (usuario free o sin preferences)', () => {
    renderPersonalizedDisclaimer(null)
    expect(document.getElementById('personalized-disclaimer').classList.contains('hidden')).toBe(true)
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/app.test.js`
Expected: `getUserPreferencesForVerdict` no existe (`undefined is not a function`)

- [ ] **Step 3: Implementación mínima**

Insertar antes de `function renderProductData(product, barcode) {` (`app.js:1628`):

```js
// Preferencias del usuario logueado+premium para personalizar computeVerdict.
// null si: no está logueado (window.authClient no existe o no hay perfil
// cacheado todavía), si es plan "free", o si es premium pero aún no configuró
// preferences (requiere consentimiento expreso — ver spec de privacidad).
function getUserPreferencesForVerdict() {
  if (typeof window === 'undefined' || !window.authClient || typeof window.authClient.getCachedProfile !== 'function') {
    return null;
  }
  const profile = window.authClient.getCachedProfile();
  if (!profile || profile.plan !== 'premium' || !profile.preferences) return null;
  return profile.preferences;
}

// Disclaimer médico (hallazgo de revisión legal): un veredicto personalizado
// por condiciones de salud (diabetes/celiaquía/etc.) puede leerse como consejo
// médico automatizado. Se muestra SOLO cuando la personalización se aplicó de
// verdad (userPreferences no nulo) — no le agrega ruido a la experiencia free.
function renderPersonalizedDisclaimer(userPreferences) {
  const el = document.getElementById('personalized-disclaimer');
  if (!el) return;
  if (!userPreferences) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = 'Este resultado considera tus preferencias guardadas y no sustituye el consejo de un profesional de la salud.';
  el.classList.remove('hidden');
}
```

Cambiar `app.js:1640`:

```js
  const userPreferences = getUserPreferencesForVerdict();
  const verdict = computeVerdict(product, userPreferences);
  renderPersonalizedDisclaimer(userPreferences);
```

Agregar en `index.html`/`scan.html`, junto al `verdict-banner` existente (mismo contenedor de resultado):

```html
<p id="personalized-disclaimer" class="hidden" style="font-size:12px;color:#6b6b6b;margin-top:8px;"></p>
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/app.test.js`

- [ ] **Step 5: Commit**

```bash
git add app.js tests/app.test.js
git commit -m "feat(verdict): wire cached premium user preferences into computeVerdict at render time"
```

---

### Task 15: UI de preferencias premium (dietary/alergias/condiciones de salud + consentimiento LFPDPPP)

**Files:**
- Create: `preferences.html`
- Create: `preferences-ui.js`
- Test: `tests/preferences-ui.test.js`

**Interfaces:**
- Consumes: `getIdToken()`, `getCachedProfile()` (Task 12, `authClient.js`); backend `PUT /api/me/preferences` (Task 6) y `DELETE /api/me/preferences` (Task 7).
- Produces: `preferences-ui.js` exporta `loadPreferencesIntoForm()`, `savePreferences(formData)`, `deletePreferences()`. Cierra el hueco que ninguno de los 2 subsistemas cubrió: sin esta pantalla, `preferences` nunca se llena y la personalización de Task 13/14 nunca se activa en la práctica.

- [ ] **Step 1: Escribe el test que falla**

```js
// tests/preferences-ui.test.js
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getIdToken = vi.fn()
const getCachedProfile = vi.fn()

vi.mock('../authClient.js', () => ({ getIdToken, getCachedProfile }))

let loadPreferencesIntoForm, savePreferences, deletePreferences

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  global.fetch = vi.fn()
  document.body.innerHTML = `
    <form id="preferences-form">
      <input type="checkbox" name="dietary" value="vegan">
      <input type="checkbox" name="dietary" value="glutenFree">
      <input type="checkbox" name="healthConditions" value="diabet">
      <input type="checkbox" id="allergen-cacahuate" name="allergen" value="cacahuate">
      <select id="severity-cacahuate"><option value="mild">Leve</option><option value="severe">Severa</option></select>
      <div class="consent-block">
        <input type="checkbox" id="consent-checkbox" required>
        <p id="consent-error" class="hidden" role="alert"></p>
      </div>
      <button type="submit" id="btn-save-preferences">Guardar</button>
    </form>
    <button id="btn-delete-preferences">Borrar mis preferencias</button>
    <p id="preferences-error" class="hidden" role="alert"></p>
  `
  const mod = await import('../preferences-ui.js')
  loadPreferencesIntoForm = mod.loadPreferencesIntoForm
  savePreferences = mod.savePreferences
  deletePreferences = mod.deletePreferences
})

describe('loadPreferencesIntoForm', () => {
  it('marca los checkboxes según el perfil cacheado', () => {
    getCachedProfile.mockReturnValue({
      plan: 'premium',
      preferences: { dietary: ['vegan'], allergens: [{ code: 'cacahuate', severity: 'severe' }], healthConditions: ['diabet'] }
    })
    loadPreferencesIntoForm()
    expect(document.querySelector('[name="dietary"][value="vegan"]').checked).toBe(true)
    expect(document.querySelector('[name="dietary"][value="glutenFree"]').checked).toBe(false)
    expect(document.querySelector('[name="healthConditions"][value="diabet"]').checked).toBe(true)
    expect(document.getElementById('allergen-cacahuate').checked).toBe(true)
    expect(document.getElementById('severity-cacahuate').value).toBe('severe')
  })

  it('no marca nada si no hay preferences aún (usuario premium sin configurar)', () => {
    getCachedProfile.mockReturnValue({ plan: 'premium' })
    loadPreferencesIntoForm()
    expect(document.querySelector('[name="dietary"][value="vegan"]').checked).toBe(false)
  })
})

describe('savePreferences', () => {
  it('rechaza guardar si el checkbox de consentimiento no está marcado, y muestra el error JUNTO al checkbox (hallazgo UX: antes solo aparecía en #preferences-error, lejos si el form es largo)', async () => {
    document.getElementById('consent-checkbox').checked = false
    await expect(savePreferences()).rejects.toThrow(/consentimiento/i)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(document.getElementById('consent-error').classList.contains('hidden')).toBe(false)
  })

  it('llama PUT /api/me/preferences con Bearer token, consent:true y el body construido del form, si hay consentimiento (hallazgo legal/seguridad: el servidor ahora exige consent explícito, no solo el cliente)', async () => {
    document.getElementById('consent-checkbox').checked = true
    document.querySelector('[name="dietary"][value="vegan"]').checked = true
    document.getElementById('allergen-cacahuate').checked = true
    document.getElementById('severity-cacahuate').value = 'severe'
    document.querySelector('[name="healthConditions"][value="diabet"]').checked = true
    getIdToken.mockResolvedValue('tok-123')
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    await savePreferences()

    expect(global.fetch).toHaveBeenCalledWith('/api/me/preferences', {
      method: 'PUT',
      headers: { Authorization: 'Bearer tok-123', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dietary: ['vegan'],
        allergens: [{ code: 'cacahuate', severity: 'severe' }],
        healthConditions: ['diabet'],
        consent: true,
        consentNoticeVersion: 'v1'
      })
    })
  })

  it('muestra el error del backend cuando PUT falla (ej. 403 premium_required)', async () => {
    document.getElementById('consent-checkbox').checked = true
    getIdToken.mockResolvedValue('tok-123')
    global.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'premium_required' }) })

    await expect(savePreferences()).rejects.toThrow()
    expect(document.getElementById('preferences-error').classList.contains('hidden')).toBe(false)
  })

  it('deshabilita el botón de guardar mientras dura la petición (hallazgo UX)', async () => {
    document.getElementById('consent-checkbox').checked = true
    let resolveFetch
    getIdToken.mockResolvedValue('tok-123')
    global.fetch.mockReturnValueOnce(new Promise(resolve => { resolveFetch = resolve }))
    const btn = document.getElementById('btn-save-preferences')
    const promise = savePreferences()
    expect(btn.disabled).toBe(true)
    resolveFetch({ ok: true, json: async () => ({ ok: true }) })
    await promise
    expect(btn.disabled).toBe(false)
  })
})

describe('deletePreferences', () => {
  it('llama DELETE /api/me/preferences con Bearer token', async () => {
    getIdToken.mockResolvedValue('tok-456')
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    await deletePreferences()

    expect(global.fetch).toHaveBeenCalledWith('/api/me/preferences', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok-456' }
    })
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/preferences-ui.test.js`
Expected: `Cannot find module '../preferences-ui.js'`

- [ ] **Step 3: Implementación mínima**

```html
<!-- preferences.html -->
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://images.openfoodfacts.org https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-src https://*.firebaseapp.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self';">
  <title>Yomi — Mis preferencias</title>
  <link rel="stylesheet" href="home.css?v=15">
  <link rel="stylesheet" href="styles.css?v=15">
  <style>
    .hidden { display: none !important; }
    /* Jerarquía visual distinta al resto del form (hallazgo UX) — el
       consentimiento de datos de salud no debe pesar igual que un checkbox
       de dieta, o se skimea sin leerse. */
    .consent-block { border: 1px solid #c8ddd6; border-radius: 8px; padding: 14px; margin: 16px 0; background: #f4faf8; }
    .medical-disclaimer { font-size: 13px; color: #6b6b6b; margin: 8px 0 16px; }
    /* Select fuera del <label> del checkbox (hallazgo UX/accesibilidad): anidado
       adentro, tocar el select puede disparar el toggle del checkbox en algunos
       navegadores móviles. Tap targets con padding >= 44px. */
    .allergen-row { display: flex; align-items: center; gap: 8px; padding: 10px 0; min-height: 44px; }
  </style>
</head>
<body>
  <div class="app-shell">
    <header class="app-header"><h1>Mis preferencias</h1></header>
    <main class="app-main">
      <p class="medical-disclaimer">
        Este resultado es una guía informativa basada en tus preferencias y no
        sustituye el consejo de un profesional de la salud. Ante cualquier
        duda médica, consulta a tu médico.
      </p>
      <form id="preferences-form">
        <fieldset>
          <legend>Dietas</legend>
          <label><input type="checkbox" name="dietary" value="vegan"> Vegano</label>
          <label><input type="checkbox" name="dietary" value="vegetarian"> Vegetariano</label>
          <label><input type="checkbox" name="dietary" value="keto"> Keto</label>
          <label><input type="checkbox" name="dietary" value="glutenFree"> Sin gluten</label>
        </fieldset>
        <fieldset>
          <legend>Alergias</legend>
          <div class="allergen-row">
            <input type="checkbox" id="allergen-cacahuate" name="allergen" value="cacahuate">
            <label for="allergen-cacahuate">Cacahuate</label>
            <select id="severity-cacahuate"><option value="mild">Aviso</option><option value="severe">Estricto</option></select>
          </div>
          <div class="allergen-row">
            <input type="checkbox" id="allergen-lacteos" name="allergen" value="lacteos">
            <label for="allergen-lacteos">Lácteos</label>
            <select id="severity-lacteos"><option value="mild">Aviso</option><option value="severe">Estricto</option></select>
          </div>
        </fieldset>
        <fieldset>
          <legend>Condiciones de salud</legend>
          <label><input type="checkbox" name="healthConditions" value="diabet"> Diabetes</label>
          <label><input type="checkbox" name="healthConditions" value="celiac"> Celiaquía</label>
          <label><input type="checkbox" name="healthConditions" value="hipert"> Hipertensión</label>
          <label><input type="checkbox" name="healthConditions" value="ninos"> También compro para niños en casa</label>
        </fieldset>
        <div class="consent-block">
          <label>
            <input type="checkbox" id="consent-checkbox" required>
            Doy mi consentimiento expreso para que Yomi guarde y use estos datos de salud
            únicamente para personalizar mis resultados de escaneo, según el
            <a href="/privacidad.html" target="_blank" rel="noopener">Aviso de Privacidad</a>.
          </label>
          <p id="consent-error" class="hidden" role="alert"></p>
        </div>
        <button type="submit" id="btn-save-preferences">Guardar</button>
      </form>
      <button id="btn-delete-preferences">Borrar mis preferencias</button>
      <p id="preferences-error" class="hidden" role="alert"></p>
    </main>
  </div>
  <script type="module" src="firebase-init.js"></script>
  <script type="module" src="authClient.js"></script>
  <script type="module" src="preferences-ui.js"></script>
</body>
</html>
```

```js
// preferences-ui.js
import { getIdToken, getCachedProfile } from './authClient.js';

const ALLERGEN_CODES = ['cacahuate', 'lacteos'];
const CONSENT_NOTICE_VERSION = 'v1';

function showError(message) {
  const el = document.getElementById('preferences-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearError() {
  const el = document.getElementById('preferences-error');
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

// Error mostrado JUNTO al checkbox de consentimiento, no solo en el error
// general del form (hallazgo UX: si el form es largo, el usuario no conecta
// el error de arriba con el checkbox que le falta marcar).
function showConsentError(message) {
  const el = document.getElementById('consent-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearConsentError() {
  const el = document.getElementById('consent-error');
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

async function withLoadingState(button, loadingText, fn) {
  const originalText = button ? button.textContent : null;
  if (button) { button.disabled = true; button.textContent = loadingText; }
  try {
    return await fn();
  } finally {
    if (button) { button.disabled = false; button.textContent = originalText; }
  }
}

export function loadPreferencesIntoForm() {
  const profile = getCachedProfile();
  const prefs = profile && profile.preferences;
  if (!prefs) return;

  (prefs.dietary || []).forEach(key => {
    const el = document.querySelector(`[name="dietary"][value="${key}"]`);
    if (el) el.checked = true;
  });
  (prefs.healthConditions || []).forEach(key => {
    const el = document.querySelector(`[name="healthConditions"][value="${key}"]`);
    if (el) el.checked = true;
  });
  (prefs.allergens || []).forEach(({ code, severity }) => {
    const checkbox = document.getElementById(`allergen-${code}`);
    const severitySelect = document.getElementById(`severity-${code}`);
    if (checkbox) checkbox.checked = true;
    if (severitySelect) severitySelect.value = severity;
  });
}

function buildPreferencesPayload() {
  const dietary = Array.from(document.querySelectorAll('[name="dietary"]:checked')).map(el => el.value);
  const healthConditions = Array.from(document.querySelectorAll('[name="healthConditions"]:checked')).map(el => el.value);
  const allergens = ALLERGEN_CODES
    .filter(code => document.getElementById(`allergen-${code}`)?.checked)
    .map(code => ({ code, severity: document.getElementById(`severity-${code}`).value }));
  return { dietary, allergens, healthConditions };
}

export async function savePreferences() {
  clearError();
  clearConsentError();
  const consentChecked = document.getElementById('consent-checkbox')?.checked;
  if (!consentChecked) {
    const message = 'Falta el consentimiento expreso para guardar datos de salud';
    showConsentError(message);
    throw new Error(message);
  }

  const btn = document.getElementById('btn-save-preferences');
  return withLoadingState(btn, 'Guardando…', async () => {
    const token = await getIdToken();
    // consent:true + consentNoticeVersion viajan al servidor porque
    // putPreferencesHandler (Task 6) ahora los EXIGE — el checkbox de cliente
    // por sí solo no es evidencia demostrable de consentimiento expreso
    // (hallazgo legal/seguridad: una llamada directa al endpoint sin pasar por
    // este checkbox antes guardaba datos de salud igual).
    const payload = { ...buildPreferencesPayload(), consent: true, consentNoticeVersion: CONSENT_NOTICE_VERSION };
    const res = await fetch('/api/me/preferences', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showError(data.error === 'premium_required' ? 'Esta función es solo para cuentas premium.' : 'No se pudo guardar. Intenta de nuevo.');
      throw new Error(data.error || 'save_failed');
    }

    return res.json();
  });
}

export async function deletePreferences() {
  clearError();
  const btn = document.getElementById('btn-delete-preferences');
  return withLoadingState(btn, 'Borrando…', async () => {
    const token = await getIdToken();
    const res = await fetch('/api/me/preferences', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      showError('No se pudieron borrar tus preferencias. Intenta de nuevo.');
      throw new Error('delete_failed');
    }
    return res.json();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadPreferencesIntoForm();
  const form = document.getElementById('preferences-form');
  const btnDelete = document.getElementById('btn-delete-preferences');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      savePreferences().catch(() => {});
    });
  }
  if (btnDelete) {
    btnDelete.addEventListener('click', () => deletePreferences().catch(() => {}));
  }
});
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/preferences-ui.test.js`

- [ ] **Step 5: Commit**

```bash
git add preferences.html preferences-ui.js tests/preferences-ui.test.js
git commit -m "feat(preferences): add premium preferences UI with explicit LFPDPPP consent gate"
```

---

### Task 16: Historial de escaneos en la nube — capa de datos + endpoints (`users/{uid}/history/{scanId}`)

**Files:**
- Modify: `api/firestore.js` (nuevas funciones antes de `module.exports`, actualizar `module.exports`), `api/index.js:7` (extender require), `api/index.js` (nueva sección tras `--- User Accounts API ---`), `api/index.js` (module.exports)
- Test: `tests/firestore-history.test.js`, `tests/meHistory.test.js`

**Interfaces:**
- Consumes: `getAccessToken()`, `toFirestoreFields`/`fromFirestoreFields` (Task 3); `requireUser`, `fireGetUser` (Tasks 2, 3).
- Produces: `fireLogUserHistory(uid, entry): Promise<{id}>` (subcolección `users/{uid}/history`), `fireListUserHistory(uid, limit): Promise<entry[]>` (orden descendente por `scannedAt`); `postHistoryHandler(req, res)` en `POST /api/me/history` (premium only, 403 si free), `getHistoryHandler(req, res)` en `GET /api/me/history` (premium only). Consumido por Task 17.

- [ ] **Step 1: Escribe el test que falla**

```js
// tests/firestore-history.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import crypto from 'crypto'

const { fireLogUserHistory, fireListUserHistory } = await import('../api/firestore.js')

function fakeServiceAccountKey() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  })
  return JSON.stringify({
    project_id: 'foodscaner-test',
    client_email: 'test@foodscaner-test.iam.gserviceaccount.com',
    private_key: privateKey
  })
}

describe('users/{uid}/history subcollection', () => {
  const ORIGINAL_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = ORIGINAL_KEY
  })

  it('fireLogUserHistory POSTs a new doc to the history subcollection (auto-generated id)', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedUrl, capturedBody
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      capturedUrl = url
      capturedBody = JSON.parse(options.body)
      return { ok: true, status: 200, json: async () => ({ name: 'projects/x/databases/(default)/documents/users/uid-1/history/auto-id-123' }) }
    }))

    const result = await fireLogUserHistory('uid-1', { barcode: '7501055363057', productName: 'Nutella', verdict: 'regular', scannedAt: '2026-07-15T10:00:00.000Z' })

    expect(capturedUrl).toContain('/users/uid-1/history')
    expect(capturedBody.fields.barcode.stringValue).toBe('7501055363057')
    expect(result).toEqual({ id: 'auto-id-123' })
  })

  it('fireListUserHistory returns entries ordered by scannedAt desc, capped at the given limit', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedBody
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      capturedBody = JSON.parse(options.body)
      return {
        ok: true, status: 200,
        json: async () => ([
          { document: { fields: { barcode: { stringValue: '111' }, productName: { stringValue: 'A' }, verdict: { stringValue: 'sano' }, scannedAt: { stringValue: '2026-07-15T12:00:00.000Z' } } } },
          { document: { fields: { barcode: { stringValue: '222' }, productName: { stringValue: 'B' }, verdict: { stringValue: 'evitar' }, scannedAt: { stringValue: '2026-07-14T12:00:00.000Z' } } } }
        ])
      }
    }))

    const result = await fireListUserHistory('uid-1', 50)

    expect(capturedBody.structuredQuery.limit).toBe(50)
    expect(capturedBody.structuredQuery.orderBy[0]).toEqual({ field: { fieldPath: 'scannedAt' }, direction: 'DESCENDING' })
    expect(result).toEqual([
      { barcode: '111', productName: 'A', verdict: 'sano', scannedAt: '2026-07-15T12:00:00.000Z' },
      { barcode: '222', productName: 'B', verdict: 'evitar', scannedAt: '2026-07-14T12:00:00.000Z' }
    ])
  })

  it('fireListUserHistory returns an empty array when there are no entries', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      return { ok: true, status: 200, json: async () => ([{}]) }
    }))
    const result = await fireListUserHistory('uid-1', 50)
    expect(result).toEqual([])
  })
})
```

```js
// tests/meHistory.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/firestore.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, fireGetUser: vi.fn(), fireLogUserHistory: vi.fn(), fireListUserHistory: vi.fn() }
})

const { postHistoryHandler, getHistoryHandler } = await import('../api/index.js')
const { fireGetUser, fireLogUserHistory, fireListUserHistory } = await import('../api/firestore.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('postHistoryHandler', () => {
  beforeEach(() => { fireGetUser.mockReset(); fireLogUserHistory.mockReset() })

  it('responds 403 for a free-plan user, does not write', async () => {
    fireGetUser.mockResolvedValue({ plan: 'free' })
    const req = { user: { uid: 'uid-1' }, body: { barcode: '111', productName: 'A', verdict: 'sano' } }
    const res = makeRes()
    await postHistoryHandler(req, res)
    expect(res.statusCode).toBe(403)
    expect(fireLogUserHistory).not.toHaveBeenCalled()
  })

  it('logs the entry for a premium user with a server-set scannedAt', async () => {
    fireGetUser.mockResolvedValue({ plan: 'premium' })
    fireLogUserHistory.mockResolvedValue({ id: 'abc' })
    const req = { user: { uid: 'uid-2' }, body: { barcode: '111', productName: 'A', verdict: 'sano' } }
    const res = makeRes()
    await postHistoryHandler(req, res)
    expect(fireLogUserHistory).toHaveBeenCalledWith('uid-2', expect.objectContaining({ barcode: '111', productName: 'A', verdict: 'sano' }))
    expect(res.body).toEqual({ ok: true, id: 'abc' })
  })
})

describe('getHistoryHandler', () => {
  beforeEach(() => { fireGetUser.mockReset(); fireListUserHistory.mockReset() })

  it('responds 403 for a free-plan user', async () => {
    fireGetUser.mockResolvedValue({ plan: 'free' })
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()
    await getHistoryHandler(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('returns the entry list for a premium user', async () => {
    fireGetUser.mockResolvedValue({ plan: 'premium' })
    fireListUserHistory.mockResolvedValue([{ barcode: '111', productName: 'A', verdict: 'sano', scannedAt: 't' }])
    const req = { user: { uid: 'uid-2' } }
    const res = makeRes()
    await getHistoryHandler(req, res)
    expect(res.body).toEqual({ history: [{ barcode: '111', productName: 'A', verdict: 'sano', scannedAt: 't' }] })
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/firestore-history.test.js tests/meHistory.test.js`
Expected: `TypeError: fireLogUserHistory is not a function` / `TypeError: postHistoryHandler is not a function`

- [ ] **Step 3: Implementación mínima**

En `api/firestore.js`, antes de `module.exports` (después de las funciones de Task 8):

```js
async function fireLogUserHistory(uid, entry) {
  const token = await getAccessToken();
  if (!token) throw new Error('No Firestore access token');
  const fields = toFirestoreFields(entry);
  const resp = await fetch(`${BASE}/projects/${getProjectId()}/databases/(default)/documents/users/${encodeURIComponent(uid)}/history`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(5000)
  });
  if (!resp.ok) throw new Error(`Firestore log history failed: ${resp.status}`);
  const data = await resp.json();
  const id = data.name.split('/').pop();
  return { id };
}

async function fireListUserHistory(uid, limit = 50) {
  const token = await getAccessToken();
  if (!token) throw new Error('No Firestore access token');
  const resp = await fetch(`${BASE}/projects/${getProjectId()}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'history' }],
        orderBy: [{ field: { fieldPath: 'scannedAt' }, direction: 'DESCENDING' }],
        limit
      },
      parent: `projects/${getProjectId()}/databases/(default)/documents/users/${encodeURIComponent(uid)}`
    }),
    signal: AbortSignal.timeout(5000)
  });
  if (!resp.ok) throw new Error(`Firestore list history failed: ${resp.status}`);
  const rows = await resp.json();
  return rows.filter(r => r.document).map(r => fromFirestoreFields(r.document.fields || {}));
}
```

Actualizar `module.exports` (agregar a la lista ya extendida por Task 8):

```js
module.exports = {
  getAccessToken,
  fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache,
  fireGetOcrData, fireSetOcrData,
  fireGetNutritionOcr, fireSetNutritionOcr,
  fireListDocs, fireListAll, fireDeleteDoc, fireLogScan, fireMarkScanNotFound, fireMarkScanHasOcr, fireMarkScanHasNutrition, fireMarkScanConfidence, fireMarkScanSource, fireMarkScanSources, fireLogReport, ADMIN_COLLECTIONS,
  fireGetUser, fireUpsertUser, firePatchUserFields,
  fireGetUserRaw, firePatchUserFieldsWithPrecondition, fireIncrementUsageCounter,
  fireLogUserHistory, fireListUserHistory
};
```

En `api/index.js:7`, extender el destructure (agregar a la lista ya extendida por Task 9):

```js
const { getAccessToken, fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache, fireGetOcrData, fireSetOcrData, fireGetNutritionOcr, fireSetNutritionOcr, fireListDocs, fireListAll, fireDeleteDoc, fireLogScan, fireMarkScanNotFound, fireMarkScanHasOcr, fireMarkScanHasNutrition, fireMarkScanConfidence, fireMarkScanSource, fireMarkScanSources, fireLogReport, ADMIN_COLLECTIONS, fireUpsertUser, fireGetUser, firePatchUserFields, fireIncrementUsageCounter, fireLogUserHistory, fireListUserHistory } = require('./firestore');
```

Debajo de `deletePreferencesHandler`/su ruta:

```js
// Mismos 3 valores que devuelve computeVerdict (Task 13) — validado como enum
// (no string libre) para evitar guardar XSS almacenado que un futuro history.html
// renderizaría sin escapar (hallazgo de revisión de seguridad).
const ALLOWED_VERDICTS = ['sano', 'regular', 'evitar'];
const MAX_BARCODE_LEN = 32;
const MAX_PRODUCT_NAME_LEN = 200;

async function postHistoryHandler(req, res) {
  try {
    const user = await fireGetUser(req.user.uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    if (user.plan !== 'premium') return res.status(403).json({ error: 'premium_required' });

    const { barcode, productName, verdict } = req.body || {};
    if (!barcode || !productName || !verdict) return res.status(400).json({ error: 'invalid_history_entry' });
    if (typeof barcode !== 'string' || barcode.length > MAX_BARCODE_LEN) {
      return res.status(400).json({ error: 'invalid_barcode' });
    }
    if (typeof productName !== 'string' || productName.length > MAX_PRODUCT_NAME_LEN) {
      return res.status(400).json({ error: 'invalid_product_name' });
    }
    if (!ALLOWED_VERDICTS.includes(verdict)) {
      return res.status(400).json({ error: 'invalid_verdict' });
    }

    const { id } = await fireLogUserHistory(req.user.uid, {
      barcode, productName: productName.slice(0, MAX_PRODUCT_NAME_LEN), verdict, scannedAt: new Date().toISOString()
    });
    res.json({ ok: true, id });
  } catch (e) {
    console.warn('[POST /api/me/history] Firestore error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

async function getHistoryHandler(req, res) {
  try {
    const user = await fireGetUser(req.user.uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    if (user.plan !== 'premium') return res.status(403).json({ error: 'premium_required' });

    const history = await fireListUserHistory(req.user.uid, 50);
    res.json({ history });
  } catch (e) {
    console.warn('[GET /api/me/history] Firestore error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.post('/api/me/history', requireUser, postHistoryHandler);
app.get('/api/me/history', requireUser, getHistoryHandler);
```

Al final del archivo:

```js
module.exports.postHistoryHandler = postHistoryHandler;
module.exports.getHistoryHandler = getHistoryHandler;
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/firestore-history.test.js tests/meHistory.test.js`
Expected: `Test Files 2 passed (2)`

- [ ] **Step 5: Commit**

```bash
git add api/firestore.js api/index.js tests/firestore-history.test.js tests/meHistory.test.js
git commit -m "feat(history): add unlimited cloud scan history for premium users (subcollection + endpoints)"
```

---

### Task 17: Wiring — registrar cada escaneo premium en el historial de la nube

**Files:**
- Modify: `app.js:1627-1628` (extender `getUserPreferencesForVerdict`/agregar helper nuevo), `app.js:1640` (después de calcular `verdict`, disparar el registro)
- Test: `tests/app.test.js` (nuevo `describe`)

**Interfaces:**
- Consumes: `window.authClient.getCachedProfile()` (Task 12); backend `POST /api/me/history` (Task 16, vía `fetch` directo con `getIdToken()`).
- Produces: `logScanToCloudHistory(barcode, productName, verdict)` — función interna de `app.js`, fire-and-forget (no bloquea el render del resultado si falla).

**Nota de alcance:** esta tarea cierra el "write path" (que el escaneo SÍ se guarde). La pantalla para que el usuario VEA su historial en la nube (`history.html` con `GET /api/me/history`) es una pantalla de presentación separada, no incluida en este plan — el dato ya queda disponible vía el endpoint de Task 16 para cuando se construya esa vista.

- [ ] **Step 1: Escribe el test que falla**

Nuevo bloque `describe` al final de `tests/app.test.js` (agregar `logScanToCloudHistory` al `let`/`return` del `beforeAll`, mismo patrón de Tasks 13/14):

```js
describe('logScanToCloudHistory', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, id: 'x' }) })
  })

  afterEach(() => {
    global.fetch = originalFetch
    delete window.authClient
  })

  it('no llama a fetch si el usuario no está logueado o no es premium', async () => {
    window.authClient = { getCachedProfile: () => null, getIdToken: vi.fn() }
    await logScanToCloudHistory('111', 'Producto A', 'sano')
    expect(global.fetch).not.toHaveBeenCalled()

    window.authClient = { getCachedProfile: () => ({ plan: 'free' }), getIdToken: vi.fn() }
    await logScanToCloudHistory('111', 'Producto A', 'sano')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('POSTea a /api/me/history con Bearer token para un usuario premium', async () => {
    window.authClient = {
      getCachedProfile: () => ({ plan: 'premium' }),
      getIdToken: vi.fn().mockResolvedValue('tok-789')
    }
    await logScanToCloudHistory('111', 'Producto A', 'sano')
    expect(global.fetch).toHaveBeenCalledWith('/api/me/history', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-789', 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: '111', productName: 'Producto A', verdict: 'sano' })
    })
  })

  it('no lanza si fetch falla (fire-and-forget)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    window.authClient = { getCachedProfile: () => ({ plan: 'premium' }), getIdToken: vi.fn().mockResolvedValue('tok') }
    await expect(logScanToCloudHistory('111', 'Producto A', 'sano')).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/app.test.js`
Expected: `logScanToCloudHistory is not a function`

- [ ] **Step 3: Implementación mínima**

Agregar junto a `getUserPreferencesForVerdict` (`app.js`, antes de `renderProductData`):

```js
// Registra el escaneo en el historial en la nube — solo usuarios premium
// (free se queda con su historial local de 5, sin cambios). Fire-and-forget:
// un fallo de red no debe bloquear ni ensuciar el render del resultado.
async function logScanToCloudHistory(barcode, productName, verdict) {
  if (typeof window === 'undefined' || !window.authClient) return;
  const profile = window.authClient.getCachedProfile();
  if (!profile || profile.plan !== 'premium') return;

  try {
    const token = await window.authClient.getIdToken();
    await fetch('/api/me/history', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode, productName, verdict })
    });
  } catch (e) {
    console.warn('[history] no se pudo registrar el escaneo en la nube:', e.message);
  }
}
```

Cambiar `app.js:1640` (justo después de calcular `verdict`, agregar la llamada fire-and-forget):

```js
  const verdict = computeVerdict(product, getUserPreferencesForVerdict());
  logScanToCloudHistory(barcode, product.name, verdict);
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/app.test.js`

- [ ] **Step 5: Commit**

```bash
git add app.js tests/app.test.js
git commit -m "feat(history): log premium scans to cloud history at render time (fire-and-forget)"
```

---

## Notas para quien ejecute el plan

- Todas las pruebas siguen el patrón ya establecido en el repo (`await import(...)` + `vi.stubGlobal('fetch', ...)` / `vi.mock(...)`) — no se introduce ninguna dependencia nueva.
- `FIREBASE_PROJECT_ID` es una variable de entorno nueva; agregar a Vercel (Preview branch `develop` → valor `foodscaner-dev`) antes de probar end-to-end.
- Las líneas de `Modify` en `api/index.js` son aproximadas y se desplazan conforme cada tarea anterior se aplica — el ancla real es el nombre de la sección/función citada, no el número exacto de línea.
- Fuera de alcance de este plan (ver spec, sección "Preguntas abiertas" y "Nota de flujo"): UI del flujo de trial de 7 días con perfil configurado antes de iniciar, endpoint de cache-refresh de cara al usuario (`cacheRefreshCount` ya tiene su contador listo en Task 8, pero el endpoint que lo consuma es una feature separada), la pantalla para VER el historial en la nube (el write-path sí queda construido en Tasks 16-17, `GET /api/me/history` ya expone los datos), y la arquitectura del plan Familiar (sub-perfiles vs. cuentas vinculadas).
- Autorevisión aplicada tras el primer borrador (obligatoria por el skill, no delegada a agentes): se encontraron y corrigieron 2 huecos de cobertura del spec — el placeholder `billing` (incluyendo `billingCycle`) no se inicializaba en la creación del usuario (Task 3), y el historial en la nube (declarado MVP en el spec) no tenía ninguna tarea (agregadas Tasks 16-17).
- **Segunda ronda de revisión** (equipo de 4 agentes especializados: Security Architect, UX Researcher, Data Privacy Officer, Legal Compliance Checker) sobre el CÓDIGO ya escrito del plan, aplicada íntegramente:
  - **Seguridad**: cuota OCR ya no se pierde/bypassea con requests paralelos (Task 9, `await` en vez de fire-and-forget); fail-closed si el perfil no sincronizó todavía (antes fail-open); mensajes de error de login ya no permiten enumerar cuentas (Task 11); sanitización de `displayName`/`photoURL` (Task 4) y de campos de historial con enum de `verdict` (Task 16).
  - **Legal**: consentimiento de datos de salud ahora se exige y evidencia SERVER-SIDE (`consent:true` + `consentGivenAt`/`consentNoticeVersion` en Task 6/15, no solo el checkbox de cliente); checkbox de Términos y declaración de mayoría de edad agregados al signup (Task 11), con `termsAcceptedAt`/`ageConfirmedAt` persistidos (Task 3/4); disclaimer médico agregado en `preferences.html` y en el punto de renderizado del veredicto personalizado (Task 14).
  - **UX** (objetivo explícito: registro lo más amigable posible): `auth.html`/`preferences.html` ahora enlazan `styles.css` (antes se veían sin estilo); Google primero con divisor; mostrar/ocultar contraseña; botón de signup revela consentimiento en 2 pasos y valida el form nativamente antes de enviar; loading state en los 5 botones async (login/signup/Google/guardar/borrar); tap targets de alergias ≥44px con el `<select>` fuera del `<label>` del checkbox; error de consentimiento se muestra junto al checkbox, no solo en el error general.
  - **Pendiente, no resuelto en código** (tarea de producto/legal, señalada explícitamente): el contenido real de `terminos.html`/`privacidad.html` (ya existen en el repo) no fue auditado ni actualizado — falta confirmar que cubren tratamiento de datos de salud (LFPDPPP), política de cancelación/reembolso de suscripción, y jurisdicción aplicable dado el alcance LATAM. El signup (Task 11) ya enlaza a ambos archivos, pero su redacción queda fuera de este plan.
