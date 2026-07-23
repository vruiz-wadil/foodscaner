import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

// NOTA DE ADAPTACIÓN (misma razón que en los tests anteriores): se usa
// createRequire para mutar fireGetUser en el objeto real de module.exports
// de firestore.js, en vez de vi.mock (que no intercepta el require anidado
// dentro de api/index.js).
const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const fireGetUser = vi.fn()
firestoreModule.fireGetUser = fireGetUser

const { getMeHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('getMeHandler', () => {
  beforeEach(() => { fireGetUser.mockReset() })

  it('returns the profile without preferences for a pending-membership user', async () => {
    fireGetUser.mockResolvedValue({ email: 'a@b.com', membershipStatus: 'pending' })
    const req = { user: { uid: 'uid-1', email: null, phoneNumber: null } }
    const res = makeRes()

    await getMeHandler(req, res)

    // email/phoneNumber now always come from req.user (the verified token claims),
    // never from the Firestore-side spread — realistic req.user always has these
    // keys (null, never undefined; see api/auth.js verifyFirebaseIdToken).
    expect(res.body).toEqual({ uid: 'uid-1', email: null, phoneNumber: null, membershipStatus: 'pending' })
  })

  it('includes preferences for an active-membership user', async () => {
    fireGetUser.mockResolvedValue({
      email: 'a@b.com', membershipStatus: 'active',
      preferences: { dietary: ['vegan'], allergens: [], healthConditions: [] }
    })
    const req = { user: { uid: 'uid-2', email: 'a@b.com', phoneNumber: null } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.body.preferences).toEqual({ dietary: ['vegan'], allergens: [], healthConditions: [] })
  })

  it('never includes preferences for an expired-membership user even if present in the doc (defensive)', async () => {
    fireGetUser.mockResolvedValue({ email: 'a@b.com', membershipStatus: 'expired', preferences: { dietary: ['vegan'] } })
    const req = { user: { uid: 'uid-3', email: 'a@b.com', phoneNumber: null } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.body.preferences).toBeUndefined()
  })

  it('responds 404 when the user document does not exist', async () => {
    fireGetUser.mockResolvedValue(null)
    const req = { user: { uid: 'uid-missing', email: null, phoneNumber: null } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: 'user_not_found' })
  })

  it('reflects the live req.user.email/phoneNumber from the verified token, not the possibly-stale Firestore copy', async () => {
    fireGetUser.mockResolvedValue({ email: 'old@example.com', phoneNumber: null, membershipStatus: 'active' })
    const req = { user: { uid: 'uid-9', email: 'new@example.com', phoneNumber: '+525512345678' } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.body.email).toBe('new@example.com')
    expect(res.body.phoneNumber).toBe('+525512345678')
  })

  it('uses the live null email/phoneNumber from a phone-login token, ignoring a stale non-null value stored in Firestore', async () => {
    // Real-world regression scenario: user originally signed up with email,
    // Firestore still has that email/phone on file, but the CURRENT session
    // is a phone-login token where req.user.email/phoneNumber are null. The
    // live token value must win — NOT be silently replaced by the stale
    // Firestore value via `||`-style fallback logic (the exact bug this task fixes).
    fireGetUser.mockResolvedValue({ email: 'stale-old@example.com', phoneNumber: '+525500000000', membershipStatus: 'active' })
    const req = { user: { uid: 'uid-10', email: null, phoneNumber: null } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.body.email).toBeNull()
    expect(res.body.phoneNumber).toBeNull()
  })
})
