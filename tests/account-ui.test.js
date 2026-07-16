/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const signOut = vi.fn()
const mockAuth = {}
const getCachedProfile = vi.fn()
const syncUserProfile = vi.fn()

vi.mock('../firebase-init.js', () => ({ firebaseAuth: mockAuth, signOut }))
vi.mock('../authClient.js', () => ({ getCachedProfile, syncUserProfile }))

let renderAccountHub, handleLogout, computeAlertsActive
let originalLocation

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  document.body.innerHTML = '<div id="account-root"></div>'
  originalLocation = window.location
  delete window.location
  window.location = { href: '' }
  const mod = await import('../account-ui.js')
  renderAccountHub = mod.renderAccountHub
  handleLogout = mod.handleLogout
  computeAlertsActive = mod.computeAlertsActive
})

afterEach(() => {
  window.location = originalLocation
})

describe('renderAccountHub', () => {
  it('redirige a auth.html si no hay perfil cacheado (sin sesión)', () => {
    getCachedProfile.mockReturnValue(null)
    renderAccountHub()
    expect(window.location.href).toBe('auth.html')
  })

  it('muestra el badge "Free" y la sección de upsell premium (sin candado, enmarcada como extensión), sin botón de editar preferencias', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', plan: 'free' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.account-plan-free')).toBeTruthy()
    expect(root.textContent).toMatch(/Activa alertas cuando un producto no es apto para tu perfil/)
    expect(root.querySelector('a[href="preferences.html"]')?.textContent).not.toMatch(/[Ee]ditar/)
  })

  it('muestra el resumen del perfil dietético/alérgico ANTES de cualquier upsell, y botón editar preferencias para premium', () => {
    getCachedProfile.mockReturnValue({
      email: 'a@b.com', plan: 'premium',
      preferences: { dietary: ['vegan'], allergens: [{ code: 'cacahuate', severity: 'severe' }], healthConditions: [] }
    })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.account-plan-premium')).toBeTruthy()
    expect(root.textContent).toMatch(/vegan/)
    expect(root.querySelector('a[href="preferences.html"]').textContent).toMatch(/[Ee]ditar preferencias/)
    expect(root.querySelector('.account-upsell')).toBeNull()
  })

  it('siempre incluye el botón de cerrar sesión, sin importar el plan', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', plan: 'free' })
    renderAccountHub()
    expect(document.getElementById('btn-logout')).toBeTruthy()
  })

  it('muestra el total de escaneos y alertas activas reales del perfil cacheado', () => {
    getCachedProfile.mockReturnValue({
      email: 'a@b.com', plan: 'premium',
      usage: { date: '2026-07-16', ocrCount: 1, cacheRefreshCount: 0, totalScans: 12 },
      preferences: { dietary: ['vegan'], allergens: [{ code: 'cacahuate', severity: 'severe' }], healthConditions: [] }
    })
    renderAccountHub()
    const root = document.getElementById('account-root')
    const nums = Array.from(root.querySelectorAll('.stat-num')).map(el => el.textContent)
    expect(nums).toEqual(['12', '2'])
  })

  it('el total de escaneos y alertas activas es 0 si el perfil no tiene usage/preferences todavía (recién creado)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', plan: 'free' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    const nums = Array.from(root.querySelectorAll('.stat-num')).map(el => el.textContent)
    expect(nums).toEqual(['0', '0'])
  })

  it('envuelve todo el contenido en un único .content-card, no en cards sueltas (hallazgo de reskin visual)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', plan: 'free' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelectorAll(':scope > .content-card').length).toBe(1)
  })
})

describe('handleLogout', () => {
  it('llama signOut y redirige a index.html', async () => {
    await handleLogout()
    expect(signOut).toHaveBeenCalledWith(mockAuth)
    expect(window.location.href).toBe('index.html')
  })
})
