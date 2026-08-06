import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

const { fireFulfillStripeSubscription } = await import('../api/firestore.js')

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

const baseParams = {
  uid: 'uid-1',
  stripeCustomerId: 'cus_1',
  subscriptionId: 'sub_1',
  subscriptionStatus: 'active',
  currentPeriodEnd: '2026-08-29T12:00:00.000Z',
  cancelAtPeriodEnd: false,
  invoiceId: 'in_1',
  amount: 29.90,
  currency: 'mxn'
}

describe('fireFulfillStripeSubscription', () => {
  const ORIGINAL_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY

  beforeEach(() => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-29T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = ORIGINAL_KEY
  })

  it('activates membership, sets billing fields, and appends to an empty paymentHistory', async () => {
    let patchBody, patchUrl
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { membershipStatus: { stringValue: 'pending' } },
            updateTime: '2026-07-29T10:00:00.000000Z'
          })
        }
      }
      patchUrl = url
      patchBody = JSON.parse(options.body)
      return { ok: true, status: 200 }
    }))

    const result = await fireFulfillStripeSubscription(baseParams)

    expect(result).toEqual({
      membershipStatus: 'active',
      membershipExpiresAt: '2026-08-29T12:00:00.000Z',
      lastPaymentAt: '2026-07-29T12:00:00.000Z',
      autoRenew: true,
      billing: { stripeCustomerId: 'cus_1', subscriptionId: 'sub_1', subscriptionStatus: 'active', currentPeriodEnd: '2026-08-29T12:00:00.000Z' },
      paymentHistory: [{ date: '2026-07-29T12:00:00.000Z', amount: 29.90, currency: 'mxn', method: 'stripe', stripeInvoiceId: 'in_1' }]
    })
    expect(patchUrl).toContain(`currentDocument.updateTime=${encodeURIComponent('2026-07-29T10:00:00.000000Z')}`)
    expect(patchBody.currentDocument).toBeUndefined()
  })

  it('is idempotent: does not append a duplicate entry when stripeInvoiceId already exists', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: {
              membershipStatus: { stringValue: 'active' },
              membershipExpiresAt: { stringValue: '2026-08-29T12:00:00.000Z' },
              paymentHistory: { arrayValue: { values: [
                { mapValue: { fields: {
                  date: { stringValue: '2026-06-29T12:00:00.000Z' }, amount: { doubleValue: 29.90 },
                  currency: { stringValue: 'mxn' }, method: { stringValue: 'stripe' }, stripeInvoiceId: { stringValue: 'in_1' }
                } } }
              ] } }
            },
            updateTime: '2026-07-29T10:00:00.000000Z'
          })
        }
      }
      throw new Error('no debería intentar escribir')
    }))

    const result = await fireFulfillStripeSubscription(baseParams)

    expect(result.alreadyFulfilled).toBe(true)
  })

  it('appends to an existing paymentHistory instead of overwriting it', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: {
              membershipStatus: { stringValue: 'active' },
              paymentHistory: { arrayValue: { values: [
                { mapValue: { fields: {
                  date: { stringValue: '2026-06-29T12:00:00.000Z' }, amount: { doubleValue: 29.90 },
                  currency: { stringValue: 'mxn' }, method: { stringValue: 'stripe' }, stripeInvoiceId: { stringValue: 'in_0' }
                } } }
              ] } }
            },
            updateTime: '2026-07-29T10:00:00.000000Z'
          })
        }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireFulfillStripeSubscription(baseParams)

    expect(result.paymentHistory).toEqual([
      { date: '2026-06-29T12:00:00.000Z', amount: 29.90, currency: 'mxn', method: 'stripe', stripeInvoiceId: 'in_0' },
      { date: '2026-07-29T12:00:00.000Z', amount: 29.90, currency: 'mxn', method: 'stripe', stripeInvoiceId: 'in_1' }
    ])
  })

  it('sets autoRenew false when cancelAtPeriodEnd is true', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return { ok: true, status: 200, json: async () => ({ fields: { membershipStatus: { stringValue: 'active' } }, updateTime: '2026-07-29T10:00:00.000000Z' }) }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireFulfillStripeSubscription({ ...baseParams, cancelAtPeriodEnd: true })

    expect(result.autoRenew).toBe(false)
  })

  it('retries with backoff on a 409 conflict and succeeds on the next attempt', async () => {
    let patchAttempts = 0
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return { ok: true, status: 200, json: async () => ({ fields: { membershipStatus: { stringValue: 'pending' } }, updateTime: '2026-07-29T10:00:00.000000Z' }) }
      }
      patchAttempts++
      if (patchAttempts === 1) return { ok: false, status: 409 }
      return { ok: true, status: 200 }
    }))
    vi.useRealTimers()

    const result = await fireFulfillStripeSubscription(baseParams)

    expect(patchAttempts).toBe(2)
    expect(result.membershipStatus).toBe('active')
  })

  it('throws when the user document does not exist', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) return { status: 404, ok: false }
      return { ok: true, status: 200 }
    }))

    await expect(fireFulfillStripeSubscription({ ...baseParams, uid: 'uid-missing' })).rejects.toThrow()
  })
})
