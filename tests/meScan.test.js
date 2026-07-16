import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

// createRequire + mutación de propiedades del objeto real de module.exports
// de firestore.js en vez de vi.mock (no intercepta el require anidado
// dentro de api/index.js) — mismo patrón que tests/deletePreferences.test.js
// y tests/authSync.test.js. No se restaura al final: cada archivo de test
// corre en su propio contexto de módulos aislado por vitest.
const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const fireIncrementUsageCounter = vi.fn()
firestoreModule.fireIncrementUsageCounter = fireIncrementUsageCounter

const { postScanHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('postScanHandler', () => {
  beforeEach(() => { fireIncrementUsageCounter.mockReset() })

  it('incrementa totalScans para un usuario free (sin gate premium)', async () => {
    fireIncrementUsageCounter.mockResolvedValue({ date: '2026-07-16', ocrCount: 0, cacheRefreshCount: 0, totalScans: 5 })
    const req = { user: { uid: 'uid-free' } }
    const res = makeRes()

    await postScanHandler(req, res)

    expect(fireIncrementUsageCounter).toHaveBeenCalledWith('uid-free', 'totalScans')
    expect(res.body).toEqual({ ok: true })
  })

  it('incrementa totalScans igual para un usuario premium', async () => {
    fireIncrementUsageCounter.mockResolvedValue({ date: '2026-07-16', ocrCount: 0, cacheRefreshCount: 0, totalScans: 40 })
    const req = { user: { uid: 'uid-premium' } }
    const res = makeRes()

    await postScanHandler(req, res)

    expect(fireIncrementUsageCounter).toHaveBeenCalledWith('uid-premium', 'totalScans')
    expect(res.body).toEqual({ ok: true })
  })

  it('responde 500 si Firestore falla, sin lanzar', async () => {
    fireIncrementUsageCounter.mockRejectedValue(new Error('firestore down'))
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await postScanHandler(req, res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'internal_error' })
  })
})
