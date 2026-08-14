/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const homeCode = fs.readFileSync(path.join(__dirname, '..', 'home.js'), 'utf8')

let redirectTargetForIncompleteOnboarding, greetingSubtitle, historyNavTarget, renderGrid

beforeAll(() => {
  const fn = new Function(homeCode + '\nreturn { redirectTargetForIncompleteOnboarding, greetingSubtitle, historyNavTarget, renderGrid }')
  const exported = fn()
  redirectTargetForIncompleteOnboarding = exported.redirectTargetForIncompleteOnboarding
  greetingSubtitle = exported.greetingSubtitle
  historyNavTarget = exported.historyNavTarget
  renderGrid = exported.renderGrid
})

describe('historyNavTarget', () => {
  it('regresa premium-offer.html cuando no hay sesión', () => {
    expect(historyNavTarget(null)).toBe('premium-offer.html')
  })

  it('regresa onboarding-membership.html cuando hay sesión sin membresía activa', () => {
    expect(historyNavTarget({ membershipStatus: 'pending' })).toBe('onboarding-membership.html')
  })

  it('regresa history.html cuando la membresía está activa', () => {
    expect(historyNavTarget({ membershipStatus: 'active' })).toBe('history.html')
  })
})

describe('redirectTargetForIncompleteOnboarding', () => {
  it('regresa null sin perfil (no logueado — home.js ya maneja ese caso por separado)', () => {
    expect(redirectTargetForIncompleteOnboarding(null)).toBeNull()
  })

  it('regresa onboarding-profile.html cuando profile.completedAt aún no existe', () => {
    const profile = { profile: { completedAt: null }, membershipStatus: 'pending' }
    expect(redirectTargetForIncompleteOnboarding(profile)).toBe('onboarding-profile.html')
  })

  it('regresa null cuando el perfil ya está completo aunque la membresía siga pending — skip es una opción válida', () => {
    const profile = { profile: { completedAt: '2026-07-22T00:00:00.000Z' }, membershipStatus: 'pending' }
    expect(redirectTargetForIncompleteOnboarding(profile)).toBeNull()
  })

  it('regresa null cuando el perfil está completo y la membresía está activa (nada que redirigir)', () => {
    const profile = { profile: { completedAt: '2026-07-22T00:00:00.000Z' }, membershipStatus: 'active' }
    expect(redirectTargetForIncompleteOnboarding(profile)).toBeNull()
  })

  it('regresa null cuando la membresía está expired — expirado NO se manda de vuelta al onboarding, se maneja en account.html', () => {
    const profile = { profile: { completedAt: '2026-07-22T00:00:00.000Z' }, membershipStatus: 'expired' }
    expect(redirectTargetForIncompleteOnboarding(profile)).toBeNull()
  })
})

describe('greetingSubtitle', () => {
  it('regresa null sin perfil (no logueado — el subtítulo genérico de index.html no se toca)', () => {
    expect(greetingSubtitle(null)).toBeNull()
  })

  it('regresa null si el perfil no tiene displayName todavía', () => {
    expect(greetingSubtitle({ email: 'a@b.com' })).toBeNull()
  })

  it('usa profile.profile.displayName cuando existe', () => {
    expect(greetingSubtitle({ profile: { displayName: 'Ana Ruiz' } })).toBe('Hola Ana Ruiz, escanea y lo sabrás en segundos.')
  })

  it('cae a profile.displayName si profile.profile no lo tiene', () => {
    expect(greetingSubtitle({ displayName: 'Luis' })).toBe('Hola Luis, escanea y lo sabrás en segundos.')
  })
})

describe('renderGrid — fuente del historial (local vs nube)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="products-grid"></div>
      <div id="products-empty" class="hidden"></div>
      <div id="activation-hint" class="hidden"></div>
    `
    localStorage.clear()
    localStorage.setItem('yomi_activation_shown', '1') // evita el nudge de primer-scan en estos tests
    window.authClient = { getIdToken: async () => 'tok-1' }
    global.fetch = undefined
  })

  it('usuario sin perfil (no logueado) usa el historial local', async () => {
    localStorage.setItem('yomi_history', JSON.stringify([{ barcode: '111', name: 'Local Producto', rating: 'sano' }]))
    await renderGrid(null)
    expect(document.getElementById('products-grid').textContent).toMatch(/Local Producto/)
  })

  it('usuario premium (membershipStatus active) usa el historial de la nube, no el local', async () => {
    localStorage.setItem('yomi_history', JSON.stringify([{ barcode: '111', name: 'Local Producto', rating: 'sano' }]))
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ history: [{ barcode: '222', productName: 'Cloud Producto', verdict: 'evitar', image: '' }] })
    })
    await renderGrid({ membershipStatus: 'active' })
    const text = document.getElementById('products-grid').textContent
    expect(text).toMatch(/Cloud Producto/)
    expect(text).not.toMatch(/Local Producto/)
  })

  it('usuario premium con fetch de nube fallido cae al historial local', async () => {
    localStorage.setItem('yomi_history', JSON.stringify([{ barcode: '111', name: 'Local Producto', rating: 'sano' }]))
    global.fetch = async () => ({ ok: false })
    await renderGrid({ membershipStatus: 'active' })
    expect(document.getElementById('products-grid').textContent).toMatch(/Local Producto/)
  })

  it('usuario logueado pero no premium (pending) usa el historial local', async () => {
    localStorage.setItem('yomi_history', JSON.stringify([{ barcode: '111', name: 'Local Producto', rating: 'sano' }]))
    await renderGrid({ membershipStatus: 'pending' })
    expect(document.getElementById('products-grid').textContent).toMatch(/Local Producto/)
  })
})
