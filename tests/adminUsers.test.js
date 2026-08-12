import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const phoneAuthModule = requireFn('../api/phoneAuth.js')

const findUserByEmail = vi.fn()
const fireGetPhoneIndex = vi.fn()
const fireGetUserRaw = vi.fn()
const fireGetUser = vi.fn()
const firePatchUserFields = vi.fn()
const fireListUsers = vi.fn()
firestoreModule.findUserByEmail = findUserByEmail
firestoreModule.fireGetPhoneIndex = fireGetPhoneIndex
firestoreModule.fireGetUserRaw = fireGetUserRaw
firestoreModule.fireGetUser = fireGetUser
firestoreModule.firePatchUserFields = firePatchUserFields
firestoreModule.fireListUsers = fireListUsers

const lookupAuthAccount = vi.fn()
const setUserDisabled = vi.fn()
phoneAuthModule.lookupAuthAccount = lookupAuthAccount
phoneAuthModule.setUserDisabled = setUserDisabled

const { searchUserHandler, patchUserMembershipHandler, setUserDisabledHandler, getUserByUidHandler, listUsersHandler, adminPatchUserProfileHandler, adminPatchUserPreferencesHandler } = await import('../api/index.js')

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

describe('getUserByUidHandler', () => {
  beforeEach(() => {
    fireGetUserRaw.mockReset()
    lookupAuthAccount.mockReset()
  })

  it('returns {uid, profile, auth} when the user doc exists', async () => {
    fireGetUserRaw.mockResolvedValue({ fields: { email: 'a@b.com', membershipStatus: 'active' }, updateTime: 't' })
    lookupAuthAccount.mockResolvedValue({ disabled: false, emailVerified: true })
    const req = { params: { uid: 'uid-1' } }
    const res = makeRes()

    await getUserByUidHandler(req, res)

    expect(fireGetUserRaw).toHaveBeenCalledWith('uid-1')
    expect(res.body).toEqual({
      uid: 'uid-1',
      profile: { email: 'a@b.com', membershipStatus: 'active' },
      auth: { disabled: false, emailVerified: true }
    })
  })

  it('responds 404 when the user doc does not exist', async () => {
    fireGetUserRaw.mockResolvedValue(null)
    const req = { params: { uid: 'uid-missing' } }
    const res = makeRes()
    await getUserByUidHandler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('responds 500 when a dependency throws', async () => {
    fireGetUserRaw.mockRejectedValue(new Error('boom'))
    const req = { params: { uid: 'uid-1' } }
    const res = makeRes()
    await getUserByUidHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})

describe('listUsersHandler', () => {
  beforeEach(() => { fireListUsers.mockReset() })

  it('returns items and nextPageToken from fireListUsers', async () => {
    fireListUsers.mockResolvedValue({ items: [{ uid: 'uid-1', email: 'a@b.com' }], nextPageToken: '2026-07-20T00:00:00.000Z' })
    const req = { query: {} }
    const res = makeRes()

    await listUsersHandler(req, res)

    expect(fireListUsers).toHaveBeenCalledWith(null)
    expect(res.body).toEqual({ items: [{ uid: 'uid-1', email: 'a@b.com' }], nextPageToken: '2026-07-20T00:00:00.000Z' })
  })

  it('passes req.query.pageToken through to fireListUsers', async () => {
    fireListUsers.mockResolvedValue({ items: [], nextPageToken: null })
    const req = { query: { pageToken: '2026-07-15T00:00:00.000Z' } }
    const res = makeRes()

    await listUsersHandler(req, res)

    expect(fireListUsers).toHaveBeenCalledWith('2026-07-15T00:00:00.000Z')
  })

  it('responds 500 when fireListUsers throws', async () => {
    fireListUsers.mockRejectedValue(new Error('boom'))
    const req = { query: {} }
    const res = makeRes()
    await listUsersHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})

describe('adminPatchUserProfileHandler', () => {
  beforeEach(() => {
    fireGetUser.mockReset()
    firePatchUserFields.mockReset()
  })

  it('responds 404 when the user document does not exist', async () => {
    fireGetUser.mockResolvedValue(null)
    const req = { params: { uid: 'uid-1' }, body: { displayName: 'Ana' } }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('responds 400 no_fields when the body has none of displayName/phone/email', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { params: { uid: 'uid-2' }, body: {} }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'no_fields' })
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('rejects an empty displayName with 400 invalid_display_name', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { params: { uid: 'uid-3' }, body: { displayName: '   ' } }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_display_name' })
  })

  it('rejects a phone that is not E.164 with 400 invalid_phone', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { params: { uid: 'uid-4' }, body: { phone: '5512345678' } }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_phone' })
  })

  it('rejects a malformed email with 400 invalid_email', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { params: { uid: 'uid-5' }, body: { email: 'not-an-email' } }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_email' })
  })

  it('patches only the fields present in the body, with an explicit nested updateMask', async () => {
    fireGetUser.mockResolvedValue({ profile: { phone: '+525512345678', displayName: 'Old' } })
    firePatchUserFields.mockResolvedValue(true)
    const req = { params: { uid: 'uid-6' }, body: { displayName: 'Ana Ruiz' } }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    expect(firePatchUserFields).toHaveBeenCalledWith(
      'uid-6',
      expect.arrayContaining(['profile.displayName']),
      expect.objectContaining({ profile: expect.objectContaining({ displayName: 'Ana Ruiz', phone: '+525512345678' }) })
    )
    expect(firePatchUserFields.mock.calls[0][1]).not.toContain('profile.phone')
    expect(res.body).toEqual({ ok: true })
  })

  it('does NOT touch profile.completedAt (admin correction, not onboarding)', async () => {
    fireGetUser.mockResolvedValue({ profile: { displayName: null, phone: null, email: null, completedAt: null } })
    firePatchUserFields.mockResolvedValue(true)
    const req = { params: { uid: 'uid-7' }, body: { displayName: 'Ana', phone: '+525512345678', email: 'a@b.com' } }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    const [, fieldPaths] = firePatchUserFields.mock.calls[0]
    expect(fieldPaths).not.toContain('profile.completedAt')
  })

  it('responds 500 when firePatchUserFields throws', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    firePatchUserFields.mockRejectedValue(new Error('boom'))
    const req = { params: { uid: 'uid-8' }, body: { displayName: 'Ana' } }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})

describe('adminPatchUserPreferencesHandler', () => {
  beforeEach(() => { firePatchUserFields.mockReset() })

  it('responds 400 invalid_preferences when dietary/allergens/healthConditions are not arrays', async () => {
    const req = { params: { uid: 'uid-1' }, body: { dietary: 'vegan', allergens: [], healthConditions: [] } }
    const res = makeRes()
    await adminPatchUserPreferencesHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_preferences' })
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('responds 400 invalid_dietary for a code outside the whitelist', async () => {
    const req = { params: { uid: 'uid-2' }, body: { dietary: ['bogus'], allergens: [], healthConditions: [] } }
    const res = makeRes()
    await adminPatchUserPreferencesHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_dietary' })
  })

  it('responds 400 invalid_health_conditions for a code outside the whitelist', async () => {
    const req = { params: { uid: 'uid-3' }, body: { dietary: [], allergens: [], healthConditions: ['bogus'] } }
    const res = makeRes()
    await adminPatchUserPreferencesHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_health_conditions' })
  })

  it('responds 400 invalid_allergens for a bad code or severity', async () => {
    const req = { params: { uid: 'uid-4' }, body: { dietary: [], allergens: [{ code: 'bogus', severity: 'severe' }], healthConditions: [] } }
    const res = makeRes()
    await adminPatchUserPreferencesHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_allergens' })
  })

  it('patches dietary/allergens/healthConditions without touching consent fields', async () => {
    firePatchUserFields.mockResolvedValue(true)
    const req = {
      params: { uid: 'uid-5' },
      body: {
        dietary: ['vegan', 'glutenFree'],
        allergens: [{ code: 'cacahuate', severity: 'severe' }],
        healthConditions: ['diabet']
      }
    }
    const res = makeRes()
    await adminPatchUserPreferencesHandler(req, res)
    expect(firePatchUserFields).toHaveBeenCalledWith(
      'uid-5',
      ['preferences.dietary', 'preferences.allergens', 'preferences.healthConditions', 'preferences.updatedAt'],
      expect.objectContaining({
        preferences: expect.objectContaining({
          dietary: ['vegan', 'glutenFree'],
          allergens: [{ code: 'cacahuate', severity: 'severe' }],
          healthConditions: ['diabet']
        })
      })
    )
    expect(res.body).toEqual({ ok: true, preferences: expect.any(Object) })
  })

  it('responds 500 when firePatchUserFields throws', async () => {
    firePatchUserFields.mockRejectedValue(new Error('boom'))
    const req = { params: { uid: 'uid-6' }, body: { dietary: [], allergens: [], healthConditions: [] } }
    const res = makeRes()
    await adminPatchUserPreferencesHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})
