import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// vi.mock() is hoisted above const declarations by vitest, so the mock's
// module-id argument can't reference a plain `const` computed below it
// (ReferenceError: Cannot access before initialization). vi.hoisted() runs
// its callback as part of that same hoisting pass, so it's safe to use here.
const { APP_URL, AUTH_URL } = vi.hoisted(() => {
  const FIREBASE_SDK_VERSION = '11.6.0'
  return {
    APP_URL: `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`,
    AUTH_URL: `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`
  }
})

const mockApp = { name: '[DEFAULT]' }
const mockAuthInstance = { currentUser: null }
const initializeApp = vi.fn(() => mockApp)
const getAuth = vi.fn(() => mockAuthInstance)
const onAuthStateChanged = vi.fn()
const signInWithEmailAndPassword = vi.fn()
const createUserWithEmailAndPassword = vi.fn()
const signInWithPopup = vi.fn()
const signOut = vi.fn()
class GoogleAuthProvider {}

vi.mock(APP_URL, () => ({ initializeApp }))
vi.mock(AUTH_URL, () => ({
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider
}))

describe('firebase-init.js', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('calls initializeApp exactly once with a config object using placeholder values (no real secrets)', async () => {
    const mod = await import('../firebase-init.js')
    expect(initializeApp).toHaveBeenCalledTimes(1)
    const configArg = initializeApp.mock.calls[0][0]
    expect(configArg).toHaveProperty('apiKey')
    expect(configArg).toHaveProperty('authDomain')
    expect(configArg).toHaveProperty('projectId')
    expect(configArg.apiKey).toMatch(/^__FIREBASE_.*__$/)
    expect(configArg.authDomain).toMatch(/^__FIREBASE_.*__$/)
    expect(configArg.projectId).toMatch(/^__FIREBASE_.*__$/)
    expect(mod.firebaseApp).toBe(mockApp)
  })

  it('calls getAuth with the initialized app and exports firebaseAuth', async () => {
    const mod = await import('../firebase-init.js')
    expect(getAuth).toHaveBeenCalledWith(mockApp)
    expect(mod.firebaseAuth).toBe(mockAuthInstance)
  })

  it('re-exports the auth SDK functions Task 11/12 depend on', async () => {
    const mod = await import('../firebase-init.js')
    expect(mod.onAuthStateChanged).toBe(onAuthStateChanged)
    expect(mod.signInWithEmailAndPassword).toBe(signInWithEmailAndPassword)
    expect(mod.createUserWithEmailAndPassword).toBe(createUserWithEmailAndPassword)
    expect(mod.signInWithPopup).toBe(signInWithPopup)
    expect(mod.GoogleAuthProvider).toBe(GoogleAuthProvider)
  })
})

describe('index.html wiring', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

  it('CSP allows loading the Firebase SDK from gstatic and talking to Identity Toolkit', () => {
    const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)
    expect(cspMatch).not.toBeNull()
    const csp = cspMatch[1]
    expect(csp).toMatch(/script-src[^;]*https:\/\/www\.gstatic\.com/)
    expect(csp).toMatch(/connect-src[^;]*https:\/\/identitytoolkit\.googleapis\.com/)
    expect(csp).toMatch(/connect-src[^;]*https:\/\/securetoken\.googleapis\.com/)
    expect(csp).toMatch(/frame-src[^;]*firebaseapp\.com/)
  })

  it('loads firebase-init.js as a module script', () => {
    expect(html).toMatch(/<script[^>]+type="module"[^>]+src="firebase-init\.js"/)
  })
})
