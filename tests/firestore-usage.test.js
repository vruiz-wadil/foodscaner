import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

const { fireIncrementUsageCounter } = await import('../api/firestore.js')

function buildFetchMock(userDocHandler) {
  return vi.fn(async (url, options = {}) => {
    if (url.includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'fake-token', expires_in: 3600 }) }
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

describe('fireIncrementUsageCounter', () => {
  const ORIGINAL_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY

  beforeEach(() => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = ORIGINAL_KEY
  })

  it('resets counters to 0 before incrementing when usage.date is not today (UTC)', async () => {
    let patchBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-14' }, ocrCount: { integerValue: '5' }, cacheRefreshCount: { integerValue: '1' }, totalScans: { integerValue: '20' }
            } } } },
            updateTime: '2026-07-14T23:00:00.000000Z'
          })
        }
      }
      patchBody = JSON.parse(options.body)
      return { ok: true, status: 200 }
    }))

    const result = await fireIncrementUsageCounter('uid-1', 'ocrCount')

    expect(result).toEqual({ date: '2026-07-15', ocrCount: 1, cacheRefreshCount: 0, totalScans: 20 })
    expect(patchBody.currentDocument.updateTime).toBe('2026-07-14T23:00:00.000000Z')
  })

  it('increments the existing counter when usage.date is already today', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-15' }, ocrCount: { integerValue: '2' }, cacheRefreshCount: { integerValue: '0' }, totalScans: { integerValue: '20' }
            } } } },
            updateTime: '2026-07-15T10:00:00.000000Z'
          })
        }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireIncrementUsageCounter('uid-1', 'ocrCount')

    expect(result).toEqual({ date: '2026-07-15', ocrCount: 3, cacheRefreshCount: 0, totalScans: 20 })
  })

  it('retries with backoff on a 409 conflict and succeeds on the next attempt', async () => {
    let patchAttempts = 0
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-15' }, ocrCount: { integerValue: '0' }, cacheRefreshCount: { integerValue: '0' }
            } } } },
            updateTime: '2026-07-15T10:00:00.000000Z'
          })
        }
      }
      patchAttempts++
      if (patchAttempts === 1) return { ok: false, status: 409 }
      return { ok: true, status: 200 }
    }))
    vi.useRealTimers() // el backoff usa setTimeout real de 10-50ms

    const result = await fireIncrementUsageCounter('uid-1', 'ocrCount')

    expect(patchAttempts).toBe(2)
    expect(result.ocrCount).toBe(1)
  })

  it('gives up after repeated 409 conflicts and throws', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-15' }, ocrCount: { integerValue: '0' }, cacheRefreshCount: { integerValue: '0' }
            } } } },
            updateTime: '2026-07-15T10:00:00.000000Z'
          })
        }
      }
      return { ok: false, status: 409 }
    }))
    vi.useRealTimers()

    await expect(fireIncrementUsageCounter('uid-1', 'ocrCount')).rejects.toThrow()
  })

  it('throws when the user document does not exist', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) return { status: 404, ok: false }
      return { ok: true, status: 200 }
    }))

    await expect(fireIncrementUsageCounter('uid-missing', 'ocrCount')).rejects.toThrow()
  })

  it('incrementa totalScans sin resetearlo aunque usage.date no sea hoy (a diferencia de ocrCount/cacheRefreshCount, es de por vida)', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-14' }, ocrCount: { integerValue: '5' }, cacheRefreshCount: { integerValue: '1' }, totalScans: { integerValue: '20' }
            } } } },
            updateTime: '2026-07-14T23:00:00.000000Z'
          })
        }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireIncrementUsageCounter('uid-1', 'totalScans')

    expect(result).toEqual({ date: '2026-07-15', ocrCount: 0, cacheRefreshCount: 0, totalScans: 21 })
  })

  it('trata totalScans ausente como 0 (perfil creado antes de este campo)', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-15' }, ocrCount: { integerValue: '0' }, cacheRefreshCount: { integerValue: '0' }
            } } } },
            updateTime: '2026-07-15T10:00:00.000000Z'
          })
        }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireIncrementUsageCounter('uid-1', 'totalScans')

    expect(result).toEqual({ date: '2026-07-15', ocrCount: 0, cacheRefreshCount: 0, totalScans: 1 })
  })
})
