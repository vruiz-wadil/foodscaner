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

  it('incluye image en el entry cuando el body trae una URL string válida', async () => {
    fireLogUserHistory.mockResolvedValue({ id: 'abc' })
    const req = { user: { uid: 'uid-2' }, body: { barcode: '111', productName: 'A', verdict: 'sano', image: 'https://example.com/p.jpg' } }
    const res = makeRes()
    await postHistoryHandler(req, res)
    expect(fireLogUserHistory).toHaveBeenCalledWith('uid-2', expect.objectContaining({ image: 'https://example.com/p.jpg' }))
  })

  it('omite image silenciosamente si no viene en el body (no rompe el log)', async () => {
    fireLogUserHistory.mockResolvedValue({ id: 'abc' })
    const req = { user: { uid: 'uid-2' }, body: { barcode: '111', productName: 'A', verdict: 'sano' } }
    const res = makeRes()
    await postHistoryHandler(req, res)
    const entry = fireLogUserHistory.mock.calls[0][1]
    expect(entry.image).toBeUndefined()
    expect(res.body).toEqual({ ok: true, id: 'abc' })
  })

  it('omite image silenciosamente si excede MAX_IMAGE_URL_LEN (no rechaza la petición)', async () => {
    fireLogUserHistory.mockResolvedValue({ id: 'abc' })
    const longUrl = 'https://example.com/' + 'a'.repeat(500)
    const req = { user: { uid: 'uid-2' }, body: { barcode: '111', productName: 'A', verdict: 'sano', image: longUrl } }
    const res = makeRes()
    await postHistoryHandler(req, res)
    const entry = fireLogUserHistory.mock.calls[0][1]
    expect(entry.image).toBeUndefined()
    expect(res.body).toEqual({ ok: true, id: 'abc' })
  })

  it('omite image silenciosamente si no es un string', async () => {
    fireLogUserHistory.mockResolvedValue({ id: 'abc' })
    const req = { user: { uid: 'uid-2' }, body: { barcode: '111', productName: 'A', verdict: 'sano', image: 12345 } }
    const res = makeRes()
    await postHistoryHandler(req, res)
    const entry = fireLogUserHistory.mock.calls[0][1]
    expect(entry.image).toBeUndefined()
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
