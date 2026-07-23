/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getIdToken = vi.fn()
const syncUserProfile = vi.fn()

vi.mock('../authClient.js', () => ({ getIdToken, syncUserProfile }))

let confirmMembershipPayment

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  sessionStorage.clear()
  document.body.innerHTML = `
    <input type="checkbox" id="pay-checkbox">
    <button id="btn-confirm-payment">Confirmar pago</button>
    <p id="membership-error" class="hidden"></p>
  `
  const mod = await import('../onboarding-membership-ui.js')
  confirmMembershipPayment = mod.confirmMembershipPayment
  getIdToken.mockResolvedValue('tok')
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  delete window.location
  window.location = { href: '' }
})

it('requires the checkbox to be checked before calling the pay endpoint', async () => {
  document.getElementById('pay-checkbox').checked = false
  await expect(confirmMembershipPayment()).rejects.toThrow()
  expect(global.fetch).not.toHaveBeenCalled()
})

it('calls POST /api/me/membership/pay and redirects to index.html when there are no pending preferences', async () => {
  document.getElementById('pay-checkbox').checked = true
  await confirmMembershipPayment()
  expect(global.fetch).toHaveBeenCalledWith('/api/me/membership/pay', expect.objectContaining({ method: 'POST' }))
  expect(window.location.href).toBe('index.html')
})

it('flushes sessionStorage preferences via PUT /api/me/preferences after paying, then clears them', async () => {
  document.getElementById('pay-checkbox').checked = true
  sessionStorage.setItem('yomi_pending_preferences', JSON.stringify({ dietary: ['vegan'], consent: true }))

  await confirmMembershipPayment()

  const preferencesCall = global.fetch.mock.calls.find(([url]) => url === '/api/me/preferences')
  expect(preferencesCall).toBeTruthy()
  expect(preferencesCall[1].method).toBe('PUT')
  expect(JSON.parse(preferencesCall[1].body)).toEqual({ dietary: ['vegan'], consent: true })
  expect(sessionStorage.getItem('yomi_pending_preferences')).toBeNull()
  expect(window.location.href).toBe('index.html')
})

it('redirects to index.html even if the deferred preferences PUT fails (payment already succeeded)', async () => {
  document.getElementById('pay-checkbox').checked = true
  sessionStorage.setItem('yomi_pending_preferences', JSON.stringify({ dietary: ['vegan'] }))
  global.fetch = vi.fn((url) => {
    if (url === '/api/me/membership/pay') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) })
    return Promise.reject(new Error('network down'))
  })

  await confirmMembershipPayment()

  expect(window.location.href).toBe('index.html')
})
