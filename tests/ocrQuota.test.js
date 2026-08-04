import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import { createRequire } from 'module'

const { ocrProcessHandler, optionalUser } = await import('../api/index.js')
const requireFn = createRequire(import.meta.url)
const { _resetJwksCacheForTests } = requireFn('../api/auth.js')

async function runOcrRoute(req, res) {
  await new Promise((resolve) => optionalUser(req, res, resolve));
  await ocrProcessHandler(req, res);
}

const PROJECT_ID = 'foodscaner-dev'
const KID = 'test-kid-ocr'

function b64url(input) { return Buffer.from(input).toString('base64url') }

function signRS256(payloadOverrides, privateKey) {
  const header = { alg: 'RS256', typ: 'JWT', kid: KID }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID, sub: 'user-1', iat: now, exp: now + 3600,
    email: 'user@example.com', email_verified: true,
    ...payloadOverrides
  }
  const headerB64 = b64url(JSON.stringify(header))
  const payloadB64 = b64url(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey)
  return `${signingInput}.${signature.toString('base64url')}`
}

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

function toFields(obj) {
  const f = {}
  if (obj.membershipStatus) f.membershipStatus = { stringValue: obj.membershipStatus }
  return f
}

describe('ocrProcessHandler — gate de membresía', () => {
  let privateKey, jwk

  beforeEach(() => {
    _resetJwksCacheForTests()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T12:00:00Z'))
    process.env.FIREBASE_PROJECT_ID = PROJECT_ID
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    privateKey = keyPair.privateKey
    jwk = keyPair.publicKey.export({ format: 'jwk' })
    jwk.kid = KID
    jwk.alg = 'RS256'
    jwk.use = 'sig'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('usuario no logueado pasa sin restricción (comportamiento actual sin cambios, fuera de alcance)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('api.groq.com')) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'ingredientes: harina' } }] }) }
      }
      return { ok: true, status: 200 }
    }))
    const req = { get: () => undefined, body: { imageData: 'base64...' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.body.status).toBe('ok')
  })

  it('usuario logueado sin membresía activa procesa OCR igual (freemium, no bloquea por membresía)', async () => {
    const token = signRS256({}, privateKey)
    let groqCalled = false
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ membershipStatus: 'pending' }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) { groqCalled = true; return { ok: true, json: async () => ({ choices: [{ message: { content: 'ingredientes: harina' } }] }) } }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(groqCalled).toBe(true)
  })

  it('usuario logueado con membershipStatus "active" → procesa normal, sin límite', async () => {
    const token = signRS256({}, privateKey)
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ membershipStatus: 'active' }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) return { ok: true, json: async () => ({ choices: [{ message: { content: 'ingredientes: harina' } }] }) }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.body.status).toBe('ok')
  })

  it('descarta el bloque <think>...</think> de qwen3.6-27b (modelo de razonamiento) antes de usar el contenido', async () => {
    const token = signRS256({}, privateKey)
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ membershipStatus: 'active' }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: '<think>razonando sobre la imagen...</think>ingredientes: harina, azúcar' } }] }) }
      }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.body.cleanedText).toBe('ingredientes: harina, azúcar')
  })

  it('si Groq falla, cae a Gemini y procesa igual (fallback de resiliencia)', async () => {
    const token = signRS256({}, privateKey)
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ membershipStatus: 'active' }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) return { ok: false, status: 503 }
      if (url.includes('generativelanguage.googleapis.com')) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ingredientes: harina (via gemini)' }] } }] }) }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.body.status).toBe('ok')
    expect(res.body.cleanedText).toBe('ingredientes: harina (via gemini)')
  })
})
