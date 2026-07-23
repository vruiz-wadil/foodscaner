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
