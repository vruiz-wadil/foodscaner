/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuth = { currentUser: null }
const onAuthStateChanged = vi.fn()

vi.mock('../firebase-init.js', () => ({
  firebaseAuth: mockAuth,
  onAuthStateChanged
}))

let getIdToken, onAuthChange, syncUserProfile, getCachedProfile

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  mockAuth.currentUser = null
  global.fetch = vi.fn()
  const mod = await import('../authClient.js')
  getIdToken = mod.getIdToken
  onAuthChange = mod.onAuthChange
  syncUserProfile = mod.syncUserProfile
  getCachedProfile = mod.getCachedProfile
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
  it('exposes the four functions for non-module scripts', async () => {
    expect(window.authClient.getIdToken).toBe(getIdToken)
    expect(window.authClient.onAuthChange).toBe(onAuthChange)
    expect(window.authClient.syncUserProfile).toBe(syncUserProfile)
    expect(window.authClient.getCachedProfile).toBe(getCachedProfile)
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
})
