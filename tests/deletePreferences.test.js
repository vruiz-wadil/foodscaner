import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

// NOTA DE ADAPTACIÓN (misma razón que en los tests anteriores): createRequire
// + mutación de propiedades del objeto real de module.exports de
// firestore.js en vez de vi.mock (no intercepta el require anidado dentro de
// api/index.js).
const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const firePatchUserFields = vi.fn()
firestoreModule.firePatchUserFields = firePatchUserFields

const { deletePreferencesHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('deletePreferencesHandler', () => {
  beforeEach(() => { firePatchUserFields.mockReset() })

  it('deletes the entire preferences field via updateMask (derechos ARCO)', async () => {
    firePatchUserFields.mockResolvedValue(true)
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await deletePreferencesHandler(req, res)

    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['preferences'], {})
    expect(res.body).toEqual({ ok: true })
  })

  it('responds 500 on a Firestore failure', async () => {
    firePatchUserFields.mockRejectedValue(new Error('Firestore down'))
    const req = { user: { uid: 'uid-2' } }
    const res = makeRes()

    await deletePreferencesHandler(req, res)

    expect(res.statusCode).toBe(500)
  })
})
