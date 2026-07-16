import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'

// NOTA DE ADAPTACIÓN (desviación del plan): el plan original usaba
// `vi.mock('../api/auth.js', () => ({ verifyFirebaseIdToken: vi.fn() }))`. Eso
// no funciona en este repo: api/index.js es CommonJS y hace
// `require('./auth')` internamente, y vi.mock (via vite-node) no intercepta
// requires anidados de un módulo CJS cargado por otro módulo CJS — solo
// intercepta el import de nivel superior hecho directamente por el archivo de
// test. Se confirmó con un repro aislado (dos módulos CJS triviales) antes de
// escribir esta adaptación. En su lugar, obtenemos el objeto real de
// module.exports de api/auth.js vía `createRequire` (el mismo objeto que
// Node cachea y que index.js recibirá en su propio require) y reemplazamos
// la propiedad con un vi.fn() ANTES de importar api/index.js — así
// `const { verifyFirebaseIdToken } = require('./auth')` dentro de index.js
// captura directamente nuestro mock. El resto de la lógica del test
// (mockReset/mockResolvedValue/mockRejectedValue) es idéntica al plan.
const requireFn = createRequire(import.meta.url)
const authModule = requireFn('../api/auth.js')
const verifyFirebaseIdToken = vi.fn()
authModule.verifyFirebaseIdToken = verifyFirebaseIdToken

const { requireUser } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('requireUser', () => {
  const ORIGINAL_PROJECT_ID = process.env.FIREBASE_PROJECT_ID

  beforeEach(() => {
    verifyFirebaseIdToken.mockReset()
    process.env.FIREBASE_PROJECT_ID = 'foodscaner-dev'
  })

  afterEach(() => {
    process.env.FIREBASE_PROJECT_ID = ORIGINAL_PROJECT_ID
  })

  it('attaches req.user = {uid, email, emailVerified} and calls next() on a valid token', async () => {
    verifyFirebaseIdToken.mockResolvedValue({ uid: 'user-123', email: 'user@example.com', emailVerified: true })
    const req = { get: (name) => (name.toLowerCase() === 'authorization' ? 'Bearer valid-token' : undefined) }
    const res = makeRes()
    const next = vi.fn()

    await requireUser(req, res, next)

    expect(req.user).toEqual({ uid: 'user-123', email: 'user@example.com', emailVerified: true })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('responds 401 when there is no Authorization header', async () => {
    const req = { get: () => undefined }
    const res = makeRes()
    const next = vi.fn()

    await requireUser(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'unauthorized' })
    expect(next).not.toHaveBeenCalled()
  })

  it('responds 401 when the Authorization header is not Bearer', async () => {
    const req = { get: (name) => (name.toLowerCase() === 'authorization' ? 'Basic abc123' : undefined) }
    const res = makeRes()
    const next = vi.fn()

    await requireUser(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('responds 401 when verifyFirebaseIdToken rejects (invalid/expired token)', async () => {
    verifyFirebaseIdToken.mockRejectedValue(new Error('Token expirado'))
    const req = { get: (name) => (name.toLowerCase() === 'authorization' ? 'Bearer expired-token' : undefined) }
    const res = makeRes()
    const next = vi.fn()

    await requireUser(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'unauthorized' })
    expect(next).not.toHaveBeenCalled()
  })

  it('responds 503 when FIREBASE_PROJECT_ID is not configured', async () => {
    delete process.env.FIREBASE_PROJECT_ID
    const req = { get: (name) => (name.toLowerCase() === 'authorization' ? 'Bearer valid-token' : undefined) }
    const res = makeRes()
    const next = vi.fn()

    await requireUser(req, res, next)

    expect(res.statusCode).toBe(503)
    expect(next).not.toHaveBeenCalled()
  })
})
