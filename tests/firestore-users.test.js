import { describe, it, expect, vi, afterEach } from 'vitest'
import crypto from 'crypto'

const { fireGetUser, fireUpsertUser, firePatchUserFields, findUserByEmail, fireListUsers } = await import('../api/firestore.js')

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

  it('fireUpsertUser creates a new doc with membershipStatus:"pending" when none exists (no updateMask — creación completa)', async () => {
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
    expect(patchCalls[0].body.fields.membershipStatus.stringValue).toBe('pending')
    expect(patchCalls[0].body.fields.membershipExpiresAt).toEqual({ nullValue: null })
    expect(patchCalls[0].body.fields.lastPaymentAt).toEqual({ nullValue: null })
    expect(patchCalls[0].body.fields.autoRenew).toEqual({ booleanValue: false })
    expect(patchCalls[0].body.fields.paymentHistory).toEqual({ arrayValue: { values: [] } })
    expect(patchCalls[0].body.fields.profile.mapValue.fields.displayName).toEqual({ nullValue: null })
    expect(patchCalls[0].body.fields.profile.mapValue.fields.completedAt).toEqual({ nullValue: null })
    expect(patchCalls[0].body.fields.usage.mapValue.fields.ocrCount).toBeUndefined()
    expect(patchCalls[0].body.fields.usage.mapValue.fields.cacheRefreshCount.integerValue).toBe('0')
    expect(patchCalls[0].body.fields.billing.mapValue.fields.isFounderPricing.booleanValue).toBe(false)
    expect(patchCalls[0].body.fields.plan).toBeUndefined()
    expect(patchCalls[0].body.fields.disabled).toBeUndefined()
  })

  it('fireUpsertUser stores phoneNumber on the creation doc', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    const patchCalls = []
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) return { status: 404, ok: false }
      patchCalls.push({ url, body: JSON.parse(options.body) })
      return { ok: true, status: 200 }
    }))

    await fireUpsertUser('uid-phone', { phoneNumber: '+525512345678', providers: [] })

    expect(patchCalls[0].body.fields.phoneNumber.stringValue).toBe('+525512345678')
  })

  it('fireUpsertUser stores phoneNumber:null on creation when not provided (email-only signup)', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    const patchCalls = []
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) return { status: 404, ok: false }
      patchCalls.push({ url, body: JSON.parse(options.body) })
      return { ok: true, status: 200 }
    }))

    await fireUpsertUser('uid-email-only', { email: 'a@b.com', providers: ['password'] })

    expect(patchCalls[0].body.fields.phoneNumber).toEqual({ nullValue: null })
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
    expect(patchCalls[0].body.fields.membershipStatus).toBeUndefined()
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

  it('findUserByEmail devuelve el uid del primer documento cuando hay match exacto por email', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      capturedBody = JSON.parse(options.body)
      return {
        ok: true,
        status: 200,
        json: async () => ([
          { document: { name: 'projects/foodscaner-test/databases/(default)/documents/users/uid-abc123', fields: {} } }
        ])
      }
    }))

    const uid = await findUserByEmail('user@example.com')

    expect(uid).toBe('uid-abc123')
    expect(capturedBody.structuredQuery.from).toEqual([{ collectionId: 'users' }])
    expect(capturedBody.structuredQuery.where).toEqual({
      fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: 'user@example.com' } }
    })
    expect(capturedBody.structuredQuery.limit).toBe(1)
  })

  it('findUserByEmail devuelve null cuando no hay match', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({
      ok: true,
      status: 200,
      json: async () => ([{}]) // runQuery responde [{}] (sin .document) cuando no hay resultados
    })))

    const uid = await findUserByEmail('nadie@example.com')

    expect(uid).toBeNull()
  })

  it('findUserByEmail lanza cuando Firestore responde error', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({ ok: false, status: 500 })))

    await expect(findUserByEmail('user@example.com')).rejects.toThrow('find user by email failed: 500')
  })

  it('fireListUsers arma la structuredQuery con orderBy createdAt DESC y limit 50, sin startAt cuando no hay pageToken', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      capturedBody = JSON.parse(options.body)
      return { ok: true, status: 200, json: async () => ([]) }
    }))

    await fireListUsers(null)

    expect(capturedBody.structuredQuery.from).toEqual([{ collectionId: 'users' }])
    expect(capturedBody.structuredQuery.orderBy).toEqual([{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }])
    expect(capturedBody.structuredQuery.limit).toBe(50)
    expect(capturedBody.structuredQuery.startAt).toBeUndefined()
  })

  it('fireListUsers agrega startAt (before:false) cuando se pasa pageToken', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      capturedBody = JSON.parse(options.body)
      return { ok: true, status: 200, json: async () => ([]) }
    }))

    await fireListUsers('2026-07-20T10:00:00.000Z')

    expect(capturedBody.structuredQuery.startAt).toEqual({ values: [{ stringValue: '2026-07-20T10:00:00.000Z' }], before: false })
  })

  it('fireListUsers mapea cada documento a la fila liviana {uid, email, phoneNumber, displayName, membershipStatus, createdAt}', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({
      ok: true,
      status: 200,
      json: async () => ([
        { document: {
          name: 'projects/foodscaner-test/databases/(default)/documents/users/uid-1',
          fields: {
            email: { stringValue: 'a@b.com' },
            phoneNumber: { stringValue: '+525512345678' },
            displayName: { stringValue: 'Ana' },
            membershipStatus: { stringValue: 'active' },
            createdAt: { stringValue: '2026-07-21T09:00:00.000Z' }
          }
        } }
      ])
    })))

    const result = await fireListUsers(null)

    expect(result.items).toEqual([{
      uid: 'uid-1', email: 'a@b.com', phoneNumber: '+525512345678',
      displayName: 'Ana', membershipStatus: 'active', createdAt: '2026-07-21T09:00:00.000Z'
    }])
  })

  it('fireListUsers devuelve nextPageToken:null cuando la página trae menos de 50 items', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({
      ok: true,
      status: 200,
      json: async () => ([
        { document: { name: 'projects/foodscaner-test/databases/(default)/documents/users/uid-1', fields: { createdAt: { stringValue: '2026-07-21T09:00:00.000Z' } } } }
      ])
    })))

    const result = await fireListUsers(null)

    expect(result.nextPageToken).toBeNull()
  })

  it('fireListUsers devuelve nextPageToken = createdAt del último item cuando la página trae exactamente 50', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    const rows = Array.from({ length: 50 }, (_, i) => ({
      document: {
        name: `projects/foodscaner-test/databases/(default)/documents/users/uid-${i}`,
        fields: { createdAt: { stringValue: `2026-07-21T00:${String(i).padStart(2, '0')}:00.000Z` } }
      }
    }))
    vi.stubGlobal('fetch', buildFetchMock(async () => ({ ok: true, status: 200, json: async () => rows })))

    const result = await fireListUsers(null)

    expect(result.items.length).toBe(50)
    expect(result.nextPageToken).toBe(rows[49].document.fields.createdAt.stringValue)
  })

  it('fireListUsers lanza cuando Firestore responde error', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({ ok: false, status: 500 })))

    await expect(fireListUsers(null)).rejects.toThrow('list users failed: 500')
  })
})
