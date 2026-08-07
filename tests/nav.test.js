/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const navCode = fs.readFileSync(path.join(__dirname, '..', 'nav.js'), 'utf8')

let historyNavTarget

beforeAll(() => {
  const fn = new Function(navCode + '\nreturn { historyNavTarget }')
  const exported = fn()
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
