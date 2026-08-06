/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getIdToken = vi.fn()
const syncUserProfile = vi.fn()
const getCachedProfile = vi.fn()
vi.mock('../authClient.js', () => ({ getIdToken, syncUserProfile, getCachedProfile }))

// account-ui.js importa firebase-init.js a nivel de módulo, y ese archivo
// importa el SDK de Firebase directo de un CDN (https://...) — el loader
// ESM de Node no soporta ese esquema, así que hay que mockearlo aquí igual
// que en tests/account-ui.test.js, aunque este archivo no ejercite auth.
vi.mock('../firebase-init.js', () => ({
  firebaseAuth: {},
  signOut: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  verifyBeforeUpdateEmail: vi.fn(),
  updatePassword: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() }
}))

let handleStripeReturn

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  sessionStorage.clear()
  getIdToken.mockResolvedValue('tok')
  window.history.replaceState({}, '', '/account.html')
  window.track = vi.fn()
  const mod = await import('../account-ui.js')
  handleStripeReturn = mod.handleStripeReturn
})

it('does nothing when there is no ?stripe= param', async () => {
  window.history.replaceState({}, '', '/account.html')
  global.fetch = vi.fn()

  await handleStripeReturn()

  expect(global.fetch).not.toHaveBeenCalled()
})

it('on stripe=success, confirms the checkout session', async () => {
  window.history.replaceState({}, '', '/account.html?stripe=success&session_id=cs_1')
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

  await handleStripeReturn()

  expect(global.fetch).toHaveBeenCalledWith(
    '/api/me/membership/checkout-result?session_id=cs_1',
    expect.objectContaining({ headers: { Authorization: 'Bearer tok' } })
  )
  expect(window.location.search).toBe('')
})

it('tracks "Checkout Completado" only when the checkout confirmation succeeds', async () => {
  window.history.replaceState({}, '', '/account.html?stripe=success&session_id=cs_1')
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

  await handleStripeReturn()

  expect(window.track).toHaveBeenCalledWith('Checkout Completado')
})

it('still shows the success toast when window.track is undefined (analytics.js blocked)', async () => {
  delete window.track
  window.history.replaceState({}, '', '/account.html?stripe=success&session_id=cs_1')
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

  await expect(handleStripeReturn()).resolves.not.toThrow()

  expect(window.location.search).toBe('')
})

it('does NOT track "Checkout Completado" when checkout-result responds non-ok', async () => {
  window.history.replaceState({}, '', '/account.html?stripe=success&session_id=cs_1')
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })

  await handleStripeReturn()

  expect(window.track).not.toHaveBeenCalledWith('Checkout Completado')
})

it('flushes pending preferences from sessionStorage after a confirmed checkout', async () => {
  window.history.replaceState({}, '', '/account.html?stripe=success&session_id=cs_1')
  sessionStorage.setItem('yomi_pending_preferences', JSON.stringify({ dietary: ['vegan'] }))
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

  await handleStripeReturn()

  const preferencesCall = global.fetch.mock.calls.find(([url]) => url === '/api/me/preferences')
  expect(preferencesCall).toBeTruthy()
  expect(preferencesCall[1].method).toBe('PUT')
  expect(sessionStorage.getItem('yomi_pending_preferences')).toBeNull()
})

it('keeps stripe params in the URL when checkout-result responds non-ok, so a reload retries', async () => {
  window.history.replaceState({}, '', '/account.html?stripe=success&session_id=cs_1')
  sessionStorage.setItem('yomi_pending_preferences', JSON.stringify({ dietary: ['vegan'] }))
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'internal_error' }) })

  await handleStripeReturn()

  // Las preferencias no se alcanzaron a enviar: si además borráramos los
  // params, no quedaría forma de reintentar.
  expect(sessionStorage.getItem('yomi_pending_preferences')).not.toBeNull()
  expect(window.location.search).toContain('session_id=cs_1')
  expect(window.location.search).toContain('stripe=success')
})

it('keeps stripe params in the URL when the checkout-result fetch throws', async () => {
  window.history.replaceState({}, '', '/account.html?stripe=success&session_id=cs_1')
  global.fetch = vi.fn().mockRejectedValue(new Error('network down'))

  await handleStripeReturn()

  expect(window.location.search).toContain('session_id=cs_1')
})

it('on stripe=cancel, does not call the API and still cleans the URL', async () => {
  window.history.replaceState({}, '', '/account.html?stripe=cancel')
  global.fetch = vi.fn()

  await handleStripeReturn()

  expect(global.fetch).not.toHaveBeenCalled()
  expect(window.location.search).toBe('')
})
