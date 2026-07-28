import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const phoneAuthModule = requireFn('../api/phoneAuth.js')

const findUserByEmail = vi.fn()
const fireGetPhoneIndex = vi.fn()
const fireGetUserRaw = vi.fn()
const firePatchUserFields = vi.fn()
firestoreModule.findUserByEmail = findUserByEmail
firestoreModule.fireGetPhoneIndex = fireGetPhoneIndex
firestoreModule.fireGetUserRaw = fireGetUserRaw
firestoreModule.firePatchUserFields = firePatchUserFields

const lookupAuthAccount = vi.fn()
const setUserDisabled = vi.fn()
phoneAuthModule.lookupAuthAccount = lookupAuthAccount
phoneAuthModule.setUserDisabled = setUserDisabled

const { searchUserHandler, patchUserMembershipHandler, setUserDisabledHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('searchUserHandler', () => {
  beforeEach(() => {
    findUserByEmail.mockReset()
    fireGetPhoneIndex.mockReset()
    fireGetUserRaw.mockReset()
    lookupAuthAccount.mockReset()
  })

  it('responds 400 when q is missing', async () => {
    const req = { query: {} }
    const res = makeRes()
    await searchUserHandler(req, res)
    expect(res.statusCode).toBe(400)
  })

  it('searches by email when q contains @, and returns profile + auth status', async () => {
    findUserByEmail.mockResolvedValue('uid-1')
    fireGetUserRaw.mockResolvedValue({ fields: { email: 'a@b.com', membershipStatus: 'active' }, updateTime: '2026-01-01T00:00:00.000000Z' })
    lookupAuthAccount.mockResolvedValue({ disabled: false, emailVerified: true })
    const req = { query: { q: 'a@b.com' } }
    const res = makeRes()

    await searchUserHandler(req, res)

    expect(findUserByEmail).toHaveBeenCalledWith('a@b.com')
    expect(fireGetPhoneIndex).not.toHaveBeenCalled()
    expect(res.body).toEqual({
      uid: 'uid-1',
      profile: { email: 'a@b.com', membershipStatus: 'active' },
      auth: { disabled: false, emailVerified: true }
    })
  })

  it('searches by phone via fireGetPhoneIndex when q has no @', async () => {
    fireGetPhoneIndex.mockResolvedValue({ uid: 'uid-2' })
    fireGetUserRaw.mockResolvedValue({ fields: { phoneNumber: '+525512345678' }, updateTime: 't' })
    lookupAuthAccount.mockResolvedValue({ disabled: true, emailVerified: false })
    const req = { query: { q: '+525512345678' } }
    const res = makeRes()

    await searchUserHandler(req, res)

    expect(fireGetPhoneIndex).toHaveBeenCalledWith('+525512345678')
    expect(findUserByEmail).not.toHaveBeenCalled()
    expect(res.body.uid).toBe('uid-2')
    expect(res.body.auth.disabled).toBe(true)
  })

  it('responds 404 when no uid resolves (email not found)', async () => {
    findUserByEmail.mockResolvedValue(null)
    const req = { query: { q: 'nobody@example.com' } }
    const res = makeRes()
    await searchUserHandler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('responds 404 when phone has no phoneIndex entry', async () => {
    fireGetPhoneIndex.mockResolvedValue(null)
    const req = { query: { q: '+520000000000' } }
    const res = makeRes()
    await searchUserHandler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('responds 404 when uid resolves but the user doc is missing', async () => {
    findUserByEmail.mockResolvedValue('uid-orphan')
    fireGetUserRaw.mockResolvedValue(null)
    const req = { query: { q: 'orphan@example.com' } }
    const res = makeRes()
    await searchUserHandler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('responds 500 when a dependency throws', async () => {
    findUserByEmail.mockRejectedValue(new Error('boom'))
    const req = { query: { q: 'x@example.com' } }
    const res = makeRes()
    await searchUserHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})

describe('patchUserMembershipHandler', () => {
  beforeEach(() => { firePatchUserFields.mockReset() })

  it('rejects an invalid membershipStatus', async () => {
    const req = { params: { uid: 'uid-1' }, body: { membershipStatus: 'bogus', membershipExpiresAt: null } }
    const res = makeRes()
    await patchUserMembershipHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('patches membershipStatus and membershipExpiresAt via firePatchUserFields', async () => {
    firePatchUserFields.mockResolvedValue(true)
    const req = { params: { uid: 'uid-1' }, body: { membershipStatus: 'active', membershipExpiresAt: '2026-08-21T00:00:00.000Z' } }
    const res = makeRes()

    await patchUserMembershipHandler(req, res)

    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['membershipStatus', 'membershipExpiresAt'], {
      membershipStatus: 'active', membershipExpiresAt: '2026-08-21T00:00:00.000Z'
    })
    expect(res.body).toEqual({ ok: true })
  })

  it('sends null for membershipExpiresAt when omitted (e.g. setting status to pending)', async () => {
    firePatchUserFields.mockResolvedValue(true)
    const req = { params: { uid: 'uid-1' }, body: { membershipStatus: 'pending' } }
    const res = makeRes()

    await patchUserMembershipHandler(req, res)

    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['membershipStatus', 'membershipExpiresAt'], {
      membershipStatus: 'pending', membershipExpiresAt: null
    })
  })

  it('responds 500 when firePatchUserFields throws', async () => {
    firePatchUserFields.mockRejectedValue(new Error('boom'))
    const req = { params: { uid: 'uid-1' }, body: { membershipStatus: 'active', membershipExpiresAt: null } }
    const res = makeRes()
    await patchUserMembershipHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})

describe('setUserDisabledHandler', () => {
  beforeEach(() => { setUserDisabled.mockReset() })

  it('rejects a non-boolean disabled value', async () => {
    const req = { params: { uid: 'uid-1' }, body: { disabled: 'yes' } }
    const res = makeRes()
    await setUserDisabledHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(setUserDisabled).not.toHaveBeenCalled()
  })

  it('calls setUserDisabled(uid, true) and returns ok', async () => {
    setUserDisabled.mockResolvedValue(undefined)
    const req = { params: { uid: 'uid-1' }, body: { disabled: true } }
    const res = makeRes()

    await setUserDisabledHandler(req, res)

    expect(setUserDisabled).toHaveBeenCalledWith('uid-1', true)
    expect(res.body).toEqual({ ok: true, disabled: true })
  })

  it('calls setUserDisabled(uid, false) to reactivate', async () => {
    setUserDisabled.mockResolvedValue(undefined)
    const req = { params: { uid: 'uid-1' }, body: { disabled: false } }
    const res = makeRes()

    await setUserDisabledHandler(req, res)

    expect(setUserDisabled).toHaveBeenCalledWith('uid-1', false)
    expect(res.body).toEqual({ ok: true, disabled: false })
  })

  it('responds 500 when setUserDisabled throws', async () => {
    setUserDisabled.mockRejectedValue(new Error('boom'))
    const req = { params: { uid: 'uid-1' }, body: { disabled: true } }
    const res = makeRes()
    await setUserDisabledHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})
