import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

// NOTA DE ADAPTACIÓN (misma razón que en tests/requireUser.test.js): el plan
// original usaba `vi.mock('../api/firestore.js', async (importOriginal) => ...)`.
// Eso no intercepta el require('./firestore') interno de api/index.js (CJS
// anidado dentro de CJS no pasa por el registro de mocks de vite-node). Se
// usa createRequire para obtener el objeto real de module.exports de
// firestore.js y reemplazar solo `fireUpsertUser` con un vi.fn() antes de
// importar api/index.js — el resto de las funciones reales quedan intactas.
const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const fireUpsertUser = vi.fn()
firestoreModule.fireUpsertUser = fireUpsertUser

const { authSyncHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('authSyncHandler', () => {
  beforeEach(() => { fireUpsertUser.mockReset() })

  it('upserts the user doc using req.user and responds { ok: true }', async () => {
    fireUpsertUser.mockResolvedValue({ created: true })
    const req = { user: { uid: 'user-123', email: 'user@example.com' }, body: { providers: ['password'] } }
    const res = makeRes()

    await authSyncHandler(req, res)

    expect(fireUpsertUser).toHaveBeenCalledWith('user-123', expect.objectContaining({
      email: 'user@example.com', providers: ['password']
    }))
    expect(res.body).toEqual({ ok: true })
  })

  it('does not block on a transient Firestore failure and still responds ok:true', async () => {
    fireUpsertUser.mockRejectedValue(new Error('Firestore unavailable'))
    const req = { user: { uid: 'user-456', email: 'x@example.com' }, body: {} }
    const res = makeRes()

    await authSyncHandler(req, res)

    expect(res.body).toEqual({ ok: true, warning: 'sync_deferred' })
  })
})
