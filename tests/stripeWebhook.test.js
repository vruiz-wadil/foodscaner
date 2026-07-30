import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const stripeClientModule = requireFn('../api/stripeClient.js')

// fireFulfillStripeSubscription is mocked directly rather than its internal
// dependencies (fireGetUserRaw / firePatchUserFieldsWithPrecondition):
// api/firestore.js calls those as bare local identifiers within its own
// module scope, so overwriting the firestoreModule export properties has no
// effect on them (only on callers outside firestore.js, like api/index.js,
// which destructures fresh after this swap runs). fireFulfillStripeSubscription
// itself IS destructured by api/index.js, so mocking it here works.
const fireFulfillStripeSubscription = vi.fn()
const firePatchUserFields = vi.fn()
const constructStripeEvent = vi.fn()
const stripeRetrieveSubscription = vi.fn()
firestoreModule.fireFulfillStripeSubscription = fireFulfillStripeSubscription
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
    fireFulfillStripeSubscription.mockReset(); firePatchUserFields.mockReset()
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
    fireFulfillStripeSubscription.mockResolvedValue({ membershipStatus: 'active' })
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(fireFulfillStripeSubscription).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'uid-1', stripeCustomerId: 'cus_1', subscriptionId: 'sub_1', subscriptionStatus: 'active',
      cancelAtPeriodEnd: false, invoiceId: 'in_1', amount: 29.9, currency: 'mxn'
    }))
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
    fireFulfillStripeSubscription.mockResolvedValue({ membershipStatus: 'active' })
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(fireFulfillStripeSubscription).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'uid-1', subscriptionId: 'sub_1', invoiceId: 'in_2'
    }))
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
