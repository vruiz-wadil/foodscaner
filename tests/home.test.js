/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const homeCode = fs.readFileSync(path.join(__dirname, '..', 'home.js'), 'utf8')

let redirectTargetForIncompleteOnboarding, greetingSubtitle, historyNavTarget

beforeAll(() => {
  const fn = new Function(homeCode + '\nreturn { redirectTargetForIncompleteOnboarding, greetingSubtitle, historyNavTarget }')
  const exported = fn()
  redirectTargetForIncompleteOnboarding = exported.redirectTargetForIncompleteOnboarding
  greetingSubtitle = exported.greetingSubtitle
  historyNavTarget = exported.historyNavTarget
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
