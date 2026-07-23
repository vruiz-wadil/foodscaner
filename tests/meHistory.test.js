import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

// NOTA DE ADAPTACIÓN (mismo patrón que tests/getMe.test.js y tests/putPreferences.test.js):
// se usa createRequire para mutar fireGetUser/fireLogUserHistory/fireListUserHistory en el
// objeto real de module.exports de firestore.js, en vez de vi.mock (que no intercepta el
// require anidado dentro de api/index.js).
const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const fireGetUser = vi.fn()
const fireLogUserHistory = vi.fn()
const fireListUserHistory = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.fireLogUserHistory = fireLogUserHistory
firestoreModule.fireListUserHistory = fireListUserHistory

const { postHistoryHandler, getHistoryHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('postHistoryHandler', () => {
  beforeEach(() => { fireGetUser.mockReset(); fireLogUserHistory.mockReset() })

  it('logs the entry for a premium user with a server-set scannedAt', async () => {
    fireLogUserHistory.mockResolvedValue({ id: 'abc' })
    const req = { user: { uid: 'uid-2' }, body: { barcode: '111', productName: 'A', verdict: 'sano' } }
    const res = makeRes()
    await postHistoryHandler(req, res)
    expect(fireLogUserHistory).toHaveBeenCalledWith('uid-2', expect.objectContaining({ barcode: '111', productName: 'A', verdict: 'sano' }))
    expect(res.body).toEqual({ ok: true, id: 'abc' })
  })
})

describe('getHistoryHandler', () => {
  beforeEach(() => { fireGetUser.mockReset(); fireListUserHistory.mockReset() })

  it('returns the entry list for a premium user', async () => {
    fireListUserHistory.mockResolvedValue([{ barcode: '111', productName: 'A', verdict: 'sano', scannedAt: 't' }])
    const req = { user: { uid: 'uid-2' } }
    const res = makeRes()
    await getHistoryHandler(req, res)
    expect(res.body).toEqual({ history: [{ barcode: '111', productName: 'A', verdict: 'sano', scannedAt: 't' }] })
  })
})
