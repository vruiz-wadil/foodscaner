/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getIdToken = vi.fn()
vi.mock('../authClient.js', () => ({ getIdToken }))

let confirmMembershipPayment

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  document.body.innerHTML = `
    <input type="checkbox" id="pay-checkbox">
    <button id="btn-confirm-payment"><img src="assets/redesign/icon-stripe.svg" alt="" class="btn-icon">Suscribirme — $29.90/mes</button>
    <button id="btn-skip-membership">Seguir sin membresía</button>
    <p id="membership-error" class="hidden"></p>
  `
  const mod = await import('../onboarding-membership-ui.js')
  confirmMembershipPayment = mod.confirmMembershipPayment
  getIdToken.mockResolvedValue('tok')
  delete window.location
  window.location = { href: '' }
})

it('requires the checkbox to be checked before calling the pay endpoint', async () => {
  document.getElementById('pay-checkbox').checked = false
  global.fetch = vi.fn()

  await expect(confirmMembershipPayment()).rejects.toThrow()

  expect(global.fetch).not.toHaveBeenCalled()
})

it('calls POST /api/me/membership/pay and redirects to the returned checkoutUrl', async () => {
  document.getElementById('pay-checkbox').checked = true
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, checkoutUrl: 'https://checkout.stripe.com/cs_1' }) })

  await confirmMembershipPayment()

  expect(global.fetch).toHaveBeenCalledWith('/api/me/membership/pay', expect.objectContaining({ method: 'POST' }))
  expect(window.location.href).toBe('https://checkout.stripe.com/cs_1')
})

it('shows an error and re-enables the button when the pay call fails', async () => {
  document.getElementById('pay-checkbox').checked = true
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })

  await expect(confirmMembershipPayment()).rejects.toThrow()

  const btn = document.getElementById('btn-confirm-payment')
  expect(btn.disabled).toBe(false)
  expect(btn.innerHTML).toBe('<img src="assets/redesign/icon-stripe.svg" alt="" class="btn-icon">Suscribirme — $29.90/mes')
  expect(document.getElementById('membership-error').classList.contains('hidden')).toBe(false)
})

it('navigates to index.html when the skip-membership button is clicked', async () => {
  document.dispatchEvent(new Event('DOMContentLoaded'))
  document.getElementById('btn-skip-membership').click()

  expect(window.location.href).toBe('index.html')
})
