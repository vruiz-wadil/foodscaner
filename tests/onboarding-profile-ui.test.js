/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getIdToken = vi.fn()
const syncUserProfile = vi.fn()
const getCachedProfile = vi.fn()

vi.mock('../authClient.js', () => ({ getIdToken, syncUserProfile, getCachedProfile }))

let renderMissingFields, submitProfile, initOnboardingProfilePage

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  document.body.innerHTML = `
    <form id="profile-form">
      <div class="form-field" id="field-name"><input id="input-name"></div>
      <div class="form-field" id="field-phone"><input id="input-phone"></div>
      <div class="form-field" id="field-email"><input id="input-email"></div>
      <button type="submit" id="btn-continue-profile">Continuar</button>
      <p id="profile-error" class="hidden"></p>
    </form>
  `
  const mod = await import('../onboarding-profile-ui.js')
  renderMissingFields = mod.renderMissingFields
  submitProfile = mod.submitProfile
  initOnboardingProfilePage = mod.initOnboardingProfilePage
  getIdToken.mockResolvedValue('tok')
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
})

describe('renderMissingFields', () => {
  it('hides the fields the provider already supplied (Google: displayName+email present, phone missing)', () => {
    renderMissingFields({ displayName: 'Ana', email: 'ana@example.com', phoneNumber: null })
    expect(document.getElementById('field-name').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('field-email').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('field-phone').classList.contains('hidden')).toBe(false)
  })

  it('shows all 3 fields when nothing was supplied (email/password signup)', () => {
    renderMissingFields({ displayName: null, email: null, phoneNumber: null })
    expect(document.getElementById('field-name').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('field-phone').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('field-email').classList.contains('hidden')).toBe(false)
  })
})

describe('submitProfile', () => {
  it('rejects an empty visible name field without calling fetch', async () => {
    document.getElementById('field-name').classList.remove('hidden')
    document.getElementById('field-phone').classList.add('hidden')
    document.getElementById('field-email').classList.add('hidden')
    document.getElementById('input-name').value = '   '
    await expect(submitProfile()).rejects.toThrow()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('sends only the visible fields and redirects to preferences.html?onboarding=1 on success', async () => {
    document.getElementById('field-name').classList.add('hidden')
    document.getElementById('field-email').classList.add('hidden')
    document.getElementById('field-phone').classList.remove('hidden')
    document.getElementById('input-phone').value = '+525512345678'
    delete window.location
    window.location = { href: '' }

    await submitProfile()

    const [, options] = global.fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ phone: '+525512345678' })
    expect(window.location.href).toBe('preferences.html?onboarding=1')
  })
})

describe('DOMContentLoaded completedAt guard', () => {
  it('redirects straight to index.html when the profile is already complete', async () => {
    getCachedProfile.mockReturnValue({
      displayName: 'Ana',
      email: 'ana@example.com',
      phoneNumber: '+525512345678',
      profile: { completedAt: '2026-01-01T00:00:00.000Z' }
    })
    delete window.location
    window.location = { href: '' }

    await initOnboardingProfilePage()

    expect(syncUserProfile).toHaveBeenCalled()
    expect(window.location.href).toBe('index.html')
  })
})
