# Account Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a usuarios y admins un borrado de cuenta real (Firestore + Stripe + Firebase Auth), reemplazando el proceso 100% manual por correo.

**Architecture:** Un helper compartido `deleteUserAccount(uid)` en `api/index.js` hace los 6 pasos de borrado (Stripe cancel-now best-effort → historial → phoneIndex → user doc → Firebase Auth). Dos endpoints lo llaman: `DELETE /api/me/account` (usuario, uid del token) y `DELETE /api/admin/users/:uid` (admin, uid de la URL). Un tercer endpoint admin-only cancela solo la suscripción sin borrar nada (`POST /api/admin/users/:uid/cancel-subscription`). Frontend: modal con palabra tecleada "ELIMINAR" en `account-ui.js` (cuenta propia) y `window.prompt` en `admin/admin.js` (panel interno).

**Tech Stack:** Express, Vitest, Firestore REST API, Stripe REST API, Firebase Identity Toolkit REST API.

## Global Constraints

- Borrado **inmediato y definitivo**, sin soft-delete ni cola de purga diferida.
- Suscripción Stripe activa se cancela **ya** (`DELETE /v1/subscriptions/{id}`), no `cancel_at_period_end`.
- Cancelación Stripe es **best-effort**: si falla, se loguea warning y el borrado de datos continúa igual.
- Orden fijo dentro de `deleteUserAccount`: Stripe → historial → phoneIndex → user doc → Firebase Auth (Auth al final — es el punto de no retorno).
- `DELETE /api/me/account` usa `requireUser`, **nunca** `requireActiveMembership` — debe funcionar en cuentas free.
- uid siempre sale del token (`req.user.uid`) en la ruta propia, nunca de query/body — anti-IDOR.
- No se toca `POST /api/me/membership/cancel` (cancelación de auto-renovación existente) — flujo completamente independiente.

---

### Task 1: Helpers de Firestore — id de historial + borrado de doc + borrado de usuario Auth

**Files:**
- Modify: `api/firestore.js:684-703` (fireListUserHistory), agregar función nueva después de `fireLogUserHistory` (línea 682), agregar función nueva después de `getAccessToken`/`docPath` (agregar `deleteFirebaseAuthUser` cerca de `fireGetUser`, línea ~458), modificar `getAccessToken` (línea 21-58, el `scope` en línea 30)
- Modify: `api/firestore.js:799` (module.exports)
- Test: `tests/firestore-history.test.js`
- Test: `tests/firebase-init.test.js` — NO, crear test nuevo: `tests/firestoreAuthDelete.test.js`

**Interfaces:**
- Consumes: `getAccessToken()`, `docPath(col, id)`, `getProjectId()` (ya existen en `api/firestore.js`).
- Produces: `fireDeleteUserHistoryEntry(uid, id) => Promise<boolean>`, `deleteFirebaseAuthUser(uid) => Promise<void>` (throws si falla), `fireListUserHistory(uid, limit)` ahora retorna objetos con campo `id` además de los campos existentes — Task 3 depende de ambos.

- [ ] **Step 1: Escribir tests que fallan para el `id` en `fireListUserHistory`**

Reemplazar el test existente en `tests/firestore-history.test.js` (líneas 45-68) — el mock de `fetch` necesita `document.name` para poder extraer el id, y el resultado esperado ahora incluye `id`:

```js
  it('fireListUserHistory returns entries ordered by scannedAt desc, capped at the given limit, each with its id', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedBody
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      capturedBody = JSON.parse(options.body)
      return {
        ok: true, status: 200,
        json: async () => ([
          { document: { name: 'projects/x/databases/(default)/documents/users/uid-1/history/hist-1', fields: { barcode: { stringValue: '111' }, productName: { stringValue: 'A' }, verdict: { stringValue: 'sano' }, scannedAt: { stringValue: '2026-07-15T12:00:00.000Z' } } } },
          { document: { name: 'projects/x/databases/(default)/documents/users/uid-1/history/hist-2', fields: { barcode: { stringValue: '222' }, productName: { stringValue: 'B' }, verdict: { stringValue: 'evitar' }, scannedAt: { stringValue: '2026-07-14T12:00:00.000Z' } } } }
        ])
      }
    }))

    const result = await fireListUserHistory('uid-1', 50)

    expect(capturedBody.structuredQuery.limit).toBe(50)
    expect(result).toEqual([
      { id: 'hist-1', barcode: '111', productName: 'A', verdict: 'sano', scannedAt: '2026-07-15T12:00:00.000Z' },
      { id: 'hist-2', barcode: '222', productName: 'B', verdict: 'evitar', scannedAt: '2026-07-14T12:00:00.000Z' }
    ])
  })
```

Agregar además un test nuevo para `fireDeleteUserHistoryEntry` en el mismo archivo, dentro del mismo `describe`:

```js
  it('fireDeleteUserHistoryEntry DELETEs the subcollection doc path (no double-encoding of slashes)', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedUrl, capturedMethod
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      capturedUrl = url
      capturedMethod = options.method
      return { ok: true, status: 200, json: async () => ({}) }
    }))

    const result = await fireDeleteUserHistoryEntry('uid-1', 'hist-1')

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toContain('/users/uid-1/history/hist-1')
    expect(capturedUrl).not.toContain('%2F')
    expect(result).toBe(true)
  })
```

Y actualizar el import en la parte superior del archivo:

```js
const { fireLogUserHistory, fireListUserHistory, fireDeleteUserHistoryEntry } = await import('../api/firestore.js')
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

Run: `npx vitest run tests/firestore-history.test.js`
Expected: FAIL — `fireDeleteUserHistoryEntry is not a function`, y el test de `fireListUserHistory` falla porque el resultado no tiene `id`.

- [ ] **Step 3: Implementar en `api/firestore.js`**

Modificar `fireListUserHistory` (reemplazar el `return` de la línea 702):

```js
  return rows.filter(r => r.document).map(r => ({
    id: r.document.name.split('/').pop(),
    ...fromFirestoreFields(r.document.fields || {})
  }));
```

Agregar función nueva inmediatamente después de `fireLogUserHistory` (después de la línea 682):

```js
async function fireDeleteUserHistoryEntry(uid, id) {
  const token = await getAccessToken();
  if (!token) return false;
  const resp = await fetch(`${docPath('users', uid)}/history/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000)
  });
  return resp.ok;
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

Run: `npx vitest run tests/firestore-history.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Escribir el test que falla para `deleteFirebaseAuthUser` y el scope ampliado**

Crear `tests/firestoreAuthDelete.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import crypto from 'crypto'

const { deleteFirebaseAuthUser } = await import('../api/firestore.js')

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

describe('deleteFirebaseAuthUser', () => {
  const ORIGINAL_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = ORIGINAL_KEY
  })

  it('POSTs accounts:delete to Identity Toolkit with localId, and requests the identitytoolkit scope', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedUrl, capturedBody, capturedTokenClaim
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        const params = new URLSearchParams(options.body)
        const assertion = params.get('assertion')
        const payloadB64 = assertion.split('.')[1]
        capturedTokenClaim = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
        return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      }
      capturedUrl = url
      capturedBody = JSON.parse(options.body)
      return { ok: true, status: 200, json: async () => ({}) }
    }))

    await deleteFirebaseAuthUser('uid-1')

    expect(capturedUrl).toBe('https://identitytoolkit.googleapis.com/v1/projects/foodscaner-test/accounts:delete')
    expect(capturedBody).toEqual({ localId: 'uid-1' })
    expect(capturedTokenClaim.scope).toContain('https://www.googleapis.com/auth/identitytoolkit')
    expect(capturedTokenClaim.scope).toContain('https://www.googleapis.com/auth/datastore')
  })

  it('throws when Identity Toolkit responds with an error status', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      return { ok: false, status: 404, json: async () => ({ error: { message: 'no such user' } }) }
    }))

    await expect(deleteFirebaseAuthUser('uid-missing')).rejects.toThrow()
  })
})
```

- [ ] **Step 6: Correr el test, confirmar que falla**

Run: `npx vitest run tests/firestoreAuthDelete.test.js`
Expected: FAIL — `deleteFirebaseAuthUser is not a function`.

- [ ] **Step 7: Implementar `deleteFirebaseAuthUser` y ampliar el scope**

En `getAccessToken` (línea 30), cambiar:

```js
      iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
```
por:
```js
      iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit',
```

Agregar función nueva después de `fireGetUser` (después de la línea 474, antes de `fireUpsertUser`):

```js
async function deleteFirebaseAuthUser(uid) {
  const token = await getAccessToken();
  if (!token) throw new Error('No access token');
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${getProjectId()}/accounts:delete`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: uid }),
      signal: AbortSignal.timeout(5000)
    }
  );
  if (!resp.ok) throw new Error(`Identity Toolkit delete error (status ${resp.status})`);
}
```

- [ ] **Step 8: Correr el test, confirmar que pasa**

Run: `npx vitest run tests/firestoreAuthDelete.test.js`
Expected: PASS (2 tests).

- [ ] **Step 9: Agregar los 2 exports nuevos a `module.exports` (línea 799) y correr toda la suite**

En `module.exports`, agregar `fireDeleteUserHistoryEntry, deleteFirebaseAuthUser` a la lista existente.

Run: `npm test`
Expected: PASS (todas las suites, incluidas las 2 modificadas/creadas).

- [ ] **Step 10: Commit**

```bash
git add api/firestore.js tests/firestore-history.test.js tests/firestoreAuthDelete.test.js
git commit -m "feat(firestore): add history entry id, delete history entry, delete Auth user"
```

---

### Task 2: Cancelación inmediata de suscripción en Stripe

**Files:**
- Modify: `api/stripeClient.js:68-72` (agregar función después de `stripeUpdateSubscription`), `api/stripeClient.js:100-103` (module.exports)
- Test: `tests/stripeClient.test.js`

**Interfaces:**
- Consumes: `stripeRequest(method, path, params)` (ya existe en `api/stripeClient.js`).
- Produces: `stripeCancelSubscriptionNow(subscriptionId) => Promise<object>` — Task 3 y Task 4 lo llaman.

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `describe('stripeClient REST calls', ...)` en `tests/stripeClient.test.js` (y agregar `stripeCancelSubscriptionNow` al import destructurado del top del archivo):

```js
  it('stripeCancelSubscriptionNow sends a DELETE to /v1/subscriptions/{id}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'sub_1', status: 'canceled' }) })
    vi.stubGlobal('fetch', fetchMock)

    const result = await stripeCancelSubscriptionNow('sub_1')

    expect(result).toEqual({ id: 'sub_1', status: 'canceled' })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.stripe.com/v1/subscriptions/sub_1')
    expect(opts.method).toBe('DELETE')
  })
```

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `npx vitest run tests/stripeClient.test.js`
Expected: FAIL — `stripeCancelSubscriptionNow is not a function`.

- [ ] **Step 3: Implementar en `api/stripeClient.js`**

Agregar después de `stripeUpdateSubscription` (línea 72):

```js
async function stripeCancelSubscriptionNow(subscriptionId) {
  return stripeRequest('DELETE', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}
```

Agregar `stripeCancelSubscriptionNow` a `module.exports` (línea 100-103).

- [ ] **Step 4: Correr el test, confirmar que pasa**

Run: `npx vitest run tests/stripeClient.test.js`
Expected: PASS (todos los tests del archivo, incluido el nuevo).

- [ ] **Step 5: Commit**

```bash
git add api/stripeClient.js tests/stripeClient.test.js
git commit -m "feat(stripe): add immediate subscription cancellation"
```

---

### Task 3: `deleteUserAccount` + `DELETE /api/me/account`

**Files:**
- Modify: `api/index.js` — agregar función `deleteUserAccount` y el endpoint, colocarlos después de `reactivateMembershipHandler` (después de la línea 1778, antes de `changePhoneHandler`)
- Modify: `api/index.js:2293` (exports al final del archivo, junto a `module.exports.deletePreferencesHandler`)
- Test: `tests/deleteAccount.test.js` (nuevo)

**Interfaces:**
- Consumes: `fireGetUser(uid)`, `fireListUserHistory(uid, limit)` (ahora con `id`, Task 1), `fireDeleteUserHistoryEntry(uid, id)` (Task 1), `fireDeleteDoc(col, id)` (ya existe), `fireGetUser` (ya existe), `deleteFirebaseAuthUser(uid)` (Task 1), `stripeCancelSubscriptionNow(subscriptionId)` (Task 2), `requireUser` middleware (ya existe en `api/index.js:120`).
- Produces: `deleteUserAccount(uid) => Promise<{ alreadyGone: boolean }>` y el handler montado en `DELETE /api/me/account` — Task 4 reutiliza `deleteUserAccount` directamente (no HTTP, llamada de función).

- [ ] **Step 1: Escribir los tests que fallan**

Crear `tests/deleteAccount.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const stripeClientModule = requireFn('../api/stripeClient.js')

const fireGetUser = vi.fn()
const fireListUserHistory = vi.fn()
const fireDeleteUserHistoryEntry = vi.fn()
const fireDeleteDoc = vi.fn()
const deleteFirebaseAuthUser = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.fireListUserHistory = fireListUserHistory
firestoreModule.fireDeleteUserHistoryEntry = fireDeleteUserHistoryEntry
firestoreModule.fireDeleteDoc = fireDeleteDoc
firestoreModule.deleteFirebaseAuthUser = deleteFirebaseAuthUser

const stripeCancelSubscriptionNow = vi.fn()
stripeClientModule.stripeCancelSubscriptionNow = stripeCancelSubscriptionNow

const { deleteUserAccount, deleteAccountHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('deleteUserAccount', () => {
  beforeEach(() => {
    fireGetUser.mockReset(); fireListUserHistory.mockReset(); fireDeleteUserHistoryEntry.mockReset()
    fireDeleteDoc.mockReset(); deleteFirebaseAuthUser.mockReset(); stripeCancelSubscriptionNow.mockReset()
    fireDeleteUserHistoryEntry.mockResolvedValue(true)
    fireDeleteDoc.mockResolvedValue(true)
    deleteFirebaseAuthUser.mockResolvedValue(undefined)
  })

  it('returns alreadyGone when the user does not exist, touches nothing else', async () => {
    fireGetUser.mockResolvedValue(null)

    const result = await deleteUserAccount('uid-missing')

    expect(result).toEqual({ alreadyGone: true })
    expect(stripeCancelSubscriptionNow).not.toHaveBeenCalled()
    expect(deleteFirebaseAuthUser).not.toHaveBeenCalled()
  })

  it('cancels Stripe, deletes history entries, phoneIndex, user doc, and Auth user, in that order', async () => {
    const callOrder = []
    fireGetUser.mockResolvedValue({ phoneNumber: '+525512345678', billing: { subscriptionId: 'sub_1' } })
    fireListUserHistory.mockResolvedValue([{ id: 'hist-1' }, { id: 'hist-2' }])
    stripeCancelSubscriptionNow.mockImplementation(async () => { callOrder.push('stripe') })
    fireDeleteUserHistoryEntry.mockImplementation(async () => { callOrder.push('history') })
    fireDeleteDoc.mockImplementation(async (col) => { callOrder.push('doc:' + col) })
    deleteFirebaseAuthUser.mockImplementation(async () => { callOrder.push('auth') })

    const result = await deleteUserAccount('uid-1')

    expect(result).toEqual({ alreadyGone: false })
    expect(stripeCancelSubscriptionNow).toHaveBeenCalledWith('sub_1')
    expect(fireDeleteUserHistoryEntry).toHaveBeenCalledWith('uid-1', 'hist-1')
    expect(fireDeleteUserHistoryEntry).toHaveBeenCalledWith('uid-1', 'hist-2')
    expect(fireDeleteDoc).toHaveBeenCalledWith('phoneIndex', '+525512345678')
    expect(fireDeleteDoc).toHaveBeenCalledWith('users', 'uid-1')
    expect(callOrder).toEqual(['stripe', 'history', 'history', 'doc:phoneIndex', 'doc:users', 'auth'])
  })

  it('skips Stripe cancellation when there is no subscription', async () => {
    fireGetUser.mockResolvedValue({ phoneNumber: null, billing: null })
    fireListUserHistory.mockResolvedValue([])

    await deleteUserAccount('uid-1')

    expect(stripeCancelSubscriptionNow).not.toHaveBeenCalled()
  })

  it('continues deleting data even when Stripe cancellation fails (best-effort)', async () => {
    fireGetUser.mockResolvedValue({ phoneNumber: null, billing: { subscriptionId: 'sub_1' } })
    fireListUserHistory.mockResolvedValue([])
    stripeCancelSubscriptionNow.mockRejectedValue(new Error('Stripe down'))

    const result = await deleteUserAccount('uid-1')

    expect(result).toEqual({ alreadyGone: false })
    expect(fireDeleteDoc).toHaveBeenCalledWith('users', 'uid-1')
    expect(deleteFirebaseAuthUser).toHaveBeenCalledWith('uid-1')
  })
})

describe('DELETE /api/me/account handler', () => {
  beforeEach(() => {
    fireGetUser.mockReset(); fireListUserHistory.mockReset()
    fireGetUser.mockResolvedValue({ phoneNumber: null, billing: null })
    fireListUserHistory.mockResolvedValue([])
  })

  it('deletes the account for req.user.uid (never from query/body) and responds ok', async () => {
    const req = { user: { uid: 'uid-from-token' }, query: { uid: 'uid-from-query' }, body: { uid: 'uid-from-body' } }
    const res = makeRes()

    await deleteAccountHandler(req, res)

    expect(fireGetUser).toHaveBeenCalledWith('uid-from-token')
    expect(res.body).toEqual({ ok: true })
  })

  it('responds 500 on unexpected error', async () => {
    fireGetUser.mockRejectedValue(new Error('boom'))
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await deleteAccountHandler(req, res)

    expect(res.statusCode).toBe(500)
  })
})
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

Run: `npx vitest run tests/deleteAccount.test.js`
Expected: FAIL — `deleteUserAccount is not a function` (no existe todavía, ni el export).

- [ ] **Step 3: Implementar en `api/index.js`**

Insertar después de `reactivateMembershipHandler` y su `app.post` (después de la línea 1778):

```js
async function deleteUserAccount(uid) {
  const user = await fireGetUser(uid);
  if (!user) return { alreadyGone: true };

  const subscriptionId = user.billing && user.billing.subscriptionId;
  if (subscriptionId) {
    try {
      await stripeCancelSubscriptionNow(subscriptionId);
    } catch (e) {
      console.warn('[deleteUserAccount] Stripe cancel error, uid:', uid, e.message);
    }
  }

  const history = await fireListUserHistory(uid, 1000);
  for (const entry of history) {
    await fireDeleteUserHistoryEntry(uid, entry.id).catch(e =>
      console.warn('[deleteUserAccount] history delete error, uid:', uid, e.message));
  }

  if (user.phoneNumber) {
    await fireDeleteDoc('phoneIndex', user.phoneNumber).catch(e =>
      console.warn('[deleteUserAccount] phoneIndex delete error, uid:', uid, e.message));
  }

  await fireDeleteDoc('users', uid);

  await deleteFirebaseAuthUser(uid).catch(e =>
    console.warn('[deleteUserAccount] Auth delete error, uid:', uid, e.message));

  return { alreadyGone: false };
}

async function deleteAccountHandler(req, res) {
  try {
    await deleteUserAccount(req.user.uid);
    res.json({ ok: true });
  } catch (e) {
    console.warn('[DELETE /api/me/account] error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.delete('/api/me/account', requireUser, deleteAccountHandler);
```

Verificar el `require` de `stripeCancelSubscriptionNow` en la cabecera de `api/index.js` — el archivo ya importa desde `./stripeClient` (buscar la línea `require('./stripeClient')` existente y agregar `stripeCancelSubscriptionNow` a esa destructuración), y de `./firestore` agregar `fireDeleteUserHistoryEntry, deleteFirebaseAuthUser` a la destructuración existente de ese require.

En la sección final de exports (cerca de la línea 2293), agregar:

```js
module.exports.deleteUserAccount = deleteUserAccount;
module.exports.deleteAccountHandler = deleteAccountHandler;
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

Run: `npx vitest run tests/deleteAccount.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Correr toda la suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/index.js tests/deleteAccount.test.js
git commit -m "feat(account): add DELETE /api/me/account with full data + Auth cleanup"
```

---

### Task 4: Endpoints admin — cancelar suscripción y borrar cuenta

**Files:**
- Modify: `api/index.js` — agregar 2 endpoints después de `getUserByUidHandler`/antes de la línea `app.get('/api/admin/:collection', ...)` (línea 2254), junto a los demás endpoints `/api/admin/users/*` (líneas 2248-2252)
- Test: `tests/adminAccountActions.test.js` (nuevo)

**Interfaces:**
- Consumes: `deleteUserAccount(uid)` (Task 3), `stripeCancelSubscriptionNow(subscriptionId)` (Task 2), `fireGetUser(uid)`, `firePatchUserFields(uid, fields, data)` (ya existen), `requireAdmin` middleware (ya existe).
- Produces: handlers `adminCancelSubscriptionHandler`, `adminDeleteAccountHandler` exportados — sin consumidores posteriores en este plan (Task 6 es frontend puro, llama por HTTP).

- [ ] **Step 1: Escribir los tests que fallan**

Crear `tests/adminAccountActions.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const stripeClientModule = requireFn('../api/stripeClient.js')

const fireGetUser = vi.fn()
const firePatchUserFields = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.firePatchUserFields = firePatchUserFields

const stripeCancelSubscriptionNow = vi.fn()
stripeClientModule.stripeCancelSubscriptionNow = stripeCancelSubscriptionNow

// deleteUserAccount llama a fireGetUser/fireListUserHistory/etc — para estos
// tests de los endpoints admin nos alcanza con mockear deleteUserAccount
// directamente vía el módulo real de api/index.js (mismo patrón createRequire).
const indexModule = requireFn('../api/index.js')
const deleteUserAccount = vi.fn()
indexModule.deleteUserAccount = deleteUserAccount

const { adminCancelSubscriptionHandler, adminDeleteAccountHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('adminCancelSubscriptionHandler', () => {
  beforeEach(() => {
    fireGetUser.mockReset(); firePatchUserFields.mockReset(); stripeCancelSubscriptionNow.mockReset()
  })

  it('responds 404 when the user does not exist', async () => {
    fireGetUser.mockResolvedValue(null)
    const req = { params: { uid: 'uid-missing' } }
    const res = makeRes()

    await adminCancelSubscriptionHandler(req, res)

    expect(res.statusCode).toBe(404)
  })

  it('responds 409 when the user has no subscription', async () => {
    fireGetUser.mockResolvedValue({ billing: null })
    const req = { params: { uid: 'uid-1' } }
    const res = makeRes()

    await adminCancelSubscriptionHandler(req, res)

    expect(res.statusCode).toBe(409)
  })

  it('cancels the subscription now and clears autoRenew', async () => {
    fireGetUser.mockResolvedValue({ billing: { subscriptionId: 'sub_1' } })
    firePatchUserFields.mockResolvedValue(true)
    const req = { params: { uid: 'uid-1' } }
    const res = makeRes()

    await adminCancelSubscriptionHandler(req, res)

    expect(stripeCancelSubscriptionNow).toHaveBeenCalledWith('sub_1')
    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['autoRenew'], { autoRenew: false })
    expect(res.body).toEqual({ ok: true })
  })
})

describe('adminDeleteAccountHandler', () => {
  beforeEach(() => { deleteUserAccount.mockReset() })

  it('deletes the account for the uid in the URL param', async () => {
    deleteUserAccount.mockResolvedValue({ alreadyGone: false })
    const req = { params: { uid: 'uid-target' } }
    const res = makeRes()

    await adminDeleteAccountHandler(req, res)

    expect(deleteUserAccount).toHaveBeenCalledWith('uid-target')
    expect(res.body).toEqual({ ok: true })
  })

  it('responds 500 on unexpected error', async () => {
    deleteUserAccount.mockRejectedValue(new Error('boom'))
    const req = { params: { uid: 'uid-1' } }
    const res = makeRes()

    await adminDeleteAccountHandler(req, res)

    expect(res.statusCode).toBe(500)
  })
})
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

Run: `npx vitest run tests/adminAccountActions.test.js`
Expected: FAIL — `adminCancelSubscriptionHandler is not a function`.

- [ ] **Step 3: Implementar en `api/index.js`**

Insertar antes de la línea `app.get('/api/admin/users/search', ...)` (línea 2248), o inmediatamente después de `setUserDisabledHandler` (después de la línea 2246):

```js
async function adminCancelSubscriptionHandler(req, res) {
  const { uid } = req.params;
  try {
    const user = await fireGetUser(uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    const subscriptionId = user.billing && user.billing.subscriptionId;
    if (!subscriptionId) return res.status(409).json({ error: 'no_subscription' });
    await stripeCancelSubscriptionNow(subscriptionId);
    await firePatchUserFields(uid, ['autoRenew'], { autoRenew: false });
    res.json({ ok: true });
  } catch (e) {
    console.warn('[POST /api/admin/users/:uid/cancel-subscription] error, uid:', uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

async function adminDeleteAccountHandler(req, res) {
  try {
    await deleteUserAccount(req.params.uid);
    res.json({ ok: true });
  } catch (e) {
    console.warn('[DELETE /api/admin/users/:uid] error, uid:', req.params.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.post('/api/admin/users/:uid/cancel-subscription', requireAdmin, adminCancelSubscriptionHandler);
app.delete('/api/admin/users/:uid', requireAdmin, adminDeleteAccountHandler);
```

Ubicarlas antes de la ruta genérica `app.delete('/api/admin/:collection/:id', ...)` (línea 2266) para que Express no la intercepte primero (Express resuelve rutas por orden de registro; `/api/admin/users/:uid` ya se registra antes que `/api/admin/:collection/:id` en el archivo actual, mantener ese orden).

En la sección de exports, agregar:

```js
module.exports.adminCancelSubscriptionHandler = adminCancelSubscriptionHandler;
module.exports.adminDeleteAccountHandler = adminDeleteAccountHandler;
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

Run: `npx vitest run tests/adminAccountActions.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Correr toda la suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/index.js tests/adminAccountActions.test.js
git commit -m "feat(admin): add cancel-subscription and delete-account endpoints"
```

---

### Task 5: UI de cuenta propia — Zona de peligro

**Files:**
- Modify: `account-ui.js` — agregar sección "Zona de peligro" en `renderAccountHub` (después de la sección de Suscripción, antes del botón `btn-logout`, línea 325-326), agregar `openDeleteAccountModal` y `submitDeleteAccount` (junto a `openCancelSubscriptionModal`/`submitCancelSubscription`, después de la línea 242 y 849 respectivamente), agregar `showDeleteAccountError` (junto a `showCancelSubscriptionError`, línea 762), wiring en `wireAccountHubEvents` (línea 332+)
- Test: `tests/account-ui.test.js`

**Interfaces:**
- Consumes: `getIdToken()` (de `authClient.js`, ya importado), `openModal`/`closeModal` (ya existen en `account-ui.js:423,444`).
- Produces: `submitDeleteAccount()` exportado — sin consumidores posteriores en este plan.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `tests/account-ui.test.js`: declarar `submitDeleteAccount` junto a las demás variables `let` del bloque de imports (línea 32), asignarla en el `beforeEach` (`submitDeleteAccount = mod.submitDeleteAccount`, junto a la línea 54), y agregar estos tests al final del `describe` que contiene el test de `submitCancelSubscription` (después de la línea 729):

```js
  it('la sección "Zona de peligro" muestra el botón de eliminar cuenta', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'pending' })
    renderAccountHub()
    expect(document.getElementById('btn-open-delete-account-modal')).toBeTruthy()
  })

  it('click en "Eliminar cuenta" abre el modal, y el botón de confirmar arranca deshabilitado', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'pending' })
    renderAccountHub()
    document.getElementById('btn-open-delete-account-modal').click()
    const confirmBtn = document.getElementById('btn-delete-account-confirm')
    expect(confirmBtn).toBeTruthy()
    expect(confirmBtn.disabled).toBe(true)
  })

  it('el botón de confirmar se habilita solo cuando el input dice exactamente ELIMINAR', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'pending' })
    renderAccountHub()
    document.getElementById('btn-open-delete-account-modal').click()
    const input = document.getElementById('input-delete-confirm')
    const confirmBtn = document.getElementById('btn-delete-account-confirm')

    input.value = 'eliminar'
    input.dispatchEvent(new Event('input'))
    expect(confirmBtn.disabled).toBe(true)

    input.value = 'ELIMINAR'
    input.dispatchEvent(new Event('input'))
    expect(confirmBtn.disabled).toBe(false)
  })

  it('submitDeleteAccount llama DELETE /api/me/account y redirige a index.html', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'pending' })
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    await submitDeleteAccount()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/me/account')
    expect(options.method).toBe('DELETE')
    expect(options.headers.Authorization).toBe('Bearer tok')
    expect(window.location.href).toBe('index.html')
  })

  it('submitDeleteAccount muestra error y no redirige si falla', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'pending' })
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })

    await expect(submitDeleteAccount()).rejects.toThrow()
    expect(window.location.href).toBe('')
  })
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

Run: `npx vitest run tests/account-ui.test.js`
Expected: FAIL — `document.getElementById('btn-open-delete-account-modal')` es null / `submitDeleteAccount is not a function`.

- [ ] **Step 3: Implementar en `account-ui.js`**

Agregar la sección "Zona de peligro" en `renderAccountHub`, insertando justo antes de la línea `<button type="button" id="btn-logout" ...` (línea 326):

```html
    <div class="content-card">
      <div class="account-data-label" style="margin-bottom:10px;">Zona de peligro</div>
      <div class="row-card">
        <p class="about-text">Eliminar tu cuenta borra tu perfil, historial y preferencias de forma permanente.</p>
        <button type="button" id="btn-open-delete-account-modal" class="account-link-btn">Eliminar cuenta</button>
      </div>
    </div>
```

Agregar wiring en `wireAccountHubEvents` (junto a la línea 340, después del listener de `btn-renew-membership`):

```js
  document.getElementById('btn-open-delete-account-modal')?.addEventListener('click', () => {
    openDeleteAccountModal();
  });
```

Agregar la función del modal, cerca de `openCancelSubscriptionModal` (después de la línea 242):

```js
function openDeleteAccountModal() {
  openModal(`
    <div class="modal-header"><h2>Eliminar tu cuenta</h2><button type="button" class="modal-close" aria-label="Cerrar">×</button></div>
    <p>Esta acción no se puede deshacer. Se borra tu perfil, tu historial de escaneos y tus preferencias. Si tienes membresía activa, se cancela de inmediato.</p>
    <p>Escribe <strong>ELIMINAR</strong> para confirmar:</p>
    <input type="text" id="input-delete-confirm" autocomplete="off">
    <button type="button" id="btn-delete-account-back" class="btn btn-secondary">Volver</button>
    <button type="button" id="btn-delete-account-confirm" class="btn btn-danger" disabled>Eliminar cuenta</button>
    <p id="delete-account-error" class="hidden modal-inline-error" role="alert"></p>
  `);
  document.getElementById('btn-delete-account-back')?.addEventListener('click', closeModal);
  document.getElementById('input-delete-confirm')?.addEventListener('input', (e) => {
    document.getElementById('btn-delete-account-confirm').disabled = e.target.value !== 'ELIMINAR';
  });
  document.getElementById('btn-delete-account-confirm')?.addEventListener('click', () => {
    submitDeleteAccount().catch(() => {});
  });
}
```

Agregar `showDeleteAccountError`, cerca de `showCancelSubscriptionError` (después de la línea 765):

```js
function showDeleteAccountError(message) {
  const el = document.getElementById('delete-account-error');
  if (el) { el.textContent = message; el.classList.remove('hidden'); }
}
```

Agregar `submitDeleteAccount` exportado, cerca de `submitCancelSubscription` (después de la línea 849):

```js
export async function submitDeleteAccount() {
  const token = await getIdToken();
  const res = await fetch('/api/me/account', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    showDeleteAccountError('No se pudo eliminar tu cuenta. Intenta de nuevo.');
    throw new Error('delete_failed');
  }
  window.location.href = 'index.html';
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

Run: `npx vitest run tests/account-ui.test.js`
Expected: PASS.

- [ ] **Step 5: Correr toda la suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add account-ui.js tests/account-ui.test.js
git commit -m "feat(account): add self-service account deletion UI with typed confirmation"
```

---

### Task 6: UI de admin — cancelar suscripción y eliminar cuenta

**Files:**
- Modify: `admin/admin.js` — agregar 2 botones en `renderUserDetail` (junto al botón `toggle-disabled`, línea 400), agregar helper `confirmWithTypedWord`, agregar 2 ramas en el handler de click delegado (junto a `toggle-disabled`, después de la línea 618)

**Interfaces:**
- Consumes: `apiFetch` (helper existente del panel admin para llamadas autenticadas), `loadUserDetail(uid)` (ya existe, línea 337), `showUserList` o equivalente para volver a la lista tras un borrado (buscar la función existente que renderiza la lista — si no existe una función standalone reutilizable, recargar la búsqueda actual en su lugar; usar el patrón ya presente en el archivo para "volver a la lista de usuarios").
- Produces: nada consumido por tasks posteriores — última tarea del plan.

No hay test unitario para `admin/admin.js` en el proyecto (panel interno, sin cobertura de Vitest existente para este archivo) — verificación manual al final de la tarea, siguiendo la práctica ya establecida en el repo para este archivo.

- [ ] **Step 1: Agregar los botones en `renderUserDetail`**

En `admin/admin.js`, junto al botón existente (línea 400, `data-action="toggle-disabled"`), agregar:

```html
<button class="btn-del" data-action="cancel-subscription" data-uid="${escHtml(uid)}" ${profile.billing && profile.billing.subscriptionId ? '' : 'disabled'}>Cancelar suscripción</button>
<button class="btn-del" data-action="delete-account" data-uid="${escHtml(uid)}">Eliminar cuenta</button>
```

- [ ] **Step 2: Agregar el helper `confirmWithTypedWord`**

Cerca del principio del archivo (junto a otras funciones helper de utilidad, no dentro de `renderUserDetail`):

```js
function confirmWithTypedWord(message) {
  const input = window.prompt(`${message}\n\nEscribe ELIMINAR para confirmar:`);
  return input === 'ELIMINAR';
}
```

- [ ] **Step 3: Agregar las 2 ramas del handler de click**

En el handler delegado de clicks (junto al bloque `else if (btn.dataset.action === 'toggle-disabled')`, después de la línea 618), agregar:

```js
    } else if (btn.dataset.action === 'cancel-subscription') {
      if (!confirmWithTypedWord('Cancelar la suscripción de este usuario ya, sin esperar fin de periodo.')) return;
      btn.disabled = true;
      const r = await apiFetch('/api/admin/users/' + encodeURIComponent(uid) + '/cancel-subscription', { method: 'POST' });
      btn.disabled = false;
      if (r.ok) loadUserDetail(uid);
    } else if (btn.dataset.action === 'delete-account') {
      if (!confirmWithTypedWord('Eliminar esta cuenta por completo: perfil, historial, preferencias, suscripción.')) return;
      btn.disabled = true;
      const r = await apiFetch('/api/admin/users/' + encodeURIComponent(uid), { method: 'DELETE' });
      if (!r.ok) btn.disabled = false;
```

Después de esa última rama, cerrar según corresponda al patrón real del archivo (mirar cómo termina el bloque `toggle-disabled` en el archivo real para calzar sintaxis exacta — el implementador debe leer las líneas 590-625 de `admin/admin.js` antes de escribir esto, para no romper la cadena de `else if`).

Para la navegación de vuelta a la lista tras un borrado exitoso: buscar en el archivo cómo se vuelve de la vista de detalle a la vista de lista (función invocada al hacer click en "Volver" o similar) y llamar a esa misma función en el camino exitoso de `delete-account` en vez de `loadUserDetail(uid)` (el usuario ya no existe, recargar su detalle daría 404).

- [ ] **Step 4: Verificación manual**

Levantar el server local (`node api/index.js` o el flujo de dev habitual del proyecto), entrar al panel admin, abrir el detalle de un usuario de prueba con suscripción activa, click en "Cancelar suscripción" → confirmar con `ELIMINAR` → verificar que el estado se refresca sin suscripción. Luego click en "Eliminar cuenta" en otro usuario de prueba → confirmar con `ELIMINAR` → verificar que vuelve a la lista y el usuario ya no aparece en una búsqueda posterior.

- [ ] **Step 5: Correr toda la suite (nada debería romperse, este archivo no tiene tests)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add admin/admin.js
git commit -m "feat(admin): add cancel-subscription and delete-account buttons to user detail"
```

## Self-Review Notes

- **Cobertura del spec:** helper compartido (Task 3), Stripe cancel-now (Task 2), Firestore/Auth helpers (Task 1), endpoint propio (Task 3), endpoints admin (Task 4), UI propia (Task 5), UI admin (Task 6). Las 6 secciones del spec tienen tarea 1:1.
- **Sin placeholders:** todo el código de cada step está completo y copiable, salvo el Step 3 de Task 6 donde se pide explícitamente leer el archivo real antes de calzar la sintaxis de cierre de la cadena `else if` — es una instrucción de lectura previa, no un "TBD" de contenido.
- **Consistencia de tipos:** `deleteUserAccount(uid) => { alreadyGone: boolean }` se usa igual en Task 3 (implementación) y Task 4 (test del endpoint admin, mockeado). `fireListUserHistory` retorna `{ id, ...campos }` consistente entre Task 1 (definición) y Task 3 (consumo en `deleteUserAccount`). `stripeCancelSubscriptionNow(subscriptionId)` firma igual en Task 2, 3 y 4.
- **Fuera de alcance confirmado:** no se toca `scan_logs`/`reports`, no se agrega exportación de datos, no se cambia el copy de `privacidad.html`.
