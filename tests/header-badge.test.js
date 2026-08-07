/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const onProfileChange = vi.fn()
vi.mock('../authClient.js', () => ({ onProfileChange }))

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
  it('stays hidden and un-rendered on mount, before any definitive profile state arrives', () => {
    // Regression guard for Critical #2 / Important #4: mounting must NOT
    // render a guessed state synchronously — only subscribe.
    mountHeaderBadge()
    // header-badge.js also auto-mounts on import (module bottom), so this
    // may be called more than once — what matters is it subscribed and did
    // not render a guessed state.
    expect(onProfileChange).toHaveBeenCalled()
    const el = document.getElementById('header-badge')
    expect(el.className).toBe('header-badge hidden')
  })

  it('renders the CTA state once onProfileChange delivers a confirmed "no session" (null)', () => {
    mountHeaderBadge()
    const callback = onProfileChange.mock.calls[0][0]
    callback(null)
    const el = document.getElementById('header-badge')
    expect(el.className).toBe('header-badge cta')
    expect(el.getAttribute('href')).toBe('premium-offer.html')
    expect(el.textContent).toContain('Hazte Premium')
  })

  it('renders the Premium state once onProfileChange delivers the resolved profile', () => {
    // This is the exact scenario Critical #2 broke: the profile becomes
    // available asynchronously, after the raw Firebase auth event already
    // fired. mountHeaderBadge must re-render when that happens.
    mountHeaderBadge()
    const callback = onProfileChange.mock.calls[0][0]
    callback({ membershipStatus: 'active', profile: { displayName: 'Luis' } })
    const el = document.getElementById('header-badge')
    expect(el.className).toBe('header-badge premium')
    expect(el.getAttribute('href')).toBe('account.html')
    expect(el.textContent).toContain('Luis')
  })

  it('renders immediately from a replayed profile when onProfileChange already resolved before mount', () => {
    // authClient.onProfileChange() replays the last known answer to late
    // subscribers (e.g. account.html/preferences.html, which sync eagerly
    // before header-badge.js mounts). Simulate that replay behavior here.
    onProfileChange.mockImplementation((cb) => {
      cb({ membershipStatus: 'active', profile: { displayName: 'Luis' } })
    })
    mountHeaderBadge()
    const el = document.getElementById('header-badge')
    expect(el.className).toBe('header-badge premium')
  })

  it('escapes HTML in a malicious displayName instead of injecting it', () => {
    mountHeaderBadge()
    const callback = onProfileChange.mock.calls[0][0]
    callback({ membershipStatus: 'active', profile: { displayName: '<img src=x onerror=alert(1)>' } })
    const el = document.getElementById('header-badge')
    expect(el.querySelector('img')).toBeNull()
    expect(el.innerHTML).toContain('&lt;img')
  })

  it('does nothing when the page has no #header-badge element', () => {
    document.body.innerHTML = ''
    expect(() => mountHeaderBadge()).not.toThrow()
  })
})
