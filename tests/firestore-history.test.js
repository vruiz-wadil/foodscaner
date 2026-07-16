// tests/firestore-history.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import crypto from 'crypto'

const { fireLogUserHistory, fireListUserHistory } = await import('../api/firestore.js')

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

describe('users/{uid}/history subcollection', () => {
  const ORIGINAL_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = ORIGINAL_KEY
  })

  it('fireLogUserHistory POSTs a new doc to the history subcollection (auto-generated id)', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedUrl, capturedBody
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      capturedUrl = url
      capturedBody = JSON.parse(options.body)
      return { ok: true, status: 200, json: async () => ({ name: 'projects/x/databases/(default)/documents/users/uid-1/history/auto-id-123' }) }
    }))

    const result = await fireLogUserHistory('uid-1', { barcode: '7501055363057', productName: 'Nutella', verdict: 'regular', scannedAt: '2026-07-15T10:00:00.000Z' })

    expect(capturedUrl).toContain('/users/uid-1/history')
    expect(capturedBody.fields.barcode.stringValue).toBe('7501055363057')
    expect(result).toEqual({ id: 'auto-id-123' })
  })

  it('fireListUserHistory returns entries ordered by scannedAt desc, capped at the given limit', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedBody
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      capturedBody = JSON.parse(options.body)
      return {
        ok: true, status: 200,
        json: async () => ([
          { document: { fields: { barcode: { stringValue: '111' }, productName: { stringValue: 'A' }, verdict: { stringValue: 'sano' }, scannedAt: { stringValue: '2026-07-15T12:00:00.000Z' } } } },
          { document: { fields: { barcode: { stringValue: '222' }, productName: { stringValue: 'B' }, verdict: { stringValue: 'evitar' }, scannedAt: { stringValue: '2026-07-14T12:00:00.000Z' } } } }
        ])
      }
    }))

    const result = await fireListUserHistory('uid-1', 50)

    expect(capturedBody.structuredQuery.limit).toBe(50)
    expect(capturedBody.structuredQuery.orderBy[0]).toEqual({ field: { fieldPath: 'scannedAt' }, direction: 'DESCENDING' })
    expect(result).toEqual([
      { barcode: '111', productName: 'A', verdict: 'sano', scannedAt: '2026-07-15T12:00:00.000Z' },
      { barcode: '222', productName: 'B', verdict: 'evitar', scannedAt: '2026-07-14T12:00:00.000Z' }
    ])
  })

  it('fireListUserHistory returns an empty array when there are no entries', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      return { ok: true, status: 200, json: async () => ([{}]) }
    }))
    const result = await fireListUserHistory('uid-1', 50)
    expect(result).toEqual([])
  })
})
