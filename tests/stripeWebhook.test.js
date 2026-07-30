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
    // Forma real post-"basil": current_period_end vive en el subscription item,
    // no en la raíz del Subscription.
    stripeRetrieveSubscription.mockResolvedValue({
      id: 'sub_1', customer: 'cus_1', status: 'active',
      cancel_at_period_end: false, latest_invoice: 'in_1',
      items: { data: [{ current_period_end: 1785400000, price: { unit_amount: 2990, currency: 'mxn' } }] }
    })
    fireFulfillStripeSubscription.mockResolvedValue({ membershipStatus: 'active' })
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(fireFulfillStripeSubscription).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'uid-1', stripeCustomerId: 'cus_1', subscriptionId: 'sub_1', subscriptionStatus: 'active',
      currentPeriodEnd: new Date(1785400000 * 1000).toISOString(),
      cancelAtPeriodEnd: false, invoiceId: 'in_1', amount: 29.9, currency: 'mxn'
    }))
    expect(res.body).toEqual({ received: true })
  })

  it('responds 500 when the subscription item has no current_period_end', async () => {
    constructStripeEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', client_reference_id: 'uid-1', subscription: 'sub_1' } }
    })
    stripeRetrieveSubscription.mockResolvedValue({
      id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, latest_invoice: 'in_1',
      items: { data: [{ price: { unit_amount: 2990, currency: 'mxn' } }] }
    })
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(fireFulfillStripeSubscription).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(500)
  })

  it('fulfills the subscription on invoice.paid using the subscription metadata for the uid', async () => {
    // Post-"basil" la invoice ya no trae `subscription` en la raíz: viene en
    // parent.subscription_details.subscription.
    constructStripeEvent.mockReturnValue({
      type: 'invoice.paid',
      data: { object: { parent: { subscription_details: { subscription: 'sub_1' } } } }
    })
    stripeRetrieveSubscription.mockResolvedValue({
      id: 'sub_1', customer: 'cus_1', status: 'active',
      cancel_at_period_end: false, latest_invoice: 'in_2', metadata: { firebaseUid: 'uid-1' },
      items: { data: [{ current_period_end: 1785400000, price: { unit_amount: 2990, currency: 'mxn' } }] }
    })
    fireFulfillStripeSubscription.mockResolvedValue({ membershipStatus: 'active' })
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(stripeRetrieveSubscription).toHaveBeenCalledWith('sub_1')
    expect(fireFulfillStripeSubscription).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'uid-1', subscriptionId: 'sub_1', invoiceId: 'in_2'
    }))
  })

  it('ignores an invoice.paid with no subscription in parent.subscription_details', async () => {
    constructStripeEvent.mockReturnValue({
      type: 'invoice.paid',
      data: { object: { parent: { subscription_details: {} } } }
    })
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(stripeRetrieveSubscription).not.toHaveBeenCalled()
    expect(res.body).toEqual({ received: true })
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
