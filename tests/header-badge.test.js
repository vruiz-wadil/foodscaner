/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const onAuthChange = vi.fn()
const getCachedProfile = vi.fn()
vi.mock('../authClient.js', () => ({ onAuthChange, getCachedProfile }))

let firstNameOf, computeBadgeState, mountHeaderBadge

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  document.body.innerHTML = '<a id="header-badge" class="header-badge hidden"></a>'
  const mod = await import('../header-badge.js')
  firstNameOf = mod.firstNameOf
  computeBadgeState = mod.computeBadgeState
  mountHeaderBadge = mod.mountHeaderBadge
})

describe('firstNameOf', () => {
  it('returns the first token of profile.displayName', () => {
    expect(firstNameOf({ profile: { displayName: 'María Fernanda López' } })).toBe('María')
  })

  it('falls back to the email local-part when displayName is missing', () => {
    expect(firstNameOf({ email: 'juan.perez@example.com' })).toBe('juan.perez')
  })

  it('falls back to "Cuenta" when neither displayName nor email exist', () => {
    expect(firstNameOf({})).toBe('Cuenta')
  })

  it('falls back to "Cuenta" when displayName is an empty/whitespace string', () => {
    expect(firstNameOf({ profile: { displayName: '   ' }, email: 'a@b.com' })).toBe('a')
  })
})

describe('computeBadgeState', () => {
  it('returns the CTA state pointing to premium-offer.html when there is no session', () => {
    const state = computeBadgeState(null)
    expect(state).toEqual({ label: 'Hazte Premium', href: 'premium-offer.html', variant: 'cta' })
  })

  it('returns the CTA state pointing to onboarding-membership.html when logged in without active membership', () => {
    const state = computeBadgeState({ membershipStatus: 'pending', profile: { displayName: 'Ana' } })
    expect(state).toEqual({ label: 'Hazte Premium', href: 'onboarding-membership.html', variant: 'cta' })
  })

  it('returns the premium state with the first name pointing to account.html when membership is active', () => {
    const state = computeBadgeState({ membershipStatus: 'active', profile: { displayName: 'Ana García' } })
    expect(state).toEqual({ label: 'Ana', href: 'account.html', variant: 'premium' })
  })
})

describe('mountHeaderBadge', () => {
  it('renders the CTA state immediately from the cached profile and un-hides the pill', () => {
    getCachedProfile.mockReturnValue(null)
    mountHeaderBadge()
    const el = document.getElementById('header-badge')
    expect(el.className).toBe('header-badge cta')
    expect(el.getAttribute('href')).toBe('premium-offer.html')
    expect(el.textContent).toContain('Hazte Premium')
  })

  it('re-renders when authClient fires an auth change', () => {
    getCachedProfile.mockReturnValueOnce(null).mockReturnValueOnce({ membershipStatus: 'active', profile: { displayName: 'Luis' } })
    mountHeaderBadge()
    const callback = onAuthChange.mock.calls[0][0]
    callback()
    const el = document.getElementById('header-badge')
    expect(el.className).toBe('header-badge premium')
    expect(el.getAttribute('href')).toBe('account.html')
    expect(el.textContent).toContain('Luis')
  })

  it('escapes HTML in a malicious displayName instead of injecting it', () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'active', profile: { displayName: '<img src=x onerror=alert(1)>' } })
    mountHeaderBadge()
    const el = document.getElementById('header-badge')
    expect(el.querySelector('img')).toBeNull()
    expect(el.innerHTML).toContain('&lt;img')
  })

  it('does nothing when the page has no #header-badge element', () => {
    document.body.innerHTML = ''
    expect(() => mountHeaderBadge()).not.toThrow()
  })
})
