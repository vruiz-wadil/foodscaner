import { describe, it, expect } from 'vitest'
import { COUNTRY_CODES, flagEmoji } from '../country-codes.js'

describe('COUNTRY_CODES', () => {
  it('has México first', () => {
    expect(COUNTRY_CODES[0]).toEqual({ name: 'México', iso2: 'MX', dial: '+52' })
  })

  it('has at least 180 countries', () => {
    expect(COUNTRY_CODES.length).toBeGreaterThanOrEqual(180)
  })

  it('every entry has a non-empty name, a 2-letter iso2, and a dial code starting with +', () => {
    for (const c of COUNTRY_CODES) {
      expect(c.name.length).toBeGreaterThan(0)
      expect(c.iso2).toMatch(/^[A-Z]{2}$/)
      expect(c.dial).toMatch(/^\+\d{1,4}$/)
    }
  })

  it('has no duplicate iso2 codes', () => {
    const codes = COUNTRY_CODES.map(c => c.iso2)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('rest of the list (after México) is alphabetical by name', () => {
    const rest = COUNTRY_CODES.slice(1).map(c => c.name)
    const sorted = [...rest].sort((a, b) => a.localeCompare(b, 'es'))
    expect(rest).toEqual(sorted)
  })
})

describe('flagEmoji', () => {
  it('converts an ISO2 code into its regional-indicator flag emoji', () => {
    expect(flagEmoji('MX')).toBe('🇲🇽')
    expect(flagEmoji('US')).toBe('🇺🇸')
    expect(flagEmoji('ES')).toBe('🇪🇸')
  })
})
