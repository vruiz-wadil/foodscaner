import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

const { fireRecordMembershipPayment } = await import('../api/firestore.js')

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

describe('fireRecordMembershipPayment', () => {
  const ORIGINAL_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY

  beforeEach(() => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = ORIGINAL_KEY
  })

  it('sets membershipStatus active, expiresAt 30 days ahead, autoRenew true, and appends to an empty paymentHistory', async () => {
    let patchBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { membershipStatus: { stringValue: 'pending' } },
            updateTime: '2026-07-22T10:00:00.000000Z'
          })
        }
      }
      patchBody = JSON.parse(options.body)
      return { ok: true, status: 200 }
    }))

    const result = await fireRecordMembershipPayment('uid-1')

    expect(result).toEqual({
      membershipStatus: 'active',
      membershipExpiresAt: '2026-08-21T12:00:00.000Z',
      lastPaymentAt: '2026-07-22T12:00:00.000Z',
      autoRenew: true,
      paymentHistory: [{ date: '2026-07-22T12:00:00.000Z', amount: 0, method: 'simulado' }]
    })
    expect(patchBody.currentDocument.updateTime).toBe('2026-07-22T10:00:00.000000Z')
  })

  it('appends to an existing paymentHistory instead of overwriting it', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: {
              membershipStatus: { stringValue: 'expired' },
              paymentHistory: { arrayValue: { values: [
                { mapValue: { fields: { date: { stringValue: '2026-06-22T12:00:00.000Z' }, amount: { integerValue: '0' }, method: { stringValue: 'simulado' } } } }
              ] } }
            },
            updateTime: '2026-07-22T10:00:00.000000Z'
          })
        }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireRecordMembershipPayment('uid-1')

    expect(result.paymentHistory).toEqual([
      { date: '2026-06-22T12:00:00.000Z', amount: 0, method: 'simulado' },
      { date: '2026-07-22T12:00:00.000Z', amount: 0, method: 'simulado' }
    ])
  })

  it('retries with backoff on a 409 conflict and succeeds on the next attempt', async () => {
    let patchAttempts = 0
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({ fields: { membershipStatus: { stringValue: 'pending' } }, updateTime: '2026-07-22T10:00:00.000000Z' })
        }
      }
      patchAttempts++
      if (patchAttempts === 1) return { ok: false, status: 409 }
      return { ok: true, status: 200 }
    }))
    vi.useRealTimers()

    const result = await fireRecordMembershipPayment('uid-1')

    expect(patchAttempts).toBe(2)
    expect(result.membershipStatus).toBe('active')
  })

  it('gives up after repeated 409 conflicts and throws', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({ fields: { membershipStatus: { stringValue: 'pending' } }, updateTime: '2026-07-22T10:00:00.000000Z' })
        }
      }
      return { ok: false, status: 409 }
    }))
    vi.useRealTimers()

    await expect(fireRecordMembershipPayment('uid-1')).rejects.toThrow()
  })

  it('throws when the user document does not exist', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) return { status: 404, ok: false }
      return { ok: true, status: 200 }
    }))

    await expect(fireRecordMembershipPayment('uid-missing')).rejects.toThrow()
  })
})
