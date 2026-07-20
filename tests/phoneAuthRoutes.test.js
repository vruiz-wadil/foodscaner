import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

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
firestoreModule.fireGetUser = fireGetUser

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

  it('mints a custom token for uid "phone:"+phone and reports isNewUser:true for a first-time phone', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetUser.mockResolvedValue(null)
    createFirebaseCustomToken.mockReturnValue('signed.jwt.token')
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(createFirebaseCustomToken).toHaveBeenCalledWith('phone:+525512345678')
    expect(fireGetUser).toHaveBeenCalledWith('phone:+525512345678')
    expect(res.body).toEqual({ customToken: 'signed.jwt.token', isNewUser: true })
  })

  it('reports isNewUser:false when the user doc already exists', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetUser.mockResolvedValue({ uid: 'phone:+525512345678' })
    createFirebaseCustomToken.mockReturnValue('signed.jwt.token')
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.body).toEqual({ customToken: 'signed.jwt.token', isNewUser: false })
  })

  it('defaults isNewUser to true (fail-safe) when the Firestore lookup itself fails, without blocking the response (diseño: Firestore ambiguo -> trata como nuevo)', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetUser.mockRejectedValue(new Error('Firestore unavailable'))
    createFirebaseCustomToken.mockReturnValue('signed.jwt.token')
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.body).toEqual({ customToken: 'signed.jwt.token', isNewUser: true })
  })

  it('500s (dedicated, not 502) when custom-token signing fails — distinct from a Twilio outage (diseño: falla firma de custom token -> 500)', async () => {
    checkVerificationCode.mockResolvedValue('approved')
    fireGetUser.mockResolvedValue(null)
    createFirebaseCustomToken.mockImplementation(() => { throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY no configurada') })
    const req = { body: { phone: '+525512345678', code: '123456' } }
    const res = makeRes()
    await phoneVerifyHandler(req, res)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'server_error' })
  })
})
