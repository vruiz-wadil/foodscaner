import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const stripeClientModule = requireFn('../api/stripeClient.js')

const fireGetUser = vi.fn()
// fireFulfillStripeSubscription is mocked directly rather than its internal
// dependencies (fireGetUserRaw / firePatchUserFieldsWithPrecondition):
// api/firestore.js calls those as bare local identifiers within its own
// module scope, so overwriting the firestoreModule export properties has no
// effect on them (only on callers outside firestore.js, like api/index.js,
// which destructures fresh after this swap runs). fireFulfillStripeSubscription
// itself IS destructured by api/index.js (inside fulfillSubscription), so
// mocking it here works. Same pattern as tests/stripeWebhook.test.js and
// tests/membershipCancel.test.js.
const fireFulfillStripeSubscription = vi.fn()
const stripeRetrieveCheckoutSession = vi.fn()
const stripeRetrieveSubscription = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.fireFulfillStripeSubscription = fireFulfillStripeSubscription
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
    fireGetUser.mockReset(); fireFulfillStripeSubscription.mockReset()
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
    fireFulfillStripeSubscription.mockResolvedValue({ membershipStatus: 'active' })
    fireGetUser.mockResolvedValue({ membershipStatus: 'active', membershipExpiresAt: '2026-08-29T00:00:00.000Z' })

    const req = { user: { uid: 'uid-1' }, query: { session_id: 'cs_1' } }
    const res = makeRes()

    await checkoutResultHandler(req, res)

    expect(fireFulfillStripeSubscription).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'uid-1', stripeCustomerId: 'cus_1', subscriptionId: 'sub_1', subscriptionStatus: 'active'
    }))
    expect(fireGetUser).toHaveBeenCalledWith('uid-1')
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
