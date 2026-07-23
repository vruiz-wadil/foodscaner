import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)

const firestoreModule = requireFn('../api/firestore.js')
const fireGetPhoneIndex = vi.fn()
const fireSetPhoneIndex = vi.fn()
const fireDeleteDoc = vi.fn()
firestoreModule.fireGetPhoneIndex = fireGetPhoneIndex
firestoreModule.fireSetPhoneIndex = fireSetPhoneIndex
firestoreModule.fireDeleteDoc = fireDeleteDoc

const phoneAuthModule = requireFn('../api/phoneAuth.js')
const checkVerificationCode = vi.fn()
const setPhoneNumberClaim = vi.fn()
phoneAuthModule.checkVerificationCode = checkVerificationCode
phoneAuthModule.setPhoneNumberClaim = setPhoneNumberClaim

const { changePhoneHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

function twilioError(message, status) {
  const e = new Error(message)
  e.status = status
  return e
}

describe('changePhoneHandler', () => {
  beforeEach(() => {
    fireGetPhoneIndex.mockReset()
    fireSetPhoneIndex.mockReset()
    fireDeleteDoc.mockReset()
    checkVerificationCode.mockReset()
    setPhoneNumberClaim.mockReset()
  })

  it('400s on invalid phone/code format', async () => {
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: 'bad', code: '123456' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(checkVerificationCode).not.toHaveBeenCalled()
  })

  it('401s when the code is not approved', async () => {
    checkVerificationCode.mockResolvedValue('pending')
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: '+525512345678', code: '000000' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'invalid_code' })
  })

  it('401s (not 502) when Twilio rejects the check itself', async () => {
    checkVerificationCode.mockRejectedValue(twilioError('Max attempts', 429))
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: '+525512345678', code: '000000' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('502s when Twilio is down', async () => {
    checkVerificationCode.mockRejectedValue(new Error('network down'))
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(res.statusCode).toBe(502)
  })

  it('409s when the new phone already belongs to a different uid', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue({ uid: 'someone-else-uid' })
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'phone_in_use' })
    expect(fireSetPhoneIndex).not.toHaveBeenCalled()
  })

  it('succeeds: deletes the old index, creates the new one, pushes the claim', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue(null)
    fireDeleteDoc.mockResolvedValue(true)
    fireSetPhoneIndex.mockResolvedValue(undefined)
    setPhoneNumberClaim.mockResolvedValue(undefined)
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(fireDeleteDoc).toHaveBeenCalledWith('phoneIndex', '+525500000000')
    expect(fireSetPhoneIndex).toHaveBeenCalledWith('+525512345678', 'uid-1')
    expect(setPhoneNumberClaim).toHaveBeenCalledWith('uid-1', '+525512345678')
    expect(res.body).toEqual({ ok: true })
  })

  it('succeeds without deleting an old index when the user had no phoneNumber before (edge case, unlikely for a phone-login account)', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue(null)
    fireSetPhoneIndex.mockResolvedValue(undefined)
    setPhoneNumberClaim.mockResolvedValue(undefined)
    const req = { user: { uid: 'uid-1', phoneNumber: null }, body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(fireDeleteDoc).not.toHaveBeenCalled()
    expect(res.body).toEqual({ ok: true })
  })

  it('500s when setPhoneNumberClaim fails', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue(null)
    fireSetPhoneIndex.mockResolvedValue(undefined)
    setPhoneNumberClaim.mockRejectedValue(new Error('Identity Toolkit down'))
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'internal_error' })
  })

  it('500s when the phoneIndex ownership check itself fails (Firestore error)', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockRejectedValue(new Error('Firestore down'))
    const req = { user: { uid: 'uid-1', phoneNumber: '+525500000000' }, body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await changePhoneHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})
