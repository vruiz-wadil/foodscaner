import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

// NOTA DE ADAPTACIÓN (misma razón que en los tests anteriores): createRequire
// + mutación de propiedades del objeto real de module.exports de
// firestore.js en vez de vi.mock (no intercepta el require anidado dentro de
// api/index.js).
const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const fireGetUser = vi.fn()
const firePatchUserFields = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.firePatchUserFields = firePatchUserFields

const { putPreferencesHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('putPreferencesHandler', () => {
  beforeEach(() => {
    fireGetUser.mockReset()
    firePatchUserFields.mockReset()
  })

  it('updates preferences with an explicit nested updateMask for a premium user', async () => {
    firePatchUserFields.mockResolvedValue(true)
    const req = {
      user: { uid: 'uid-2' },
      body: {
        dietary: ['vegan', 'glutenFree'],
        allergens: [{ code: 'cacahuate', severity: 'severe' }],
        healthConditions: ['diabet'],
        consent: true,
        consentNoticeVersion: 'aviso-v1'
      }
    }
    const res = makeRes()

    await putPreferencesHandler(req, res)

    expect(firePatchUserFields).toHaveBeenCalledWith(
      'uid-2',
      ['preferences.dietary', 'preferences.allergens', 'preferences.healthConditions', 'preferences.consentGivenAt', 'preferences.consentNoticeVersion', 'preferences.updatedAt'],
      expect.objectContaining({
        preferences: expect.objectContaining({
          dietary: ['vegan', 'glutenFree'],
          allergens: [{ code: 'cacahuate', severity: 'severe' }],
          healthConditions: ['diabet']
        })
      })
    )
    expect(res.body.ok).toBe(true)
  })

  it('rejects an unknown dietary key with 400', async () => {
    const req = { user: { uid: 'uid-3' }, body: { dietary: ['not-a-real-diet'], allergens: [], healthConditions: [], consent: true } }
    const res = makeRes()

    await putPreferencesHandler(req, res)

    expect(res.statusCode).toBe(400)
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('rejects an allergen with an invalid severity with 400', async () => {
    const req = {
      user: { uid: 'uid-4' },
      body: { dietary: [], allergens: [{ code: 'leche', severity: 'extreme' }], healthConditions: [], consent: true }
    }
    const res = makeRes()

    await putPreferencesHandler(req, res)

    expect(res.statusCode).toBe(400)
  })

  it('never merges the raw body directly — a spurious "plan" field cannot reach Firestore', async () => {
    firePatchUserFields.mockResolvedValue(true)
    const req = {
      user: { uid: 'uid-5' },
      body: { dietary: [], allergens: [], healthConditions: [], consent: true, plan: 'premium-forever' }
    }
    const res = makeRes()

    await putPreferencesHandler(req, res)

    const [, , data] = firePatchUserFields.mock.calls[0]
    expect(data.plan).toBeUndefined()
  })

  it('responds 400 consent_required when consent is missing or false (hallazgo de revisión legal/seguridad: el checkbox de preferences-ui.js solo valida en cliente — el servidor debe exigirlo también)', async () => {
    const req = {
      user: { uid: 'uid-6' },
      body: { dietary: ['vegan'], allergens: [], healthConditions: [], consent: false }
    }
    const res = makeRes()

    await putPreferencesHandler(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'consent_required' })
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('stores consentGivenAt and consentNoticeVersion as evidence of expreso consent when consent is true', async () => {
    firePatchUserFields.mockResolvedValue(true)
    const req = {
      user: { uid: 'uid-7' },
      body: { dietary: ['vegan'], allergens: [], healthConditions: [], consent: true, consentNoticeVersion: 'aviso-v1' }
    }
    const res = makeRes()

    await putPreferencesHandler(req, res)

    const [, fieldPaths, data] = firePatchUserFields.mock.calls[0]
    expect(fieldPaths).toContain('preferences.consentGivenAt')
    expect(fieldPaths).toContain('preferences.consentNoticeVersion')
    expect(data.preferences.consentNoticeVersion).toBe('aviso-v1')
    expect(typeof data.preferences.consentGivenAt).toBe('string')
  })
})
