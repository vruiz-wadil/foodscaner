import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

const {
  stripeCreateCustomer, stripeCreateCheckoutSession, stripeRetrieveCheckoutSession,
  stripeRetrieveSubscription, stripeUpdateSubscription, stripeCancelSubscriptionNow, constructStripeEvent
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

  it('pins the Stripe-Version header on every request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'sub_1' }) })
    vi.stubGlobal('fetch', fetchMock)

    await stripeRetrieveSubscription('sub_1')
    await stripeCreateCustomer({ email: 'a@b.com', uid: 'uid-1' })

    for (const [, opts] of fetchMock.mock.calls) {
      expect(opts.headers['Stripe-Version']).toBe('2026-06-24.dahlia')
    }
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

  it('stripeCancelSubscriptionNow sends a DELETE to /v1/subscriptions/{id}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'sub_1', status: 'canceled' }) })
    vi.stubGlobal('fetch', fetchMock)

    const result = await stripeCancelSubscriptionNow('sub_1')

    expect(result).toEqual({ id: 'sub_1', status: 'canceled' })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.stripe.com/v1/subscriptions/sub_1')
    expect(opts.method).toBe('DELETE')
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
