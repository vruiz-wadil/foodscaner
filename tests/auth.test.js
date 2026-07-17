import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

const { verifyFirebaseIdToken, _resetJwksCacheForTests } = await import('../api/auth.js')

const PROJECT_ID = 'foodscaner-dev'
const KID = 'test-kid-1'

function b64url(input) {
  return Buffer.from(input).toString('base64url')
}

function signRS256(payloadOverrides, privateKey, headerOverrides = {}) {
  const header = { alg: 'RS256', typ: 'JWT', kid: KID, ...headerOverrides }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: 'user-123',
    iat: now,
    exp: now + 3600,
    email: 'user@example.com',
    email_verified: true,
    ...payloadOverrides
  }
  const headerB64 = b64url(JSON.stringify(header))
  const payloadB64 = b64url(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey)
  return `${signingInput}.${signature.toString('base64url')}`
}

describe('verifyFirebaseIdToken', () => {
  let privateKey, jwk

  beforeEach(() => {
    _resetJwksCacheForTests()
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    privateKey = keyPair.privateKey
    jwk = keyPair.publicKey.export({ format: 'jwk' })
    jwk.kid = KID
    jwk.alg = 'RS256'
    jwk.use = 'sig'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockJwks(keys, cacheControl = 'public, max-age=21600') {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (name) => (name.toLowerCase() === 'cache-control' ? cacheControl : null) },
      json: async () => ({ keys: keys || [jwk] })
    }))
  }

  it('accepts a validly signed token and returns {uid, email, emailVerified, phoneNumber}', async () => {
    mockJwks()
    const token = signRS256({}, privateKey)
    const result = await verifyFirebaseIdToken(token, PROJECT_ID)
    expect(result).toEqual({ uid: 'user-123', email: 'user@example.com', emailVerified: true, phoneNumber: null })
  })

  it('extracts phone_number from a phone-authenticated token', async () => {
    mockJwks()
    const token = signRS256({ email: undefined, email_verified: undefined, phone_number: '+525512345678' }, privateKey)
    const result = await verifyFirebaseIdToken(token, PROJECT_ID)
    expect(result).toEqual({ uid: 'user-123', email: null, emailVerified: false, phoneNumber: '+525512345678' })
  })

  it('rejects an expired token', async () => {
    mockJwks()
    const token = signRS256({ exp: Math.floor(Date.now() / 1000) - 10 }, privateKey)
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow()
  })

  it('rejects a token with the wrong aud (cross-project token)', async () => {
    mockJwks()
    const token = signRS256({ aud: 'other-project' }, privateKey)
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow()
  })

  it('rejects a token whose iss is only the bare project id (must be the full URL)', async () => {
    mockJwks()
    const token = signRS256({ iss: PROJECT_ID }, privateKey)
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow()
  })

  it('rejects a token with an empty sub', async () => {
    mockJwks()
    const token = signRS256({ sub: '' }, privateKey)
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow()
  })

  it('rejects an algorithm-confusion attack (alg:HS256 signed with the RSA public key as HMAC secret)', async () => {
    mockJwks()
    const header = { alg: 'HS256', typ: 'JWT', kid: KID }
    const now = Math.floor(Date.now() / 1000)
    const payload = {
      iss: `https://securetoken.google.com/${PROJECT_ID}`, aud: PROJECT_ID,
      sub: 'attacker', iat: now, exp: now + 3600
    }
    const headerB64 = b64url(JSON.stringify(header))
    const payloadB64 = b64url(JSON.stringify(payload))
    const signingInput = `${headerB64}.${payloadB64}`
    const publicKeyPem = crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' })
    const hmacSig = crypto.createHmac('sha256', publicKeyPem).update(signingInput).digest('base64url')
    const forgedToken = `${signingInput}.${hmacSig}`

    await expect(verifyFirebaseIdToken(forgedToken, PROJECT_ID)).rejects.toThrow(/Algoritmo no soportado/)
  })

  it('rejects a token with a tampered payload (signature no longer matches)', async () => {
    mockJwks()
    const token = signRS256({}, privateKey)
    const [headerB64, , sigB64] = token.split('.')
    const tamperedPayloadB64 = b64url(JSON.stringify({
      iss: `https://securetoken.google.com/${PROJECT_ID}`, aud: PROJECT_ID,
      sub: 'attacker', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600
    }))
    const tamperedToken = `${headerB64}.${tamperedPayloadB64}.${sigB64}`
    await expect(verifyFirebaseIdToken(tamperedToken, PROJECT_ID)).rejects.toThrow()
  })

  it('fails closed when fetching Google public keys throws (network error/timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const token = signRS256({}, privateKey)
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow()
  })

  it('fails closed when the Google JWKS endpoint responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, headers: { get: () => null } }))
    const token = signRS256({}, privateKey)
    await expect(verifyFirebaseIdToken(token, PROJECT_ID)).rejects.toThrow()
  })

  it('respects Cache-Control max-age and does not re-fetch keys within the TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (name) => (name.toLowerCase() === 'cache-control' ? 'public, max-age=21600' : null) },
      json: async () => ({ keys: [jwk] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const token1 = signRS256({}, privateKey)
    const token2 = signRS256({ sub: 'user-456' }, privateKey)
    await verifyFirebaseIdToken(token1, PROJECT_ID)
    await verifyFirebaseIdToken(token2, PROJECT_ID)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
