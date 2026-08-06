import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const fireGetUser = vi.fn()
const firePatchUserFields = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.firePatchUserFields = firePatchUserFields

const { putProfileHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('putProfileHandler', () => {
  beforeEach(() => {
    fireGetUser.mockReset()
    firePatchUserFields.mockReset()
  })

  it('responds 404 when the user document does not exist', async () => {
    fireGetUser.mockResolvedValue(null)
    const req = { user: { uid: 'uid-1' }, body: { displayName: 'Ana' } }
    const res = makeRes()
    await putProfileHandler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('responds 400 no_fields when the body has none of displayName/phone/email', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { user: { uid: 'uid-2' }, body: {} }
    const res = makeRes()
    await putProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'no_fields' })
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('rejects an empty displayName with 400 invalid_display_name', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { user: { uid: 'uid-3' }, body: { displayName: '   ' } }
    const res = makeRes()
    await putProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_display_name' })
  })

  it('rejects a phone that is not E.164 with 400 invalid_phone', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { user: { uid: 'uid-4' }, body: { phone: '5512345678' } }
    const res = makeRes()
    await putProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_phone' })
  })

  it('rejects a malformed email with 400 invalid_email', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { user: { uid: 'uid-5' }, body: { email: 'not-an-email' } }
    const res = makeRes()
    await putProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_email' })
  })

  it('updates only the fields present in the body, with an explicit nested updateMask', async () => {
    fireGetUser.mockResolvedValue({ profile: { phone: '+525512345678' }, phoneNumber: '+525512345678' })
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-6' }, body: { displayName: 'Ana Ruiz' } }
    const res = makeRes()
    await putProfileHandler(req, res)
    expect(firePatchUserFields).toHaveBeenCalledWith(
      'uid-6',
      expect.arrayContaining(['profile.displayName']),
      expect.objectContaining({ profile: expect.objectContaining({ displayName: 'Ana Ruiz' }) })
    )
    expect(firePatchUserFields.mock.calls[0][1]).not.toContain('profile.phone')
    expect(res.body.ok).toBe(true)
  })

  it('sets profile.completedAt once displayName/phone/email are all present (mixing new input with provider-supplied fields)', async () => {
    // Google ya dio email; el profile trae displayName y falta solo phone.
    fireGetUser.mockResolvedValue({ email: 'a@b.com', profile: { displayName: 'Ana', phone: null, email: null, completedAt: null } })
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-7' }, body: { phone: '+525512345678' } }
    const res = makeRes()
    await putProfileHandler(req, res)
    const [, fieldPaths, data] = firePatchUserFields.mock.calls[0]
    expect(fieldPaths).toContain('profile.completedAt')
    expect(typeof data.profile.completedAt).toBe('string')
  })

  it('does NOT set profile.completedAt while a required field is still missing', async () => {
    fireGetUser.mockResolvedValue({ profile: { displayName: null, phone: null, email: null, completedAt: null } })
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-8' }, body: { displayName: 'Ana' } }
    const res = makeRes()
    await putProfileHandler(req, res)
    const [, fieldPaths] = firePatchUserFields.mock.calls[0]
    expect(fieldPaths).not.toContain('profile.completedAt')
  })
})
