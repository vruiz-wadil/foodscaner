# Administrar suscripción (estilo Netflix) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar a `account.html` un bloque "Suscripción" (solo para `membershipStatus === 'active'`) que muestra si se renovará automáticamente o cuándo vence, permite cancelar (conserva acceso hasta el vencimiento, sin cobrar de nuevo) o reactivar, y lista el historial de pagos simulados.

**Architecture:** Dos campos nuevos en el doc `users/{uid}` de Firestore — `autoRenew: boolean` y `paymentHistory: array<{date, amount, method}>`. Un helper nuevo `fireRecordMembershipPayment(uid)` en `api/firestore.js` (mismo patrón de reintento-con-precondición que `fireIncrementUsageCounter` ya usa) hace el pago simulado existente (`POST /api/me/membership/pay`) también fijar `autoRenew:true` y agregar al historial. Dos endpoints nuevos, `POST /api/me/membership/cancel` y `POST /api/me/membership/reactivate`, solo togglean `autoRenew` (nunca tocan `membershipStatus`/`membershipExpiresAt` — el usuario conserva acceso hasta vencer, igual que cancelar en Netflix). El frontend (`account-ui.js`) agrega un bloque nuevo que reusa el modal genérico ya existente en el archivo para la confirmación de cancelar.

**Tech Stack:** Node/Express + REST Firestore (sin firebase-admin), Vitest, vanilla JS ES modules (frontend).

## Global Constraints

- Nada de Stripe real en este plan — `amount` siempre `0`, `method` siempre `'simulado'`. El objeto `billing.*` que ya existe en `fireUpsertUser` (stripeCustomerId, subscriptionId, etc.) es scaffolding reservado para una integración de Stripe futura — **no se toca ni se reutiliza aquí**, `autoRenew`/`paymentHistory` son campos nuevos e independientes.
- Cancelar NUNCA cambia `membershipStatus` ni `membershipExpiresAt` — solo `autoRenew:false`. El vencimiento natural sigue pasando por el chequeo perezoso ya existente en `requireActiveMembership` (`api/index.js` línea ~94-104), que este plan no modifica.
- Reactivar y cancelar solo son válidos si `membershipStatus === 'active'` (409 `{ error: 'not_active' }` en cualquier otro caso). Reactivar una cuenta ya `expired`/`pending` sigue siendo trabajo del endpoint existente `POST /api/me/membership/pay` ("Renovar membresía"), no de este endpoint nuevo.
- En el frontend, tratar `autoRenew` ausente/`undefined` como equivalente a `true` (no como `false`) — cubre cuentas activas creadas antes de este cambio, que nunca cancelaron nada.
- `GET /api/me` no necesita cambios — ya hace spread de todos los campos del doc (`const { preferences, ...rest } = user`), así que `autoRenew`/`paymentHistory` viajan automáticamente al frontend en cuanto existen en Firestore.
- Fechas en el frontend con `toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })`.

---

### Task 1: Backend — Firestore fields, `fireRecordMembershipPayment`, endpoints cancel/reactivate

**Files:**
- Modify: `api/firestore.js`
- Modify: `api/index.js`
- Modify: `tests/firestore-users.test.js` (agrega 2 aserciones a un test existente)
- Modify: `tests/payMembership.test.js` (reescribe para mockear el nuevo helper)
- Test (nuevo): `tests/firestore-membership-payment.test.js`
- Test (nuevo): `tests/membershipCancel.test.js`

**Interfaces:**
- Produces: `fireRecordMembershipPayment(uid)` — async, sin más parámetros, regresa `{ membershipStatus: 'active', membershipExpiresAt: string, lastPaymentAt: string, autoRenew: true, paymentHistory: array }` o lanza si falla tras 3 reintentos.
- Produces: rutas `POST /api/me/membership/cancel` y `POST /api/me/membership/reactivate` (ambas `requireUser`), y los handlers exportados `cancelMembershipHandler`/`reactivateMembershipHandler`.
- Consumes: `fireGetUser`, `firePatchUserFields`, `fireGetUserRaw`, `firePatchUserFieldsWithPrecondition` — todos ya existentes, sin cambios de firma.

- [ ] **Step 1: Agregar los defaults de `autoRenew`/`paymentHistory` a `fireUpsertUser`**

En `api/firestore.js`, dentro de `fireUpsertUser`, en el objeto pasado a `toFirestoreFields` en la rama de creación (busca `membershipStatus: 'pending',`), agrega dos campos justo después de `lastPaymentAt: null,`:

```js
      membershipStatus: 'pending',
      membershipExpiresAt: null,
      lastPaymentAt: null,
      autoRenew: false,
      paymentHistory: [],
```

- [ ] **Step 2: Extender el test de creación existente para cubrir los defaults nuevos**

En `tests/firestore-users.test.js`, dentro del test `'fireUpsertUser creates a new doc with membershipStatus:"pending" when none exists...'`, agrega estas dos líneas justo después de la línea `expect(patchCalls[0].body.fields.lastPaymentAt).toEqual({ nullValue: null })`:

```js
    expect(patchCalls[0].body.fields.autoRenew).toEqual({ booleanValue: false })
    expect(patchCalls[0].body.fields.paymentHistory).toEqual({ arrayValue: { values: [] } })
```

- [ ] **Step 3: Correr ese test para confirmar que pasa**

Run: `npx vitest run tests/firestore-users.test.js`
Expected: PASS (7 tests, incluyendo el extendido).

- [ ] **Step 4: Escribir el test del nuevo helper `fireRecordMembershipPayment` (RED)**

Crear `tests/firestore-membership-payment.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

const { fireRecordMembershipPayment } = await import('../api/firestore.js')

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

describe('fireRecordMembershipPayment', () => {
  const ORIGINAL_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY

  beforeEach(() => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = ORIGINAL_KEY
  })

  it('sets membershipStatus active, expiresAt 30 days ahead, autoRenew true, and appends to an empty paymentHistory', async () => {
    let patchBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { membershipStatus: { stringValue: 'pending' } },
            updateTime: '2026-07-22T10:00:00.000000Z'
          })
        }
      }
      patchBody = JSON.parse(options.body)
      return { ok: true, status: 200 }
    }))

    const result = await fireRecordMembershipPayment('uid-1')

    expect(result).toEqual({
      membershipStatus: 'active',
      membershipExpiresAt: '2026-08-21T12:00:00.000Z',
      lastPaymentAt: '2026-07-22T12:00:00.000Z',
      autoRenew: true,
      paymentHistory: [{ date: '2026-07-22T12:00:00.000Z', amount: 0, method: 'simulado' }]
    })
    expect(patchBody.currentDocument.updateTime).toBe('2026-07-22T10:00:00.000000Z')
  })

  it('appends to an existing paymentHistory instead of overwriting it', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: {
              membershipStatus: { stringValue: 'expired' },
              paymentHistory: { arrayValue: { values: [
                { mapValue: { fields: { date: { stringValue: '2026-06-22T12:00:00.000Z' }, amount: { integerValue: '0' }, method: { stringValue: 'simulado' } } } }
              ] } }
            },
            updateTime: '2026-07-22T10:00:00.000000Z'
          })
        }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireRecordMembershipPayment('uid-1')

    expect(result.paymentHistory).toEqual([
      { date: '2026-06-22T12:00:00.000Z', amount: 0, method: 'simulado' },
      { date: '2026-07-22T12:00:00.000Z', amount: 0, method: 'simulado' }
    ])
  })

  it('retries with backoff on a 409 conflict and succeeds on the next attempt', async () => {
    let patchAttempts = 0
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({ fields: { membershipStatus: { stringValue: 'pending' } }, updateTime: '2026-07-22T10:00:00.000000Z' })
        }
      }
      patchAttempts++
      if (patchAttempts === 1) return { ok: false, status: 409 }
      return { ok: true, status: 200 }
    }))
    vi.useRealTimers()

    const result = await fireRecordMembershipPayment('uid-1')

    expect(patchAttempts).toBe(2)
    expect(result.membershipStatus).toBe('active')
  })

  it('gives up after repeated 409 conflicts and throws', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({ fields: { membershipStatus: { stringValue: 'pending' } }, updateTime: '2026-07-22T10:00:00.000000Z' })
        }
      }
      return { ok: false, status: 409 }
    }))
    vi.useRealTimers()

    await expect(fireRecordMembershipPayment('uid-1')).rejects.toThrow()
  })

  it('throws when the user document does not exist', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) return { status: 404, ok: false }
      return { ok: true, status: 200 }
    }))

    await expect(fireRecordMembershipPayment('uid-missing')).rejects.toThrow()
  })
})
```

- [ ] **Step 5: Correr el test para confirmar que falla**

Run: `npx vitest run tests/firestore-membership-payment.test.js`
Expected: FAIL — `fireRecordMembershipPayment is not a function` (no existe aún).

- [ ] **Step 6: Implementar `fireRecordMembershipPayment` en `api/firestore.js`**

Justo después de la función `fireIncrementUsageCounter` existente (después de su línea de cierre `}` y antes de `async function fireLogUserHistory`), agregar:

```js
const MEMBERSHIP_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

async function fireRecordMembershipPayment(uid) {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const doc = await fireGetUserRaw(uid);
    if (!doc) throw new Error('Usuario no encontrado: ' + uid);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + MEMBERSHIP_PERIOD_MS).toISOString();
    const paymentHistory = [...(doc.fields.paymentHistory || []), { date: now.toISOString(), amount: 0, method: 'simulado' }];
    const update = {
      membershipStatus: 'active',
      membershipExpiresAt: expiresAt,
      lastPaymentAt: now.toISOString(),
      autoRenew: true,
      paymentHistory
    };

    const resp = await firePatchUserFieldsWithPrecondition(
      uid,
      ['membershipStatus', 'membershipExpiresAt', 'lastPaymentAt', 'autoRenew', 'paymentHistory'],
      update,
      doc.updateTime
    );
    if (resp.ok) return update;
    if (resp.status === 409) {
      const backoffMs = 10 + Math.floor(Math.random() * 40); // 10-50ms
      await sleep(backoffMs);
      continue;
    }
    throw new Error(`Firestore record membership payment failed: ${resp.status}`);
  }
  throw new Error('No se pudo registrar el pago de membresía tras reintentos por conflictos de concurrencia');
}
```

Y en el `module.exports` al final del archivo, agrega `fireRecordMembershipPayment` a la lista (junto a `fireIncrementUsageCounter`):

```js
  fireGetUserRaw, firePatchUserFieldsWithPrecondition, fireIncrementUsageCounter, fireRecordMembershipPayment,
```

- [ ] **Step 7: Correr el test para confirmar que pasa**

Run: `npx vitest run tests/firestore-membership-payment.test.js`
Expected: PASS, 5/5.

- [ ] **Step 8: Reescribir `payMembershipHandler` para usar el nuevo helper**

En `api/index.js`, reemplazar el bloque completo (desde `const MEMBERSHIP_PERIOD_MS = ...` hasta el cierre de `payMembershipHandler`):

```js
async function payMembershipHandler(req, res) {
  try {
    const result = await fireRecordMembershipPayment(req.user.uid);
    res.json({ ok: true, membershipStatus: result.membershipStatus, membershipExpiresAt: result.membershipExpiresAt });
  } catch (e) {
    console.warn('[POST /api/me/membership/pay] Firestore error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}
```

Y en el import de `./firestore` (línea 7, el `require` destructurado gigante), agrega `fireRecordMembershipPayment` a la lista de nombres importados.

- [ ] **Step 9: Reescribir `tests/payMembership.test.js` para mockear el nuevo helper**

Reemplazar el archivo completo:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const fireRecordMembershipPayment = vi.fn()
firestoreModule.fireRecordMembershipPayment = fireRecordMembershipPayment

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
    fireRecordMembershipPayment.mockReset()
  })

  it('delegates to fireRecordMembershipPayment and returns its membershipStatus/membershipExpiresAt', async () => {
    fireRecordMembershipPayment.mockResolvedValue({
      membershipStatus: 'active',
      membershipExpiresAt: '2026-08-21T12:00:00.000Z',
      lastPaymentAt: '2026-07-22T12:00:00.000Z',
      autoRenew: true,
      paymentHistory: [{ date: '2026-07-22T12:00:00.000Z', amount: 0, method: 'simulado' }]
    })
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await payMembershipHandler(req, res)

    expect(fireRecordMembershipPayment).toHaveBeenCalledWith('uid-1')
    expect(res.body).toEqual({ ok: true, membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z' })
  })

  it('responds 500 internal_error when Firestore fails', async () => {
    fireRecordMembershipPayment.mockRejectedValue(new Error('boom'))
    const req = { user: { uid: 'uid-2' } }
    const res = makeRes()

    await payMembershipHandler(req, res)

    expect(res.statusCode).toBe(500)
  })
})
```

- [ ] **Step 10: Correr el test para confirmar que pasa**

Run: `npx vitest run tests/payMembership.test.js`
Expected: PASS, 2/2.

- [ ] **Step 11: Escribir el test de cancelar/reactivar (RED)**

Crear `tests/membershipCancel.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const fireGetUser = vi.fn()
const firePatchUserFields = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.firePatchUserFields = firePatchUserFields

const { cancelMembershipHandler, reactivateMembershipHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('cancelMembershipHandler', () => {
  beforeEach(() => { fireGetUser.mockReset(); firePatchUserFields.mockReset() })

  it('sets autoRenew false for an active membership', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'active' })
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await cancelMembershipHandler(req, res)

    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['autoRenew'], { autoRenew: false })
    expect(res.body).toEqual({ ok: true, autoRenew: false })
  })

  it('responds 409 not_active for a pending/expired membership, without patching', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'expired' })
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await cancelMembershipHandler(req, res)

    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'not_active' })
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('responds 404 when the user does not exist', async () => {
    fireGetUser.mockResolvedValue(null)
    const req = { user: { uid: 'uid-missing' } }
    const res = makeRes()

    await cancelMembershipHandler(req, res)

    expect(res.statusCode).toBe(404)
  })

  it('responds 500 internal_error when Firestore fails', async () => {
    fireGetUser.mockRejectedValue(new Error('boom'))
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await cancelMembershipHandler(req, res)

    expect(res.statusCode).toBe(500)
  })
})

describe('reactivateMembershipHandler', () => {
  beforeEach(() => { fireGetUser.mockReset(); firePatchUserFields.mockReset() })

  it('sets autoRenew true for an active membership', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'active' })
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await reactivateMembershipHandler(req, res)

    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['autoRenew'], { autoRenew: true })
    expect(res.body).toEqual({ ok: true, autoRenew: true })
  })

  it('responds 409 not_active for a pending/expired membership, without patching', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'pending' })
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await reactivateMembershipHandler(req, res)

    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'not_active' })
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 12: Correr el test para confirmar que falla**

Run: `npx vitest run tests/membershipCancel.test.js`
Expected: FAIL — `cancelMembershipHandler`/`reactivateMembershipHandler` no existen aún.

- [ ] **Step 13: Implementar los handlers y rutas en `api/index.js`**

Justo después de la ruta `app.post('/api/me/membership/pay', requireUser, payMembershipHandler);`, agregar:

```js
async function cancelMembershipHandler(req, res) {
  try {
    const user = await fireGetUser(req.user.uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    if (user.membershipStatus !== 'active') return res.status(409).json({ error: 'not_active' });
    await firePatchUserFields(req.user.uid, ['autoRenew'], { autoRenew: false });
    res.json({ ok: true, autoRenew: false });
  } catch (e) {
    console.warn('[POST /api/me/membership/cancel] Firestore error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.post('/api/me/membership/cancel', requireUser, cancelMembershipHandler);

async function reactivateMembershipHandler(req, res) {
  try {
    const user = await fireGetUser(req.user.uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    if (user.membershipStatus !== 'active') return res.status(409).json({ error: 'not_active' });
    await firePatchUserFields(req.user.uid, ['autoRenew'], { autoRenew: true });
    res.json({ ok: true, autoRenew: true });
  } catch (e) {
    console.warn('[POST /api/me/membership/reactivate] Firestore error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.post('/api/me/membership/reactivate', requireUser, reactivateMembershipHandler);
```

Y al final del archivo, junto a `module.exports.payMembershipHandler = payMembershipHandler;`, agregar:

```js
module.exports.cancelMembershipHandler = cancelMembershipHandler;
module.exports.reactivateMembershipHandler = reactivateMembershipHandler;
```

- [ ] **Step 14: Correr el test para confirmar que pasa**

Run: `npx vitest run tests/membershipCancel.test.js`
Expected: PASS, 6/6.

- [ ] **Step 15: Correr la suite completa del backend para confirmar que no hay regresiones**

Run: `npx vitest run`
Expected: PASS en todas las suites salvo la falla preexistente y no relacionada de `tests/e2e/scan-cycle.spec.js`.

- [ ] **Step 16: Commit**

```bash
git add api/firestore.js api/index.js tests/firestore-users.test.js tests/payMembership.test.js tests/firestore-membership-payment.test.js tests/membershipCancel.test.js
git commit -m "feat(membership): autoRenew + historial de pagos, endpoints cancelar/reactivar

Agrega autoRenew y paymentHistory al modelo de datos (fireUpsertUser
+ nuevo helper fireRecordMembershipPayment, mismo patrón de reintento
que fireIncrementUsageCounter). payMembershipHandler ahora también fija
autoRenew:true y registra el pago en el historial. Nuevos endpoints
POST /api/me/membership/cancel y /reactivate solo togglean autoRenew,
sin tocar membershipStatus/membershipExpiresAt — el usuario conserva
acceso hasta el vencimiento, igual que cancelar en Netflix."
```

---

### Task 2: Frontend — bloque "Suscripción" en `account-ui.js`

**Files:**
- Modify: `account-ui.js`
- Modify: `home.css`
- Modify: `styles.css`
- Modify: `tests/account-ui.test.js`

**Interfaces:**
- Consumes: `profile.membershipStatus`, `profile.membershipExpiresAt`, `profile.autoRenew`, `profile.paymentHistory` (todos ya viajan en el perfil cacheado gracias a Task 1, sin cambios de `authClient.js` necesarios). Reusa `openModal`/`closeModal`, `getIdToken`, `syncUserProfile` ya existentes en `account-ui.js`.
- Produces: dos nuevas funciones exportadas `submitCancelSubscription()` y `submitReactivateSubscription()` (zero-arg, igual que el resto de `submit*` del archivo).

- [ ] **Step 1: Agregar la clase CSS `.modal-actions` (fila de botones Volver/Confirmar)**

En `styles.css`, justo después de la regla `.ocr-actions { display: flex; gap: 10px; justify-content: flex-end; }` (busca ese selector exacto), agregar:

```css
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
```

- [ ] **Step 2: Agregar CSS del bloque Suscripción en `home.css`**

Al final de `home.css`, agregar:

```css
/* Bloque "Suscripción" en Mi cuenta (solo membershipStatus:'active') —
   estilo Netflix: ver si se renovará/cuándo vence, cancelar (conserva
   acceso hasta el vencimiento) o reactivar, e historial de pagos. */
.account-subscription-block {
  padding: 12px 0;
  border-top: 1px solid var(--border);
}
.account-subscription-status { font-size: 0.88rem; color: var(--ink-2); margin: 4px 0 8px; }

.account-payment-history { padding: 10px 0 4px; }
.account-payment-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.82rem;
  color: var(--ink-3);
  padding: 6px 0;
  border-top: 1px solid var(--border);
}
.account-payment-row:first-child { border-top: none; }
```

- [ ] **Step 3: Escribir los tests del bloque Suscripción (RED)**

En `tests/account-ui.test.js`, primero extiende la lista de funciones importadas: cambia la línea

```js
let submitPhoneContactEdit, submitPhoneSendCode, submitPhoneChangeConfirm, submitEmailEdit, submitPasswordEdit
```

por:

```js
let submitPhoneContactEdit, submitPhoneSendCode, submitPhoneChangeConfirm, submitEmailEdit, submitPasswordEdit
let submitCancelSubscription, submitReactivateSubscription
```

y dentro del `beforeEach`, justo después de la línea `submitPasswordEdit = mod.submitPasswordEdit`, agrega:

```js
  submitCancelSubscription = mod.submitCancelSubscription
  submitReactivateSubscription = mod.submitReactivateSubscription
```

Luego, al final del archivo (después del último `describe` de Contraseña), agrega:

```js

describe('bloque Suscripción (membresía activa)', () => {
  it('muestra "se renovará" y botón Cancelar cuando autoRenew !== false', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z', autoRenew: true })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.textContent).toMatch(/Se renovará automáticamente/)
    expect(document.getElementById('btn-open-cancel-subscription-modal')).toBeTruthy()
    expect(document.getElementById('btn-reactivate-subscription')).toBeNull()
  })

  it('trata autoRenew ausente como true (cuentas activas de antes de este cambio)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z' })
    renderAccountHub()
    expect(document.getElementById('btn-open-cancel-subscription-modal')).toBeTruthy()
  })

  it('muestra "vence" y botón Reactivar cuando autoRenew === false', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z', autoRenew: false })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.textContent).toMatch(/no se renovará/)
    expect(document.getElementById('btn-reactivate-subscription')).toBeTruthy()
    expect(document.getElementById('btn-open-cancel-subscription-modal')).toBeNull()
  })

  it('no se muestra para membresías pending/expired', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'pending' })
    renderAccountHub()
    expect(document.querySelector('[data-row="subscription"]')).toBeNull()
  })

  it('muestra el historial de pagos, más reciente primero', () => {
    getCachedProfile.mockReturnValue({
      email: 'a@b.com', membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z', autoRenew: true,
      paymentHistory: [
        { date: '2026-06-22T12:00:00.000Z', amount: 0, method: 'simulado' },
        { date: '2026-07-22T12:00:00.000Z', amount: 0, method: 'simulado' }
      ]
    })
    renderAccountHub()
    const rows = Array.from(document.querySelectorAll('.account-payment-row')).map(r => r.textContent)
    expect(rows[0]).toMatch(/22 jul 2026/)
    expect(rows[1]).toMatch(/22 jun 2026/)
  })

  it('click en "Cancelar suscripción" abre el modal de confirmación', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z', autoRenew: true })
    renderAccountHub()
    document.getElementById('btn-open-cancel-subscription-modal').click()
    expect(document.getElementById('btn-cancel-subscription-confirm')).toBeTruthy()
  })

  it('submitCancelSubscription llama POST /api/me/membership/cancel y re-sincroniza', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z', autoRenew: true })
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    await submitCancelSubscription()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/me/membership/cancel')
    expect(options.method).toBe('POST')
    expect(syncUserProfile).toHaveBeenCalled()
  })

  it('submitReactivateSubscription llama POST /api/me/membership/reactivate y re-sincroniza', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z', autoRenew: false })
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    await submitReactivateSubscription()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/me/membership/reactivate')
    expect(options.method).toBe('POST')
    expect(syncUserProfile).toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Correr el test para confirmar que falla**

Run: `npx vitest run tests/account-ui.test.js`
Expected: FAIL — los nuevos `describe` fallan (`btn-open-cancel-subscription-modal` etc. no existen; `submitCancelSubscription`/`submitReactivateSubscription` son `undefined`).

- [ ] **Step 5: Implementar el bloque en `account-ui.js`**

Justo después de la función `renderEmailRow` existente (antes de `export function renderAccountHub()`), agregar:

```js
function formatMembershipDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderSubscriptionBlock(profile) {
  const autoRenew = profile.autoRenew !== false;
  const expiresLabel = formatMembershipDate(profile.membershipExpiresAt);
  const statusLine = autoRenew
    ? `Se renovará automáticamente el ${expiresLabel}.`
    : `Vence el ${expiresLabel} — no se renovará.`;
  const actionBtn = autoRenew
    ? `<button type="button" id="btn-open-cancel-subscription-modal" class="account-link-btn">Cancelar suscripción</button>`
    : `<button type="button" id="btn-reactivate-subscription" class="account-link-btn">Reactivar suscripción</button>`;

  const history = profile.paymentHistory || [];
  const historyHtml = history.length ? `
    <div class="account-payment-history">
      <div class="account-data-label">Historial de pagos</div>
      ${history.slice().reverse().map(p => `
        <div class="account-payment-row">
          <span>${formatMembershipDate(p.date)}</span>
          <span>$${Number(p.amount).toFixed(2)} (${escapeHtml(p.method)})</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  return `
    <div class="account-subscription-block" data-row="subscription">
      <div class="account-data-label">Suscripción</div>
      <div class="account-subscription-status">${statusLine}</div>
      ${actionBtn}
    </div>
    ${historyHtml}
  `;
}

function openCancelSubscriptionModal(profile) {
  const expiresLabel = formatMembershipDate(profile.membershipExpiresAt);
  openModal(`
    <div class="modal-header"><h2>¿Cancelar tu suscripción?</h2><button type="button" class="modal-close" aria-label="Cerrar">×</button></div>
    <p class="about-text">Conservas acceso completo hasta el ${expiresLabel}. Después de esa fecha no se te volverá a cobrar y tu cuenta pasará a inactiva.</p>
    <div class="modal-actions">
      <button type="button" id="btn-cancel-subscription-back" class="btn btn-secondary">Volver</button>
      <button type="button" id="btn-cancel-subscription-confirm" class="btn btn-primary">Sí, cancelar</button>
    </div>
    <p id="cancel-subscription-error" class="hidden modal-inline-error" role="alert"></p>
  `);
  document.getElementById('btn-cancel-subscription-back')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-subscription-confirm')?.addEventListener('click', () => {
    submitCancelSubscription().then(() => closeModal()).catch(() => {});
  });
}
```

Luego, dentro de `renderAccountHub`, en el template, justo antes de la línea `${!isActive ? \`` (el bloque `account-renew` existente), agrega:

```js
      ${isActive ? renderSubscriptionBlock(profile) : ''}
```

(queda como: primero la fila de preferencias, luego este bloque de suscripción si está activa, luego el bloque `!isActive` de renovar si no lo está — nunca se muestran los dos a la vez).

Luego, dentro de `wireAccountHubEvents(profile)`, justo después del bloque `btn-open-password-modal`, agrega:

```js
  document.getElementById('btn-open-cancel-subscription-modal')?.addEventListener('click', () => {
    openCancelSubscriptionModal(profile);
  });
  document.getElementById('btn-reactivate-subscription')?.addEventListener('click', () => {
    submitReactivateSubscription().catch(() => {});
  });
```

Finalmente, después de `submitPasswordEdit` (antes de `handleLogout`), agrega:

```js
function showCancelSubscriptionError(message) {
  const el = document.getElementById('cancel-subscription-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function submitCancelSubscription() {
  const token = await getIdToken();
  const res = await fetch('/api/me/membership/cancel', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    showCancelSubscriptionError('No se pudo cancelar tu suscripción. Intenta de nuevo.');
    throw new Error('cancel_failed');
  }
  await syncUserProfile();
  renderAccountHub();
}

export async function submitReactivateSubscription() {
  const token = await getIdToken();
  const res = await fetch('/api/me/membership/reactivate', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('reactivate_failed');
  await syncUserProfile();
  renderAccountHub();
}
```

- [ ] **Step 6: Correr el test para confirmar que pasa**

Run: `npx vitest run tests/account-ui.test.js`
Expected: PASS, todos los tests verdes (los existentes + los 8 nuevos de Suscripción).

- [ ] **Step 7: Correr la suite completa para confirmar que no hay regresiones**

Run: `npx vitest run`
Expected: PASS en todas las suites salvo la falla preexistente y no relacionada de `tests/e2e/scan-cycle.spec.js`.

- [ ] **Step 8: Commit**

```bash
git add account-ui.js home.css styles.css tests/account-ui.test.js
git commit -m "feat(account): bloque Suscripción — cancelar/reactivar + historial de pagos

Solo visible con membershipStatus:'active'. Muestra si se renovará
automáticamente o cuándo vence según autoRenew, permite cancelar (modal
de confirmación, conserva acceso hasta el vencimiento) o reactivar, y
lista el historial de pagos simulados más reciente primero."
```
