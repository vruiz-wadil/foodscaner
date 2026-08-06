# Gestión de usuarios en el panel admin — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar una tab "Usuarios" al panel admin (`admin/index.html`/`admin/admin.js`) que permite buscar un usuario por correo o teléfono (match exacto), ver su perfil completo, desactivar/reactivar su cuenta de Firebase Auth, y cambiar su `membershipStatus`/`membershipExpiresAt` manualmente.

**Architecture:** 3 rutas nuevas bajo `/api/admin/users/*` (protegidas por `requireAdmin`, ya existente) en `api/index.js`, respaldadas por un helper de búsqueda por email en `api/firestore.js` y dos helpers de Identity Toolkit en `api/phoneAuth.js`. El frontend reutiliza el shell de tabs ya existente en `admin/admin.js`, reemplazando el filtro-en-memoria por un buscador servidor para esta tab específica.

**Tech Stack:** Express (backend), Firestore REST API, Identity Toolkit REST API, vanilla JS (frontend admin), vitest.

## Global Constraints

- **Desviación deliberada del spec en organización de archivos** (ver nota arriba): NO se crea `api/adminUsers.js`. `findUserByEmail` va en `api/firestore.js`; `lookupAuthAccount` y `setUserDisabled` van en `api/phoneAuth.js`. Comportamiento externo idéntico al spec, solo cambia dónde vive el código.
- Solo match EXACTO de correo o teléfono — sin búsqueda parcial/prefijo (decisión explícita del usuario).
- Todas las rutas nuevas van bajo `/api/admin/*`, protegidas por `requireAdmin` (ya existente en `api/index.js`).
- `ADMIN_COLLECTIONS` (en `api/firestore.js`) NO se modifica — `users` no se agrega ahí.
- Ningún endpoint de `/api/me/*` cambia.
- "Desactivar cuenta" = `disableUser` real en Firebase Auth vía Identity Toolkit `accounts:update` (bloquea login completamente), no un flag de aplicación.
- Cambio de membresía usa `firePatchUserFields` (sin lock optimista) — no `firePatchUserFieldsWithPrecondition`, ese es solo para el flujo de pago real.
- El `<input type="date">` del frontend (`YYYY-MM-DD`) se convierte a ISO datetime (`new Date(valor + 'T00:00:00.000Z').toISOString()`) antes de enviarse; vacío → `null`.

---

### Task 1: `findUserByEmail` en `api/firestore.js`

**Files:**
- Modify: `api/firestore.js` (agrega la función + la exporta; insertar después de `fireGetPhoneIndex`/`fireSetPhoneIndex`, ~línea 725, antes del `module.exports`)
- Test: `tests/firestore-users.test.js` (ya existe — se le agrega un nuevo `describe`)

**Interfaces:**
- Consumes: `getAccessToken()`, `getProjectId()`, `BASE`, `fromFirestoreFields()` — todos ya definidos en el mismo archivo `api/firestore.js`.
- Produces: `findUserByEmail(email: string): Promise<string|null>` — devuelve el `uid` (= ID del doc en la colección `users`) del primer match, o `null` si no hay match. Exportado desde `api/firestore.js`.

- [ ] **Step 1: Escribir el test que falla**

Agrega a `tests/firestore-users.test.js`, dentro del `describe('users/{uid} data layer', ...)` ya existente (reusa el `buildFetchMock`/`fakeServiceAccountKey` ya definidos arriba en el mismo archivo — no los dupliques), justo antes del cierre `})` final del describe:

```js
  it('findUserByEmail devuelve el uid del primer documento cuando hay match exacto por email', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      capturedBody = JSON.parse(options.body)
      return {
        ok: true,
        status: 200,
        json: async () => ([
          { document: { name: 'projects/foodscaner-test/databases/(default)/documents/users/uid-abc123', fields: {} } }
        ])
      }
    }))

    const uid = await findUserByEmail('user@example.com')

    expect(uid).toBe('uid-abc123')
    expect(capturedBody.structuredQuery.from).toEqual([{ collectionId: 'users' }])
    expect(capturedBody.structuredQuery.where).toEqual({
      fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: 'user@example.com' } }
    })
    expect(capturedBody.structuredQuery.limit).toBe(1)
  })

  it('findUserByEmail devuelve null cuando no hay match', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({
      ok: true,
      status: 200,
      json: async () => ([{}]) // runQuery responde [{}] (sin .document) cuando no hay resultados
    })))

    const uid = await findUserByEmail('nadie@example.com')

    expect(uid).toBeNull()
  })

  it('findUserByEmail lanza cuando Firestore responde error', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({ ok: false, status: 500 })))

    await expect(findUserByEmail('user@example.com')).rejects.toThrow('find user by email failed: 500')
  })
```

También agrega `findUserByEmail` al import de la línea 4 de `tests/firestore-users.test.js`:

```js
const { fireGetUser, fireUpsertUser, firePatchUserFields, findUserByEmail } = await import('../api/firestore.js')
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/firestore-users.test.js -t "findUserByEmail"`
Expected: FAIL — `findUserByEmail is not a function`

- [ ] **Step 3: Implementar en `api/firestore.js`**

Agrega esta función después de `fireSetPhoneIndex` (justo antes de `module.exports`, ~línea 725):

```js
// --- users: búsqueda por email (match exacto, para el panel admin) ---
async function findUserByEmail(email) {
  const token = await getAccessToken();
  if (!token) throw new Error('No Firestore access token');
  const resp = await fetch(`${BASE}/projects/${getProjectId()}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'users' }],
        where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } },
        limit: 1
      }
    }),
    signal: AbortSignal.timeout(5000)
  });
  if (!resp.ok) throw new Error(`Firestore find user by email failed: ${resp.status}`);
  const rows = await resp.json();
  const row = rows.find(r => r.document);
  if (!row) return null;
  return row.document.name.split('/').pop();
}
```

Y agrega `findUserByEmail` a la lista del `module.exports` al final del archivo (línea ~735, junto a `fireGetPhoneIndex, fireSetPhoneIndex`):

```js
  fireGetPhoneIndex, fireSetPhoneIndex, findUserByEmail
};
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/firestore-users.test.js`
Expected: PASS (todos los tests del archivo, incluyendo los 3 nuevos)

- [ ] **Step 5: Commit**

```bash
git add api/firestore.js tests/firestore-users.test.js
git commit -m "feat(admin): agrega findUserByEmail para el buscador de usuarios del panel admin"
```

---

### Task 2: `lookupAuthAccount` y `setUserDisabled` en `api/phoneAuth.js`

**Files:**
- Modify: `api/phoneAuth.js` (agrega las 2 funciones + las exporta; insertar después de `setPhoneNumberClaim`, antes de `module.exports`)
- Test: `tests/phoneAuth.test.js` (ya existe — se le agregan 2 nuevos `describe`)

**Interfaces:**
- Consumes: `getAuthAccessToken()`, `getAuthServiceAccount()` — ya definidos y exportados en el mismo archivo `api/phoneAuth.js`.
- Produces: `lookupAuthAccount(uid: string): Promise<{disabled: boolean, emailVerified: boolean} | null>` y `setUserDisabled(uid: string, disabled: boolean): Promise<void>` — ambas exportadas desde `api/phoneAuth.js`.

- [ ] **Step 1: Escribir los tests que fallan**

Agrega a `tests/phoneAuth.test.js`, después del `describe('setPhoneNumberClaim', ...)` ya existente (reusa el patrón `fakeAuthServiceAccountKey`/`FIREBASE_SERVICE_ACCOUNT_KEY_DEV` ya usado en ese describe — defínelo localmente igual que ahí si no es accesible fuera del describe):

```js
describe('lookupAuthAccount', () => {
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

  it('calls Identity Toolkit accounts:lookup with localId and returns {disabled, emailVerified}', async () => {
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
      return { ok: true, status: 200, json: async () => ({ users: [{ localId: 'uid-1', disabled: true, emailVerified: false }] }) }
    }))

    const { lookupAuthAccount } = await import('../api/phoneAuth.js')
    const result = await lookupAuthAccount('uid-1')

    expect(capturedUrl).toBe('https://identitytoolkit.googleapis.com/v1/projects/foodscaner-dev/accounts:lookup')
    expect(capturedBody.localId).toEqual(['uid-1'])
    expect(result).toEqual({ disabled: true, emailVerified: false })
  })

  it('returns null when Identity Toolkit finds no matching account', async () => {
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
      return { ok: true, status: 200, json: async () => ({}) } // sin campo "users"
    }))

    const { lookupAuthAccount } = await import('../api/phoneAuth.js')
    const result = await lookupAuthAccount('uid-missing')

    expect(result).toBeNull()
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

    const { lookupAuthAccount } = await import('../api/phoneAuth.js')
    await expect(lookupAuthAccount('uid-1')).rejects.toThrow('accounts:lookup failed: 400')
  })
})

describe('setUserDisabled', () => {
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

  it('calls Identity Toolkit accounts:update with localId and disableUser:true', async () => {
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

    const { setUserDisabled } = await import('../api/phoneAuth.js')
    await setUserDisabled('uid-1', true)

    expect(capturedUrl).toBe('https://identitytoolkit.googleapis.com/v1/projects/foodscaner-dev/accounts:update')
    expect(capturedBody).toEqual({ localId: 'uid-1', disableUser: true })
  })

  it('calls accounts:update with disableUser:false to reactivate', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY_DEV = fakeAuthServiceAccountKey(privateKey)

    let capturedBody
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 'fake-token', expires_in: 3600 }) }
      }
      capturedBody = JSON.parse(options.body)
      return { ok: true, status: 200 }
    }))

    const { setUserDisabled } = await import('../api/phoneAuth.js')
    await setUserDisabled('uid-1', false)

    expect(capturedBody).toEqual({ localId: 'uid-1', disableUser: false })
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

    const { setUserDisabled } = await import('../api/phoneAuth.js')
    await expect(setUserDisabled('uid-1', true)).rejects.toThrow('accounts:update failed: 400')
  })
})
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/phoneAuth.test.js -t "lookupAuthAccount"`
Run: `npx vitest run tests/phoneAuth.test.js -t "setUserDisabled"`
Expected: FAIL — `lookupAuthAccount`/`setUserDisabled` no exportadas desde `../api/phoneAuth.js`

- [ ] **Step 3: Implementar en `api/phoneAuth.js`**

Agrega estas dos funciones después de `setPhoneNumberClaim` (antes de `module.exports`, ~línea 130):

```js
// Lee el estado real de la cuenta en Firebase Auth (disabled/emailVerified) —
// para el panel admin, que necesita la fuente de verdad de Auth, no solo el
// espejo en Firestore. Ver spec 2026-07-27-admin-user-management-design.md.
async function lookupAuthAccount(uid) {
  const token = await getAuthAccessToken();
  const sa = getAuthServiceAccount();
  if (!token || !sa) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY_DEV no configurada');
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:lookup`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: [uid] })
  });
  if (!resp.ok) throw new Error(`Identity Toolkit accounts:lookup failed: ${resp.status}`);
  const data = await resp.json();
  const account = (data.users || [])[0];
  if (!account) return null;
  return { disabled: !!account.disabled, emailVerified: !!account.emailVerified };
}

// Bloquea/desbloquea el login por completo vía Identity Toolkit
// accounts:update (disableUser) — usado por el panel admin para
// desactivar/reactivar cuentas.
async function setUserDisabled(uid, disabled) {
  const token = await getAuthAccessToken();
  const sa = getAuthServiceAccount();
  if (!token || !sa) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY_DEV no configurada');
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:update`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, disableUser: disabled })
  });
  if (!resp.ok) throw new Error(`Identity Toolkit accounts:update failed: ${resp.status}`);
}
```

Y actualiza el `module.exports` al final del archivo:

```js
module.exports = { sendVerificationCode, checkVerificationCode, createFirebaseCustomToken, setPhoneNumberClaim, getAuthAccessToken, getAuthServiceAccount, lookupAuthAccount, setUserDisabled };
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/phoneAuth.test.js`
Expected: PASS (todos los tests del archivo, incluyendo los 6 nuevos)

- [ ] **Step 5: Commit**

```bash
git add api/phoneAuth.js tests/phoneAuth.test.js
git commit -m "feat(admin): agrega lookupAuthAccount y setUserDisabled para desactivar cuentas desde el panel admin"
```

---

### Task 3: Rutas `/api/admin/users/*` en `api/index.js`

**Files:**
- Modify: `api/index.js` (imports en línea 7 y línea 9; handlers + rutas nuevas insertadas después de `app.delete('/api/admin/cache-all/:type/:key', ...)`, ~línea 2028, antes de `app.get('/api/admin/:collection', ...)`; exports al final del archivo)
- Test: `tests/adminUsers.test.js` (nuevo)

**Interfaces:**
- Consumes: `findUserByEmail` (Task 1), `fireGetPhoneIndex`, `fireGetUserRaw`, `firePatchUserFields` (ya existentes en `api/firestore.js`); `lookupAuthAccount`, `setUserDisabled` (Task 2, de `api/phoneAuth.js`); `requireAdmin` (ya existente en `api/index.js`, ~línea 1846).
- Produces: `searchUserHandler(req, res)`, `patchUserMembershipHandler(req, res)`, `setUserDisabledHandler(req, res)` — exportados desde `api/index.js` para poder probarse directamente (mismo patrón que `payMembershipHandler`).

- [ ] **Step 1: Escribir el test que falla**

Crea `tests/adminUsers.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const phoneAuthModule = requireFn('../api/phoneAuth.js')

const findUserByEmail = vi.fn()
const fireGetPhoneIndex = vi.fn()
const fireGetUserRaw = vi.fn()
const firePatchUserFields = vi.fn()
firestoreModule.findUserByEmail = findUserByEmail
firestoreModule.fireGetPhoneIndex = fireGetPhoneIndex
firestoreModule.fireGetUserRaw = fireGetUserRaw
firestoreModule.firePatchUserFields = firePatchUserFields

const lookupAuthAccount = vi.fn()
const setUserDisabled = vi.fn()
phoneAuthModule.lookupAuthAccount = lookupAuthAccount
phoneAuthModule.setUserDisabled = setUserDisabled

const { searchUserHandler, patchUserMembershipHandler, setUserDisabledHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('searchUserHandler', () => {
  beforeEach(() => {
    findUserByEmail.mockReset()
    fireGetPhoneIndex.mockReset()
    fireGetUserRaw.mockReset()
    lookupAuthAccount.mockReset()
  })

  it('responds 400 when q is missing', async () => {
    const req = { query: {} }
    const res = makeRes()
    await searchUserHandler(req, res)
    expect(res.statusCode).toBe(400)
  })

  it('searches by email when q contains @, and returns profile + auth status', async () => {
    findUserByEmail.mockResolvedValue('uid-1')
    fireGetUserRaw.mockResolvedValue({ fields: { email: 'a@b.com', membershipStatus: 'active' }, updateTime: '2026-01-01T00:00:00.000000Z' })
    lookupAuthAccount.mockResolvedValue({ disabled: false, emailVerified: true })
    const req = { query: { q: 'a@b.com' } }
    const res = makeRes()

    await searchUserHandler(req, res)

    expect(findUserByEmail).toHaveBeenCalledWith('a@b.com')
    expect(fireGetPhoneIndex).not.toHaveBeenCalled()
    expect(res.body).toEqual({
      uid: 'uid-1',
      profile: { email: 'a@b.com', membershipStatus: 'active' },
      auth: { disabled: false, emailVerified: true }
    })
  })

  it('searches by phone via fireGetPhoneIndex when q has no @', async () => {
    fireGetPhoneIndex.mockResolvedValue({ uid: 'uid-2' })
    fireGetUserRaw.mockResolvedValue({ fields: { phoneNumber: '+525512345678' }, updateTime: 't' })
    lookupAuthAccount.mockResolvedValue({ disabled: true, emailVerified: false })
    const req = { query: { q: '+525512345678' } }
    const res = makeRes()

    await searchUserHandler(req, res)

    expect(fireGetPhoneIndex).toHaveBeenCalledWith('+525512345678')
    expect(findUserByEmail).not.toHaveBeenCalled()
    expect(res.body.uid).toBe('uid-2')
    expect(res.body.auth.disabled).toBe(true)
  })

  it('responds 404 when no uid resolves (email not found)', async () => {
    findUserByEmail.mockResolvedValue(null)
    const req = { query: { q: 'nobody@example.com' } }
    const res = makeRes()
    await searchUserHandler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('responds 404 when phone has no phoneIndex entry', async () => {
    fireGetPhoneIndex.mockResolvedValue(null)
    const req = { query: { q: '+520000000000' } }
    const res = makeRes()
    await searchUserHandler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('responds 404 when uid resolves but the user doc is missing', async () => {
    findUserByEmail.mockResolvedValue('uid-orphan')
    fireGetUserRaw.mockResolvedValue(null)
    const req = { query: { q: 'orphan@example.com' } }
    const res = makeRes()
    await searchUserHandler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('responds 500 when a dependency throws', async () => {
    findUserByEmail.mockRejectedValue(new Error('boom'))
    const req = { query: { q: 'x@example.com' } }
    const res = makeRes()
    await searchUserHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})

describe('patchUserMembershipHandler', () => {
  beforeEach(() => { firePatchUserFields.mockReset() })

  it('rejects an invalid membershipStatus', async () => {
    const req = { params: { uid: 'uid-1' }, body: { membershipStatus: 'bogus', membershipExpiresAt: null } }
    const res = makeRes()
    await patchUserMembershipHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('patches membershipStatus and membershipExpiresAt via firePatchUserFields', async () => {
    firePatchUserFields.mockResolvedValue(true)
    const req = { params: { uid: 'uid-1' }, body: { membershipStatus: 'active', membershipExpiresAt: '2026-08-21T00:00:00.000Z' } }
    const res = makeRes()

    await patchUserMembershipHandler(req, res)

    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['membershipStatus', 'membershipExpiresAt'], {
      membershipStatus: 'active', membershipExpiresAt: '2026-08-21T00:00:00.000Z'
    })
    expect(res.body).toEqual({ ok: true })
  })

  it('sends null for membershipExpiresAt when omitted (e.g. setting status to pending)', async () => {
    firePatchUserFields.mockResolvedValue(true)
    const req = { params: { uid: 'uid-1' }, body: { membershipStatus: 'pending' } }
    const res = makeRes()

    await patchUserMembershipHandler(req, res)

    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['membershipStatus', 'membershipExpiresAt'], {
      membershipStatus: 'pending', membershipExpiresAt: null
    })
  })

  it('responds 500 when firePatchUserFields throws', async () => {
    firePatchUserFields.mockRejectedValue(new Error('boom'))
    const req = { params: { uid: 'uid-1' }, body: { membershipStatus: 'active', membershipExpiresAt: null } }
    const res = makeRes()
    await patchUserMembershipHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})

describe('setUserDisabledHandler', () => {
  beforeEach(() => { setUserDisabled.mockReset() })

  it('rejects a non-boolean disabled value', async () => {
    const req = { params: { uid: 'uid-1' }, body: { disabled: 'yes' } }
    const res = makeRes()
    await setUserDisabledHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(setUserDisabled).not.toHaveBeenCalled()
  })

  it('calls setUserDisabled(uid, true) and returns ok', async () => {
    setUserDisabled.mockResolvedValue(undefined)
    const req = { params: { uid: 'uid-1' }, body: { disabled: true } }
    const res = makeRes()

    await setUserDisabledHandler(req, res)

    expect(setUserDisabled).toHaveBeenCalledWith('uid-1', true)
    expect(res.body).toEqual({ ok: true, disabled: true })
  })

  it('calls setUserDisabled(uid, false) to reactivate', async () => {
    setUserDisabled.mockResolvedValue(undefined)
    const req = { params: { uid: 'uid-1' }, body: { disabled: false } }
    const res = makeRes()

    await setUserDisabledHandler(req, res)

    expect(setUserDisabled).toHaveBeenCalledWith('uid-1', false)
    expect(res.body).toEqual({ ok: true, disabled: false })
  })

  it('responds 500 when setUserDisabled throws', async () => {
    setUserDisabled.mockRejectedValue(new Error('boom'))
    const req = { params: { uid: 'uid-1' }, body: { disabled: true } }
    const res = makeRes()
    await setUserDisabledHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/adminUsers.test.js`
Expected: FAIL — `searchUserHandler`/`patchUserMembershipHandler`/`setUserDisabledHandler` no exportadas desde `../api/index.js`

- [ ] **Step 3: Implementar en `api/index.js`**

Cambia la línea 7 (agrega `fireGetUserRaw` y `findUserByEmail` al destructure ya existente — el resto de la línea se mantiene igual, solo se agregan estos 2 nombres al final antes de `} = require('./firestore');`):

```js
const { getAccessToken, fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache, fireGetOcrData, fireSetOcrData, fireGetNutritionOcr, fireSetNutritionOcr, fireListDocs, fireListAll, fireDeleteDoc, fireLogScan, fireMarkScanNotFound, fireMarkScanHasOcr, fireMarkScanHasNutrition, fireMarkScanConfidence, fireMarkScanSource, fireMarkScanSources, fireLogReport, ADMIN_COLLECTIONS, fireUpsertUser, fireGetUser, firePatchUserFields, fireIncrementUsageCounter, fireRecordMembershipPayment, fireLogUserHistory, fireListUserHistory, fireGetPhoneIndex, fireSetPhoneIndex, fireGetUserRaw, findUserByEmail } = require('./firestore');
```

Cambia la línea 9 (agrega `lookupAuthAccount` y `setUserDisabled`):

```js
const { sendVerificationCode, checkVerificationCode, createFirebaseCustomToken, setPhoneNumberClaim, lookupAuthAccount, setUserDisabled } = require('./phoneAuth');
```

Inserta esto después de `app.delete('/api/admin/cache-all/:type/:key', ...)` (después de la línea `});` que cierra esa ruta, ~línea 2028), antes de `app.get('/api/admin/:collection', ...)`:

```js
async function searchUserHandler(req, res) {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'missing_query' });
  try {
    let uid;
    if (q.includes('@')) {
      uid = await findUserByEmail(q);
    } else {
      const idx = await fireGetPhoneIndex(q);
      uid = idx ? idx.uid : null;
    }
    if (!uid) return res.status(404).json({ error: 'not_found' });

    const userDoc = await fireGetUserRaw(uid);
    if (!userDoc) return res.status(404).json({ error: 'not_found' });

    const authAccount = await lookupAuthAccount(uid);
    res.json({ uid, profile: userDoc.fields, auth: authAccount });
  } catch (e) {
    res.status(500).json({ error: 'internal_error' });
  }
}

async function patchUserMembershipHandler(req, res) {
  const { uid } = req.params;
  const { membershipStatus, membershipExpiresAt } = req.body || {};
  if (!['pending', 'active', 'expired'].includes(membershipStatus)) {
    return res.status(400).json({ error: 'invalid_membership_status' });
  }
  try {
    await firePatchUserFields(uid, ['membershipStatus', 'membershipExpiresAt'], {
      membershipStatus, membershipExpiresAt: membershipExpiresAt || null
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'internal_error' });
  }
}

async function setUserDisabledHandler(req, res) {
  const { uid } = req.params;
  const { disabled } = req.body || {};
  if (typeof disabled !== 'boolean') return res.status(400).json({ error: 'invalid_disabled' });
  try {
    await setUserDisabled(uid, disabled);
    res.json({ ok: true, disabled });
  } catch (e) {
    res.status(500).json({ error: 'internal_error' });
  }
}

app.get('/api/admin/users/search', requireAdmin, searchUserHandler);
app.patch('/api/admin/users/:uid/membership', requireAdmin, patchUserMembershipHandler);
app.post('/api/admin/users/:uid/disabled', requireAdmin, setUserDisabledHandler);
```

Agrega estas 3 líneas junto a los demás `module.exports.XHandler = ...` al final del archivo (después de `module.exports.optionalUser = optionalUser;`):

```js
module.exports.searchUserHandler = searchUserHandler;
module.exports.patchUserMembershipHandler = patchUserMembershipHandler;
module.exports.setUserDisabledHandler = setUserDisabledHandler;
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/adminUsers.test.js`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/adminUsers.test.js
git commit -m "feat(admin): agrega rutas /api/admin/users/* (buscar, cambiar membresía, desactivar/reactivar)"
```

---

### Task 4: Tab "Usuarios" en el panel admin (`admin/index.html` + `admin/admin.js`)

**Files:**
- Modify: `admin/index.html`
- Modify: `admin/admin.js`

**Interfaces:**
- Consumes: `GET /api/admin/users/search?q=`, `PATCH /api/admin/users/:uid/membership`, `POST /api/admin/users/:uid/disabled` (Task 3).
- Produces: nada consumido por otras tasks — es la última.

Nota: `admin.js` es un script clásico sin exports (patrón ya establecido en el repo, igual que la parte "script clásico" de `account-ui.js` — no hay tests automatizados para `admin.js` en ningún punto de este repo). Este task se verifica manualmente, no con vitest.

- [ ] **Step 1: Agregar la tab y el botón de búsqueda en `admin/index.html`**

Agrega este botón dentro de `<nav class="side-nav" id="tabs">` (después del botón de `cache`, ~línea 159):

```html
      <button class="tab-btn" data-col="users">👤 Usuarios</button>
```

Cambia el `<div class="toolbar" id="toolbar">` (~líneas 167-169) de:

```html
    <div class="toolbar" id="toolbar">
      <input id="filter-input" type="text" placeholder="Filtrar…">
    </div>
```

a:

```html
    <div class="toolbar" id="toolbar">
      <input id="filter-input" type="text" placeholder="Filtrar…">
      <button class="btn" id="btn-user-search" style="display:none;">Buscar</button>
    </div>
```

- [ ] **Step 2: Wiring de la tab en `admin/admin.js`**

Agrega esta línea junto a las demás constantes `getElementById` al inicio del archivo (después de `const toolbarEl = document.getElementById('toolbar');`, ~línea 17):

```js
  const btnUserSearch = document.getElementById('btn-user-search');
```

Agrega `let lastUserSearch = null;` junto a las demás variables de estado (después de `let lastCacheData = null;`, ~línea 23).

Cambia `SECTION_TITLES` (~línea 25) de:

```js
  const SECTION_TITLES = { resumen: 'Resumen', scan_logs: 'Logs de escaneo', reports: 'Reportes', products_ocr: 'OCR ingredientes', products_nutrition: 'OCR nutrición', cache: 'Cache' };
```

a:

```js
  const SECTION_TITLES = { resumen: 'Resumen', scan_logs: 'Logs de escaneo', reports: 'Reportes', products_ocr: 'OCR ingredientes', products_nutrition: 'OCR nutrición', cache: 'Cache', users: 'Usuarios' };
```

Cambia `FILTER_PLACEHOLDERS` (~línea 376-382) agregando la entrada `users` al objeto ya existente:

```js
  const FILTER_PLACEHOLDERS = {
    scan_logs: 'Filtrar por código, IP, sistema, producto, fuente o cache…',
    reports: 'Filtrar por código, categoría o comentario…',
    products_ocr: 'Filtrar por ID…',
    products_nutrition: 'Filtrar por ID…',
    cache: 'Filtrar por código, nombre, fuente o modelo…',
    users: 'Correo o teléfono (+52...)'
  };
```

Dentro del listener `tabsEl.addEventListener('click', e => { ... })` (~línea 128-142), agrega esta línea justo antes del cierre `});` del listener (después de `loadCollection();`):

```js
    btnUserSearch.style.display = currentCol === 'users' ? 'inline-block' : 'none';
```

- [ ] **Step 3: Rama `users` en `loadCollection()`**

Cambia el inicio de `loadCollection()` (~línea 152) de:

```js
  async function loadCollection(append = false) {
    if (currentCol === 'resumen') { await loadStats(); return; }
```

a:

```js
  async function loadCollection(append = false) {
    if (currentCol === 'users') {
      docList.innerHTML = '<div class="empty-msg">Busca un usuario por correo o teléfono.</div>';
      statsBar.textContent = '';
      loadMoreEl.innerHTML = '';
      return;
    }
    if (currentCol === 'resumen') { await loadStats(); return; }
```

- [ ] **Step 4: Funciones `searchUser` y `renderUserDetail`**

Agrega estas dos funciones nuevas después de `renderCacheAll` (justo antes de la línea `const SOURCE_LABELS = ...`, ~línea 287):

```js
  async function searchUser(q) {
    docList.innerHTML = '<div class="empty-msg">Buscando…</div>';
    statsBar.textContent = '';
    const r = await apiFetch('/api/admin/users/search?q=' + encodeURIComponent(q));
    if (r.status === 404) { docList.innerHTML = '<div class="empty-msg">No se encontró ningún usuario con ese correo/teléfono.</div>'; return; }
    if (!r.ok) { docList.innerHTML = '<div class="empty-msg">Error al buscar.</div>'; return; }
    lastUserSearch = q;
    renderUserDetail(await r.json());
  }

  function renderUserDetail(data) {
    const { uid, profile, auth } = data;
    const dateInputValue = profile.membershipExpiresAt ? profile.membershipExpiresAt.slice(0, 10) : '';
    const authBadge = auth.disabled
      ? '<span class="cache-badge" style="background:#fdecea;color:#b3261e;border-color:#f5c2c0;">Desactivada</span>'
      : '<span class="cache-badge cache-badge-both">Activa</span>';
    docList.innerHTML = `
      <div class="list-card doc-item" style="flex-direction:column;align-items:stretch;gap:10px;">
        <div>
          <div class="doc-id">${escHtml(profile.displayName || profile.email || profile.phoneNumber || uid)}</div>
          <div class="doc-meta">UID: ${escHtml(uid)}</div>
          <div class="doc-meta">Correo: ${escHtml(profile.email || '—')} · Teléfono: ${escHtml(profile.phoneNumber || '—')}</div>
          <div class="doc-meta">Proveedores: ${escHtml((profile.providers || []).join(', ') || '—')}</div>
          <div class="doc-meta">Creada: ${profile.createdAt ? new Date(profile.createdAt).toLocaleString('es-MX') : '—'} · Último login: ${profile.lastLoginAt ? new Date(profile.lastLoginAt).toLocaleString('es-MX') : '—'}</div>
          <div class="doc-meta">Escaneos totales: ${(profile.usage && profile.usage.totalScans) || 0}</div>
          <div class="doc-meta">Estado de cuenta: ${authBadge}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <select id="user-membership-status">
            <option value="pending" ${profile.membershipStatus === 'pending' ? 'selected' : ''}>Pendiente</option>
            <option value="active" ${profile.membershipStatus === 'active' ? 'selected' : ''}>Activa</option>
            <option value="expired" ${profile.membershipStatus === 'expired' ? 'selected' : ''}>Expirada</option>
          </select>
          <input type="date" id="user-membership-expires" value="${dateInputValue}">
          <button class="btn" data-action="save-membership" data-uid="${escHtml(uid)}">Guardar membresía</button>
        </div>
        <div>
          <button class="btn-del" data-action="toggle-disabled" data-uid="${escHtml(uid)}" data-disabled="${auth.disabled ? 'true' : 'false'}">${auth.disabled ? 'Reactivar cuenta' : 'Desactivar cuenta'}</button>
        </div>
      </div>`;
  }
```

- [ ] **Step 5: Wiring del botón de búsqueda + Enter**

Agrega esto después del bloque `filterInput.addEventListener('input', () => { ... });` ya existente (~línea 144-150):

```js
  btnUserSearch.addEventListener('click', () => {
    const q = filterInput.value.trim();
    if (q) searchUser(q);
  });

  filterInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && currentCol === 'users') {
      const q = filterInput.value.trim();
      if (q) searchUser(q);
    }
  });
```

- [ ] **Step 6: Acciones de guardar-membresía y desactivar/reactivar**

Dentro del listener delegado `docList.addEventListener('click', async e => { ... })` ya existente, agrega estos 2 `else if` nuevos justo antes del `else if (btn.dataset.action === 'view-cache') { ... }` ya existente (o después, el orden entre ramas no importa):

```js
    } else if (btn.dataset.action === 'save-membership') {
      const uid = btn.dataset.uid;
      const status = document.getElementById('user-membership-status').value;
      const dateVal = document.getElementById('user-membership-expires').value;
      const membershipExpiresAt = dateVal ? new Date(dateVal + 'T00:00:00.000Z').toISOString() : null;
      btn.disabled = true;
      btn.textContent = '…';
      const r = await apiFetch('/api/admin/users/' + encodeURIComponent(uid) + '/membership', {
        method: 'PATCH',
        body: JSON.stringify({ membershipStatus: status, membershipExpiresAt })
      });
      if (r.ok) {
        searchUser(lastUserSearch);
      } else {
        alert('Error al guardar la membresía.');
        btn.disabled = false;
        btn.textContent = 'Guardar membresía';
      }
    } else if (btn.dataset.action === 'toggle-disabled') {
      const uid = btn.dataset.uid;
      const currentlyDisabled = btn.dataset.disabled === 'true';
      const next = !currentlyDisabled;
      if (!confirm(next ? '¿Desactivar esta cuenta? El usuario no podrá iniciar sesión.' : '¿Reactivar esta cuenta?')) return;
      btn.disabled = true;
      btn.textContent = '…';
      const r = await apiFetch('/api/admin/users/' + encodeURIComponent(uid) + '/disabled', {
        method: 'POST',
        body: JSON.stringify({ disabled: next })
      });
      if (r.ok) {
        searchUser(lastUserSearch);
      } else {
        alert('Error al cambiar el estado de la cuenta.');
        btn.disabled = false;
        btn.textContent = currentlyDisabled ? 'Reactivar cuenta' : 'Desactivar cuenta';
      }
```

- [ ] **Step 7: Verificación manual**

No hay test automatizado para `admin.js` (consistente con el resto del archivo). Verificar manualmente contra el backend ya implementado en Tasks 1-3:

1. `vercel dev` (o el comando de desarrollo local del proyecto).
2. Abrir `/admin/index.html`, iniciar sesión con `ADMIN_TOKEN`.
3. Click en la tab "👤 Usuarios" — debe mostrar el buscador vacío con placeholder "Correo o teléfono (+52...)".
4. Buscar un correo real existente (o un teléfono en formato `+52...`) — debe mostrar la card con perfil, badge de estado, y los 2 controles de acción.
5. Cambiar el `<select>` de status + fecha, click "Guardar membresía" — debe refrescar la card con los valores nuevos.
6. Click "Desactivar cuenta", confirmar — debe cambiar a "Reactivar cuenta" y el badge a "Desactivada". Verificar en Firebase Console (Authentication → ese usuario) que quedó `Disabled`.
7. Click "Reactivar cuenta" — debe revertir.
8. Buscar un correo/teléfono que no existe — debe mostrar "No se encontró ningún usuario...".

- [ ] **Step 8: Commit**

```bash
git add admin/index.html admin/admin.js
git commit -m "feat(admin): agrega tab Usuarios (buscar, ver perfil, cambiar membresía, desactivar cuenta)"
```

---

## Verificación final (tras las 4 tasks)

Correr la suite completa: `npx vitest run` — debe dar el mismo resultado base ya conocido en este repo (todos los tests de vitest en verde; el único archivo que falla es `tests/e2e/scan-cycle.spec.js`, un problema de configuración de Playwright preexistente y no relacionado). Además, completar la verificación manual del Task 4 Step 7 antes de dar el feature por terminado.
