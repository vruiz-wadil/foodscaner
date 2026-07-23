# Identidad de teléfono independiente del uid — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El uid de una cuenta phone-login deja de derivarse del número de teléfono (`'phone:'+phone`) — pasa a ser un id random estable, con un índice `phoneIndex/{telefono}→uid` resolviendo el mapeo. Prepara el terreno para una futura feature de "editar teléfono" sin migrar cuentas.

**Architecture:** Nueva colección Firestore `phoneIndex/{telefono}` (doc `{uid}`). `phoneVerifyHandler` la consulta antes de decidir el uid; si no hay índice, revisa el doc legado `'phone:'+telefono` (backfill perezoso, cero migración); si tampoco existe, genera uid random. `createFirebaseCustomToken` gana un segundo parámetro opcional `claims`, usado para mandar `{phone_number: telefono}` en el custom token — Firebase promueve ese claim al ID token final, y `api/auth.js` (sin tocar) ya lo prefiere sobre parsear el uid.

**Tech Stack:** Express (`api/index.js`), REST a Firestore (`api/firestore.js`, sin firebase-admin), Twilio Verify (`api/phoneAuth.js`), vitest.

Spec de referencia: `docs/superpowers/specs/2026-07-23-phone-identity-decoupling-design.md`.

## Global Constraints

- `api/auth.js` (`verifyFirebaseIdToken`, la derivación de `phoneNumber` en la línea 83) **no se toca en este plan** — ya prefiere `payload.phone_number` sobre parsear el uid, eso es lo que hace que este cambio funcione sin tocarlo.
- Ninguna migración de datos explícita — cuentas phone-login existentes conservan su uid legado (`'phone:'+telefono`) indefinidamente; el índice se rellena solo, perezosamente, la primera vez que ese número vuelve a loguearse.
- Cualquier fallo de Firestore durante la resolución del uid debe caer a "usuario nuevo con uid random" (fail-safe) — nunca debe bloquear ni tronar la respuesta de `/api/auth/phone/verify`. Mismo criterio que el código actual ya usa.
- El uid nuevo (cuando no hay índice ni doc legado) se genera con `crypto.randomUUID()` — `api/index.js:5` ya importa `crypto`, no se agrega un import nuevo.
- El claim del custom token va anidado bajo la clave `claims` en el payload que se firma (formato que Firebase espera de un custom token) — no se mezcla plano en el payload del custom token mismo.

---

### Task 1: `phoneIndex/{telefono}` — `api/firestore.js`

**Files:**
- Modify: `api/firestore.js` (agregar `fireGetPhoneIndex`, `fireSetPhoneIndex`, y sus 2 nombres al `module.exports`)
- Test: `tests/firestore-phoneIndex.test.js` (nuevo)

**Interfaces:**
- Produces: `fireGetPhoneIndex(phone)` → `Promise<{uid: string} | null>` (null si no existe el doc o hay error). `fireSetPhoneIndex(phone, uid)` → `Promise<void>` (lanza si Firestore falla).
- Consumes: `getAccessToken()`, `docPath(col, id)`, `toFirestoreFields(obj)`, `fromFirestoreFields(fields)` — ya existen en el mismo archivo, no se duplican.

- [ ] **Step 1: Escribir el test que falla**

Crea `tests/firestore-phoneIndex.test.js` (mismo patrón de `buildFetchMock`/`fakeServiceAccountKey` que ya usa `tests/firestore-users.test.js`):

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import crypto from 'crypto'

const { fireGetPhoneIndex, fireSetPhoneIndex } = await import('../api/firestore.js')

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

describe('phoneIndex/{telefono} data layer', () => {
  const ORIGINAL_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = ORIGINAL_KEY
  })

  it('fireGetPhoneIndex returns null when the document does not exist (404)', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({ status: 404, ok: false })))
    const result = await fireGetPhoneIndex('+525512345678')
    expect(result).toBeNull()
  })

  it('fireGetPhoneIndex returns { uid } when the document exists', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({
      ok: true, status: 200,
      json: async () => ({ fields: { uid: { stringValue: 'a1b2c3d4-uuid' } } })
    })))
    const result = await fireGetPhoneIndex('+525512345678')
    expect(result).toEqual({ uid: 'a1b2c3d4-uuid' })
  })

  it('fireGetPhoneIndex returns null on any Firestore error (fail-safe, never throws)', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({ ok: false, status: 500 })))
    const result = await fireGetPhoneIndex('+525512345678')
    expect(result).toBeNull()
  })

  it('fireSetPhoneIndex PATCHes the doc with the given uid', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedUrl, capturedOptions
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      capturedUrl = url
      capturedOptions = options
      return { ok: true, status: 200 }
    }))
    await fireSetPhoneIndex('+525512345678', 'a1b2c3d4-uuid')
    expect(capturedUrl).toContain('phoneIndex')
    expect(capturedUrl).toContain(encodeURIComponent('+525512345678'))
    expect(capturedOptions.method).toBe('PATCH')
    const body = JSON.parse(capturedOptions.body)
    expect(body.fields.uid.stringValue).toBe('a1b2c3d4-uuid')
  })

  it('fireSetPhoneIndex throws when Firestore responds non-ok', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({ ok: false, status: 500 })))
    await expect(fireSetPhoneIndex('+525512345678', 'a1b2c3d4-uuid')).rejects.toThrow('Firestore set phone index failed')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/firestore-phoneIndex.test.js`
Expected: FAIL — `fireGetPhoneIndex`/`fireSetPhoneIndex` no existen todavía.

- [ ] **Step 3: Implementar en `api/firestore.js`**

Agrega después de `fireGetUser`/`fireUpsertUser` (junto al resto de funciones de `users/{uid}`, mismo bloque temático):

```js
async function fireGetPhoneIndex(phone) {
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const resp = await fetch(docPath('phoneIndex', phone), {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(5000)
    });
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    const data = await resp.json();
    return fromFirestoreFields(data.fields || {});
  } catch (e) {
    console.warn('[Firestore] getPhoneIndex error:', e.message);
    return null;
  }
}

async function fireSetPhoneIndex(phone, uid) {
  const token = await getAccessToken();
  if (!token) throw new Error('No Firestore access token');
  const resp = await fetch(docPath('phoneIndex', phone), {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields({ uid }) }),
    signal: AbortSignal.timeout(5000)
  });
  if (!resp.ok) throw new Error(`Firestore set phone index failed: ${resp.status}`);
}
```

Agrega ambas al `module.exports` (junto a `fireGetUser, fireUpsertUser, firePatchUserFields,`):

```js
  fireGetPhoneIndex, fireSetPhoneIndex,
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/firestore-phoneIndex.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/firestore.js tests/firestore-phoneIndex.test.js
git commit -m "feat(firestore): add phoneIndex/{phone}->uid lookup collection"
```

---

### Task 2: `createFirebaseCustomToken(uid, claims)` — `api/phoneAuth.js`

**Files:**
- Modify: `api/phoneAuth.js` (`createFirebaseCustomToken`)
- Test: `tests/phoneAuth.test.js` (extender el `describe('createFirebaseCustomToken', ...)` existente)

**Interfaces:**
- Produces: `createFirebaseCustomToken(uid, claims)` — `claims` es opcional; cuando se pasa, aparece anidado como `payload.claims` en el JWT firmado (formato de custom token de Firebase — el servicio de intercambio de tokens de Firebase promueve `claims.*` al nivel superior del ID token final que emite, eso ya lo consume sin cambios `api/auth.js:83`).
- Consumes: `getServiceAccount()` (sin cambio de firma).

- [ ] **Step 1: Escribir el test que falla**

Agrega al `describe('createFirebaseCustomToken', ...)` en `tests/phoneAuth.test.js` (después de la prueba `'signs a JWT with the claims Firebase custom tokens require'`, usa el mismo `publicKey`/`getServiceAccount.mockReturnValue` del `beforeEach` de ese describe):

```js
  it('includes an optional developer claims object under payload.claims when provided', () => {
    const token = createFirebaseCustomToken('a1b2c3d4-uuid', { phone_number: '+525512345678' })
    const [, payloadB64] = token.split('.')
    const payload = b64urlJsonDecode(payloadB64)
    expect(payload.claims).toEqual({ phone_number: '+525512345678' })
    expect(payload.uid).toBe('a1b2c3d4-uuid')
  })

  it('omits payload.claims entirely when no claims argument is passed (backward compatible)', () => {
    const token = createFirebaseCustomToken('phone:+525512345678')
    const [, payloadB64] = token.split('.')
    const payload = b64urlJsonDecode(payloadB64)
    expect(payload.claims).toBeUndefined()
  })
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/phoneAuth.test.js -t "developer claims"`
Expected: FAIL — `createFirebaseCustomToken` todavía ignora un segundo argumento.

- [ ] **Step 3: Implementar en `api/phoneAuth.js`**

Reemplaza la función completa:

```js
function createFirebaseCustomToken(uid, claims) {
  const sa = getServiceAccount();
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY no configurada');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email, sub: sa.client_email, aud: CUSTOM_TOKEN_AUD,
    uid, iat: now, exp: now + 3600,
    ...(claims ? { claims } : {})
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(sa.private_key, 'base64url');
  return `${signingInput}.${signature}`;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/phoneAuth.test.js`
Expected: PASS (todas, incluidas las pruebas previas de este describe)

- [ ] **Step 5: Commit**

```bash
git add api/phoneAuth.js tests/phoneAuth.test.js
git commit -m "feat(phoneAuth): support optional developer claims on custom tokens"
```

---

### Task 3: Reescribir `phoneVerifyHandler` — resolución de uid vía `phoneIndex`

**Files:**
- Modify: `api/index.js` (`phoneVerifyHandler`, líneas 1377-1421 actuales)
- Test: `tests/phoneAuthRoutes.test.js` (reescribir el `describe('phoneVerifyHandler', ...)`)

**Interfaces:**
- Consumes: `fireGetPhoneIndex`, `fireSetPhoneIndex` (Task 1), `fireGetUser` (ya existe, para el doc legado), `createFirebaseCustomToken(uid, claims)` (Task 2), `crypto.randomUUID()` (`api/index.js:5` ya importa `crypto`).
- Produces: mismo contrato externo (`{customToken, isNewUser}` / los mismos códigos de error 400/401/502/500) — cambia SOLO cómo se resuelve el `uid` internamente.

- [ ] **Step 1: Escribir los tests que fallan**

Reemplaza en `tests/phoneAuthRoutes.test.js`: agrega los mocks de `fireGetPhoneIndex`/`fireSetPhoneIndex` junto a `fireGetUser` (líneas 13-15 actuales):

```js
const firestoreModule = requireFn('../api/firestore.js')
const fireGetUser = vi.fn()
const fireGetPhoneIndex = vi.fn()
const fireSetPhoneIndex = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.fireGetPhoneIndex = fireGetPhoneIndex
firestoreModule.fireSetPhoneIndex = fireSetPhoneIndex
```

Agrega el import de `crypto` al inicio del archivo (para mockear `randomUUID` de forma determinística — es el mismo objeto módulo que `api/index.js` referencia vía `require('crypto')`, mutar el método aquí lo afecta ahí también):

```js
import crypto from 'crypto'
```

En el `beforeEach` del describe de `phoneVerifyHandler`, agrega el reset de los 2 mocks nuevos:

```js
  beforeEach(() => {
    checkVerificationCode.mockReset()
    createFirebaseCustomToken.mockReset()
    fireGetUser.mockReset()
    fireGetPhoneIndex.mockReset()
    fireSetPhoneIndex.mockReset()
  })
```

Reemplaza las 4 pruebas que dependen de la resolución del uid — `'mints a custom token for uid "phone:"+phone and reports isNewUser:true for a first-time phone'`, `'reports isNewUser:false when the user doc already exists'`, `'defaults isNewUser to true (fail-safe) when the Firestore lookup itself fails...'`, y `'500s (dedicated, not 502) when custom-token signing fails...'` — por estas 6 (las 2 primeras invariantes del bloque anterior, `400s.../401s.../401s (not 502).../502s...`, quedan igual sin tocar, ya no dependen de la resolución del uid):

```js
  it('teléfono con índice existente en phoneIndex -> usa ese uid, isNewUser:false, no consulta el doc legado', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue({ uid: 'a1b2c3d4-uuid' })
    createFirebaseCustomToken.mockReturnValue('signed.jwt.token')
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(fireGetUser).not.toHaveBeenCalled()
    expect(fireSetPhoneIndex).not.toHaveBeenCalled()
    expect(createFirebaseCustomToken).toHaveBeenCalledWith('a1b2c3d4-uuid', { phone_number: '+525512345678' })
    expect(res.body).toEqual({ customToken: 'signed.jwt.token', isNewUser: false })
  })

  it('teléfono sin índice pero con doc legado "phone:"+telefono -> adopta ese uid, isNewUser:false, rellena el índice (backfill)', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue(null)
    fireGetUser.mockResolvedValue({ membershipStatus: 'active' })
    fireSetPhoneIndex.mockResolvedValue(undefined)
    createFirebaseCustomToken.mockReturnValue('signed.jwt.token')
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(fireGetUser).toHaveBeenCalledWith('phone:+525512345678')
    expect(fireSetPhoneIndex).toHaveBeenCalledWith('+525512345678', 'phone:+525512345678')
    expect(createFirebaseCustomToken).toHaveBeenCalledWith('phone:+525512345678', { phone_number: '+525512345678' })
    expect(res.body).toEqual({ customToken: 'signed.jwt.token', isNewUser: false })
  })

  it('teléfono completamente nuevo (sin índice, sin doc legado) -> uid random nuevo, isNewUser:true, rellena el índice', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue(null)
    fireGetUser.mockResolvedValue(null)
    fireSetPhoneIndex.mockResolvedValue(undefined)
    createFirebaseCustomToken.mockReturnValue('signed.jwt.token')
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('brand-new-uuid')
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(fireSetPhoneIndex).toHaveBeenCalledWith('+525512345678', 'brand-new-uuid')
    expect(createFirebaseCustomToken).toHaveBeenCalledWith('brand-new-uuid', { phone_number: '+525512345678' })
    expect(res.body).toEqual({ customToken: 'signed.jwt.token', isNewUser: true })
    crypto.randomUUID.mockRestore()
  })

  it('falla de Firestore en la resolución del índice -> cae a uid random nuevo, isNewUser:true (fail-safe, nunca bloquea la respuesta)', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockRejectedValue(new Error('Firestore unavailable'))
    createFirebaseCustomToken.mockReturnValue('signed.jwt.token')
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('fallback-uuid')
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.body).toEqual({ customToken: 'signed.jwt.token', isNewUser: true })
    crypto.randomUUID.mockRestore()
  })

  it('500s (dedicated, not 502) when custom-token signing fails — distinto de una caída de Twilio', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue({ uid: 'a1b2c3d4-uuid' })
    createFirebaseCustomToken.mockImplementation(() => { throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY no configurada') })
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'server_error' })
  })
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/phoneAuthRoutes.test.js`
Expected: FAIL — el handler todavía usa `uid = 'phone:'+phone` sin consultar `phoneIndex`.

- [ ] **Step 3: Implementar en `api/index.js`**

Reemplaza el bloque entre `if (status !== 'approved') ...` y el `try { const customToken = ... }` final (líneas 1396-1420 actuales):

```js
  if (status !== 'approved') return res.status(401).json({ error: 'invalid_code' });

  // Resuelve el uid estable de este teléfono: índice existente -> ese uid
  // (usuario recurrente); si no hay índice, doc legado 'phone:'+phone -> lo
  // adopta como uid permanente y rellena el índice (backfill perezoso, cero
  // migración de datos); si no existe ninguno -> uid nuevo random. Firestore
  // ambiguo/inaccesible en cualquier paso -> trata como usuario nuevo
  // (fail-safe, MISMO criterio que ya usaba esta función — nunca bloquea la
  // respuesta por un problema transitorio de Firestore).
  let uid, isNewUser;
  try {
    const indexed = await fireGetPhoneIndex(phone);
    if (indexed && indexed.uid) {
      uid = indexed.uid;
      isNewUser = false;
    } else {
      const legacyUid = 'phone:' + phone;
      const legacyUser = await fireGetUser(legacyUid);
      if (legacyUser) {
        uid = legacyUid;
        isNewUser = false;
        await fireSetPhoneIndex(phone, uid);
      } else {
        uid = crypto.randomUUID();
        isNewUser = true;
        await fireSetPhoneIndex(phone, uid);
      }
    }
  } catch (e) {
    console.warn('[auth/phone/verify] phone index resolution failed, defaulting to new-user random uid:', e.message);
    uid = crypto.randomUUID();
    isNewUser = true;
  }

  try {
    const customToken = createFirebaseCustomToken(uid, { phone_number: phone });
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
```

Confirma que `fireGetPhoneIndex`/`fireSetPhoneIndex` estén en el `require('./firestore')` destructurado al inicio de `api/index.js` (junto a `fireGetUser` y los demás) — agrégalos ahí si no están ya.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/phoneAuthRoutes.test.js`
Expected: PASS

- [ ] **Step 5: Correr la suite completa**

Run: `npx vitest run`
Expected: PASS — el único fallo debe seguir siendo el preexistente de Playwright/e2e (`tests/e2e/scan-cycle.spec.js`), sin relación.

- [ ] **Step 6: Commit**

```bash
git add api/index.js tests/phoneAuthRoutes.test.js
git commit -m "feat(auth): resolve phone-login uid via phoneIndex, decoupled from the number"
```

---

## Al terminar todas las tasks

Correr la suite completa una última vez (`npx vitest run`) y usar `superpowers:finishing-a-development-branch` para decidir merge/PR — no se hace commit a `master`/producción sin instrucción explícita del usuario (regla de sesión: `develop` únicamente). Antes de dar por cerrado, considerar un smoke test manual contra una cuenta phone-login real (dev) para confirmar el backfill perezoso funciona end-to-end — no automatizable con vitest solo.
