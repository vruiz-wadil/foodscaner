import { describe, it, expect, vi, afterEach } from 'vitest'
import crypto from 'crypto'

const { fireGetUser, fireUpsertUser, firePatchUserFields } = await import('../api/firestore.js')

function buildFetchMock(userDocHandler) {
  return vi.fn(async (url, options = {}) => {
    if (url.includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'fake-access-token', expires_in: 3600 }) }
    }
    return userDocHandler(url, options)
  })
}

function fakeServiceAccountKey() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  })
  return JSON.stringify({
    project_id: 'foodscaner-test',
    client_email: 'test@foodscaner-test.iam.gserviceaccount.com',
    private_key: privateKey
  })
}

describe('users/{uid} data layer', () => {
  const ORIGINAL_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = ORIGINAL_KEY
  })

  it('fireGetUser returns null when the document does not exist (404)', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({ status: 404, ok: false })))
    const result = await fireGetUser('uid-does-not-exist')
    expect(result).toBeNull()
  })

  it('fireGetUser converts native Firestore fields into a plain object', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        fields: {
          email: { stringValue: 'user@example.com' },
          emailVerified: { booleanValue: true },
          plan: { stringValue: 'free' },
          providers: { arrayValue: { values: [{ stringValue: 'password' }] } },
          usage: { mapValue: { fields: {
            date: { stringValue: '2026-07-15' },
            ocrCount: { integerValue: '2' },
            cacheRefreshCount: { integerValue: '0' }
          } } }
        }
      })
    })))
    const result = await fireGetUser('uid-123')
    expect(result).toEqual({
      email: 'user@example.com',
      emailVerified: true,
      plan: 'free',
      providers: ['password'],
      usage: { date: '2026-07-15', ocrCount: 2, cacheRefreshCount: 0 }
    })
  })

  it('fireUpsertUser creates a new doc with plan:"free" when none exists (no updateMask — creación completa)', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    const patchCalls = []
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) return { status: 404, ok: false }
      patchCalls.push({ url, body: JSON.parse(options.body) })
      return { ok: true, status: 200 }
    }))

    await fireUpsertUser('uid-new', { email: 'new@example.com', providers: ['password'] })

    expect(patchCalls.length).toBe(1)
    expect(patchCalls[0].url).not.toContain('updateMask')
    expect(patchCalls[0].body.fields.plan.stringValue).toBe('free')
    expect(patchCalls[0].body.fields.usage.mapValue.fields.ocrCount.integerValue).toBe('0')
    expect(patchCalls[0].body.fields.billing.mapValue.fields.isFounderPricing.booleanValue).toBe(false)
    expect(patchCalls[0].body.fields.billing.mapValue.fields.billingCycle).toEqual({ nullValue: null })
  })

  it('fireUpsertUser only updates lastLoginAt/providers when the doc already exists', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    const patchCalls = []
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return { ok: true, status: 200, json: async () => ({ fields: { plan: { stringValue: 'premium' } } }) }
      }
      patchCalls.push({ url, body: JSON.parse(options.body) })
      return { ok: true, status: 200 }
    }))

    await fireUpsertUser('uid-existing', { providers: ['password', 'google.com'] })

    expect(patchCalls.length).toBe(1)
    expect(patchCalls[0].url).toContain('updateMask.fieldPaths=lastLoginAt')
    expect(patchCalls[0].url).toContain('updateMask.fieldPaths=providers')
    expect(patchCalls[0].body.fields.plan).toBeUndefined()
  })

  it('firePatchUserFields sends an explicit updateMask.fieldPaths for only the given fields', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedUrl, capturedBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      capturedUrl = url
      capturedBody = JSON.parse(options.body)
      return { ok: true, status: 200 }
    }))

    await firePatchUserFields('uid-1', ['dietary', 'allergens', 'healthConditions'], {
      dietary: ['vegan'],
      allergens: [{ code: 'cacahuate', severity: 'severe' }],
      healthConditions: ['diabet']
    })

    expect(capturedUrl).toContain('updateMask.fieldPaths=dietary')
    expect(capturedUrl).toContain('updateMask.fieldPaths=allergens')
    expect(capturedUrl).toContain('updateMask.fieldPaths=healthConditions')
    expect(capturedBody.fields.dietary.arrayValue.values[0].stringValue).toBe('vegan')
    expect(capturedBody.fields.allergens.arrayValue.values[0].mapValue.fields.code.stringValue).toBe('cacahuate')
  })

  it('firePatchUserFields deletes a field when omitted from data but present in fieldPaths', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedUrl, capturedBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      capturedUrl = url
      capturedBody = JSON.parse(options.body)
      return { ok: true, status: 200 }
    }))

    await firePatchUserFields('uid-1', ['preferences'], {})

    expect(capturedUrl).toContain('updateMask.fieldPaths=preferences')
    expect(capturedBody.fields).toEqual({})
  })

  // Cobertura de conversión de tipos (hallazgo de cobertura de la 4a ronda —
  // Test Results Analyzer): doubleValue y objetos anidados a 2 niveles solo
  // se ejercitaban indirectamente antes; se agregan casos explícitos.
  it('fireGetUser convierte doubleValue y objetos anidados a 2 niveles correctamente', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({
      ok: true, status: 200,
      json: async () => ({ fields: {
        billing: { mapValue: { fields: {
          currentPeriodEnd: { nullValue: null },
          isFounderPricing: { booleanValue: false },
          trialScore: { doubleValue: 4.5 }
        } } }
      } })
    })))
    const result = await fireGetUser('uid-decimal')
    expect(result).toEqual({ billing: { currentPeriodEnd: null, isFounderPricing: false, trialScore: 4.5 } })
  })

  it('firePatchUserFields envía un arreglo vacío explícito tal cual (ej. borrar todos los allergens)', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      capturedBody = JSON.parse(options.body)
      return { ok: true, status: 200 }
    }))
    await firePatchUserFields('uid-1', ['allergens'], { allergens: [] })
    expect(capturedBody.fields.allergens).toEqual({ arrayValue: { values: [] } })
  })
})
