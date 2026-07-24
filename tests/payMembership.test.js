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
