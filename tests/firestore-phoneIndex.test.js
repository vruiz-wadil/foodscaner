import { describe, it, expect, vi, afterEach } from 'vitest'
import crypto from 'crypto'

const { fireGetPhoneIndex, fireSetPhoneIndex } = await import('../api/firestore.js')

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

describe('phoneIndex/{telefono} data layer', () => {
  const ORIGINAL_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = ORIGINAL_KEY
  })

  it('fireGetPhoneIndex returns null when the document does not exist (404)', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({ status: 404, ok: false })))
    const result = await fireGetPhoneIndex('+525512345678')
    expect(result).toBeNull()
  })

  it('fireGetPhoneIndex returns { uid } when the document exists', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({
      ok: true, status: 200,
      json: async () => ({ fields: { uid: { stringValue: 'a1b2c3d4-uuid' } } })
    })))
    const result = await fireGetPhoneIndex('+525512345678')
    expect(result).toEqual({ uid: 'a1b2c3d4-uuid' })
  })

  it('fireGetPhoneIndex returns null on any Firestore error (fail-safe, never throws)', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({ ok: false, status: 500 })))
    const result = await fireGetPhoneIndex('+525512345678')
    expect(result).toBeNull()
  })

  it('fireSetPhoneIndex PATCHes the doc with the given uid', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedUrl, capturedOptions
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      capturedUrl = url
      capturedOptions = options
      return { ok: true, status: 200 }
    }))
    await fireSetPhoneIndex('+525512345678', 'a1b2c3d4-uuid')
    expect(capturedUrl).toContain('phoneIndex')
    expect(capturedUrl).toContain(encodeURIComponent('+525512345678'))
    expect(capturedOptions.method).toBe('PATCH')
    const body = JSON.parse(capturedOptions.body)
    expect(body.fields.uid.stringValue).toBe('a1b2c3d4-uuid')
  })

  it('fireSetPhoneIndex throws when Firestore responds non-ok', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({ ok: false, status: 500 })))
    await expect(fireSetPhoneIndex('+525512345678', 'a1b2c3d4-uuid')).rejects.toThrow('Firestore set phone index failed')
  })
})
