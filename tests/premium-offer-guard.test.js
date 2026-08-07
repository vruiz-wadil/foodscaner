/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { shouldRedirectToAccount } from '../premium-offer-guard.js'

describe('shouldRedirectToAccount', () => {
  it('returns true when there is a logged-in user, regardless of membership status', () => {
    expect(shouldRedirectToAccount({ uid: 'abc' })).toBe(true)
  })

  it('returns false when there is no user', () => {
    expect(shouldRedirectToAccount(null)).toBe(false)
  })
})
