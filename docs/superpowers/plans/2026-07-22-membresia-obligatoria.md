# Membresía obligatoria + onboarding completo — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el modelo `plan: 'free'|'premium'` por una membresía de pago obligatoria (simulada por ahora), y extender el registro para pedir nombre/teléfono/correo (los que falten) y preferencias a toda cuenta nueva, sin importar el método de login.

**Architecture:** `users/{uid}` gana `profile` (contacto) y `membershipStatus`/`membershipExpiresAt`/`lastPaymentAt` (reemplazan a `plan`). Un nuevo middleware `requireActiveMembership` (después de `requireUser`) gatea preferences/historial-nube/OCR con un chequeo perezoso de expiración (sin cron). El onboarding es una cadena de 3 páginas nuevas/reusadas (perfil → preferencias → pago) conectadas por redirects; las preferencias elegidas durante el onboarding se retienen en `sessionStorage` hasta que el pago activa la cuenta (una cuenta pendiente de pago no puede tener `preferences` en Firestore).

**Tech Stack:** Express (api/index.js), REST a Firestore (api/firestore.js, sin firebase-admin), vanilla JS + Firebase JS SDK en frontend, vitest.

Spec de referencia: `docs/superpowers/specs/2026-07-22-membresia-obligatoria-design.md`.

## Global Constraints

- Sin billing real: el "pago" es un checkbox que llama `POST /api/me/membership/pay`, que siempre activa la cuenta con 30 días de vigencia (`membershipExpiresAt = hoy + 30 días`).
- `membershipStatus` es el ÚNICO campo de control de acceso — no se reintroduce `disabled` ni `plan`.
- Toda escritura a Firestore usa `updateMask.fieldPaths` explícito (patrón ya establecido en `firePatchUserFields`) — nunca se acepta el body crudo del cliente como estado nuevo del doc.
- `requireActiveMembership` responde SIEMPRE 402 (nunca 403) cuando la membresía no está activa: `{error:'membership_required'}` (nunca pagó) o `{error:'membership_expired'}` (pagó antes, venció).
- El escaneo anónimo (sin login, vía `optionalUser` con `req.user === null`) NO cambia — fuera de alcance de este plan.
- `cacheRefreshCount` en `usage` se deja intacto (campo inerte, sin gate real hoy ni en este plan).
- Todos los tests siguen el patrón `createRequire` + mutación de `module.exports` de `api/firestore.js` ya usado en `tests/putPreferences.test.js`, `tests/getMe.test.js`, `tests/meHistory.test.js` — NUNCA `vi.mock` (no intercepta el `require` anidado dentro de `api/index.js`).

---

### Task 1: Modelo de datos — `api/firestore.js`

**Files:**
- Modify: `api/firestore.js:476-536` (`fireUpsertUser`), `api/firestore.js:586-618` (`fireIncrementUsageCounter`)
- Test: `tests/firestore-users.test.js`, `tests/firestore-usage.test.js`

**Interfaces:**
- Produces: `fireUpsertUser(uid, data)` crea el doc con `profile: {displayName:null, phone:null, email:null, completedAt:null}`, `membershipStatus:'pending'`, `membershipExpiresAt:null`, `lastPaymentAt:null` en vez de `disabled`/`plan`/`planUpdatedAt`. `usage` ya no incluye `ocrCount`.
- Produces: `fireIncrementUsageCounter(uid, field)` solo acepta `'cacheRefreshCount'|'totalScans'` (se quita `'ocrCount'` del allowlist y de `newUsage`).

- [ ] **Step 1: Escribir los tests que fallan (ediciones sobre los existentes)**

En `tests/firestore-users.test.js`, reemplaza la prueba de creación (líneas 72-89) por:

```js
  it('fireUpsertUser creates a new doc with membershipStatus:"pending" when none exists (no updateMask — creación completa)', async () => {
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
    expect(patchCalls[0].body.fields.membershipStatus.stringValue).toBe('pending')
    expect(patchCalls[0].body.fields.membershipExpiresAt).toEqual({ nullValue: null })
    expect(patchCalls[0].body.fields.lastPaymentAt).toEqual({ nullValue: null })
    expect(patchCalls[0].body.fields.profile.mapValue.fields.displayName).toEqual({ nullValue: null })
    expect(patchCalls[0].body.fields.profile.mapValue.fields.completedAt).toEqual({ nullValue: null })
    expect(patchCalls[0].body.fields.usage.mapValue.fields.ocrCount).toBeUndefined()
    expect(patchCalls[0].body.fields.usage.mapValue.fields.cacheRefreshCount.integerValue).toBe('0')
    expect(patchCalls[0].body.fields.billing.mapValue.fields.isFounderPricing.booleanValue).toBe(false)
    expect(patchCalls[0].body.fields.plan).toBeUndefined()
    expect(patchCalls[0].body.fields.disabled).toBeUndefined()
  })
```

Y la prueba de "solo actualiza lastLoginAt/providers" (líneas 119-136) queda igual — solo verifica que no hay chequeo de `plan`, así que no requiere cambio, pero AGREGA esta aserción extra al final de esa misma prueba:

```js
    expect(patchCalls[0].body.fields.membershipStatus).toBeUndefined()
```

En `tests/firestore-usage.test.js`, reemplaza el archivo completo — todas las pruebas usaban `'ocrCount'` como el campo que "se resetea al cambiar de día"; ahora ese rol lo cumple `'cacheRefreshCount'`:

```js
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

  it('rejects an unknown field name', async () => {
    await expect(fireIncrementUsageCounter('uid-1', 'ocrCount')).rejects.toThrow('Campo de uso inválido: ocrCount')
  })

  it('resets cacheRefreshCount to 0 before incrementing when usage.date is not today (UTC)', async () => {
    let patchBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-14' }, cacheRefreshCount: { integerValue: '1' }, totalScans: { integerValue: '20' }
            } } } },
            updateTime: '2026-07-14T23:00:00.000000Z'
          })
        }
      }
      patchBody = JSON.parse(options.body)
      return { ok: true, status: 200 }
    }))

    const result = await fireIncrementUsageCounter('uid-1', 'cacheRefreshCount')

    expect(result).toEqual({ date: '2026-07-15', cacheRefreshCount: 1, totalScans: 20 })
    expect(patchBody.currentDocument.updateTime).toBe('2026-07-14T23:00:00.000000Z')
  })

  it('increments the existing counter when usage.date is already today', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-15' }, cacheRefreshCount: { integerValue: '2' }, totalScans: { integerValue: '20' }
            } } } },
            updateTime: '2026-07-15T10:00:00.000000Z'
          })
        }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireIncrementUsageCounter('uid-1', 'cacheRefreshCount')

    expect(result).toEqual({ date: '2026-07-15', cacheRefreshCount: 3, totalScans: 20 })
  })

  it('retries with backoff on a 409 conflict and succeeds on the next attempt', async () => {
    let patchAttempts = 0
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-15' }, cacheRefreshCount: { integerValue: '0' }
            } } } },
            updateTime: '2026-07-15T10:00:00.000000Z'
          })
        }
      }
      patchAttempts++
      if (patchAttempts === 1) return { ok: false, status: 409 }
      return { ok: true, status: 200 }
    }))
    vi.useRealTimers()

    const result = await fireIncrementUsageCounter('uid-1', 'cacheRefreshCount')

    expect(patchAttempts).toBe(2)
    expect(result.cacheRefreshCount).toBe(1)
  })

  it('gives up after repeated 409 conflicts and throws', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-15' }, cacheRefreshCount: { integerValue: '0' }
            } } } },
            updateTime: '2026-07-15T10:00:00.000000Z'
          })
        }
      }
      return { ok: false, status: 409 }
    }))
    vi.useRealTimers()

    await expect(fireIncrementUsageCounter('uid-1', 'cacheRefreshCount')).rejects.toThrow()
  })

  it('throws when the user document does not exist', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) return { status: 404, ok: false }
      return { ok: true, status: 200 }
    }))

    await expect(fireIncrementUsageCounter('uid-missing', 'totalScans')).rejects.toThrow()
  })

  it('incrementa totalScans sin resetearlo aunque usage.date no sea hoy (a diferencia de cacheRefreshCount, es de por vida)', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-14' }, cacheRefreshCount: { integerValue: '1' }, totalScans: { integerValue: '20' }
            } } } },
            updateTime: '2026-07-14T23:00:00.000000Z'
          })
        }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireIncrementUsageCounter('uid-1', 'totalScans')

    expect(result).toEqual({ date: '2026-07-15', cacheRefreshCount: 0, totalScans: 21 })
  })

  it('trata totalScans ausente como 0 (perfil creado antes de este campo)', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-15' }, cacheRefreshCount: { integerValue: '0' }
            } } } },
            updateTime: '2026-07-15T10:00:00.000000Z'
          })
        }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireIncrementUsageCounter('uid-1', 'totalScans')

    expect(result).toEqual({ date: '2026-07-15', cacheRefreshCount: 0, totalScans: 1 })
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/firestore-users.test.js tests/firestore-usage.test.js`
Expected: FAIL (el código todavía crea `plan:'free'`/`disabled` y `fireIncrementUsageCounter` todavía acepta/escribe `ocrCount`).

- [ ] **Step 3: Implementar — `api/firestore.js`**

Reemplaza el bloque de creación dentro de `fireUpsertUser` (líneas 488-513):

```js
    const fields = toFirestoreFields({
      email: data.email || null,
      phoneNumber: data.phoneNumber || null,
      emailVerified: !!data.emailVerified,
      displayName: data.displayName || null,
      photoURL: data.photoURL || null,
      providers: data.providers || [],
      createdAt: nowIso,
      lastLoginAt: nowIso,
      profile: { displayName: null, phone: null, email: null, completedAt: null },
      membershipStatus: 'pending',
      membershipExpiresAt: null,
      lastPaymentAt: null,
      termsAcceptedAt: data.termsAccepted ? nowIso : null,
      termsVersion: data.termsAccepted ? (data.termsVersion || 'v1') : null,
      ageConfirmedAt: data.ageConfirmed ? nowIso : null,
      billing: {
        stripeCustomerId: null, subscriptionId: null,
        subscriptionStatus: null, currentPeriodEnd: null,
        isFounderPricing: false, billingCycle: null
      },
      usage: { date: today, cacheRefreshCount: 0, totalScans: 0 }
    });
```

Reemplaza `fireIncrementUsageCounter` completo (líneas 586-618):

```js
async function fireIncrementUsageCounter(uid, field) {
  if (!['cacheRefreshCount', 'totalScans'].includes(field)) {
    throw new Error('Campo de uso inválido: ' + field);
  }
  const today = new Date().toISOString().slice(0, 10); // UTC, a propósito (ver spec)
  const MAX_ATTEMPTS = 3;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const doc = await fireGetUserRaw(uid);
    if (!doc) throw new Error('Usuario no encontrado: ' + uid);

    const currentUsage = doc.fields.usage || { date: today, cacheRefreshCount: 0, totalScans: 0 };
    const isNewDay = currentUsage.date !== today;
    const newUsage = {
      date: today,
      cacheRefreshCount: isNewDay ? (field === 'cacheRefreshCount' ? 1 : 0) : (currentUsage.cacheRefreshCount || 0) + (field === 'cacheRefreshCount' ? 1 : 0),
      // totalScans NUNCA se resetea por cambio de día (a diferencia del otro
      // campo) — es un contador de por vida, no una cuota diaria.
      totalScans: (currentUsage.totalScans || 0) + (field === 'totalScans' ? 1 : 0)
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

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/firestore-users.test.js tests/firestore-usage.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/firestore.js tests/firestore-users.test.js tests/firestore-usage.test.js
git commit -m "feat(users): replace plan free/premium with membershipStatus in user schema"
```

---

### Task 2: Middleware `requireActiveMembership`

**Files:**
- Modify: `api/index.js` (agregar después de `optionalUser`, línea ~83)
- Test: `tests/requireActiveMembership.test.js` (nuevo)

**Interfaces:**
- Consumes: `fireGetUser(uid)`, `firePatchUserFields(uid, fieldPaths, data)` (ya existen en `api/firestore.js`).
- Produces: `requireActiveMembership(req, res, next)` — exportado desde `api/index.js` (agregar a `module.exports` junto a `requireUser`, línea 1832). Si activa y vigente, adjunta `req.membershipUser` (el doc completo) y llama `next()`. Se monta SIEMPRE después de `requireUser` (necesita `req.user.uid`).

- [ ] **Step 1: Escribir el test que falla**

Crea `tests/requireActiveMembership.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const fireGetUser = vi.fn()
const firePatchUserFields = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.firePatchUserFields = firePatchUserFields

const { requireActiveMembership } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('requireActiveMembership', () => {
  beforeEach(() => {
    fireGetUser.mockReset()
    firePatchUserFields.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T12:00:00Z'))
  })

  it('responds 404 when the user document does not exist', async () => {
    fireGetUser.mockResolvedValue(null)
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()
    const next = vi.fn()
    await requireActiveMembership(req, res, next)
    expect(res.statusCode).toBe(404)
    expect(next).not.toHaveBeenCalled()
  })

  it('responds 402 membership_required when membershipStatus is "pending"', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'pending' })
    const req = { user: { uid: 'uid-2' } }
    const res = makeRes()
    const next = vi.fn()
    await requireActiveMembership(req, res, next)
    expect(res.statusCode).toBe(402)
    expect(res.body).toEqual({ error: 'membership_required' })
    expect(next).not.toHaveBeenCalled()
  })

  it('responds 402 membership_expired when membershipStatus is already "expired"', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'expired' })
    const req = { user: { uid: 'uid-3' } }
    const res = makeRes()
    const next = vi.fn()
    await requireActiveMembership(req, res, next)
    expect(res.statusCode).toBe(402)
    expect(res.body).toEqual({ error: 'membership_expired' })
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('calls next() and attaches req.membershipUser when active and not yet expired', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'active', membershipExpiresAt: '2026-08-01T00:00:00.000Z' })
    const req = { user: { uid: 'uid-4' } }
    const res = makeRes()
    const next = vi.fn()
    await requireActiveMembership(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(req.membershipUser).toEqual({ membershipStatus: 'active', membershipExpiresAt: '2026-08-01T00:00:00.000Z' })
    expect(res.body).toBeNull()
  })

  it('flips to expired and responds 402 (chequeo perezoso) when membershipExpiresAt already passed', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'active', membershipExpiresAt: '2026-07-20T00:00:00.000Z' })
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-5' } }
    const res = makeRes()
    const next = vi.fn()
    await requireActiveMembership(req, res, next)
    expect(firePatchUserFields).toHaveBeenCalledWith('uid-5', ['membershipStatus'], { membershipStatus: 'expired' })
    expect(res.statusCode).toBe(402)
    expect(res.body).toEqual({ error: 'membership_expired' })
    expect(next).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/requireActiveMembership.test.js`
Expected: FAIL — `requireActiveMembership` no está exportado todavía.

- [ ] **Step 3: Implementar en `api/index.js`**

Agrega justo después de `optionalUser` (después de la línea 83, antes del comentario `// --- Queue for Groq...`):

```js
// Gate del "producto pagado" (OCR de ingredientes, preferencias, historial nube)
// — se monta DESPUÉS de requireUser, nunca solo. Chequeo perezoso de
// expiración: sin cron, la primera petición autenticada tras vencer la
// membresía es la que la marca 'expired' en Firestore.
async function requireActiveMembership(req, res, next) {
  const user = await fireGetUser(req.user.uid);
  if (!user) return res.status(404).json({ error: 'user_not_found' });

  if (user.membershipStatus === 'active') {
    const expired = user.membershipExpiresAt && new Date(user.membershipExpiresAt) < new Date();
    if (expired) {
      await firePatchUserFields(req.user.uid, ['membershipStatus'], { membershipStatus: 'expired' });
      return res.status(402).json({ error: 'membership_expired' });
    }
    req.membershipUser = user;
    return next();
  }

  return res.status(402).json({ error: user.membershipStatus === 'expired' ? 'membership_expired' : 'membership_required' });
}
```

Agrega `requireActiveMembership` al `module.exports` (junto a `module.exports.requireUser = requireUser;`, línea 1832):

```js
module.exports.requireActiveMembership = requireActiveMembership;
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/requireActiveMembership.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/requireActiveMembership.test.js
git commit -m "feat(auth): add requireActiveMembership middleware with lazy expiry check"
```

---

### Task 3: `PUT /api/me/profile`

**Files:**
- Modify: `api/index.js` (agregar después de `app.get('/api/me', requireUser, getMeHandler);`, línea ~1451)
- Test: `tests/putProfile.test.js` (nuevo)

**Interfaces:**
- Consumes: `fireGetUser`, `firePatchUserFields`, `E164_RE` (ya definido en `api/index.js:1359`).
- Produces: `putProfileHandler` exportado, montado en `PUT /api/me/profile` con `requireUser` (SIN `requireActiveMembership` — debe funcionar durante el onboarding, antes de pagar).

- [ ] **Step 1: Escribir el test que falla**

Crea `tests/putProfile.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const fireGetUser = vi.fn()
const firePatchUserFields = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.firePatchUserFields = firePatchUserFields

const { putProfileHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('putProfileHandler', () => {
  beforeEach(() => {
    fireGetUser.mockReset()
    firePatchUserFields.mockReset()
  })

  it('responds 404 when the user document does not exist', async () => {
    fireGetUser.mockResolvedValue(null)
    const req = { user: { uid: 'uid-1' }, body: { displayName: 'Ana' } }
    const res = makeRes()
    await putProfileHandler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('responds 400 no_fields when the body has none of displayName/phone/email', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { user: { uid: 'uid-2' }, body: {} }
    const res = makeRes()
    await putProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'no_fields' })
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('rejects an empty displayName with 400 invalid_display_name', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { user: { uid: 'uid-3' }, body: { displayName: '   ' } }
    const res = makeRes()
    await putProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_display_name' })
  })

  it('rejects a phone that is not E.164 with 400 invalid_phone', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { user: { uid: 'uid-4' }, body: { phone: '5512345678' } }
    const res = makeRes()
    await putProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_phone' })
  })

  it('rejects a malformed email with 400 invalid_email', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { user: { uid: 'uid-5' }, body: { email: 'not-an-email' } }
    const res = makeRes()
    await putProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_email' })
  })

  it('updates only the fields present in the body, with an explicit nested updateMask', async () => {
    fireGetUser.mockResolvedValue({ profile: { phone: '+525512345678' }, phoneNumber: '+525512345678' })
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-6' }, body: { displayName: 'Ana Ruiz' } }
    const res = makeRes()
    await putProfileHandler(req, res)
    expect(firePatchUserFields).toHaveBeenCalledWith(
      'uid-6',
      expect.arrayContaining(['profile.displayName']),
      expect.objectContaining({ profile: expect.objectContaining({ displayName: 'Ana Ruiz' }) })
    )
    expect(firePatchUserFields.mock.calls[0][1]).not.toContain('profile.phone')
    expect(res.body.ok).toBe(true)
  })

  it('sets profile.completedAt once displayName/phone/email are all present (mixing new input with provider-supplied fields)', async () => {
    // Google ya dio email; el profile trae displayName y falta solo phone.
    fireGetUser.mockResolvedValue({ email: 'a@b.com', profile: { displayName: 'Ana', phone: null, email: null, completedAt: null } })
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-7' }, body: { phone: '+525512345678' } }
    const res = makeRes()
    await putProfileHandler(req, res)
    const [, fieldPaths, data] = firePatchUserFields.mock.calls[0]
    expect(fieldPaths).toContain('profile.completedAt')
    expect(typeof data.profile.completedAt).toBe('string')
  })

  it('does NOT set profile.completedAt while a required field is still missing', async () => {
    fireGetUser.mockResolvedValue({ profile: { displayName: null, phone: null, email: null, completedAt: null } })
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-8' }, body: { displayName: 'Ana' } }
    const res = makeRes()
    await putProfileHandler(req, res)
    const [, fieldPaths] = firePatchUserFields.mock.calls[0]
    expect(fieldPaths).not.toContain('profile.completedAt')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/putProfile.test.js`
Expected: FAIL — `putProfileHandler` no existe.

- [ ] **Step 3: Implementar en `api/index.js`**

Agrega después de `app.get('/api/me', requireUser, getMeHandler);`:

```js
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function putProfileHandler(req, res) {
  try {
    const user = await fireGetUser(req.user.uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    const { displayName, phone, email } = req.body || {};
    const fieldPaths = [];
    const profile = { ...(user.profile || {}) };

    if (displayName !== undefined) {
      const clean = typeof displayName === 'string' ? displayName.trim().slice(0, 100) : '';
      if (!clean) return res.status(400).json({ error: 'invalid_display_name' });
      profile.displayName = clean;
      fieldPaths.push('profile.displayName');
    }
    if (phone !== undefined) {
      if (typeof phone !== 'string' || !E164_RE.test(phone)) return res.status(400).json({ error: 'invalid_phone' });
      profile.phone = phone;
      fieldPaths.push('profile.phone');
    }
    if (email !== undefined) {
      const clean = typeof email === 'string' ? email.trim().slice(0, 200) : '';
      if (!EMAIL_RE.test(clean)) return res.status(400).json({ error: 'invalid_email' });
      profile.email = clean;
      fieldPaths.push('profile.email');
    }
    if (fieldPaths.length === 0) return res.status(400).json({ error: 'no_fields' });

    const hasAll = !!(profile.displayName || user.displayName) && !!(profile.phone || user.phoneNumber) && !!(profile.email || user.email);
    if (hasAll && !profile.completedAt) {
      profile.completedAt = new Date().toISOString();
      fieldPaths.push('profile.completedAt');
    }

    await firePatchUserFields(req.user.uid, fieldPaths, { profile });
    res.json({ ok: true, profile });
  } catch (e) {
    console.warn('[PUT /api/me/profile] Firestore error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.put('/api/me/profile', requireUser, putProfileHandler);
```

Nota: `E164_RE` ya está definido en la línea 1359 (usado por `phoneSendHandler`) — no se duplica.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/putProfile.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/putProfile.test.js
git commit -m "feat(profile): add PUT /api/me/profile to collect missing name/phone/email"
```

---

### Task 4: `POST /api/me/membership/pay`

**Files:**
- Modify: `api/index.js` (agregar después de `putProfileHandler`/su ruta)
- Test: `tests/payMembership.test.js` (nuevo)

**Interfaces:**
- Consumes: `firePatchUserFields`.
- Produces: `payMembershipHandler`, montado en `POST /api/me/membership/pay` con `requireUser` (SIN `requireActiveMembership` — es la acción que activa). Usado tanto en el alta inicial como en renovación.

- [ ] **Step 1: Escribir el test que falla**

Crea `tests/payMembership.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const firePatchUserFields = vi.fn()
firestoreModule.firePatchUserFields = firePatchUserFields

const { payMembershipHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('payMembershipHandler', () => {
  beforeEach(() => {
    firePatchUserFields.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T12:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('sets membershipStatus active with expiresAt exactly 30 days ahead', async () => {
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()
    await payMembershipHandler(req, res)
    expect(firePatchUserFields).toHaveBeenCalledWith(
      'uid-1',
      ['membershipStatus', 'membershipExpiresAt', 'lastPaymentAt'],
      {
        membershipStatus: 'active',
        membershipExpiresAt: '2026-08-21T12:00:00.000Z',
        lastPaymentAt: '2026-07-22T12:00:00.000Z'
      }
    )
    expect(res.body).toEqual({ ok: true, membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z' })
  })

  it('responds 500 internal_error when Firestore fails', async () => {
    firePatchUserFields.mockRejectedValue(new Error('boom'))
    const req = { user: { uid: 'uid-2' } }
    const res = makeRes()
    await payMembershipHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/payMembership.test.js`
Expected: FAIL — `payMembershipHandler` no existe.

- [ ] **Step 3: Implementar en `api/index.js`**

Agrega después de la ruta de `putProfileHandler`:

```js
const MEMBERSHIP_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

async function payMembershipHandler(req, res) {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + MEMBERSHIP_PERIOD_MS).toISOString();
    await firePatchUserFields(req.user.uid, ['membershipStatus', 'membershipExpiresAt', 'lastPaymentAt'], {
      membershipStatus: 'active',
      membershipExpiresAt: expiresAt,
      lastPaymentAt: now.toISOString()
    });
    res.json({ ok: true, membershipStatus: 'active', membershipExpiresAt: expiresAt });
  } catch (e) {
    console.warn('[POST /api/me/membership/pay] Firestore error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.post('/api/me/membership/pay', requireUser, payMembershipHandler);
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/payMembership.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/payMembership.test.js
git commit -m "feat(membership): add POST /api/me/membership/pay (simulated payment/renewal)"
```

---

### Task 5: `GET /api/me` — gate de `preferences` por `membershipStatus`

**Files:**
- Modify: `api/index.js:1436-1451` (`getMeHandler`)
- Test: `tests/getMe.test.js`

**Interfaces:**
- Consumes: `fireGetUser` (sin cambio de firma).
- Produces: `getMeHandler` — la condición de inclusión de `preferences` cambia de `user.plan === 'premium'` a `user.membershipStatus === 'active'`.

- [ ] **Step 1: Editar el test (falla contra el código actual)**

Reemplaza el contenido de `tests/getMe.test.js` (las 3 pruebas que usan `plan`):

```js
  it('returns the profile without preferences for a pending-membership user', async () => {
    fireGetUser.mockResolvedValue({ email: 'a@b.com', membershipStatus: 'pending' })
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.body).toEqual({ uid: 'uid-1', email: 'a@b.com', membershipStatus: 'pending' })
  })

  it('includes preferences for an active-membership user', async () => {
    fireGetUser.mockResolvedValue({
      email: 'a@b.com', membershipStatus: 'active',
      preferences: { dietary: ['vegan'], allergens: [], healthConditions: [] }
    })
    const req = { user: { uid: 'uid-2' } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.body.preferences).toEqual({ dietary: ['vegan'], allergens: [], healthConditions: [] })
  })

  it('never includes preferences for an expired-membership user even if present in the doc (defensive)', async () => {
    fireGetUser.mockResolvedValue({ email: 'a@b.com', membershipStatus: 'expired', preferences: { dietary: ['vegan'] } })
    const req = { user: { uid: 'uid-3' } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.body.preferences).toBeUndefined()
  })
```

(La prueba de 404 `user_not_found` queda igual, sin cambios.)

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/getMe.test.js`
Expected: FAIL

- [ ] **Step 3: Implementar en `api/index.js`**

En `getMeHandler` (línea 1443), cambia:

```js
    if (user.plan === 'premium' && preferences) body.preferences = preferences;
```
por:
```js
    if (user.membershipStatus === 'active' && preferences) body.preferences = preferences;
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/getMe.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/getMe.test.js
git commit -m "fix(me): gate preferences visibility on membershipStatus instead of plan"
```

---

### Task 6: Gatear preferences/historial con `requireActiveMembership`

**Files:**
- Modify: `api/index.js:1461-1575` (`putPreferencesHandler`, `deletePreferencesHandler`, `postHistoryHandler`, `getHistoryHandler` y sus rutas)
- Test: `tests/putPreferences.test.js`, `tests/meHistory.test.js`

**Interfaces:**
- Consumes: `req.membershipUser` (adjuntado por `requireActiveMembership`, Task 2) — ya no llaman `fireGetUser` por su cuenta.
- Produces: mismas 4 rutas, ahora con `requireUser, requireActiveMembership` en la cadena; los handlers pierden el chequeo manual `if (user.plan !== 'premium')`.

- [ ] **Step 1: Editar los tests que fallan**

En `tests/putPreferences.test.js`, quita la prueba `'responds 403 premium_required for a free-plan user'` completa (ese caso ahora lo cubre `requireActiveMembership`, ya probado en Task 2 — el handler ya no hace ese chequeo). En las demás pruebas, quita `fireGetUser.mockResolvedValue({ plan: ... })` (ya no se llama) y agrega `req.membershipUser = { membershipStatus: 'active' }` si el handler lo necesita — en este caso NO lo necesita (solo usa `req.user.uid`), así que solo elimina las líneas `fireGetUser.mockResolvedValue(...)` de cada prueba restante y el `import`/mock de `fireGetUser` si ya no se usa en ninguna aserción (déjalo declarado por si acaso, sin uso no rompe nada).

En `tests/meHistory.test.js`, quita ambas pruebas `'responds 403 for a free-plan user...'` (una en `postHistoryHandler`, otra en `getHistoryHandler`) y quita las líneas `fireGetUser.mockResolvedValue({ plan: ... })` de las pruebas restantes (`'logs the entry for a premium user...'`, `'returns the entry list for a premium user'`) — el handler ya no llama a `fireGetUser`.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/putPreferences.test.js tests/meHistory.test.js`
Expected: FAIL (los handlers todavía llaman `fireGetUser` y checan `plan`).

- [ ] **Step 3: Implementar en `api/index.js`**

En `putPreferencesHandler` (línea 1461), quita:
```js
    const user = await fireGetUser(req.user.uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    if (user.plan !== 'premium') return res.status(403).json({ error: 'premium_required' });

```
(las 3 líneas completas, el resto de la función queda igual). Cambia su ruta:
```js
app.put('/api/me/preferences', requireUser, requireActiveMembership, putPreferencesHandler);
```

En `deletePreferencesHandler` (línea 1511) no había chequeo de plan — solo cambia su ruta:
```js
app.delete('/api/me/preferences', requireUser, requireActiveMembership, deletePreferencesHandler);
```

En `postHistoryHandler` (línea 1532), quita:
```js
    const user = await fireGetUser(req.user.uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    if (user.plan !== 'premium') return res.status(403).json({ error: 'premium_required' });

```
En `getHistoryHandler` (línea 1560), quita el mismo bloque. Cambia ambas rutas:
```js
app.post('/api/me/history', requireUser, requireActiveMembership, postHistoryHandler);
app.get('/api/me/history', requireUser, requireActiveMembership, getHistoryHandler);
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/putPreferences.test.js tests/meHistory.test.js tests/requireActiveMembership.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/putPreferences.test.js tests/meHistory.test.js
git commit -m "refactor(me): gate preferences/history behind requireActiveMembership middleware"
```

---

### Task 7: `ocrProcessHandler` — quitar cuota free, gatear por membresía

**Files:**
- Modify: `api/index.js:1099-1137` (`OCR_FREE_DAILY_LIMIT` y el bloque de cuota dentro de `ocrProcessHandler`)
- Test: `tests/ocrQuota.test.js` (reescrito — pasa a probar el gate de membresía, ya no una cuota numérica)

**Interfaces:**
- Consumes: `fireGetUser` (sin cambio de firma). `ocrProcessHandler` sigue montado con `optionalUser` (anónimo permitido, sin cambio).
- Produces: si `req.user` existe y `membershipStatus !== 'active'` → 402 (mismos códigos que `requireActiveMembership`, pero inline porque esta ruta usa `optionalUser`, no `requireUser`, y debe seguir dejando pasar a los anónimos).

- [ ] **Step 1: Reescribir el test que falla**

Reemplaza el contenido completo de `tests/ocrQuota.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import { createRequire } from 'module'

const { ocrProcessHandler, optionalUser } = await import('../api/index.js')
const requireFn = createRequire(import.meta.url)
const { _resetJwksCacheForTests } = requireFn('../api/auth.js')

async function runOcrRoute(req, res) {
  await new Promise((resolve) => optionalUser(req, res, resolve));
  await ocrProcessHandler(req, res);
}

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
  if (obj.membershipStatus) f.membershipStatus = { stringValue: obj.membershipStatus }
  return f
}

describe('ocrProcessHandler — gate de membresía', () => {
  let privateKey, jwk

  beforeEach(() => {
    _resetJwksCacheForTests()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T12:00:00Z'))
    process.env.FIREBASE_PROJECT_ID = PROJECT_ID
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    privateKey = keyPair.privateKey
    jwk = keyPair.publicKey.export({ format: 'jwk' })
    jwk.kid = KID
    jwk.alg = 'RS256'
    jwk.use = 'sig'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('usuario no logueado pasa sin restricción (comportamiento actual sin cambios, fuera de alcance)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('api.groq.com')) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'ingredientes: harina' } }] }) }
      }
      return { ok: true, status: 200 }
    }))
    const req = { get: () => undefined, body: { imageData: 'base64...' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.body.status).toBe('ok')
  })

  it('usuario logueado con membershipStatus "pending" → 402 membership_required, no llama a Groq', async () => {
    const token = signRS256({}, privateKey)
    let groqCalled = false
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ membershipStatus: 'pending' }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) { groqCalled = true; return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) } }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.statusCode).toBe(402)
    expect(res.body).toEqual({ error: 'membership_required' })
    expect(groqCalled).toBe(false)
  })

  it('usuario logueado con membershipStatus "expired" → 402 membership_expired, no llama a Groq', async () => {
    const token = signRS256({}, privateKey)
    let groqCalled = false
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ membershipStatus: 'expired' }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) { groqCalled = true; return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) } }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.statusCode).toBe(402)
    expect(res.body).toEqual({ error: 'membership_expired' })
    expect(groqCalled).toBe(false)
  })

  it('usuario logueado con membershipStatus "active" → procesa normal, sin límite', async () => {
    const token = signRS256({}, privateKey)
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ membershipStatus: 'active' }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) return { ok: true, json: async () => ({ choices: [{ message: { content: 'ingredientes: harina' } }] }) }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.body.status).toBe('ok')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/ocrQuota.test.js`
Expected: FAIL (el código todavía usa `plan`/`OCR_FREE_DAILY_LIMIT`).

- [ ] **Step 3: Implementar en `api/index.js`**

Reemplaza el bloque completo entre `const OCR_FREE_DAILY_LIMIT = 5;` y el cierre del `if (req.user) { ... }` (líneas 1101-1137):

```js
async function ocrProcessHandler(req, res) {
  try {
    const { imageData } = req.body;
    if (!imageData) return res.status(400).json({ error: 'Missing imageData' });

    if (req.user) {
      // Fail-closed: si el perfil todavía no se sincronizó (fireGetUser === null),
      // se trata como membresía no activa — NUNCA se salta el gate por falta de doc.
      const profile = await fireGetUser(req.user.uid);
      const membershipStatus = profile ? profile.membershipStatus : 'pending';
      if (membershipStatus !== 'active') {
        return res.status(402).json({ error: membershipStatus === 'expired' ? 'membership_expired' : 'membership_required' });
      }
    }
```

(el resto de la función, desde `const prompt = ...` en adelante, queda igual sin cambios).

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/ocrQuota.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/ocrQuota.test.js
git commit -m "feat(ocr): replace free-tier daily quota with membership gate"
```

---

### Task 8: `auth-ui.js` redirige a onboarding + `onboarding-profile.html`

**Files:**
- Modify: `auth-ui.js` (4 lugares con `window.location.href = 'index.html'`)
- Create: `onboarding-profile.html`, `onboarding-profile-ui.js`
- Test: `tests/onboarding-profile-ui.test.js` (nuevo)

**Interfaces:**
- Consumes: `getIdToken`, `syncUserProfile`, `getCachedProfile` de `authClient.js` (ya existen).
- Produces: `submitProfile()`, `renderMissingFields(profile)` exportados desde `onboarding-profile-ui.js`.

- [ ] **Step 1: Escribir el test que falla**

Crea `tests/onboarding-profile-ui.test.js`:

```js
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getIdToken = vi.fn()
const syncUserProfile = vi.fn()
const getCachedProfile = vi.fn()

vi.mock('../authClient.js', () => ({ getIdToken, syncUserProfile, getCachedProfile }))

let renderMissingFields, submitProfile

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  document.body.innerHTML = `
    <form id="profile-form">
      <div class="form-field" id="field-name"><input id="input-name"></div>
      <div class="form-field" id="field-phone"><input id="input-phone"></div>
      <div class="form-field" id="field-email"><input id="input-email"></div>
      <button type="submit" id="btn-continue-profile">Continuar</button>
      <p id="profile-error" class="hidden"></p>
    </form>
  `
  const mod = await import('../onboarding-profile-ui.js')
  renderMissingFields = mod.renderMissingFields
  submitProfile = mod.submitProfile
  getIdToken.mockResolvedValue('tok')
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
})

describe('renderMissingFields', () => {
  it('hides the fields the provider already supplied (Google: displayName+email present, phone missing)', () => {
    renderMissingFields({ displayName: 'Ana', email: 'ana@example.com', phoneNumber: null })
    expect(document.getElementById('field-name').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('field-email').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('field-phone').classList.contains('hidden')).toBe(false)
  })

  it('shows all 3 fields when nothing was supplied (email/password signup)', () => {
    renderMissingFields({ displayName: null, email: null, phoneNumber: null })
    expect(document.getElementById('field-name').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('field-phone').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('field-email').classList.contains('hidden')).toBe(false)
  })
})

describe('submitProfile', () => {
  it('rejects an empty visible name field without calling fetch', async () => {
    document.getElementById('field-name').classList.remove('hidden')
    document.getElementById('field-phone').classList.add('hidden')
    document.getElementById('field-email').classList.add('hidden')
    document.getElementById('input-name').value = '   '
    await expect(submitProfile()).rejects.toThrow()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('sends only the visible fields and redirects to preferences.html?onboarding=1 on success', async () => {
    document.getElementById('field-name').classList.add('hidden')
    document.getElementById('field-email').classList.add('hidden')
    document.getElementById('field-phone').classList.remove('hidden')
    document.getElementById('input-phone').value = '+525512345678'
    delete window.location
    window.location = { href: '' }

    await submitProfile()

    const [, options] = global.fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ phone: '+525512345678' })
    expect(window.location.href).toBe('preferences.html?onboarding=1')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/onboarding-profile-ui.test.js`
Expected: FAIL — `onboarding-profile-ui.js` no existe.

- [ ] **Step 3: Implementar**

Crea `onboarding-profile-ui.js`:

```js
import { getIdToken, syncUserProfile, getCachedProfile } from './authClient.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function showError(message) {
  const el = document.getElementById('profile-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearError() {
  const el = document.getElementById('profile-error');
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

export function renderMissingFields(profile) {
  document.getElementById('field-name')?.classList.toggle('hidden', !!profile.displayName);
  document.getElementById('field-phone')?.classList.toggle('hidden', !!profile.phoneNumber);
  document.getElementById('field-email')?.classList.toggle('hidden', !!profile.email);
}

export async function submitProfile() {
  clearError();
  const fieldName = document.getElementById('field-name');
  const fieldPhone = document.getElementById('field-phone');
  const fieldEmail = document.getElementById('field-email');
  const body = {};

  if (fieldName && !fieldName.classList.contains('hidden')) {
    const v = document.getElementById('input-name').value.trim();
    if (!v) { showError('Escribe tu nombre.'); throw new Error('invalid_display_name'); }
    body.displayName = v;
  }
  if (fieldPhone && !fieldPhone.classList.contains('hidden')) {
    const v = document.getElementById('input-phone').value.trim();
    if (!v) { showError('Escribe tu teléfono.'); throw new Error('invalid_phone'); }
    body.phone = v;
  }
  if (fieldEmail && !fieldEmail.classList.contains('hidden')) {
    const v = document.getElementById('input-email').value.trim();
    if (!EMAIL_RE.test(v)) { showError('Escribe un correo válido.'); throw new Error('invalid_email'); }
    body.email = v;
  }

  const btn = document.getElementById('btn-continue-profile');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    const token = await getIdToken();
    const res = await fetch('/api/me/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      showError('No se pudo guardar tu perfil. Intenta de nuevo.');
      throw new Error('save_failed');
    }
    window.location.href = 'preferences.html?onboarding=1';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Continuar'; }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await syncUserProfile();
  const profile = getCachedProfile();
  if (!profile) {
    window.location.href = 'auth.html';
    return;
  }
  renderMissingFields(profile);
  document.getElementById('profile-form')?.addEventListener('submit', e => {
    e.preventDefault();
    submitProfile().catch(() => {});
  });
});
```

Crea `onboarding-profile.html` (mismo esqueleto de página que `preferences.html`, sin bottom-nav — es un paso lineal de onboarding):

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.gstatic.com https://apis.google.com https://www.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://images.openfoodfacts.org https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.gstatic.com https://apis.google.com https://www.googleapis.com https://www.google.com https://firebaseappcheck.googleapis.com https://content-firebaseappcheck.googleapis.com; frame-src https://*.firebaseapp.com https://apis.google.com https://accounts.google.com https://www.google.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self';">
  <title>Yomi — Completa tu perfil</title>
  <link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#2DBC9E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="home.css?v=15">
  <link rel="stylesheet" href="styles.css?v=15">
  <style>.hidden{display:none!important}</style>
</head>
<body>
  <div class="app-shell">
    <header class="app-header">
      <img src="assets/redesign/logo.svg" alt="Yomi" class="app-logo">
    </header>
    <main class="app-main content-page">
      <section class="section-heading">
        <h1 class="heading-title">Completa tu perfil</h1>
        <p class="heading-sub">Nos falta un poco de información para tu cuenta.</p>
      </section>
      <div class="content-card">
        <form id="profile-form" novalidate>
          <div class="form-field" id="field-name">
            <label for="input-name">Nombre</label>
            <input id="input-name" class="form-input" type="text" autocomplete="name" placeholder="Tu nombre">
          </div>
          <div class="form-field" id="field-phone">
            <label for="input-phone">Teléfono</label>
            <input id="input-phone" class="form-input" type="tel" autocomplete="tel" placeholder="+525512345678">
          </div>
          <div class="form-field" id="field-email">
            <label for="input-email">Correo electrónico</label>
            <input id="input-email" class="form-input" type="email" autocomplete="email" placeholder="tucorreo@ejemplo.com">
          </div>
          <button type="submit" id="btn-continue-profile" class="btn btn-primary">Continuar</button>
          <p id="profile-error" class="hidden" role="alert"></p>
        </form>
      </div>
    </main>
  </div>
  <script type="module" src="firebase-init.js"></script>
  <script type="module" src="onboarding-profile-ui.js"></script>
</body>
</html>
```

Actualiza en `auth-ui.js` los 4 lugares con `window.location.href = 'index.html';` (dentro de `handleLogin`, `handleSignup`, `handleGoogleSignIn`, `handlePhoneSignupConsent`, y en `handleVerifyCode` la rama `window.location.href = 'index.html';` de login existente) — **solo** los de signup/alta nueva cambian, `handleLogin` (usuario YA existente, ya completó onboarding antes) se queda igual:

- `handleSignup`: `window.location.href = 'index.html';` → `window.location.href = 'onboarding-profile.html';`
- `handleGoogleSignIn`: mismo cambio — pero Google puede ser login de un usuario existente; como `onboarding-profile.html` redirige a `auth.html` solo si NO hay perfil, y muestra los campos ya llenos como ocultos, entrar ahí de más no rompe nada — si los 3 campos ya existen, el form no muestra ningún input y el submit fallaría con `no_fields` sin enviar nada. **Para evitar ese caso**, agrega esta guarda al inicio del `DOMContentLoaded` de `onboarding-profile-ui.js` (después de obtener `profile`): si `profile.profile && profile.profile.completedAt`, saltar directo a `index.html` en vez de mostrar el form. Actualiza el código de `onboarding-profile-ui.js` así:

```js
document.addEventListener('DOMContentLoaded', async () => {
  await syncUserProfile();
  const profile = getCachedProfile();
  if (!profile) {
    window.location.href = 'auth.html';
    return;
  }
  if (profile.profile && profile.profile.completedAt) {
    window.location.href = 'index.html';
    return;
  }
  renderMissingFields(profile);
  document.getElementById('profile-form')?.addEventListener('submit', e => {
    e.preventDefault();
    submitProfile().catch(() => {});
  });
});
```

  (agrega la prueba correspondiente a `tests/onboarding-profile-ui.test.js` cubriendo este atajo antes de continuar al Step 4 — no se detalla aquí por brevedad, sigue el mismo patrón de mockear `getCachedProfile`)
- `handlePhoneSignupConsent`: mismo cambio a `onboarding-profile.html`.
- La rama de `handleVerifyCode` para usuario YA existente (`data.isNewUser === false`) se queda en `index.html` — solo cambia para el caso nuevo, que ya pasa por `handlePhoneSignupConsent`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/onboarding-profile-ui.test.js tests/auth-ui.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add auth-ui.js onboarding-profile.html onboarding-profile-ui.js tests/onboarding-profile-ui.test.js
git commit -m "feat(onboarding): add profile-completion step after signup"
```

---

### Task 9: `preferences.html` en modo onboarding (retiene en sessionStorage)

**Files:**
- Modify: `preferences.html` (agregar botón "Ahora no"), `preferences-ui.js`
- Test: `tests/preferences-ui.test.js`

**Interfaces:**
- Produces: `continueOnboardingPreferences()`, `skipOnboardingPreferences()` exportados desde `preferences-ui.js`. Ninguno llama a `PUT /api/me/preferences` — guardan/limpian `sessionStorage['yomi_pending_preferences']` y redirigen a `onboarding-membership.html`.

- [ ] **Step 1: Escribir los tests que fallan**

Agrega a `tests/preferences-ui.test.js` (revisa primero el mock/setup existente del archivo y sigue su mismo patrón de `document.body.innerHTML` con los tiles de dietary/allergen ya marcados `.chosen` antes de cada prueba — reutiliza el helper que el archivo ya tenga para eso):

```js
describe('onboarding mode (?onboarding=1)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    document.getElementById('consent-checkbox').checked = true
  })

  it('continueOnboardingPreferences stores the payload in sessionStorage and redirects to onboarding-membership.html without calling fetch', async () => {
    document.querySelector('#dietary-tiles [data-dietary="vegan"]').classList.add('chosen')
    delete window.location
    window.location = { href: '' }

    await continueOnboardingPreferences()

    const stored = JSON.parse(sessionStorage.getItem('yomi_pending_preferences'))
    expect(stored.dietary).toEqual(['vegan'])
    expect(stored.consent).toBe(true)
    expect(window.location.href).toBe('onboarding-membership.html')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('continueOnboardingPreferences requires consent, same as the normal save flow', async () => {
    document.getElementById('consent-checkbox').checked = false
    await expect(continueOnboardingPreferences()).rejects.toThrow()
    expect(sessionStorage.getItem('yomi_pending_preferences')).toBeNull()
  })

  it('skipOnboardingPreferences clears any pending selection and redirects without requiring consent', () => {
    sessionStorage.setItem('yomi_pending_preferences', JSON.stringify({ dietary: ['vegan'] }))
    delete window.location
    window.location = { href: '' }

    skipOnboardingPreferences()

    expect(sessionStorage.getItem('yomi_pending_preferences')).toBeNull()
    expect(window.location.href).toBe('onboarding-membership.html')
  })
})
```

Agrega `continueOnboardingPreferences, skipOnboardingPreferences` al import del módulo bajo prueba, junto a los demás nombres ya importados al inicio del archivo.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/preferences-ui.test.js`
Expected: FAIL — las 2 funciones no existen.

- [ ] **Step 3: Implementar**

En `preferences.html`, agrega el botón "Ahora no" justo después de `<button type="submit" id="btn-save-preferences" ...>`:

```html
        <button type="button" id="btn-skip-preferences" class="link-button hidden">Ahora no</button>
```

En `preferences-ui.js`, agrega (después de `const CONSENT_NOTICE_VERSION = 'v1';`):

```js
const ONBOARDING_PREFS_KEY = 'yomi_pending_preferences';

function isOnboarding() {
  return new URLSearchParams(window.location.search).get('onboarding') === '1';
}

export async function continueOnboardingPreferences() {
  clearError();
  clearConsentError();
  const consentChecked = document.getElementById('consent-checkbox')?.checked;
  if (!consentChecked) {
    const message = 'Falta el consentimiento expreso para guardar datos de salud';
    showConsentError(message);
    throw new Error(message);
  }
  const payload = { ...buildPreferencesPayload(), consent: true, consentNoticeVersion: CONSENT_NOTICE_VERSION };
  sessionStorage.setItem(ONBOARDING_PREFS_KEY, JSON.stringify(payload));
  window.location.href = 'onboarding-membership.html';
}

export function skipOnboardingPreferences() {
  sessionStorage.removeItem(ONBOARDING_PREFS_KEY);
  window.location.href = 'onboarding-membership.html';
}
```

Cambia el mapeo de error en `savePreferences()` (línea 191) — ya no existe `premium_required`, ahora son los códigos de `requireActiveMembership`:

```js
      showError(['membership_required', 'membership_expired'].includes(data.error)
        ? 'Necesitas una membresía activa para guardar tus preferencias.'
        : 'No se pudo guardar. Intenta de nuevo.');
```

Y en el `DOMContentLoaded` final, envuelve el wiring del form según `isOnboarding()`:

```js
document.addEventListener('DOMContentLoaded', async () => {
  await syncUserProfile();
  if (!getCachedProfile()) {
    window.location.href = 'auth.html';
    return;
  }
  loadPreferencesIntoForm();
  setupPreferenceTiles();
  const onboarding = isOnboarding();
  const form = document.getElementById('preferences-form');
  const btnDelete = document.getElementById('btn-delete-preferences');
  const btnSave = document.getElementById('btn-save-preferences');
  const btnSkip = document.getElementById('btn-skip-preferences');
  if (onboarding) {
    if (btnSave) btnSave.textContent = 'Continuar';
    btnDelete?.classList.add('hidden');
    btnSkip?.classList.remove('hidden');
    btnSkip?.addEventListener('click', () => skipOnboardingPreferences());
  }
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      (onboarding ? continueOnboardingPreferences() : savePreferences()).catch(() => {});
    });
  }
  if (btnDelete) {
    btnDelete.addEventListener('click', () => deletePreferences().catch(() => {}));
  }
});
```

(nota: `btnDelete?.classList.add('hidden')` durante onboarding — borrar preferencias que ni siquiera se han guardado no aplica.)

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/preferences-ui.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add preferences.html preferences-ui.js tests/preferences-ui.test.js
git commit -m "feat(onboarding): defer preferences save to sessionStorage during onboarding"
```

---

### Task 10: `onboarding-membership.html` — pago simulado + flush de preferences

**Files:**
- Create: `onboarding-membership.html`, `onboarding-membership-ui.js`
- Test: `tests/onboarding-membership-ui.test.js` (nuevo)

**Interfaces:**
- Consumes: `getIdToken`, `syncUserProfile` de `authClient.js`.
- Produces: `confirmMembershipPayment()` exportado.

- [ ] **Step 1: Escribir el test que falla**

Crea `tests/onboarding-membership-ui.test.js`:

```js
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getIdToken = vi.fn()
const syncUserProfile = vi.fn()

vi.mock('../authClient.js', () => ({ getIdToken, syncUserProfile }))

let confirmMembershipPayment

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  sessionStorage.clear()
  document.body.innerHTML = `
    <input type="checkbox" id="pay-checkbox">
    <button id="btn-confirm-payment">Confirmar pago</button>
    <p id="membership-error" class="hidden"></p>
  `
  const mod = await import('../onboarding-membership-ui.js')
  confirmMembershipPayment = mod.confirmMembershipPayment
  getIdToken.mockResolvedValue('tok')
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  delete window.location
  window.location = { href: '' }
})

it('requires the checkbox to be checked before calling the pay endpoint', async () => {
  document.getElementById('pay-checkbox').checked = false
  await expect(confirmMembershipPayment()).rejects.toThrow()
  expect(global.fetch).not.toHaveBeenCalled()
})

it('calls POST /api/me/membership/pay and redirects to index.html when there are no pending preferences', async () => {
  document.getElementById('pay-checkbox').checked = true
  await confirmMembershipPayment()
  expect(global.fetch).toHaveBeenCalledWith('/api/me/membership/pay', expect.objectContaining({ method: 'POST' }))
  expect(window.location.href).toBe('index.html')
})

it('flushes sessionStorage preferences via PUT /api/me/preferences after paying, then clears them', async () => {
  document.getElementById('pay-checkbox').checked = true
  sessionStorage.setItem('yomi_pending_preferences', JSON.stringify({ dietary: ['vegan'], consent: true }))

  await confirmMembershipPayment()

  const preferencesCall = global.fetch.mock.calls.find(([url]) => url === '/api/me/preferences')
  expect(preferencesCall).toBeTruthy()
  expect(preferencesCall[1].method).toBe('PUT')
  expect(JSON.parse(preferencesCall[1].body)).toEqual({ dietary: ['vegan'], consent: true })
  expect(sessionStorage.getItem('yomi_pending_preferences')).toBeNull()
  expect(window.location.href).toBe('index.html')
})

it('redirects to index.html even if the deferred preferences PUT fails (payment already succeeded)', async () => {
  document.getElementById('pay-checkbox').checked = true
  sessionStorage.setItem('yomi_pending_preferences', JSON.stringify({ dietary: ['vegan'] }))
  global.fetch = vi.fn((url) => {
    if (url === '/api/me/membership/pay') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) })
    return Promise.reject(new Error('network down'))
  })

  await confirmMembershipPayment()

  expect(window.location.href).toBe('index.html')
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/onboarding-membership-ui.test.js`
Expected: FAIL — `onboarding-membership-ui.js` no existe.

- [ ] **Step 3: Implementar**

Crea `onboarding-membership-ui.js`:

```js
import { getIdToken, syncUserProfile } from './authClient.js';

const ONBOARDING_PREFS_KEY = 'yomi_pending_preferences';

function showError(message) {
  const el = document.getElementById('membership-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function confirmMembershipPayment() {
  const checkbox = document.getElementById('pay-checkbox');
  if (!checkbox?.checked) {
    showError('Marca la casilla para confirmar el pago simulado.');
    throw new Error('pay_checkbox_required');
  }

  const btn = document.getElementById('btn-confirm-payment');
  if (btn) { btn.disabled = true; btn.textContent = 'Procesando…'; }
  try {
    const token = await getIdToken();
    const res = await fetch('/api/me/membership/pay', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      showError('No se pudo procesar el pago. Intenta de nuevo.');
      throw new Error('pay_failed');
    }

    const pendingPrefs = sessionStorage.getItem(ONBOARDING_PREFS_KEY);
    if (pendingPrefs) {
      try {
        await fetch('/api/me/preferences', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: pendingPrefs
        });
      } catch (e) {
        console.warn('[onboarding] no se pudieron guardar preferencias pendientes:', e.message);
      }
      sessionStorage.removeItem(ONBOARDING_PREFS_KEY);
    }

    await syncUserProfile();
    window.location.href = 'index.html';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar pago'; }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-confirm-payment')?.addEventListener('click', () => {
    confirmMembershipPayment().catch(() => {});
  });
});
```

Crea `onboarding-membership.html`:

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.gstatic.com https://apis.google.com https://www.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://images.openfoodfacts.org https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.gstatic.com https://apis.google.com https://www.googleapis.com https://www.google.com https://firebaseappcheck.googleapis.com https://content-firebaseappcheck.googleapis.com; frame-src https://*.firebaseapp.com https://apis.google.com https://accounts.google.com https://www.google.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self';">
  <title>Yomi — Activa tu membresía</title>
  <link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#2DBC9E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="home.css?v=15">
  <link rel="stylesheet" href="styles.css?v=15">
  <style>
    .hidden{display:none!important}
    .consent-block { display: block; border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin: 12px 0; background: #fafafa; }
  </style>
</head>
<body>
  <div class="app-shell">
    <header class="app-header">
      <img src="assets/redesign/logo.svg" alt="Yomi" class="app-logo">
    </header>
    <main class="app-main content-page">
      <section class="section-heading">
        <h1 class="heading-title">Activa tu membresía</h1>
        <p class="heading-sub">Yomi funciona con una membresía de pago — sin ella no hay cuenta activa.</p>
      </section>
      <div class="content-card">
        <label class="consent-block">
          <input type="checkbox" id="pay-checkbox">
          Pagar membresía (simulado — $0 mientras no haya cobro real).
        </label>
        <button type="button" id="btn-confirm-payment" class="btn btn-primary">Confirmar pago</button>
        <p id="membership-error" class="hidden" role="alert"></p>
      </div>
    </main>
  </div>
  <script type="module" src="firebase-init.js"></script>
  <script type="module" src="onboarding-membership-ui.js"></script>
</body>
</html>
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/onboarding-membership-ui.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add onboarding-membership.html onboarding-membership-ui.js tests/onboarding-membership-ui.test.js
git commit -m "feat(onboarding): add membership payment step (simulated) and preferences flush"
```

---

### Task 11: `account.html`/`account-ui.js` — badge de membresía + renovar

**Files:**
- Modify: `account.html`, `account-ui.js`
- Test: `tests/account-ui.test.js`

**Interfaces:**
- Produces: `renderAccountHub()` cambia su badge/CTA según `membershipStatus`; nuevo `handleRenewMembership()` exportado.

- [ ] **Step 1: Editar los tests que fallan**

Reemplaza en `tests/account-ui.test.js` cada `plan: 'free'` por `membershipStatus: 'pending'` y `plan: 'premium'` por `membershipStatus: 'active'`; los selectores `.account-plan-free`/`.account-plan-premium` pasan a `.account-plan-pending`/`.account-plan-active`. Por ejemplo, la prueba de la línea 41 queda:

```js
  it('muestra el badge "Pendiente" y el CTA para activar membresía, sin botón de editar preferencias', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'pending' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.account-plan-pending')).toBeTruthy()
    expect(root.textContent).toMatch(/Completa tu membresía/)
  })
```

Y agrega una prueba nueva para el estado `expired` y para `handleRenewMembership`:

```js
  it('muestra el badge "Expirada" y el CTA de renovar cuando la membresía venció', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'expired' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.account-plan-expired')).toBeTruthy()
    expect(root.textContent).toMatch(/Tu membresía venció/)
    expect(document.getElementById('btn-renew-membership').textContent).toMatch(/Renovar membresía/)
  })
```

```js
describe('handleRenewMembership', () => {
  it('calls POST /api/me/membership/pay and re-renders after syncing the profile', async () => {
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    document.body.innerHTML = '<div id="account-root"></div><button id="btn-renew-membership"></button>'

    await handleRenewMembership()

    expect(global.fetch).toHaveBeenCalledWith('/api/me/membership/pay', expect.objectContaining({ method: 'POST' }))
    expect(syncUserProfile).toHaveBeenCalled()
  })
})
```

(agrega `getIdToken` al mock de `authClient.js` en la parte superior del archivo, junto a `getCachedProfile`/`syncUserProfile`, y `handleRenewMembership` al import del módulo bajo prueba).

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/account-ui.test.js`
Expected: FAIL

- [ ] **Step 3: Implementar**

En `account.html`, cambia el `<style>` (líneas 12-14):

```html
    .account-plan-pending{background:rgba(255,255,255,0.15);color:#fff}
    .account-plan-active{background:#2DBC9E;color:#fff}
    .account-plan-expired{background:#c0392b;color:#fff}
```

En `account-ui.js`, reemplaza el import y `renderAccountHub` completo:

```js
import { firebaseAuth, signOut } from './firebase-init.js';
import { getIdToken, getCachedProfile, syncUserProfile } from './authClient.js';

export function computeAlertsActive(prefs) {
  if (!prefs) return 0;
  return (prefs.dietary || []).length + (prefs.allergens || []).length + (prefs.healthConditions || []).length;
}

const PROFILE_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d="M17.4167 19.25V17.4167C17.4167 16.4442 17.0304 15.5116 16.3428 14.8239C15.6551 14.1363 14.7225 13.75 13.75 13.75H8.25004C7.27758 13.75 6.34495 14.1363 5.65732 14.8239C4.96968 15.5116 4.58337 16.4442 4.58337 17.4167V19.25" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 10.0833C13.0251 10.0833 14.6667 8.44171 14.6667 6.41667C14.6667 4.39162 13.0251 2.75 11 2.75C8.975 2.75 7.33337 4.39162 7.33337 6.41667C7.33337 8.44171 8.975 10.0833 11 10.0833Z" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const BADGE_LABEL = { active: 'Activa', pending: 'Pendiente', expired: 'Expirada' };

export function renderAccountHub() {
  const profile = getCachedProfile();
  const root = document.getElementById('account-root');
  if (!root) return;

  if (!profile) {
    window.location.href = 'auth.html';
    return;
  }

  const status = profile.membershipStatus;
  const isActive = status === 'active';
  const prefs = profile.preferences;
  const hasPrefs = prefs && ((prefs.dietary || []).length || (prefs.allergens || []).length || (prefs.healthConditions || []).length);
  const totalScans = (profile.usage && profile.usage.totalScans) || 0;
  const alertsActive = computeAlertsActive(prefs);

  const summaryHtml = hasPrefs
    ? `<p class="account-summary">Tu perfil: ${[...(prefs.dietary || []), ...(prefs.allergens || []).map(a => a.code), ...(prefs.healthConditions || [])].join(', ')}</p>`
    : '<p class="account-empty">Aún no configuraste tus preferencias.</p>';

  const renewCta = status === 'expired'
    ? { text: 'Tu membresía venció. Renuévala para seguir escaneando y guardar tu historial.', btn: 'Renovar membresía' }
    : { text: 'Completa tu membresía para desbloquear el escaneo de ingredientes.', btn: 'Activar membresía' };

  root.innerHTML = `
    <div class="content-card">
      <div class="hero-card-dark">
        <div class="icon-wrap">${PROFILE_ICON_SVG}</div>
        <div>
          <p class="account-email">${profile.email || profile.phoneNumber || ''}</p>
          <span class="account-plan-badge account-plan-${status}">${BADGE_LABEL[status] || 'Pendiente'}</span>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat-tile"><div class="stat-num">${totalScans}</div><div class="stat-label">Escaneos</div></div>
        <div class="stat-tile"><div class="stat-num">${alertsActive}</div><div class="stat-label">Alertas activas</div></div>
      </div>
      <div class="row-card">
        ${summaryHtml}
        <a href="preferences.html" class="btn btn-secondary">Editar preferencias</a>
      </div>
      ${!isActive ? `
        <div class="row-card account-renew">
          <div class="icon-wrap" style="background:rgba(245,166,35,0.15);">🔔</div>
          <div>
            <p class="about-text">${renewCta.text}</p>
            <button type="button" id="btn-renew-membership" class="btn btn-primary">${renewCta.btn}</button>
          </div>
        </div>` : ''}
      <button type="button" id="btn-logout" class="btn btn-secondary">Cerrar sesión</button>
    </div>
  `;

  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
  document.getElementById('btn-renew-membership')?.addEventListener('click', () => handleRenewMembership());
}

export async function handleRenewMembership() {
  const btn = document.getElementById('btn-renew-membership');
  if (btn) { btn.disabled = true; btn.textContent = 'Procesando…'; }
  try {
    const token = await getIdToken();
    await fetch('/api/me/membership/pay', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    await syncUserProfile();
    renderAccountHub();
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function handleLogout() {
  await signOut(firebaseAuth);
  window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', async () => {
  await syncUserProfile();
  renderAccountHub();
});
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/account-ui.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add account.html account-ui.js tests/account-ui.test.js
git commit -m "feat(account): show membershipStatus badge and renew/activate CTA"
```

---

### Task 12: `home.js`, `history-ui.js`, `app.js` — quitar el upsell free, agregar guard de onboarding, usar `membershipStatus`

**Files:**
- Modify: `home.js` (quitar `shouldShowHomeUpsell`/`renderHomeUpsellBanner`, agregar `redirectTargetForIncompleteOnboarding`), `history-ui.js:61`, `app.js:1725`, `app.js:1750`
- Test: reescribe `tests/home.test.js` (la función que probaba, `shouldShowHomeUpsell`, se elimina en este task — se reemplaza por pruebas de la nueva guarda), edita `tests/history-ui.test.js` y `tests/app.test.js`

**Interfaces:**
- Produces: `getUserPreferencesForVerdict()` y `logScanToCloudHistory()` en `app.js` cambian su condición de `profile.plan !== 'premium'` a `profile.membershipStatus !== 'active'`. `renderHistoryScreen()` en `history-ui.js` igual. Nuevo `redirectTargetForIncompleteOnboarding(profile)` en `home.js` — función pura, regresa la URL a la que `index.html` debe redirigir si el onboarding quedó a medias (spec: "evita saltarse pasos por URL manual"), o `null` si no hace falta redirigir.

- [ ] **Step 1: Editar los tests**

Reemplaza el contenido completo de `tests/home.test.js` (la función que probaba antes, `shouldShowHomeUpsell`, ya no existe):

```js
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const homeCode = fs.readFileSync(path.join(__dirname, '..', 'home.js'), 'utf8')

let redirectTargetForIncompleteOnboarding

beforeAll(() => {
  const fn = new Function(homeCode + '\nreturn { redirectTargetForIncompleteOnboarding }')
  redirectTargetForIncompleteOnboarding = fn().redirectTargetForIncompleteOnboarding
})

describe('redirectTargetForIncompleteOnboarding', () => {
  it('regresa null sin perfil (no logueado — home.js ya maneja ese caso por separado)', () => {
    expect(redirectTargetForIncompleteOnboarding(null)).toBeNull()
  })

  it('regresa onboarding-profile.html cuando profile.completedAt aún no existe', () => {
    const profile = { profile: { completedAt: null }, membershipStatus: 'pending' }
    expect(redirectTargetForIncompleteOnboarding(profile)).toBe('onboarding-profile.html')
  })

  it('regresa onboarding-membership.html cuando el perfil ya está completo pero la membresía sigue pending', () => {
    const profile = { profile: { completedAt: '2026-07-22T00:00:00.000Z' }, membershipStatus: 'pending' }
    expect(redirectTargetForIncompleteOnboarding(profile)).toBe('onboarding-membership.html')
  })

  it('regresa null cuando el perfil está completo y la membresía está activa (nada que redirigir)', () => {
    const profile = { profile: { completedAt: '2026-07-22T00:00:00.000Z' }, membershipStatus: 'active' }
    expect(redirectTargetForIncompleteOnboarding(profile)).toBeNull()
  })

  it('regresa null cuando la membresía está expired — expirado NO se manda de vuelta al onboarding, se maneja en account.html', () => {
    const profile = { profile: { completedAt: '2026-07-22T00:00:00.000Z' }, membershipStatus: 'expired' }
    expect(redirectTargetForIncompleteOnboarding(profile)).toBeNull()
  })
})
```

En `tests/history-ui.test.js`, reemplaza cada `plan: 'free'` por `membershipStatus: 'pending'` y `plan: 'premium'` por `membershipStatus: 'active'` (mismo mecanismo que Task 11, solo cambia el valor del mock, la lógica de las pruebas no cambia).

En `tests/app.test.js`, reemplaza en las líneas señaladas (624, 630, 635, 680, 687, 700): `plan: 'free'` → `membershipStatus: 'pending'`, `plan: 'premium'` → `membershipStatus: 'active'`.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/home.test.js tests/history-ui.test.js tests/app.test.js`
Expected: FAIL (`redirectTargetForIncompleteOnboarding` no existe todavía; el resto del código sigue leyendo `.plan`).

- [ ] **Step 3: Implementar**

En `home.js`, borra por completo: la constante `HOME_UPSELL_DISMISS_KEY`, `DAY_MS`, la función `shouldShowHomeUpsell` (líneas 80-100), la función `renderHomeUpsellBanner` (líneas 102-122), y la llamada `renderHomeUpsellBanner();` al final del `DOMContentLoaded` (línea 155).

En su lugar (mismo punto del archivo, después de `function escHtml`), agrega:

```js
// Evita que un usuario a medio onboarding llegue a index.html navegando
// directo por URL (ej. cerró la pestaña de onboarding-membership.html y
// volvió a abrir la app) — lo manda de vuelta al paso que le falta.
function redirectTargetForIncompleteOnboarding(profile) {
  if (!profile) return null;
  if (!profile.profile || !profile.profile.completedAt) return 'onboarding-profile.html';
  if (profile.membershipStatus === 'pending') return 'onboarding-membership.html';
  return null;
}
```

Y cambia el final del `DOMContentLoaded` (línea 154-155, donde antes llamaba a `renderHomeUpsellBanner()`):

```js
  // await explícito (mismo motivo que preferences-ui.js, Task 15): no depender
  // de que el auto-sync de authClient.js ya haya resuelto para este frame.
  const profile = window.authClient ? await window.authClient.syncUserProfile() : null;
  const redirectTarget = redirectTargetForIncompleteOnboarding(profile);
  if (redirectTarget) window.location.href = redirectTarget;
});
```

(nota: un usuario `expired` SÍ entra normalmente a `index.html` — no se le manda de vuelta al onboarding, ve la app con las funciones premium bloqueadas y el CTA de renovar vive en `account.html`, ya cubierto en Task 11.)

En `history-ui.js:61`, cambia:
```js
  if (!profile || profile.plan !== 'premium') {
```
por:
```js
  if (!profile || profile.membershipStatus !== 'active') {
```

En `app.js:1725`, cambia:
```js
  if (!profile || profile.plan !== 'premium' || !profile.preferences) return null;
```
por:
```js
  if (!profile || profile.membershipStatus !== 'active' || !profile.preferences) return null;
```

En `app.js:1750`, cambia:
```js
  if (!profile || profile.plan !== 'premium') return;
```
por:
```js
  if (!profile || profile.membershipStatus !== 'active') return;
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/home.test.js tests/history-ui.test.js tests/app.test.js`
Expected: PASS

- [ ] **Step 5: Correr la suite completa**

Run: `npx vitest run`
Expected: PASS — todos los tests, incluidos los de las Tasks 1-11, siguen verdes.

- [ ] **Step 6: Commit**

```bash
git add home.js history-ui.js app.js tests/home.test.js tests/history-ui.test.js tests/app.test.js
git commit -m "refactor(frontend): drop free-tier upsell banner, add onboarding redirect guard, gate on membershipStatus everywhere"
```

---

## Al terminar todas las tasks

Correr la suite completa una última vez (`npx vitest run`) y usar `superpowers:finishing-a-development-branch` para decidir merge/PR — no se hace commit a `master`/producción sin instrucción explícita del usuario (regla de sesión: `develop` únicamente).
