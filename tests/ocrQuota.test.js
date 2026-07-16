import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import { createRequire } from 'module'

const { ocrProcessHandler, optionalUser } = await import('../api/index.js')
// NOTA DE ADAPTACIÓN: `await import('../api/auth.js')` carga una instancia
// de módulo SEPARADA de la que api/index.js usa internamente vía
// `require('./auth')` (mismo motivo que las adaptaciones de las tasks
// anteriores: import ESM del test vs. require anidado CJS dentro de
// index.js no comparten registro/instancia en este entorno). Llamar
// `_resetJwksCacheForTests()` desde la copia ESM no limpiaba el
// `_jwksCache` real que usa `verifyFirebaseIdToken` dentro de optionalUser
// — el JWK del test anterior seguía cacheado y la firma del token,
// generado con un keypair nuevo cada test, dejaba de coincidir ("Firma
// inválida"), tumbando en silencio a "usuario anónimo". Se usa
// createRequire para obtener la MISMA instancia real que index.js usa.
const requireFn = createRequire(import.meta.url)
const { _resetJwksCacheForTests } = requireFn('../api/auth.js')

// NOTA DE ADAPTACIÓN: el plan original invocaba `ocrProcessHandler(req, res)`
// directamente esperando que `req.user` ya estuviera poblado, pero en la app
// real eso lo hace el middleware `optionalUser` montado antes en la ruta
// (`app.post('/api/ocr/process', optionalUser, ocrProcessHandler)`) — al
// llamar el handler solo, sin pasar por Express, `req.user` nunca se asigna
// y todos los casos "logueado" terminaban comportándose como anónimos
// (siempre 200 ok), ocultando que la cuota nunca se aplicaba. Se corrige
// encadenando `optionalUser` antes de `ocrProcessHandler` en cada test, tal
// como Express lo haría — el resto de la lógica del test (firma del JWT,
// mocks de JWKS/Firestore/Groq, aserciones) es idéntico al plan.
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
  if (obj.plan) f.plan = { stringValue: obj.plan }
  if (obj.usage) f.usage = { mapValue: { fields: {
    date: { stringValue: obj.usage.date },
    ocrCount: { integerValue: String(obj.usage.ocrCount) },
    cacheRefreshCount: { integerValue: String(obj.usage.cacheRefreshCount || 0) }
  } } }
  return f
}

describe('ocrProcessHandler — enforcement de cuota', () => {
  let privateKey, jwk

  beforeEach(() => {
    // NOTA DE ADAPTACIÓN: el plan no reseteaba el cache de JWKS (module-level
    // en api/auth.js, TTL de hasta 6h vía Cache-Control) entre tests. Cada
    // test genera un keypair RSA nuevo con el mismo `kid`, así que sin este
    // reset, el 2do test en adelante firma con una llave privada que ya no
    // coincide con el JWK cacheado del 1er test que disparó el fetch — la
    // verificación de firma falla, req.user queda null, y el test degenera a
    // "usuario anónimo" en silencio (varios tests "pasaban" solo porque el
    // camino anónimo también responde 'ok'). tests/auth.test.js sí lo hacía
    // bien; se replica aquí.
    _resetJwksCacheForTests()
    // NOTA DE ADAPTACIÓN: el plan hardcodea usage.date: '2026-07-15' en los
    // mocks de Firestore, pero ocrProcessHandler compara ese valor contra
    // `new Date().toISOString().slice(0,10)` (fecha REAL del sistema, no la
    // fecha "de la conversación"). Sin fijar el reloj, la comparación
    // `usage.date === today` casi nunca es true, así que currentCount cae
    // por default a 0 y el chequeo de cuota (429 en 5/5) nunca se ejercita
    // de verdad. tests/firestore-usage.test.js (Task 8) sí fija el reloj con
    // vi.setSystemTime para el mismo escenario; se replica aquí.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
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

  it('usuario no logueado pasa sin medir cuota (comportamiento actual sin cambios)', async () => {
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

  it('usuario free con email no verificado → 403, no llama a Groq', async () => {
    const token = signRS256({ email_verified: false }, privateKey)
    let groqCalled = false
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ plan: 'free', usage: { date: '2026-07-15', ocrCount: 1 } }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) { groqCalled = true; return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) } }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'email_not_verified' })
    expect(groqCalled).toBe(false)
  })

  it('usuario premium con email no verificado → procesa normal (el chequeo de email solo protege la cuota free)', async () => {
    const token = signRS256({ email_verified: false }, privateKey)
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        if (options.method === 'PATCH') return { ok: true, status: 200 }
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ plan: 'premium', usage: { date: '2026-07-15', ocrCount: 40 } }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) return { ok: true, json: async () => ({ choices: [{ message: { content: 'ingredientes: harina' } }] }) }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.body.status).toBe('ok')
  })

  it('usuario free bajo cuota (2/5) → procesa, responde ok, e incrementa el contador', async () => {
    const token = signRS256({}, privateKey)
    let incrementPatchCalled = false
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        if (options.method === 'PATCH') { incrementPatchCalled = true; return { ok: true, status: 200 } }
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ plan: 'free', usage: { date: '2026-07-15', ocrCount: 2 } }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) return { ok: true, json: async () => ({ choices: [{ message: { content: 'ingredientes: harina' } }] }) }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.body.status).toBe('ok')
    expect(incrementPatchCalled).toBe(true)
  })

  it('usuario free en el límite (5/5) → 429 quota_exceeded, no llama a Groq', async () => {
    const token = signRS256({}, privateKey)
    let groqCalled = false
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ plan: 'free', usage: { date: '2026-07-15', ocrCount: 5 } }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) { groqCalled = true; return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) } }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.statusCode).toBe(429)
    expect(res.body).toEqual({ error: 'quota_exceeded', limit: 5 })
    expect(groqCalled).toBe(false)
  })

  it('usuario premium sin límite, aunque ocrCount ya sea alto, y no intenta incrementar', async () => {
    const token = signRS256({}, privateKey)
    let incrementPatchCalled = false
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        if (options.method === 'PATCH') { incrementPatchCalled = true; return { ok: true, status: 200 } }
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ plan: 'premium', usage: { date: '2026-07-15', ocrCount: 40 } }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.body.status).toBe('ok')
    expect(incrementPatchCalled).toBe(false)
  })
})
