import { describe, it, expect, vi, afterEach } from 'vitest'
import crypto from 'crypto'

const { deleteFirebaseAuthUser } = await import('../api/firestore.js')

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

describe('deleteFirebaseAuthUser', () => {
  const ORIGINAL_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = ORIGINAL_KEY
  })

  it('POSTs accounts:delete to Identity Toolkit with localId, and requests the identitytoolkit scope', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedUrl, capturedBody, capturedTokenClaim
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        const params = new URLSearchParams(options.body)
        const assertion = params.get('assertion')
        const payloadB64 = assertion.split('.')[1]
        capturedTokenClaim = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
        return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      }
      capturedUrl = url
      capturedBody = JSON.parse(options.body)
      return { ok: true, status: 200, json: async () => ({}) }
    }))

    await deleteFirebaseAuthUser('uid-1')

    expect(capturedUrl).toBe('https://identitytoolkit.googleapis.com/v1/projects/foodscaner-test/accounts:delete')
    expect(capturedBody).toEqual({ localId: 'uid-1' })
    expect(capturedTokenClaim.scope).toContain('https://www.googleapis.com/auth/identitytoolkit')
    expect(capturedTokenClaim.scope).toContain('https://www.googleapis.com/auth/datastore')
  })

  it('throws when Identity Toolkit responds with an error status', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      return { ok: false, status: 404, json: async () => ({ error: { message: 'no such user' } }) }
    }))

    await expect(deleteFirebaseAuthUser('uid-missing')).rejects.toThrow()
  })
})
