import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import crypto from 'crypto'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const getServiceAccount = vi.fn()
firestoreModule.getServiceAccount = getServiceAccount

const { sendVerificationCode, checkVerificationCode, createFirebaseCustomToken } = await import('../api/phoneAuth.js')

function b64urlJsonDecode(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
}

describe('sendVerificationCode', () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_test'
    process.env.TWILIO_AUTH_TOKEN = 'token_test'
    process.env.TWILIO_VERIFY_SERVICE_SID = 'VA_test'
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('calls the Twilio Verify Verifications endpoint with Basic Auth and the phone number', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'pending' }) })
    vi.stubGlobal('fetch', fetchMock)

    const status = await sendVerificationCode('+525512345678')

    expect(status).toBe('pending')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://verify.twilio.com/v2/Services/VA_test/Verifications')
    expect(opts.headers.Authorization).toBe('Basic ' + Buffer.from('AC_test:token_test').toString('base64'))
    expect(opts.body.toString()).toBe('To=%2B525512345678&Channel=sms')
  })

  it('throws with .status set to the Twilio HTTP status when Twilio responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'Invalid phone' }) }))
    await expect(sendVerificationCode('bad')).rejects.toThrow('Invalid phone')
    try {
      await sendVerificationCode('bad')
    } catch (e) {
      expect(e.status).toBe(400)
    }
  })
})

describe('checkVerificationCode', () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_test'
    process.env.TWILIO_AUTH_TOKEN = 'token_test'
    process.env.TWILIO_VERIFY_SERVICE_SID = 'VA_test'
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('calls the Twilio Verify VerificationCheck endpoint and returns the status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'approved' }) })
    vi.stubGlobal('fetch', fetchMock)

    const status = await checkVerificationCode('+525512345678', '123456')

    expect(status).toBe('approved')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://verify.twilio.com/v2/Services/VA_test/VerificationCheck')
    expect(opts.body.toString()).toBe('To=%2B525512345678&Code=123456')
  })

  it('throws with .status set to the Twilio HTTP status when Twilio responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ message: 'Not found' }) }))
    try {
      await checkVerificationCode('+525512345678', '000000')
      expect.unreachable()
    } catch (e) {
      expect(e.message).toBe('Not found')
      expect(e.status).toBe(404)
    }
  })
})

describe('createFirebaseCustomToken', () => {
  let publicKey

  beforeEach(() => {
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    publicKey = keyPair.publicKey
    getServiceAccount.mockReturnValue({
      client_email: 'firebase-adminsdk@foodscaner-dev.iam.gserviceaccount.com',
      private_key: keyPair.privateKey.export({ type: 'pkcs1', format: 'pem' }),
      project_id: 'foodscaner-dev'
    })
  })

  it('signs a JWT with the claims Firebase custom tokens require', () => {
    const token = createFirebaseCustomToken('phone:+525512345678')
    const [headerB64, payloadB64, sigB64] = token.split('.')

    expect(b64urlJsonDecode(headerB64)).toEqual({ alg: 'RS256', typ: 'JWT' })

    const payload = b64urlJsonDecode(payloadB64)
    expect(payload.uid).toBe('phone:+525512345678')
    expect(payload.iss).toBe('firebase-adminsdk@foodscaner-dev.iam.gserviceaccount.com')
    expect(payload.sub).toBe(payload.iss)
    expect(payload.aud).toBe('https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit')
    expect(payload.exp - payload.iat).toBe(3600)

    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`)
    const signature = Buffer.from(sigB64, 'base64url')
    expect(crypto.verify('RSA-SHA256', signingInput, publicKey, signature)).toBe(true)
  })

  it('throws when getServiceAccount() returns null (FIREBASE_SERVICE_ACCOUNT_KEY missing)', () => {
    getServiceAccount.mockReturnValue(null)
    expect(() => createFirebaseCustomToken('phone:+525512345678')).toThrow(/FIREBASE_SERVICE_ACCOUNT_KEY/)
  })
})
