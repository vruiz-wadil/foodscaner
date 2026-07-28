import { describe, it, expect } from 'vitest'
import { COUNTRY_CODES, flagEmoji, splitE164 } from '../country-codes.js'

describe('COUNTRY_CODES', () => {
  it('tiene exactamente México y Estados Unidos, por ahora (alcance reducido a propósito)', () => {
    expect(COUNTRY_CODES).toEqual([
      { name: 'México', iso2: 'MX', dial: '+52' },
      { name: 'Estados Unidos', iso2: 'US', dial: '+1' }
    ])
  })
})

describe('flagEmoji', () => {
  it('converts an ISO2 code into its regional-indicator flag emoji', () => {
    expect(flagEmoji('MX')).toBe('🇲🇽')
    expect(flagEmoji('US')).toBe('🇺🇸')
  })
})

describe('splitE164', () => {
  it('separa un E.164 de México en { dial, local }', () => {
    expect(splitE164('+525512345678')).toEqual({ dial: '+52', local: '5512345678' })
  })

  it('separa un E.164 de Estados Unidos en { dial, local }', () => {
    expect(splitE164('+13334445555')).toEqual({ dial: '+1', local: '3334445555' })
  })

  it('cae a México (+52) con el número tal cual si no hay match', () => {
    expect(splitE164('+99999999')).toEqual({ dial: '+52', local: '99999999' })
  })

  it('cae a México con local vacío si el teléfono es vacío/null', () => {
    expect(splitE164('')).toEqual({ dial: '+52', local: '' })
    expect(splitE164(null)).toEqual({ dial: '+52', local: '' })
  })
})
