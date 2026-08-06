import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const stripeClientModule = requireFn('../api/stripeClient.js')

const fireGetUser = vi.fn()
const firePatchUserFields = vi.fn()
const stripeCreateCustomer = vi.fn()
const stripeCreateCheckoutSession = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.firePatchUserFields = firePatchUserFields
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
    firePatchUserFields.mockReset()
    firePatchUserFields.mockResolvedValue(true)
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
    expect(firePatchUserFields).not.toHaveBeenCalled()
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

  it('persists the new stripeCustomerId before creating the Checkout Session', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'pending', billing: { stripeCustomerId: null } })
    stripeCreateCustomer.mockResolvedValue({ id: 'cus_new' })
    stripeCreateCheckoutSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' })
    const req = { user: { uid: 'uid-1', email: 'a@b.com' } }

    await payMembershipHandler(req, makeRes())

    // Sin esto, abandonar el checkout deja huérfano el Customer y el siguiente
    // intento crea uno duplicado en Stripe.
    expect(firePatchUserFields).toHaveBeenCalledWith(
      'uid-1', ['billing.stripeCustomerId'], { billing: { stripeCustomerId: 'cus_new' } }
    )
    expect(firePatchUserFields.mock.invocationCallOrder[0])
      .toBeLessThan(stripeCreateCheckoutSession.mock.invocationCallOrder[0])
  })

  it('responds 409 already_active when the user already has a live subscription', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'active', billing: { stripeCustomerId: 'cus_1', subscriptionId: 'sub_1' } })
    const req = { user: { uid: 'uid-1', email: 'a@b.com' } }
    const res = makeRes()

    await payMembershipHandler(req, res)

    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'already_active' })
    expect(stripeCreateCustomer).not.toHaveBeenCalled()
    expect(stripeCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('allows a new checkout when the user is active but has no subscriptionId', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'active', billing: { stripeCustomerId: 'cus_1' } })
    stripeCreateCheckoutSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' })
    const req = { user: { uid: 'uid-1', email: 'a@b.com' } }
    const res = makeRes()

    await payMembershipHandler(req, res)

    expect(res.statusCode).toBe(200)
    expect(stripeCreateCheckoutSession).toHaveBeenCalled()
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
