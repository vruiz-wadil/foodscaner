/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuth = { currentUser: null, authStateReady: vi.fn().mockResolvedValue(undefined) }
const onAuthStateChanged = vi.fn()

vi.mock('../firebase-init.js', () => ({
  firebaseAuth: mockAuth,
  onAuthStateChanged
}))

let getIdToken, onAuthChange, onProfileChange, syncUserProfile, getCachedProfile, setAutoSyncSuppressed

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  mockAuth.currentUser = null
  mockAuth.authStateReady = vi.fn().mockResolvedValue(undefined)
  global.fetch = vi.fn()
  const mod = await import('../authClient.js')
  getIdToken = mod.getIdToken
  onAuthChange = mod.onAuthChange
  onProfileChange = mod.onProfileChange
  syncUserProfile = mod.syncUserProfile
  getCachedProfile = mod.getCachedProfile
  setAutoSyncSuppressed = mod.setAutoSyncSuppressed
})

describe('onAuthChange', () => {
  it('wraps onAuthStateChanged with the firebaseAuth instance', () => {
    const cb = vi.fn()
    onAuthChange(cb)
    expect(onAuthStateChanged).toHaveBeenCalledWith(mockAuth, cb)
  })
})

describe('getIdToken', () => {
  it('returns null when there is no signed-in user', async () => {
    mockAuth.currentUser = null
    const token = await getIdToken()
    expect(token).toBeNull()
  })

  it('returns the token from the current user, forcing refresh when requested', async () => {
    const getIdTokenMock = vi.fn().mockResolvedValue('fresh-token')
    mockAuth.currentUser = { getIdToken: getIdTokenMock }
    const token = await getIdToken(true)
    expect(getIdTokenMock).toHaveBeenCalledWith(true)
    expect(token).toBe('fresh-token')
  })

  it('awaits authStateReady() before reading currentUser (hallazgo: currentUser sigue null por unos ms tras un reload mientras Firebase rehidrata la sesión persistida — leerlo antes de tiempo reporta "sin sesión" con un usuario sí logueado)', async () => {
    let resolveReady
    mockAuth.authStateReady = vi.fn(() => new Promise(r => { resolveReady = r }))
    mockAuth.currentUser = null
    const getIdTokenMock = vi.fn().mockResolvedValue('late-token')

    const tokenPromise = getIdToken()
    // Simula la rehidratación terminando DESPUÉS de la llamada, con sesión ya restaurada.
    mockAuth.currentUser = { getIdToken: getIdTokenMock }
    resolveReady()

    expect(await tokenPromise).toBe('late-token')
  })
})

describe('syncUserProfile', () => {
  it('returns null and does not call fetch when there is no signed-in user', async () => {
    mockAuth.currentUser = null
    const profile = await syncUserProfile()
    expect(profile).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('POSTs to /api/auth/sync then GETs /api/me with the Bearer token, and caches the response', async () => {
    mockAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('tok-123') }
    global.fetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: 'premium', preferences: { dietary: ['vegan'] } }) })

    const profile = await syncUserProfile()

    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/auth/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-123' }
    })
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/me', {
      headers: { Authorization: 'Bearer tok-123' }
    })
    expect(profile).toEqual({ plan: 'premium', preferences: { dietary: ['vegan'] } })
    expect(getCachedProfile()).toEqual({ plan: 'premium', preferences: { dietary: ['vegan'] } })
  })

  it('clears the cached profile when GET /api/me fails', async () => {
    mockAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('tok-123') }
    global.fetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false })

    const profile = await syncUserProfile()
    expect(profile).toBeNull()
    expect(getCachedProfile()).toBeNull()
  })
})

describe('window.authClient', () => {
  it('exposes the six functions for non-module scripts', async () => {
    expect(window.authClient.getIdToken).toBe(getIdToken)
    expect(window.authClient.onAuthChange).toBe(onAuthChange)
    expect(window.authClient.onProfileChange).toBe(onProfileChange)
    expect(window.authClient.syncUserProfile).toBe(syncUserProfile)
    expect(window.authClient.getCachedProfile).toBe(getCachedProfile)
    expect(window.authClient.setAutoSyncSuppressed).toBe(setAutoSyncSuppressed)
  })
})

// ─── onProfileChange (Critical #2, revisión final 2026-08-06) ──────────────
// onAuthChange's raw Firebase event fires before syncUserProfile() actually
// resolves, so a subscriber relying on it + getCachedProfile() can observe
// a stale null even for a Premium member. onProfileChange() must notify only
// once the real answer (profile or confirmed null) is known, and must replay
// that answer to subscribers that attach after resolution already happened.
describe('onProfileChange', () => {
  it('notifies subscribers with the resolved profile once syncUserProfile() succeeds', async () => {
    mockAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('tok-1') }
    global.fetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ membershipStatus: 'active' }) })

    const cb = vi.fn()
    onProfileChange(cb)
    await syncUserProfile()

    expect(cb).toHaveBeenCalledWith({ membershipStatus: 'active' })
  })

  it('notifies subscribers with null when syncUserProfile() resolves to "no session" (logout)', async () => {
    mockAuth.currentUser = null
    const cb = vi.fn()
    onProfileChange(cb)
    await syncUserProfile()

    expect(cb).toHaveBeenCalledWith(null)
  })

  it('notifies subscribers with null when the internal auth-change callback sees no user, even though syncUserProfile() never runs', async () => {
    const cb = vi.fn()
    onProfileChange(cb)
    const internalCallback = onAuthStateChanged.mock.calls[0][1]
    await internalCallback(null)

    expect(cb).toHaveBeenCalledWith(null)
  })

  it('replays the last known answer immediately to a subscriber that attaches after resolution already happened', async () => {
    mockAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('tok-2') }
    global.fetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ membershipStatus: 'active' }) })
    await syncUserProfile()

    const lateSubscriber = vi.fn()
    onProfileChange(lateSubscriber)

    expect(lateSubscriber).toHaveBeenCalledWith({ membershipStatus: 'active' })
  })

  it('does not call a subscriber before any resolution has happened', () => {
    const cb = vi.fn()
    onProfileChange(cb)
    expect(cb).not.toHaveBeenCalled()
  })
})

// ─── Auto-sync al detectar sesión (hallazgo crítico, 4a ronda) ──────────
// Sin esto, getCachedProfile() regresa null en cualquier pantalla que no sea
// account.html — apagando personalización/historial/banner en silencio.
describe('auto-sync on auth state change', () => {
  it('llama syncUserProfile automáticamente cuando el auth state cambia a un usuario logueado', async () => {
    mockAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('tok-auto') }
    global.fetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: 'free' }) })

    // El primer registro de onAuthStateChanged es el que hace el propio módulo
    // al cargar (no uno hecho manualmente por un consumidor vía onAuthChange).
    const internalCallback = onAuthStateChanged.mock.calls[0][1]
    await internalCallback({ uid: 'u1' })

    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/auth/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-auto' }
    })
  })

  it('no llama a fetch cuando el auth state cambia a null (cierre de sesión)', async () => {
    const internalCallback = onAuthStateChanged.mock.calls[0][1]
    await internalCallback(null)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('no llama a syncUserProfile cuando setAutoSyncSuppressed(true) está activo, aunque haya usuario', async () => {
    setAutoSyncSuppressed(true)
    mockAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('tok-suppressed') }
    const internalCallback = onAuthStateChanged.mock.calls[0][1]
    await internalCallback({ uid: 'u1' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('vuelve a auto-sincronizar normalmente después de setAutoSyncSuppressed(false)', async () => {
    setAutoSyncSuppressed(true)
    setAutoSyncSuppressed(false)
    mockAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('tok-resumed') }
    global.fetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: 'free' }) })
    const internalCallback = onAuthStateChanged.mock.calls[0][1]
    await internalCallback({ uid: 'u1' })
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/auth/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-resumed' }
    })
  })
})
