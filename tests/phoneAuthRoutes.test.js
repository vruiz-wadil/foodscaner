import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'
import crypto from 'crypto'

const requireFn = createRequire(import.meta.url)
const phoneAuthModule = requireFn('../api/phoneAuth.js')
const sendVerificationCode = vi.fn()
const checkVerificationCode = vi.fn()
const createFirebaseCustomToken = vi.fn()
phoneAuthModule.sendVerificationCode = sendVerificationCode
phoneAuthModule.checkVerificationCode = checkVerificationCode
phoneAuthModule.createFirebaseCustomToken = createFirebaseCustomToken

const firestoreModule = requireFn('../api/firestore.js')
const fireGetUser = vi.fn()
const fireGetPhoneIndex = vi.fn()
const fireSetPhoneIndex = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.fireGetPhoneIndex = fireGetPhoneIndex
firestoreModule.fireSetPhoneIndex = fireSetPhoneIndex

const { phoneSendHandler, phoneVerifyHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

function twilioError(message, status) {
  const e = new Error(message)
  e.status = status
  return e
}

describe('phoneSendHandler', () => {
  beforeEach(() => { sendVerificationCode.mockReset() })

  it('400s on a missing/invalid phone (must be E.164: + followed by digits)', async () => {
    const req = { body: { phone: 'not-a-phone' } }
    const res = makeRes()
    await phoneSendHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_phone' })
    expect(sendVerificationCode).not.toHaveBeenCalled()
  })

  it('sends the code via Twilio and responds { status }', async () => {
    sendVerificationCode.mockResolvedValue('pending')
    const req = { body: { phone: '+525512345678' } }
    const res = makeRes()
    await phoneSendHandler(req, res)
    expect(sendVerificationCode).toHaveBeenCalledWith('+525512345678')
    expect(res.body).toEqual({ status: 'pending' })
  })

  it('400s (not 502) when Twilio itself rejects the number (4xx from Twilio)', async () => {
    sendVerificationCode.mockRejectedValue(twilioError('Invalid parameter', 400))
    const req = { body: { phone: '+525512345678' } }
    const res = makeRes()
    await phoneSendHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_phone' })
  })

  it('502s when Twilio is down (5xx or no status)', async () => {
    sendVerificationCode.mockRejectedValue(new Error('network error'))
    const req = { body: { phone: '+525512345678' } }
    const res = makeRes()
    await phoneSendHandler(req, res)
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: 'send_failed' })
  })
})

describe('phoneVerifyHandler', () => {
  beforeEach(() => {
    checkVerificationCode.mockReset()
    createFirebaseCustomToken.mockReset()
    fireGetUser.mockReset()
    fireGetPhoneIndex.mockReset()
    fireSetPhoneIndex.mockReset()
  })

  it('400s on a missing/invalid phone, same E.164 check as phoneSendHandler (hallazgo de seguridad: sin esto, el mismo teléfono real podía mintear varios uids con formatos distintos)', async () => {
    const req = { body: { phone: 'not-a-phone', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(checkVerificationCode).not.toHaveBeenCalled()
  })

  it('401s when Twilio does not approve the code', async () => {
    checkVerificationCode.mockResolvedValue('pending')
    const req = { body: { phone: '+525512345678', code: '000000' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'invalid_code' })
    expect(createFirebaseCustomToken).not.toHaveBeenCalled()
  })

  it('401s (not 502) when Twilio rejects the check itself (4xx, e.g. expired/max attempts)', async () => {
    checkVerificationCode.mockRejectedValue(twilioError('Max check attempts reached', 429))
    const req = { body: { phone: '+525512345678', code: '000000' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'invalid_code' })
  })

  it('502s when Twilio is down (5xx or no status) during the check', async () => {
    checkVerificationCode.mockRejectedValue(new Error('network error'))
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: 'verify_failed' })
  })

  it('teléfono con índice existente en phoneIndex -> usa ese uid, isNewUser:false, no consulta el doc legado', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue({ uid: 'a1b2c3d4-uuid' })
    createFirebaseCustomToken.mockReturnValue('signed.jwt.token')
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(fireGetUser).not.toHaveBeenCalled()
    expect(fireSetPhoneIndex).not.toHaveBeenCalled()
    expect(createFirebaseCustomToken).toHaveBeenCalledWith('a1b2c3d4-uuid', { phone_number: '+525512345678' })
    expect(res.body).toEqual({ customToken: 'signed.jwt.token', isNewUser: false })
  })

  it('teléfono sin índice pero con doc legado "phone:"+telefono -> adopta ese uid, isNewUser:false, rellena el índice (backfill)', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue(null)
    fireGetUser.mockResolvedValue({ membershipStatus: 'active' })
    fireSetPhoneIndex.mockResolvedValue(undefined)
    createFirebaseCustomToken.mockReturnValue('signed.jwt.token')
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(fireGetUser).toHaveBeenCalledWith('phone:+525512345678')
    expect(fireSetPhoneIndex).toHaveBeenCalledWith('+525512345678', 'phone:+525512345678')
    expect(createFirebaseCustomToken).toHaveBeenCalledWith('phone:+525512345678', { phone_number: '+525512345678' })
    expect(res.body).toEqual({ customToken: 'signed.jwt.token', isNewUser: false })
  })

  it('teléfono completamente nuevo (sin índice, sin doc legado) -> uid random nuevo, isNewUser:true, rellena el índice', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue(null)
    fireGetUser.mockResolvedValue(null)
    fireSetPhoneIndex.mockResolvedValue(undefined)
    createFirebaseCustomToken.mockReturnValue('signed.jwt.token')
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('brand-new-uuid')
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(fireSetPhoneIndex).toHaveBeenCalledWith('+525512345678', 'brand-new-uuid')
    expect(createFirebaseCustomToken).toHaveBeenCalledWith('brand-new-uuid', { phone_number: '+525512345678' })
    expect(res.body).toEqual({ customToken: 'signed.jwt.token', isNewUser: true })
    crypto.randomUUID.mockRestore()
  })

  it('falla de escritura al rellenar el índice tras encontrar el doc legado -> conserva el uid YA resuelto, isNewUser:false (solo una falla de LECTURA debe caer a uid random)', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue(null)
    fireGetUser.mockResolvedValue({ membershipStatus: 'active' })
    fireSetPhoneIndex.mockRejectedValue(new Error('Firestore write timeout'))
    createFirebaseCustomToken.mockReturnValue('signed.jwt.token')
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(createFirebaseCustomToken).toHaveBeenCalledWith('phone:+525512345678', { phone_number: '+525512345678' })
    expect(res.body).toEqual({ customToken: 'signed.jwt.token', isNewUser: false })
  })

  it('falla de Firestore en la resolución del índice -> cae a uid random nuevo, isNewUser:true (fail-safe, nunca bloquea la respuesta)', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockRejectedValue(new Error('Firestore unavailable'))
    createFirebaseCustomToken.mockReturnValue('signed.jwt.token')
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('fallback-uuid')
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.body).toEqual({ customToken: 'signed.jwt.token', isNewUser: true })
    crypto.randomUUID.mockRestore()
  })

  it('500s (dedicated, not 502) when custom-token signing fails — distinto de una caída de Twilio', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetPhoneIndex.mockResolvedValue({ uid: 'a1b2c3d4-uuid' })
    createFirebaseCustomToken.mockImplementation(() => { throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY no configurada') })
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'server_error' })
  })
})
