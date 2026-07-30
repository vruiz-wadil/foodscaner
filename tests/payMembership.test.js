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
