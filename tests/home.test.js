/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const homeCode = fs.readFileSync(path.join(__dirname, '..', 'home.js'), 'utf8')

let redirectTargetForIncompleteOnboarding

beforeAll(() => {
  const fn = new Function(homeCode + '\nreturn { redirectTargetForIncompleteOnboarding }')
  redirectTargetForIncompleteOnboarding = fn().redirectTargetForIncompleteOnboarding
})

describe('redirectTargetForIncompleteOnboarding', () => {
  it('regresa null sin perfil (no logueado — home.js ya maneja ese caso por separado)', () => {
    expect(redirectTargetForIncompleteOnboarding(null)).toBeNull()
  })

  it('regresa onboarding-profile.html cuando profile.completedAt aún no existe', () => {
    const profile = { profile: { completedAt: null }, membershipStatus: 'pending' }
    expect(redirectTargetForIncompleteOnboarding(profile)).toBe('onboarding-profile.html')
  })

  it('regresa onboarding-membership.html cuando el perfil ya está completo pero la membresía sigue pending', () => {
    const profile = { profile: { completedAt: '2026-07-22T00:00:00.000Z' }, membershipStatus: 'pending' }
    expect(redirectTargetForIncompleteOnboarding(profile)).toBe('onboarding-membership.html')
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
