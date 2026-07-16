import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

// NOTA DE ADAPTACIÓN (misma razón que en los tests anteriores): se usa
// createRequire para mutar fireGetUser en el objeto real de module.exports
// de firestore.js, en vez de vi.mock (que no intercepta el require anidado
// dentro de api/index.js).
const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const fireGetUser = vi.fn()
firestoreModule.fireGetUser = fireGetUser

const { getMeHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('getMeHandler', () => {
  beforeEach(() => { fireGetUser.mockReset() })

  it('returns the profile without preferences for a free-plan user', async () => {
    fireGetUser.mockResolvedValue({ email: 'a@b.com', plan: 'free' })
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.body).toEqual({ uid: 'uid-1', email: 'a@b.com', plan: 'free' })
  })

  it('includes preferences for a premium-plan user', async () => {
    fireGetUser.mockResolvedValue({
      email: 'a@b.com', plan: 'premium',
      preferences: { dietary: ['vegan'], allergens: [], healthConditions: [] }
    })
    const req = { user: { uid: 'uid-2' } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.body.preferences).toEqual({ dietary: ['vegan'], allergens: [], healthConditions: [] })
  })

  it('never includes preferences for a free-plan user even if present in the doc (defensive)', async () => {
    fireGetUser.mockResolvedValue({ email: 'a@b.com', plan: 'free', preferences: { dietary: ['vegan'] } })
    const req = { user: { uid: 'uid-3' } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.body.preferences).toBeUndefined()
  })

  it('responds 404 when the user document does not exist', async () => {
    fireGetUser.mockResolvedValue(null)
    const req = { user: { uid: 'uid-missing' } }
    const res = makeRes()

    await getMeHandler(req, res)

    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: 'user_not_found' })
  })
})
