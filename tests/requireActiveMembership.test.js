import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const fireGetUser = vi.fn()
const firePatchUserFields = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.firePatchUserFields = firePatchUserFields

const { requireActiveMembership } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('requireActiveMembership', () => {
  beforeEach(() => {
    fireGetUser.mockReset()
    firePatchUserFields.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T12:00:00Z'))
  })

  it('responds 404 when the user document does not exist', async () => {
    fireGetUser.mockResolvedValue(null)
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()
    const next = vi.fn()
    await requireActiveMembership(req, res, next)
    expect(res.statusCode).toBe(404)
    expect(next).not.toHaveBeenCalled()
  })

  it('responds 402 membership_required when membershipStatus is "pending"', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'pending' })
    const req = { user: { uid: 'uid-2' } }
    const res = makeRes()
    const next = vi.fn()
    await requireActiveMembership(req, res, next)
    expect(res.statusCode).toBe(402)
    expect(res.body).toEqual({ error: 'membership_required' })
    expect(next).not.toHaveBeenCalled()
  })

  it('responds 402 membership_expired when membershipStatus is already "expired"', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'expired' })
    const req = { user: { uid: 'uid-3' } }
    const res = makeRes()
    const next = vi.fn()
    await requireActiveMembership(req, res, next)
    expect(res.statusCode).toBe(402)
    expect(res.body).toEqual({ error: 'membership_expired' })
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('calls next() and attaches req.membershipUser when active and not yet expired', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'active', membershipExpiresAt: '2026-08-01T00:00:00.000Z' })
    const req = { user: { uid: 'uid-4' } }
    const res = makeRes()
    const next = vi.fn()
    await requireActiveMembership(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(req.membershipUser).toEqual({ membershipStatus: 'active', membershipExpiresAt: '2026-08-01T00:00:00.000Z' })
    expect(res.body).toBeNull()
  })

  it('flips to expired and responds 402 (chequeo perezoso) when membershipExpiresAt already passed', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'active', membershipExpiresAt: '2026-07-20T00:00:00.000Z' })
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-5' } }
    const res = makeRes()
    const next = vi.fn()
    await requireActiveMembership(req, res, next)
    expect(firePatchUserFields).toHaveBeenCalledWith('uid-5', ['membershipStatus'], { membershipStatus: 'expired' })
    expect(res.statusCode).toBe(402)
    expect(res.body).toEqual({ error: 'membership_expired' })
    expect(next).not.toHaveBeenCalled()
  })

  it('responds 500 internal_error when fireGetUser throws (Firestore transient failure, fails closed)', async () => {
    fireGetUser.mockRejectedValue(new Error('firestore unavailable'))
    const req = { user: { uid: 'uid-6' } }
    const res = makeRes()
    const next = vi.fn()
    await requireActiveMembership(req, res, next)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'internal_error' })
    expect(next).not.toHaveBeenCalled()
  })
})
