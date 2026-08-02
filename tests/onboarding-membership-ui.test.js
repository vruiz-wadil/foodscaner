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
    <h1 class="heading-title">Activa tu membresía</h1>
    <p class="heading-sub">Compara lo que obtienes gratis vs. con Yomi Premium.</p>
    <input type="checkbox" id="pay-checkbox">
    <button id="btn-confirm-payment"><img src="assets/redesign/icon-stripe.svg" alt="" class="btn-icon">Suscribirme — $29.90/mes</button>
    <button id="btn-skip-membership">Seguir sin membresía</button>
    <p id="membership-error" class="hidden"></p>
  `
  sessionStorage.clear()
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

it('keeps the default heading and button copy when there is no pending-preferences payload', () => {
  document.dispatchEvent(new Event('DOMContentLoaded'))

  expect(document.querySelector('.heading-title').textContent).toBe('Activa tu membresía')
  expect(document.querySelector('.heading-sub').textContent).toBe('Compara lo que obtienes gratis vs. con Yomi Premium.')
  expect(document.getElementById('btn-confirm-payment').textContent).toBe('Suscribirme — $29.90/mes')
})

it('personalizes the heading and button copy for a severe allergen, keeping the icon', () => {
  sessionStorage.setItem('yomi_pending_preferences', JSON.stringify({
    allergens: [{ code: 'cacahuate', severity: 'severe' }],
    dietary: [],
    healthConditions: []
  }))

  document.dispatchEvent(new Event('DOMContentLoaded'))

  const btn = document.getElementById('btn-confirm-payment')
  expect(document.querySelector('.heading-title').textContent).toBe('No más sustos con cacahuate')
  expect(btn.textContent).toContain('Sí, quiero Premium — $29.90/mes')
  expect(btn.querySelector('img.btn-icon')).not.toBeNull()
})

it('personalizes the heading and button copy for a mild/any allergen, keeping the icon', () => {
  sessionStorage.setItem('yomi_pending_preferences', JSON.stringify({
    allergens: [{ code: 'lacteos', severity: 'mild' }],
    dietary: [],
    healthConditions: []
  }))

  document.dispatchEvent(new Event('DOMContentLoaded'))

  const btn = document.getElementById('btn-confirm-payment')
  expect(document.querySelector('.heading-title').textContent).toBe('Cuidado con lácteos, sin adivinar')
  expect(document.querySelector('.heading-sub').textContent).toBe('Premium revisa cada producto contra tu alergia automáticamente.')
  expect(btn.textContent).toContain('Sí, quiero Premium — $29.90/mes')
  expect(btn.querySelector('img.btn-icon')).not.toBeNull()
})

it('personalizes the heading and button copy for a health condition, keeping the icon', () => {
  sessionStorage.setItem('yomi_pending_preferences', JSON.stringify({
    allergens: [],
    dietary: [],
    healthConditions: ['diabetes']
  }))

  document.dispatchEvent(new Event('DOMContentLoaded'))

  const btn = document.getElementById('btn-confirm-payment')
  expect(document.querySelector('.heading-title').textContent).toBe('Cuida tu salud sin adivinar')
  expect(document.querySelector('.heading-sub').textContent).toBe('Cada escaneo revisa el producto contra tu perfil de salud.')
  expect(btn.textContent).toContain('Sí, quiero Premium — $29.90/mes')
  expect(btn.querySelector('img.btn-icon')).not.toBeNull()
})

it('personalizes the heading for a dietary-only payload', () => {
  sessionStorage.setItem('yomi_pending_preferences', JSON.stringify({
    allergens: [],
    dietary: ['vegan'],
    healthConditions: []
  }))

  document.dispatchEvent(new Event('DOMContentLoaded'))

  expect(document.querySelector('.heading-title').textContent).toBe('Come vegano sin leer etiquetas')
})

it('falls back to the default copy when sessionStorage has malformed JSON', () => {
  sessionStorage.setItem('yomi_pending_preferences', 'not json')

  expect(() => document.dispatchEvent(new Event('DOMContentLoaded'))).not.toThrow()
  expect(document.querySelector('.heading-title').textContent).toBe('Activa tu membresía')
})
