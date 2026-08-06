# Integración real de Stripe para membresía — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el pago simulado de membresía (`amount: 0`, `method: 'simulado'`) por cobro recurrente real vía Stripe Checkout ($29.90 MXN/mes), con webhook para mantener Firestore sincronizado con el estado real de la suscripción.

**Architecture:** Wrapper delgado sobre la API REST de Stripe (`api/stripeClient.js`, vía `fetch`, sin SDK npm — mismo patrón que `api/phoneAuth.js` con Twilio). `payMembershipHandler` crea una Checkout Session y redirige; el fulfillment (activar membresía en Firestore) ocurre de forma idempotente tanto por webhook (`POST /api/webhooks/stripe`) como por una verificación síncrona al volver de Stripe (`GET /api/me/membership/checkout-result`), para que la UI no dependa de la latencia del webhook.

**Tech Stack:** Node/Express (`api/index.js`), Firestore vía REST (`api/firestore.js`), JS vanilla en frontend (`account-ui.js`, `onboarding-membership-ui.js`), Vitest + jsdom para tests.

## Global Constraints

- Precio: **$29.90 MXN/mes**, recurrente. `STRIPE_PRICE_ID=price_1TygtOAK7bO3f1402Kc1nUoW` ya creado y en Vercel (development/preview/production) y `.env.local`.
- `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` ya provisionados (sandbox test mode, Vercel Marketplace, integración `stripe-champagne-yacht`, sin reclamar todavía — no cobra dinero real).
- **No agregar el SDK npm `stripe`** — todo vía `fetch` a `https://api.stripe.com/v1`, igual que Twilio en `api/phoneAuth.js`. Cero dependencias nuevas en `package.json`.
- Reusar el mapa `billing` ya reservado en `fireUpsertUser` (`api/firestore.js:506-510`): `stripeCustomerId`, `subscriptionId`, `subscriptionStatus`, `currentPeriodEnd`. No inventar campos top-level nuevos.
- `paymentHistory` entries: `{ date: ISO, amount: number, currency: string, method: 'stripe', stripeInvoiceId: string }`. `stripeInvoiceId` es la clave de idempotencia.
- El webhook (`POST /api/webhooks/stripe`) necesita el body **crudo** para verificar la firma — su ruta se registra con `express.raw({ type: 'application/json' })` ANTES del `express.json()` global de `api/index.js:43`.
- URLs de Stripe (success/cancel) se construyen con `process.env.APP_BASE_URL || 'https://yomi.mx'` — mismo patrón ya usado en `passwordResetHandler`/`verificationEmailHandler` (`api/index.js:1569`, `:1592`).
- Ambos call sites de `POST /api/me/membership/pay` (`account-ui.js` para renovación, `onboarding-membership-ui.js` para el pago inicial) dejan de asumir éxito síncrono — ahora reciben `{ checkoutUrl }` y redirigen.
- Estilo de tests: archivos bajo `api/` se testean con el truco `createRequire` + reasignar propiedades del módulo ya cacheado (ver `tests/membershipCancel.test.js`). Archivos de frontend (`account-ui.js`, `onboarding-membership-ui.js`) se testean con `@vitest-environment jsdom` + `vi.mock(...)`.

---

### Task 1: `api/stripeClient.js` — wrapper REST de Stripe

**Files:**
- Create: `api/stripeClient.js`
- Test: `tests/stripeClient.test.js`
- Modify: `.env.example` (agregar placeholders)

**Interfaces:**
- Produces: `stripeCreateCustomer({ email, uid }) => Promise<{ id, ... }>`, `stripeCreateCheckoutSession({ customerId, priceId, uid, successUrl, cancelUrl }) => Promise<{ id, url, ... }>`, `stripeRetrieveCheckoutSession(sessionId) => Promise<{ client_reference_id, payment_status, subscription, ... }>`, `stripeRetrieveSubscription(subscriptionId) => Promise<{ id, customer, status, current_period_end, cancel_at_period_end, latest_invoice, metadata, items: { data: [{ price: { unit_amount, currency } }] }, ... }>`, `stripeUpdateSubscription(subscriptionId, { cancelAtPeriodEnd }) => Promise<{...}>`, `constructStripeEvent(rawBodyBuffer, signatureHeader, webhookSecret) => event object (throws si la firma es inválida)`.

- [ ] **Step 1: Escribir el test completo (falla porque el módulo no existe)**

Crear `tests/stripeClient.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

const {
  stripeCreateCustomer, stripeCreateCheckoutSession, stripeRetrieveCheckoutSession,
  stripeRetrieveSubscription, stripeUpdateSubscription, constructStripeEvent
} = await import('../api/stripeClient.js')

describe('stripeClient REST calls', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123'
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('stripeCreateCustomer posts to /v1/customers with Basic auth and metadata.firebaseUid', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'cus_1' }) })
    vi.stubGlobal('fetch', fetchMock)

    const customer = await stripeCreateCustomer({ email: 'a@b.com', uid: 'uid-1' })

    expect(customer).toEqual({ id: 'cus_1' })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.stripe.com/v1/customers')
    expect(opts.method).toBe('POST')
    expect(opts.headers.Authorization).toBe('Basic ' + Buffer.from('sk_test_123:').toString('base64'))
    expect(opts.body.toString()).toBe('email=a%40b.com&metadata%5BfirebaseUid%5D=uid-1')
  })

  it('stripeCreateCheckoutSession posts subscription mode with price, customer and client_reference_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' }) })
    vi.stubGlobal('fetch', fetchMock)

    const session = await stripeCreateCheckoutSession({
      customerId: 'cus_1', priceId: 'price_1', uid: 'uid-1',
      successUrl: 'https://yomi.mx/account.html?stripe=success&session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://yomi.mx/account.html?stripe=cancel'
    })

    expect(session.url).toBe('https://checkout.stripe.com/cs_1')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions')
    const body = opts.body.toString()
    expect(body).toContain('mode=subscription')
    expect(body).toContain('customer=cus_1')
    expect(body).toContain('client_reference_id=uid-1')
    expect(body).toContain(encodeURIComponent('line_items[0][price]') + '=price_1')
    expect(body).toContain(encodeURIComponent('subscription_data[metadata][firebaseUid]') + '=uid-1')
  })

  it('stripeRetrieveCheckoutSession does a GET to /v1/checkout/sessions/:id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'cs_1', payment_status: 'paid' }) })
    vi.stubGlobal('fetch', fetchMock)

    const session = await stripeRetrieveCheckoutSession('cs_1')

    expect(session.payment_status).toBe('paid')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions/cs_1')
    expect(opts.method).toBe('GET')
  })

  it('stripeRetrieveSubscription does a GET to /v1/subscriptions/:id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'sub_1', status: 'active' }) })
    vi.stubGlobal('fetch', fetchMock)

    const subscription = await stripeRetrieveSubscription('sub_1')

    expect(subscription.status).toBe('active')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.stripe.com/v1/subscriptions/sub_1')
  })

  it('stripeUpdateSubscription posts cancel_at_period_end as a string boolean', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'sub_1', cancel_at_period_end: true }) })
    vi.stubGlobal('fetch', fetchMock)

    await stripeUpdateSubscription('sub_1', { cancelAtPeriodEnd: true })

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.stripe.com/v1/subscriptions/sub_1')
    expect(opts.body.toString()).toBe('cancel_at_period_end=true')
  })

  it('throws with .status set to the Stripe HTTP status when Stripe responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({ error: { message: 'Your card was declined.' } }) }))

    await expect(stripeRetrieveSubscription('sub_bad')).rejects.toThrow('Your card was declined.')
    try {
      await stripeRetrieveSubscription('sub_bad')
    } catch (e) {
      expect(e.status).toBe(402)
    }
  })
})

describe('constructStripeEvent', () => {
  const secret = 'whsec_test_secret'

  function signPayload(payload, timestamp) {
    const signedPayload = `${timestamp}.${payload}`
    return crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex')
  }

  it('parses and returns the event when the signature is valid', () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' })
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = signPayload(payload, timestamp)
    const header = `t=${timestamp},v1=${signature}`

    const event = constructStripeEvent(Buffer.from(payload), header, secret)

    expect(event).toEqual({ id: 'evt_1', type: 'checkout.session.completed' })
  })

  it('throws when the signature does not match the payload', () => {
    const payload = JSON.stringify({ id: 'evt_1' })
    const timestamp = Math.floor(Date.now() / 1000)
    const header = `t=${timestamp},v1=${'0'.repeat(64)}`

    expect(() => constructStripeEvent(Buffer.from(payload), header, secret)).toThrow()
  })

  it('throws when the payload was tampered with after signing', () => {
    const originalPayload = JSON.stringify({ id: 'evt_1' })
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = signPayload(originalPayload, timestamp)
    const header = `t=${timestamp},v1=${signature}`
    const tamperedPayload = JSON.stringify({ id: 'evt_2' })

    expect(() => constructStripeEvent(Buffer.from(tamperedPayload), header, secret)).toThrow()
  })

  it('throws when the timestamp is older than the tolerance window', () => {
    const payload = JSON.stringify({ id: 'evt_1' })
    const oldTimestamp = Math.floor(Date.now() / 1000) - 400
    const signature = signPayload(payload, oldTimestamp)
    const header = `t=${oldTimestamp},v1=${signature}`

    expect(() => constructStripeEvent(Buffer.from(payload), header, secret)).toThrow()
  })

  it('throws when the signature header is missing', () => {
    expect(() => constructStripeEvent(Buffer.from('{}'), undefined, secret)).toThrow()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/stripeClient.test.js`
Expected: FAIL — `Cannot find module '../api/stripeClient.js'`

- [ ] **Step 3: Implementar `api/stripeClient.js`**

```js
// Wrapper delgado sobre la API REST de Stripe (mismo patrón que api/phoneAuth.js
// para Twilio) — sin agregar el SDK npm `stripe`, todo vía fetch +
// application/x-www-form-urlencoded.
const crypto = require('crypto');

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

function stripeAuthHeader() {
  const key = process.env.STRIPE_SECRET_KEY;
  return 'Basic ' + Buffer.from(`${key}:`).toString('base64');
}

async function stripeRequest(method, path, params) {
  let url = `${STRIPE_API_BASE}${path}`;
  const opts = {
    method,
    headers: { Authorization: stripeAuthHeader() },
    signal: AbortSignal.timeout(10000)
  };
  if (params && method === 'GET') {
    url += `?${new URLSearchParams(params).toString()}`;
  } else if (params) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(params);
  }
  const resp = await fetch(url, opts);
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data?.error?.message || `Stripe API error (status ${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  return data;
}

async function stripeCreateCustomer({ email, uid }) {
  return stripeRequest('POST', '/customers', { email, 'metadata[firebaseUid]': uid });
}

async function stripeCreateCheckoutSession({ customerId, priceId, uid, successUrl, cancelUrl }) {
  return stripeRequest('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: customerId,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    client_reference_id: uid,
    'subscription_data[metadata][firebaseUid]': uid,
    success_url: successUrl,
    cancel_url: cancelUrl
  });
}

async function stripeRetrieveCheckoutSession(sessionId) {
  return stripeRequest('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

async function stripeRetrieveSubscription(subscriptionId) {
  return stripeRequest('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

async function stripeUpdateSubscription(subscriptionId, { cancelAtPeriodEnd }) {
  return stripeRequest('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    cancel_at_period_end: cancelAtPeriodEnd ? 'true' : 'false'
  });
}

const WEBHOOK_TOLERANCE_SECONDS = 300;

function constructStripeEvent(rawBody, signatureHeader, webhookSecret) {
  if (!signatureHeader) throw new Error('Falta el header Stripe-Signature');
  const parts = Object.fromEntries(signatureHeader.split(',').map(p => p.split('=')));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new Error('Header Stripe-Signature malformado');

  const payload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', webhookSecret).update(payload, 'utf8').digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const signatureBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== signatureBuf.length || !crypto.timingSafeEqual(expectedBuf, signatureBuf)) {
    throw new Error('Firma de webhook inválida');
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (ageSeconds > WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error('Timestamp del webhook fuera de tolerancia');
  }

  return JSON.parse(rawBody.toString('utf8'));
}

module.exports = {
  stripeCreateCustomer, stripeCreateCheckoutSession, stripeRetrieveCheckoutSession,
  stripeRetrieveSubscription, stripeUpdateSubscription, constructStripeEvent
};
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/stripeClient.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: Agregar placeholders a `.env.example`**

Editar `.env.example`, agregar al final:

```
STRIPE_SECRET_KEY=sk_test_your_key_here
STRIPE_PUBLISHABLE_KEY=pk_test_your_key_here
STRIPE_PRICE_ID=price_your_price_id_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

- [ ] **Step 6: Commit**

```bash
git add api/stripeClient.js tests/stripeClient.test.js .env.example
git commit -m "feat(stripe): agrega wrapper REST sobre la API de Stripe

Sin SDK npm — fetch + application/x-www-form-urlencoded, mismo patrón
que api/phoneAuth.js con Twilio. Incluye verificación manual de firma
de webhook (HMAC-SHA256 + timingSafeEqual)."
```

---

### Task 2: `fireFulfillStripeSubscription` en `api/firestore.js`

**Files:**
- Modify: `api/firestore.js` (agrega la función, elimina `fireRecordMembershipPayment` y `MEMBERSHIP_PERIOD_MS`, actualiza `module.exports`)
- Create: `tests/firestore-stripe-fulfillment.test.js`
- Delete: `tests/firestore-membership-payment.test.js` (testeaba la función eliminada)

**Interfaces:**
- Produces: `fireFulfillStripeSubscription({ uid, stripeCustomerId, subscriptionId, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd, invoiceId, amount, currency }) => Promise<{ membershipStatus, membershipExpiresAt, lastPaymentAt, autoRenew, billing, paymentHistory } | { ..., alreadyFulfilled: true }>` — idempotente en `invoiceId`.

- [ ] **Step 1: Escribir el test completo**

Crear `tests/firestore-stripe-fulfillment.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

const { fireFulfillStripeSubscription } = await import('../api/firestore.js')

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

const baseParams = {
  uid: 'uid-1',
  stripeCustomerId: 'cus_1',
  subscriptionId: 'sub_1',
  subscriptionStatus: 'active',
  currentPeriodEnd: '2026-08-29T12:00:00.000Z',
  cancelAtPeriodEnd: false,
  invoiceId: 'in_1',
  amount: 29.90,
  currency: 'mxn'
}

describe('fireFulfillStripeSubscription', () => {
  const ORIGINAL_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY

  beforeEach(() => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-29T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = ORIGINAL_KEY
  })

  it('activates membership, sets billing fields, and appends to an empty paymentHistory', async () => {
    let patchBody, patchUrl
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { membershipStatus: { stringValue: 'pending' } },
            updateTime: '2026-07-29T10:00:00.000000Z'
          })
        }
      }
      patchUrl = url
      patchBody = JSON.parse(options.body)
      return { ok: true, status: 200 }
    }))

    const result = await fireFulfillStripeSubscription(baseParams)

    expect(result).toEqual({
      membershipStatus: 'active',
      membershipExpiresAt: '2026-08-29T12:00:00.000Z',
      lastPaymentAt: '2026-07-29T12:00:00.000Z',
      autoRenew: true,
      billing: { stripeCustomerId: 'cus_1', subscriptionId: 'sub_1', subscriptionStatus: 'active', currentPeriodEnd: '2026-08-29T12:00:00.000Z' },
      paymentHistory: [{ date: '2026-07-29T12:00:00.000Z', amount: 29.90, currency: 'mxn', method: 'stripe', stripeInvoiceId: 'in_1' }]
    })
    expect(patchUrl).toContain(`currentDocument.updateTime=${encodeURIComponent('2026-07-29T10:00:00.000000Z')}`)
    expect(patchBody.currentDocument).toBeUndefined()
  })

  it('is idempotent: does not append a duplicate entry when stripeInvoiceId already exists', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: {
              membershipStatus: { stringValue: 'active' },
              membershipExpiresAt: { stringValue: '2026-08-29T12:00:00.000Z' },
              paymentHistory: { arrayValue: { values: [
                { mapValue: { fields: {
                  date: { stringValue: '2026-06-29T12:00:00.000Z' }, amount: { doubleValue: 29.90 },
                  currency: { stringValue: 'mxn' }, method: { stringValue: 'stripe' }, stripeInvoiceId: { stringValue: 'in_1' }
                } } }
              ] } }
            },
            updateTime: '2026-07-29T10:00:00.000000Z'
          })
        }
      }
      throw new Error('no debería intentar escribir')
    }))

    const result = await fireFulfillStripeSubscription(baseParams)

    expect(result.alreadyFulfilled).toBe(true)
  })

  it('appends to an existing paymentHistory instead of overwriting it', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: {
              membershipStatus: { stringValue: 'active' },
              paymentHistory: { arrayValue: { values: [
                { mapValue: { fields: {
                  date: { stringValue: '2026-06-29T12:00:00.000Z' }, amount: { doubleValue: 29.90 },
                  currency: { stringValue: 'mxn' }, method: { stringValue: 'stripe' }, stripeInvoiceId: { stringValue: 'in_0' }
                } } }
              ] } }
            },
            updateTime: '2026-07-29T10:00:00.000000Z'
          })
        }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireFulfillStripeSubscription(baseParams)

    expect(result.paymentHistory).toEqual([
      { date: '2026-06-29T12:00:00.000Z', amount: 29.90, currency: 'mxn', method: 'stripe', stripeInvoiceId: 'in_0' },
      { date: '2026-07-29T12:00:00.000Z', amount: 29.90, currency: 'mxn', method: 'stripe', stripeInvoiceId: 'in_1' }
    ])
  })

  it('sets autoRenew false when cancelAtPeriodEnd is true', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return { ok: true, status: 200, json: async () => ({ fields: { membershipStatus: { stringValue: 'active' } }, updateTime: '2026-07-29T10:00:00.000000Z' }) }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireFulfillStripeSubscription({ ...baseParams, cancelAtPeriodEnd: true })

    expect(result.autoRenew).toBe(false)
  })

  it('retries with backoff on a 409 conflict and succeeds on the next attempt', async () => {
    let patchAttempts = 0
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return { ok: true, status: 200, json: async () => ({ fields: { membershipStatus: { stringValue: 'pending' } }, updateTime: '2026-07-29T10:00:00.000000Z' }) }
      }
      patchAttempts++
      if (patchAttempts === 1) return { ok: false, status: 409 }
      return { ok: true, status: 200 }
    }))
    vi.useRealTimers()

    const result = await fireFulfillStripeSubscription(baseParams)

    expect(patchAttempts).toBe(2)
    expect(result.membershipStatus).toBe('active')
  })

  it('throws when the user document does not exist', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) return { status: 404, ok: false }
      return { ok: true, status: 200 }
    }))

    await expect(fireFulfillStripeSubscription({ ...baseParams, uid: 'uid-missing' })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/firestore-stripe-fulfillment.test.js`
Expected: FAIL — `fireFulfillStripeSubscription is not a function` (undefined tras el destructure)

- [ ] **Step 3: Implementar `fireFulfillStripeSubscription`, eliminar `fireRecordMembershipPayment`**

En `api/firestore.js`, reemplazar el bloque de `MEMBERSHIP_PERIOD_MS` + `fireRecordMembershipPayment` (líneas 621-656) por:

```js
async function fireFulfillStripeSubscription({ uid, stripeCustomerId, subscriptionId, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd, invoiceId, amount, currency }) {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const doc = await fireGetUserRaw(uid);
    if (!doc) throw new Error('Usuario no encontrado: ' + uid);

    const existingHistory = doc.fields.paymentHistory || [];
    if (existingHistory.some(p => p.stripeInvoiceId === invoiceId)) {
      return {
        membershipStatus: doc.fields.membershipStatus,
        membershipExpiresAt: doc.fields.membershipExpiresAt,
        alreadyFulfilled: true
      };
    }

    const now = new Date().toISOString();
    const paymentHistory = [...existingHistory, { date: now, amount, currency, method: 'stripe', stripeInvoiceId: invoiceId }];
    const update = {
      membershipStatus: 'active',
      membershipExpiresAt: currentPeriodEnd,
      lastPaymentAt: now,
      autoRenew: !cancelAtPeriodEnd,
      billing: { stripeCustomerId, subscriptionId, subscriptionStatus, currentPeriodEnd },
      paymentHistory
    };

    const resp = await firePatchUserFieldsWithPrecondition(
      uid,
      [
        'membershipStatus', 'membershipExpiresAt', 'lastPaymentAt', 'autoRenew', 'paymentHistory',
        'billing.stripeCustomerId', 'billing.subscriptionId', 'billing.subscriptionStatus', 'billing.currentPeriodEnd'
      ],
      update,
      doc.updateTime
    );
    if (resp.ok) return update;
    if (resp.status === 409) {
      const backoffMs = 10 + Math.floor(Math.random() * 40); // 10-50ms
      await sleep(backoffMs);
      continue;
    }
    throw new Error(`Firestore fulfill stripe subscription failed: ${resp.status}`);
  }
  throw new Error('No se pudo registrar el pago de Stripe tras reintentos por conflictos de concurrencia');
}
```

En `module.exports` (línea 784-794), reemplazar `fireRecordMembershipPayment` por `fireFulfillStripeSubscription`.

- [ ] **Step 4: Borrar el test viejo, correr el nuevo y verificar que pasa**

```bash
rm tests/firestore-membership-payment.test.js
npx vitest run tests/firestore-stripe-fulfillment.test.js
```
Expected: PASS (7 tests)

- [ ] **Step 5: Correr toda la suite para confirmar que nada más quedó roto**

Run: `npx vitest run`
Expected: solo deberían fallar (por ahora, hasta las próximas tareas) `tests/payMembership.test.js` — sigue importando `fireRecordMembershipPayment`, que ya no existe. Se corrige en la Task 4.

- [ ] **Step 6: Commit**

```bash
git add api/firestore.js tests/firestore-stripe-fulfillment.test.js
git rm tests/firestore-membership-payment.test.js
git commit -m "feat(stripe): fireFulfillStripeSubscription reemplaza el pago simulado

Idempotente en stripeInvoiceId, escribe en el mapa billing ya
reservado en fireUpsertUser. Elimina fireRecordMembershipPayment
(simulado, amount:0/method:'simulado')."
```

---

### Task 3: Webhook de Stripe (`POST /api/webhooks/stripe`)

**Files:**
- Modify: `api/index.js`
- Test: `tests/stripeWebhook.test.js`

**Interfaces:**
- Consumes: `fireFulfillStripeSubscription` (Task 2), `stripeRetrieveSubscription`, `constructStripeEvent` (Task 1).
- Produces: función interna `fulfillSubscription(uid, subscriptionId)` (usada también por Task 4), handler exportado `stripeWebhookHandler`.

- [ ] **Step 1: Escribir el test completo**

Crear `tests/stripeWebhook.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const stripeClientModule = requireFn('../api/stripeClient.js')

const fireGetUserRaw = vi.fn()
const firePatchUserFieldsWithPrecondition = vi.fn()
const firePatchUserFields = vi.fn()
const constructStripeEvent = vi.fn()
const stripeRetrieveSubscription = vi.fn()
firestoreModule.fireGetUserRaw = fireGetUserRaw
firestoreModule.firePatchUserFieldsWithPrecondition = firePatchUserFieldsWithPrecondition
firestoreModule.firePatchUserFields = firePatchUserFields
stripeClientModule.constructStripeEvent = constructStripeEvent
stripeClientModule.stripeRetrieveSubscription = stripeRetrieveSubscription

const { stripeWebhookHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

function makeReq() {
  return { body: Buffer.from('raw'), get: () => 'sig-header' }
}

describe('stripeWebhookHandler', () => {
  beforeEach(() => {
    fireGetUserRaw.mockReset(); firePatchUserFieldsWithPrecondition.mockReset(); firePatchUserFields.mockReset()
    constructStripeEvent.mockReset(); stripeRetrieveSubscription.mockReset()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  })

  it('responds 400 when the signature is invalid', async () => {
    constructStripeEvent.mockImplementation(() => { throw new Error('bad sig') })
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(res.statusCode).toBe(400)
  })

  it('fulfills the subscription on checkout.session.completed', async () => {
    constructStripeEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', client_reference_id: 'uid-1', subscription: 'sub_1' } }
    })
    stripeRetrieveSubscription.mockResolvedValue({
      id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1785400000,
      cancel_at_period_end: false, latest_invoice: 'in_1',
      items: { data: [{ price: { unit_amount: 2990, currency: 'mxn' } }] }
    })
    fireGetUserRaw.mockResolvedValue({ fields: { membershipStatus: 'pending' }, updateTime: '2026-07-29T10:00:00.000000Z' })
    firePatchUserFieldsWithPrecondition.mockResolvedValue({ ok: true })
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(firePatchUserFieldsWithPrecondition).toHaveBeenCalled()
    expect(res.body).toEqual({ received: true })
  })

  it('fulfills the subscription on invoice.paid using the subscription metadata for the uid', async () => {
    constructStripeEvent.mockReturnValue({
      type: 'invoice.paid',
      data: { object: { subscription: 'sub_1' } }
    })
    stripeRetrieveSubscription.mockResolvedValue({
      id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1785400000,
      cancel_at_period_end: false, latest_invoice: 'in_2', metadata: { firebaseUid: 'uid-1' },
      items: { data: [{ price: { unit_amount: 2990, currency: 'mxn' } }] }
    })
    fireGetUserRaw.mockResolvedValue({ fields: { membershipStatus: 'active', paymentHistory: [] }, updateTime: '2026-07-29T10:00:00.000000Z' })
    firePatchUserFieldsWithPrecondition.mockResolvedValue({ ok: true })
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(firePatchUserFieldsWithPrecondition).toHaveBeenCalled()
  })

  it('syncs autoRenew on customer.subscription.updated', async () => {
    constructStripeEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: { object: { cancel_at_period_end: true, metadata: { firebaseUid: 'uid-1' } } }
    })
    firePatchUserFields.mockResolvedValue(true)
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['autoRenew'], { autoRenew: false })
  })

  it('sets autoRenew false on customer.subscription.deleted', async () => {
    constructStripeEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { metadata: { firebaseUid: 'uid-1' } } }
    })
    firePatchUserFields.mockResolvedValue(true)
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['autoRenew'], { autoRenew: false })
  })

  it('responds 200 with received:true for unhandled event types', async () => {
    constructStripeEvent.mockReturnValue({ type: 'customer.created', data: { object: {} } })
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(res.body).toEqual({ received: true })
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/stripeWebhook.test.js`
Expected: FAIL — `stripeWebhookHandler is not a function`

- [ ] **Step 3: Implementar el handler y montar la ruta ANTES de `express.json()`**

En `api/index.js` línea 7, actualizar el require de `./firestore` reemplazando `fireRecordMembershipPayment` por `fireFulfillStripeSubscription`.

Después de la línea 13 (`const { computeStats } = require('./stats');`), agregar:

```js
const {
  stripeCreateCustomer, stripeCreateCheckoutSession, stripeRetrieveCheckoutSession,
  stripeRetrieveSubscription, stripeUpdateSubscription, constructStripeEvent
} = require('./stripeClient');
```

Reemplazar:
```js
app.use(express.static(path.join(__dirname, '..')));
app.use(express.json({ limit: '5mb' }));
```
por:
```js
app.use(express.static(path.join(__dirname, '..')));

async function fulfillSubscription(uid, subscriptionId) {
  const subscription = await stripeRetrieveSubscription(subscriptionId);
  const price = subscription.items?.data?.[0]?.price;
  await fireFulfillStripeSubscription({
    uid,
    stripeCustomerId: subscription.customer,
    subscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    invoiceId: subscription.latest_invoice,
    amount: price ? price.unit_amount / 100 : 0,
    currency: price ? price.currency : 'mxn'
  });
}

async function stripeWebhookHandler(req, res) {
  let event;
  try {
    event = constructStripeEvent(req.body, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.warn('[POST /api/webhooks/stripe] firma inválida:', e.message);
    return res.status(400).json({ error: 'invalid_signature' });
  }

  try {
    const obj = event.data.object;
    if (event.type === 'checkout.session.completed') {
      if (obj.mode === 'subscription' && obj.client_reference_id && obj.subscription) {
        await fulfillSubscription(obj.client_reference_id, obj.subscription);
      }
    } else if (event.type === 'invoice.paid') {
      if (obj.subscription) {
        const subscription = await stripeRetrieveSubscription(obj.subscription);
        const uid = subscription.metadata && subscription.metadata.firebaseUid;
        if (uid) await fulfillSubscription(uid, obj.subscription);
      }
    } else if (event.type === 'customer.subscription.updated') {
      const uid = obj.metadata && obj.metadata.firebaseUid;
      if (uid) await firePatchUserFields(uid, ['autoRenew'], { autoRenew: !obj.cancel_at_period_end });
    } else if (event.type === 'customer.subscription.deleted') {
      const uid = obj.metadata && obj.metadata.firebaseUid;
      if (uid) await firePatchUserFields(uid, ['autoRenew'], { autoRenew: false });
    }
    res.json({ received: true });
  } catch (e) {
    console.warn('[POST /api/webhooks/stripe] error procesando', event.type, ':', e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

// La firma del webhook se verifica sobre el body crudo — esta ruta se registra
// ANTES del express.json() global de abajo. Si json() corriera primero ya
// habría parseado/consumido el body y stripeWebhookHandler nunca podría
// verificar la firma contra los bytes exactos que Stripe firmó.
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json({ limit: '5mb' }));
```

Al final del archivo, junto a los demás `module.exports.X = X;`, agregar:
```js
module.exports.stripeWebhookHandler = stripeWebhookHandler;
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/stripeWebhook.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/stripeWebhook.test.js
git commit -m "feat(stripe): agrega POST /api/webhooks/stripe

Body crudo (express.raw montado antes del express.json global),
firma verificada con constructStripeEvent. Maneja
checkout.session.completed, invoice.paid, customer.subscription.updated
y customer.subscription.deleted."
```

---

### Task 4: `payMembershipHandler` real + `GET /api/me/membership/checkout-result`

**Files:**
- Modify: `api/index.js` (reemplaza el bloque `payMembershipHandler` actual, ~línea 1608-1618)
- Modify: `tests/payMembership.test.js` (reescribir completo — el actual testea la versión simulada)
- Create: `tests/checkoutResult.test.js`

**Interfaces:**
- Consumes: `stripeCreateCustomer`, `stripeCreateCheckoutSession`, `stripeRetrieveCheckoutSession` (Task 1), `fulfillSubscription` (Task 3, ya hoisted como function declaration).
- Produces: `payMembershipHandler` ahora responde `{ ok: true, checkoutUrl }`; nuevo `checkoutResultHandler` en `GET /api/me/membership/checkout-result?session_id=`.

- [ ] **Step 1: Reescribir `tests/payMembership.test.js` completo**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const stripeClientModule = requireFn('../api/stripeClient.js')

const fireGetUser = vi.fn()
const stripeCreateCustomer = vi.fn()
const stripeCreateCheckoutSession = vi.fn()
firestoreModule.fireGetUser = fireGetUser
stripeClientModule.stripeCreateCustomer = stripeCreateCustomer
stripeClientModule.stripeCreateCheckoutSession = stripeCreateCheckoutSession

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
    fireGetUser.mockReset()
    stripeCreateCustomer.mockReset()
    stripeCreateCheckoutSession.mockReset()
    process.env.STRIPE_PRICE_ID = 'price_test_1'
  })

  it('reuses an existing stripeCustomerId and creates a Checkout Session, returning checkoutUrl', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'pending', billing: { stripeCustomerId: 'cus_1' } })
    stripeCreateCheckoutSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' })
    const req = { user: { uid: 'uid-1', email: 'a@b.com' } }
    const res = makeRes()

    await payMembershipHandler(req, res)

    expect(stripeCreateCustomer).not.toHaveBeenCalled()
    expect(stripeCreateCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'cus_1', priceId: 'price_test_1', uid: 'uid-1'
    }))
    expect(res.body).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.com/cs_1' })
  })

  it('creates a Stripe customer first when the user has no stripeCustomerId yet', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'pending', billing: { stripeCustomerId: null } })
    stripeCreateCustomer.mockResolvedValue({ id: 'cus_new' })
    stripeCreateCheckoutSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' })
    const req = { user: { uid: 'uid-1', email: 'a@b.com' } }
    const res = makeRes()

    await payMembershipHandler(req, res)

    expect(stripeCreateCustomer).toHaveBeenCalledWith({ email: 'a@b.com', uid: 'uid-1' })
    expect(stripeCreateCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_new' }))
  })

  it('responds 404 when the user does not exist', async () => {
    fireGetUser.mockResolvedValue(null)
    const req = { user: { uid: 'uid-missing' } }
    const res = makeRes()

    await payMembershipHandler(req, res)

    expect(res.statusCode).toBe(404)
  })

  it('responds 500 internal_error when Stripe fails', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'pending', billing: {} })
    stripeCreateCustomer.mockRejectedValue(new Error('boom'))
    const req = { user: { uid: 'uid-2', email: 'a@b.com' } }
    const res = makeRes()

    await payMembershipHandler(req, res)

    expect(res.statusCode).toBe(500)
  })
})
```

- [ ] **Step 2: Crear `tests/checkoutResult.test.js`**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const stripeClientModule = requireFn('../api/stripeClient.js')

const fireGetUser = vi.fn()
const fireGetUserRaw = vi.fn()
const firePatchUserFieldsWithPrecondition = vi.fn()
const stripeRetrieveCheckoutSession = vi.fn()
const stripeRetrieveSubscription = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.fireGetUserRaw = fireGetUserRaw
firestoreModule.firePatchUserFieldsWithPrecondition = firePatchUserFieldsWithPrecondition
stripeClientModule.stripeRetrieveCheckoutSession = stripeRetrieveCheckoutSession
stripeClientModule.stripeRetrieveSubscription = stripeRetrieveSubscription

const { checkoutResultHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('checkoutResultHandler', () => {
  beforeEach(() => {
    fireGetUser.mockReset(); fireGetUserRaw.mockReset(); firePatchUserFieldsWithPrecondition.mockReset()
    stripeRetrieveCheckoutSession.mockReset(); stripeRetrieveSubscription.mockReset()
  })

  it('fulfills the subscription and returns the updated membership status', async () => {
    stripeRetrieveCheckoutSession.mockResolvedValue({
      client_reference_id: 'uid-1', payment_status: 'paid', subscription: 'sub_1'
    })
    stripeRetrieveSubscription.mockResolvedValue({
      id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1785400000,
      cancel_at_period_end: false, latest_invoice: 'in_1',
      items: { data: [{ price: { unit_amount: 2990, currency: 'mxn' } }] }
    })
    fireGetUserRaw.mockResolvedValue({ fields: { membershipStatus: 'pending' }, updateTime: '2026-07-29T10:00:00.000000Z' })
    firePatchUserFieldsWithPrecondition.mockResolvedValue({ ok: true })
    fireGetUser.mockResolvedValue({ membershipStatus: 'active', membershipExpiresAt: '2026-08-29T00:00:00.000Z' })

    const req = { user: { uid: 'uid-1' }, query: { session_id: 'cs_1' } }
    const res = makeRes()

    await checkoutResultHandler(req, res)

    expect(res.body).toEqual({ ok: true, membershipStatus: 'active', membershipExpiresAt: '2026-08-29T00:00:00.000Z' })
  })

  it('responds 403 when the session does not belong to the requesting user', async () => {
    stripeRetrieveCheckoutSession.mockResolvedValue({ client_reference_id: 'uid-OTHER', payment_status: 'paid', subscription: 'sub_1' })
    const req = { user: { uid: 'uid-1' }, query: { session_id: 'cs_1' } }
    const res = makeRes()

    await checkoutResultHandler(req, res)

    expect(res.statusCode).toBe(403)
    expect(stripeRetrieveSubscription).not.toHaveBeenCalled()
  })

  it('responds 409 when the session payment is not completed yet', async () => {
    stripeRetrieveCheckoutSession.mockResolvedValue({ client_reference_id: 'uid-1', payment_status: 'unpaid', subscription: 'sub_1' })
    const req = { user: { uid: 'uid-1' }, query: { session_id: 'cs_1' } }
    const res = makeRes()

    await checkoutResultHandler(req, res)

    expect(res.statusCode).toBe(409)
  })

  it('responds 400 when session_id is missing', async () => {
    const req = { user: { uid: 'uid-1' }, query: {} }
    const res = makeRes()

    await checkoutResultHandler(req, res)

    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 3: Correr ambos tests y verificar que fallan**

Run: `npx vitest run tests/payMembership.test.js tests/checkoutResult.test.js`
Expected: FAIL — `payMembershipHandler` sigue llamando `fireRecordMembershipPayment` (ya no existe) y `checkoutResultHandler` no existe.

- [ ] **Step 4: Reemplazar el handler en `api/index.js`**

Reemplazar el bloque actual (~línea 1608-1618):
```js
async function payMembershipHandler(req, res) {
  try {
    const result = await fireRecordMembershipPayment(req.user.uid);
    res.json({ ok: true, membershipStatus: result.membershipStatus, membershipExpiresAt: result.membershipExpiresAt });
  } catch (e) {
    console.warn('[POST \api\me\membership\pay] Firestore error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.post('/api/me/membership/pay', requireUser, payMembershipHandler);
```
por:
```js
async function payMembershipHandler(req, res) {
  try {
    const user = await fireGetUser(req.user.uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    let stripeCustomerId = user.billing && user.billing.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripeCreateCustomer({ email: req.user.email, uid: req.user.uid });
      stripeCustomerId = customer.id;
    }

    const baseUrl = process.env.APP_BASE_URL || 'https://yomi.mx';
    const session = await stripeCreateCheckoutSession({
      customerId: stripeCustomerId,
      priceId: process.env.STRIPE_PRICE_ID,
      uid: req.user.uid,
      successUrl: `${baseUrl}/account.html?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/account.html?stripe=cancel`
    });

    res.json({ ok: true, checkoutUrl: session.url });
  } catch (e) {
    console.warn('[POST /api/me/membership/pay] error creando checkout, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.post('/api/me/membership/pay', requireUser, payMembershipHandler);

async function checkoutResultHandler(req, res) {
  const sessionId = req.query.session_id;
  if (typeof sessionId !== 'string' || !sessionId) return res.status(400).json({ error: 'invalid_request' });

  try {
    const session = await stripeRetrieveCheckoutSession(sessionId);
    if (session.client_reference_id !== req.user.uid) return res.status(403).json({ error: 'forbidden' });
    if (session.payment_status !== 'paid' || !session.subscription) {
      return res.status(409).json({ error: 'payment_not_completed' });
    }

    await fulfillSubscription(req.user.uid, session.subscription);
    const user = await fireGetUser(req.user.uid);
    res.json({ ok: true, membershipStatus: user.membershipStatus, membershipExpiresAt: user.membershipExpiresAt });
  } catch (e) {
    console.warn('[GET /api/me/membership/checkout-result] error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.get('/api/me/membership/checkout-result', requireUser, checkoutResultHandler);
```

Junto a los demás `module.exports.X = X;`, agregar:
```js
module.exports.checkoutResultHandler = checkoutResultHandler;
```

- [ ] **Step 5: Correr ambos tests y verificar que pasan**

Run: `npx vitest run tests/payMembership.test.js tests/checkoutResult.test.js`
Expected: PASS (8 tests en total)

- [ ] **Step 6: Commit**

```bash
git add api/index.js tests/payMembership.test.js tests/checkoutResult.test.js
git commit -m "feat(stripe): payMembershipHandler crea Checkout Session real

Ya no activa membresía sincrono -- responde { checkoutUrl } y el
fulfillment ocurre por webhook o por GET
/api/me/membership/checkout-result al volver de Stripe (idempotente,
mismo camino que usa el webhook)."
```

---

### Task 5: `cancel`/`reactivate` llaman a Stripe

**Files:**
- Modify: `api/index.js` (~línea 1620-1648)
- Modify: `tests/membershipCancel.test.js` (reescribir completo)

**Interfaces:**
- Consumes: `stripeUpdateSubscription` (Task 1).

- [ ] **Step 1: Reescribir `tests/membershipCancel.test.js` completo**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const stripeClientModule = requireFn('../api/stripeClient.js')
const fireGetUser = vi.fn()
const firePatchUserFields = vi.fn()
const stripeUpdateSubscription = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.firePatchUserFields = firePatchUserFields
stripeClientModule.stripeUpdateSubscription = stripeUpdateSubscription

const { cancelMembershipHandler, reactivateMembershipHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('cancelMembershipHandler', () => {
  beforeEach(() => { fireGetUser.mockReset(); firePatchUserFields.mockReset(); stripeUpdateSubscription.mockReset() })

  it('sets autoRenew false for an active membership', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'active' })
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await cancelMembershipHandler(req, res)

    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['autoRenew'], { autoRenew: false })
    expect(res.body).toEqual({ ok: true, autoRenew: false })
  })

  it('calls Stripe to set cancel_at_period_end when the user has a subscriptionId', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'active', billing: { subscriptionId: 'sub_1' } })
    firePatchUserFields.mockResolvedValue(true)
    stripeUpdateSubscription.mockResolvedValue({ id: 'sub_1', cancel_at_period_end: true })
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await cancelMembershipHandler(req, res)

    expect(stripeUpdateSubscription).toHaveBeenCalledWith('sub_1', { cancelAtPeriodEnd: true })
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
  beforeEach(() => { fireGetUser.mockReset(); firePatchUserFields.mockReset(); stripeUpdateSubscription.mockReset() })

  it('sets autoRenew true for an active membership', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'active' })
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await reactivateMembershipHandler(req, res)

    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['autoRenew'], { autoRenew: true })
    expect(res.body).toEqual({ ok: true, autoRenew: true })
  })

  it('calls Stripe to unset cancel_at_period_end when the user has a subscriptionId', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'active', billing: { subscriptionId: 'sub_1' } })
    firePatchUserFields.mockResolvedValue(true)
    stripeUpdateSubscription.mockResolvedValue({ id: 'sub_1', cancel_at_period_end: false })
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await reactivateMembershipHandler(req, res)

    expect(stripeUpdateSubscription).toHaveBeenCalledWith('sub_1', { cancelAtPeriodEnd: false })
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

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/membershipCancel.test.js`
Expected: FAIL — los 2 tests nuevos de `stripeUpdateSubscription` fallan (nunca se llama).

- [ ] **Step 3: Actualizar los handlers en `api/index.js`**

Reemplazar el bloque actual (~línea 1620-1648):
```js
async function cancelMembershipHandler(req, res) {
  try {
    const user = await fireGetUser(req.user.uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    if (user.membershipStatus !== 'active') return res.status(409).json({ error: 'not_active' });
    await firePatchUserFields(req.user.uid, ['autoRenew'], { autoRenew: false });
    res.json({ ok: true, autoRenew: false });
  } catch (e) {
    console.warn('[POST \api\me\membership\cancel] Firestore error, uid:', req.user?.uid, e.message);
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
    console.warn('[POST \api\me\membership\reactivate] Firestore error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.post('/api/me/membership/reactivate', requireUser, reactivateMembershipHandler);
```
por:
```js
async function cancelMembershipHandler(req, res) {
  try {
    const user = await fireGetUser(req.user.uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    if (user.membershipStatus !== 'active') return res.status(409).json({ error: 'not_active' });

    const subscriptionId = user.billing && user.billing.subscriptionId;
    if (subscriptionId) {
      await stripeUpdateSubscription(subscriptionId, { cancelAtPeriodEnd: true });
    }
    await firePatchUserFields(req.user.uid, ['autoRenew'], { autoRenew: false });
    res.json({ ok: true, autoRenew: false });
  } catch (e) {
    console.warn('[POST /api/me/membership/cancel] error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.post('/api/me/membership/cancel', requireUser, cancelMembershipHandler);

async function reactivateMembershipHandler(req, res) {
  try {
    const user = await fireGetUser(req.user.uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    if (user.membershipStatus !== 'active') return res.status(409).json({ error: 'not_active' });

    const subscriptionId = user.billing && user.billing.subscriptionId;
    if (subscriptionId) {
      await stripeUpdateSubscription(subscriptionId, { cancelAtPeriodEnd: false });
    }
    await firePatchUserFields(req.user.uid, ['autoRenew'], { autoRenew: true });
    res.json({ ok: true, autoRenew: true });
  } catch (e) {
    console.warn('[POST /api/me/membership/reactivate] error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.post('/api/me/membership/reactivate', requireUser, reactivateMembershipHandler);
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/membershipCancel.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Correr toda la suite de `api/`**

Run: `npx vitest run tests/stripeClient.test.js tests/firestore-stripe-fulfillment.test.js tests/stripeWebhook.test.js tests/payMembership.test.js tests/checkoutResult.test.js tests/membershipCancel.test.js`
Expected: PASS (todo)

- [ ] **Step 6: Commit**

```bash
git add api/index.js tests/membershipCancel.test.js
git commit -m "feat(stripe): cancel/reactivate llaman a Stripe antes de Firestore

stripe.subscriptions.update(cancel_at_period_end) via stripeUpdateSubscription
cuando el usuario ya tiene billing.subscriptionId real; cuentas
activas de antes de Stripe (sin subscriptionId) siguen igual que hoy."
```

---

### Task 6: `account-ui.js` — redirect a Checkout + retorno de Stripe

**Files:**
- Modify: `account-ui.js`
- Modify: `tests/account-ui.test.js` (reescribir el describe `handleRenewMembership`)
- Create: `tests/account-stripe-return.test.js`

**Interfaces:**
- Produces: `handleStripeReturn()` exportada (nueva), `handleRenewMembership()` cambia de comportamiento.

- [ ] **Step 1: Actualizar el describe `handleRenewMembership` en `tests/account-ui.test.js`**

Reemplazar el primer test del bloque (líneas 250-261):
```js
  it('calls POST /api/me/membership/pay and re-renders after syncing the profile', async () => {
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    document.body.innerHTML = '<div id="account-root"></div><button id="btn-renew-membership"></button>'

    await handleRenewMembership()

    expect(global.fetch).toHaveBeenCalledWith('/api/me/membership/pay', expect.objectContaining({ method: 'POST' }))
    expect(syncUserProfile).toHaveBeenCalled()
  })
```
por:
```js
  it('calls POST /api/me/membership/pay and redirects to the returned checkoutUrl', async () => {
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, checkoutUrl: 'https://checkout.stripe.com/cs_1' }) })
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    document.body.innerHTML = '<div id="account-root"></div><button id="btn-renew-membership"></button>'

    await handleRenewMembership()

    expect(global.fetch).toHaveBeenCalledWith('/api/me/membership/pay', expect.objectContaining({ method: 'POST' }))
    expect(window.location.href).toBe('https://checkout.stripe.com/cs_1')
  })
```
Los otros dos tests del describe (líneas 263-289, los de error) se quedan igual — siguen siendo válidos, el manejo de error no cambió.

- [ ] **Step 2: Crear `tests/account-stripe-return.test.js`**

```js
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getIdToken = vi.fn()
const syncUserProfile = vi.fn()
const getCachedProfile = vi.fn()
vi.mock('../authClient.js', () => ({ getIdToken, syncUserProfile, getCachedProfile }))

let handleStripeReturn

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  sessionStorage.clear()
  getIdToken.mockResolvedValue('tok')
  window.history.replaceState({}, '', '/account.html')
  const mod = await import('../account-ui.js')
  handleStripeReturn = mod.handleStripeReturn
})

it('does nothing when there is no ?stripe= param', async () => {
  window.history.replaceState({}, '', '/account.html')
  global.fetch = vi.fn()

  await handleStripeReturn()

  expect(global.fetch).not.toHaveBeenCalled()
})

it('on stripe=success, confirms the checkout session', async () => {
  window.history.replaceState({}, '', '/account.html?stripe=success&session_id=cs_1')
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

  await handleStripeReturn()

  expect(global.fetch).toHaveBeenCalledWith(
    '/api/me/membership/checkout-result?session_id=cs_1',
    expect.objectContaining({ headers: { Authorization: 'Bearer tok' } })
  )
  expect(window.location.search).toBe('')
})

it('flushes pending preferences from sessionStorage after a confirmed checkout', async () => {
  window.history.replaceState({}, '', '/account.html?stripe=success&session_id=cs_1')
  sessionStorage.setItem('yomi_pending_preferences', JSON.stringify({ dietary: ['vegan'] }))
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

  await handleStripeReturn()

  const preferencesCall = global.fetch.mock.calls.find(([url]) => url === '/api/me/preferences')
  expect(preferencesCall).toBeTruthy()
  expect(preferencesCall[1].method).toBe('PUT')
  expect(sessionStorage.getItem('yomi_pending_preferences')).toBeNull()
})

it('on stripe=cancel, does not call the API and still cleans the URL', async () => {
  window.history.replaceState({}, '', '/account.html?stripe=cancel')
  global.fetch = vi.fn()

  await handleStripeReturn()

  expect(global.fetch).not.toHaveBeenCalled()
  expect(window.location.search).toBe('')
})
```

- [ ] **Step 3: Correr ambos tests y verificar que fallan**

Run: `npx vitest run tests/account-ui.test.js tests/account-stripe-return.test.js`
Expected: FAIL — `handleStripeReturn` no existe, `handleRenewMembership` sigue llamando `syncUserProfile`.

- [ ] **Step 4: Editar `account-ui.js`**

Línea 5, actualizar el import de toast:
```js
import { showPendingToast, showToast } from './toast.js';
```

Reemplazar `handleRenewMembership` (líneas 524-542):
```js
export async function handleRenewMembership() {
  const btn = document.getElementById('btn-renew-membership');
  const originalText = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Procesando…'; }
  try {
    const token = await getIdToken();
    const res = await fetch('/api/me/membership/pay', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error('renew_failed');
    }
    const data = await res.json();
    window.location.href = data.checkoutUrl;
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    showRenewError('No se pudo procesar el pago. Intenta de nuevo.');
    console.warn('[account] no se pudo iniciar el pago de membresía:', err.message);
    throw err;
  }
}
```

Agregar (por ejemplo justo antes de `export async function submitCancelSubscription`, línea ~768) las funciones nuevas:
```js
const ONBOARDING_PREFS_KEY = 'yomi_pending_preferences';

async function flushPendingPreferences(token) {
  const pendingPrefs = sessionStorage.getItem(ONBOARDING_PREFS_KEY);
  if (!pendingPrefs) return;
  try {
    await fetch('/api/me/preferences', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: pendingPrefs
    });
  } catch (e) {
    console.warn('[account] no se pudieron guardar preferencias pendientes:', e.message);
  }
  sessionStorage.removeItem(ONBOARDING_PREFS_KEY);
}

export async function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  const stripeParam = params.get('stripe');
  if (!stripeParam) return;

  if (stripeParam === 'success') {
    const sessionId = params.get('session_id');
    if (sessionId) {
      try {
        const token = await getIdToken();
        const res = await fetch(`/api/me/membership/checkout-result?session_id=${encodeURIComponent(sessionId)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          await flushPendingPreferences(token);
          showToast('¡Pago confirmado! Tu membresía está activa.');
        } else {
          showToast('Pago recibido, confirmando con Stripe…');
        }
      } catch (err) {
        console.warn('[account] no se pudo confirmar el checkout de Stripe:', err.message);
      }
    }
  } else if (stripeParam === 'cancel') {
    showToast('Pago cancelado.');
  }

  params.delete('stripe');
  params.delete('session_id');
  const newQuery = params.toString();
  const newUrl = window.location.pathname + (newQuery ? `?${newQuery}` : '') + window.location.hash;
  window.history.replaceState({}, '', newUrl);
}
```

Actualizar `initAccountPage` (línea ~813):
```js
export async function initAccountPage() {
  await handleStripeReturn();
  await syncUserProfile();
  renderAccountHub();
  showPendingToast();
}
```

- [ ] **Step 5: Correr ambos tests y verificar que pasan**

Run: `npx vitest run tests/account-ui.test.js tests/account-stripe-return.test.js`
Expected: PASS (toda la suite de `account-ui.test.js` + los 4 tests nuevos)

- [ ] **Step 6: Commit**

```bash
git add account-ui.js tests/account-ui.test.js tests/account-stripe-return.test.js
git commit -m "feat(stripe): account-ui.js redirige a Checkout y maneja el retorno

handleRenewMembership ahora navega a checkoutUrl en vez de asumir
exito sincrono. Nueva handleStripeReturn() confirma el pago al volver
de Stripe (?stripe=success|cancel) y absorbe el flush de preferencias
pendientes que antes vivia en onboarding-membership-ui.js."
```

---

### Task 7: `onboarding-membership-ui.js` — simplificar al redirect

**Files:**
- Modify: `onboarding-membership-ui.js`
- Modify: `tests/onboarding-membership-ui.test.js` (reescribir completo)

**Interfaces:**
- Consumes: nada nuevo (solo `getIdToken`).

- [ ] **Step 1: Reescribir `tests/onboarding-membership-ui.test.js` completo**

```js
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getIdToken = vi.fn()
vi.mock('../authClient.js', () => ({ getIdToken }))

let confirmMembershipPayment

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  document.body.innerHTML = `
    <input type="checkbox" id="pay-checkbox">
    <button id="btn-confirm-payment">Confirmar pago</button>
    <p id="membership-error" class="hidden"></p>
  `
  const mod = await import('../onboarding-membership-ui.js')
  confirmMembershipPayment = mod.confirmMembershipPayment
  getIdToken.mockResolvedValue('tok')
  delete window.location
  window.location = { href: '' }
})

it('requires the checkbox to be checked before calling the pay endpoint', async () => {
  document.getElementById('pay-checkbox').checked = false
  global.fetch = vi.fn()

  await expect(confirmMembershipPayment()).rejects.toThrow()

  expect(global.fetch).not.toHaveBeenCalled()
})

it('calls POST /api/me/membership/pay and redirects to the returned checkoutUrl', async () => {
  document.getElementById('pay-checkbox').checked = true
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, checkoutUrl: 'https://checkout.stripe.com/cs_1' }) })

  await confirmMembershipPayment()

  expect(global.fetch).toHaveBeenCalledWith('/api/me/membership/pay', expect.objectContaining({ method: 'POST' }))
  expect(window.location.href).toBe('https://checkout.stripe.com/cs_1')
})

it('shows an error and re-enables the button when the pay call fails', async () => {
  document.getElementById('pay-checkbox').checked = true
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })

  await expect(confirmMembershipPayment()).rejects.toThrow()

  const btn = document.getElementById('btn-confirm-payment')
  expect(btn.disabled).toBe(false)
  expect(btn.textContent).toBe('Confirmar pago')
  expect(document.getElementById('membership-error').classList.contains('hidden')).toBe(false)
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/onboarding-membership-ui.test.js`
Expected: FAIL — `window.location.href` sigue siendo `'index.html'`, no la URL de Stripe.

- [ ] **Step 3: Reescribir `onboarding-membership-ui.js` completo**

```js
import { getIdToken } from './authClient.js';

function showError(message) {
  const el = document.getElementById('membership-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function confirmMembershipPayment() {
  const checkbox = document.getElementById('pay-checkbox');
  if (!checkbox?.checked) {
    showError('Marca la casilla para continuar.');
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
      showError('No se pudo iniciar el pago. Intenta de nuevo.');
      throw new Error('pay_failed');
    }
    const data = await res.json();
    window.location.href = data.checkoutUrl;
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar pago'; }
    throw err;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-confirm-payment')?.addEventListener('click', () => {
    confirmMembershipPayment().catch(() => {});
  });
});
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/onboarding-membership-ui.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Correr TODA la suite del proyecto**

Run: `npx vitest run`
Expected: PASS — todo verde. Si algo más referencia `fireRecordMembershipPayment` o el shape viejo de `payMembershipHandler`, aparecerá aquí.

- [ ] **Step 6: Commit**

```bash
git add onboarding-membership-ui.js tests/onboarding-membership-ui.test.js
git commit -m "feat(stripe): onboarding redirige a Checkout en vez de asumir pago sincrono

Quita el flush de preferencias y el redirect a index.html de aqui --
ahora vive en account-ui.js:handleStripeReturn, porque requiere
membresia ya activa (requireActiveMembership), algo que ya no es
cierto en el momento en que este archivo llamaba a /api/me/preferences."
```

---

### Task 8 (manual, no código): Deploy + webhook de Stripe + verificación end-to-end

Esta tarea no tiene tests automatizados — es configuración externa que solo se puede hacer contra un deploy real.

- [ ] **Step 1: Deploy a preview**

```bash
vercel deploy
```

Anota la URL de preview que imprime (ej. `https://foodscaner-git-develop-....vercel.app`).

- [ ] **Step 2: Crear el webhook endpoint en Stripe Dashboard (modo test)**

En https://dashboard.stripe.com/test/webhooks → "Add endpoint":
- URL: `https://<url-de-preview>/api/webhooks/stripe`
- Eventos a escuchar: `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`
- Copiar el "Signing secret" (`whsec_...`) que Stripe muestra tras crearlo.

- [ ] **Step 3: Agregar `STRIPE_WEBHOOK_SECRET` a Vercel (preview)**

```bash
echo "whsec_..." | vercel env add STRIPE_WEBHOOK_SECRET preview
vercel env pull .env.local --yes
```

- [ ] **Step 4: Re-deploy para que tome la env var nueva**

```bash
vercel deploy
```

- [ ] **Step 5: Verificar end-to-end en modo test**

1. Ir a la URL de preview, crear/usar una cuenta con membresía `pending` o `expired`.
2. Click en "Activar membresía" / "Renovar membresía" → debe redirigir a `checkout.stripe.com`.
3. Pagar con tarjeta de prueba `4242 4242 4242 4242`, fecha futura cualquiera, CVC cualquiera.
4. Debe volver a `account.html?stripe=success&session_id=...`, mostrar el toast de confirmación, y la cuenta debe verse `active` con el bloque "Suscripción" mostrando "Se renovará automáticamente el...".
5. En Stripe Dashboard → Webhooks → el endpoint → confirmar que `checkout.session.completed` se entregó con `200`.
6. Probar "Cancelar suscripción" en la UI → confirmar en Stripe Dashboard que la subscription queda con `Cancel at period end: Yes`.
7. Probar "Reactivar suscripción" → confirmar que vuelve a `No`.
8. Opcional: en Stripe Dashboard, usar "Send test webhook" sobre `invoice.paid` apuntando a una subscription de prueba, confirmar que `paymentHistory` gana una entrada nueva sin duplicar la anterior.

- [ ] **Step 6: Repetir Steps 2-3 para producción cuando esté listo**

Mismo procedimiento, pero con el webhook endpoint apuntando a `https://www.yomi.mx/api/webhooks/stripe` y `vercel env add STRIPE_WEBHOOK_SECRET production`. Hacer esto solo después de reclamar el sandbox (`vercel integration resource claim stripe-champagne-yacht`) y completar el onboarding de Stripe con datos reales del negocio (RFC, cuenta bancaria) — mientras el sandbox siga sin reclamar, todo permanece en modo test sin cobrar dinero real.
