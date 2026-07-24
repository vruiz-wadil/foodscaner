import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const fireGetUser = vi.fn()
const firePatchUserFields = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.firePatchUserFields = firePatchUserFields

const { cancelMembershipHandler, reactivateMembershipHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('cancelMembershipHandler', () => {
  beforeEach(() => { fireGetUser.mockReset(); firePatchUserFields.mockReset() })

  it('sets autoRenew false for an active membership', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'active' })
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await cancelMembershipHandler(req, res)

    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['autoRenew'], { autoRenew: false })
    expect(res.body).toEqual({ ok: true, autoRenew: false })
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
  beforeEach(() => { fireGetUser.mockReset(); firePatchUserFields.mockReset() })

  it('sets autoRenew true for an active membership', async () => {
    fireGetUser.mockResolvedValue({ membershipStatus: 'active' })
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await reactivateMembershipHandler(req, res)

    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['autoRenew'], { autoRenew: true })
    expect(res.body).toEqual({ ok: true, autoRenew: true })
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
