import { describe, it, expect } from 'vitest'
import { buildPreferenceSummary, ALLERGEN_LABELS, HEALTH_LABELS } from '../preference-labels.js'

describe('buildPreferenceSummary', () => {
  it('devuelve counts y chips vacíos cuando prefs es null', () => {
    expect(buildPreferenceSummary(null)).toEqual({ counts: [], chips: [] })
  })

  it('devuelve counts y chips vacíos cuando prefs no tiene ninguna categoría', () => {
    expect(buildPreferenceSummary({ dietary: [], allergens: [], healthConditions: [] })).toEqual({ counts: [], chips: [] })
  })

  it('cuenta en singular cuando hay exactamente 1 item por categoría', () => {
    const result = buildPreferenceSummary({
      dietary: ['vegan'],
      allergens: [{ code: 'cacahuate', severity: 'severe' }],
      healthConditions: ['celiac']
    })
    expect(result.counts).toEqual([
      { emoji: '🌱', text: '1 dietético' },
      { emoji: '⚠️', text: '1 alergia' },
      { emoji: '❤️', text: '1 condición' }
    ])
  })

  it('cuenta en plural cuando hay más de 1 item por categoría', () => {
    const result = buildPreferenceSummary({
      dietary: ['vegan', 'keto'],
      allergens: [{ code: 'cacahuate', severity: 'mild' }, { code: 'soja', severity: 'severe' }],
      healthConditions: ['celiac', 'diabet']
    })
    expect(result.counts).toEqual([
      { emoji: '🌱', text: '2 dietéticos' },
      { emoji: '⚠️', text: '2 alergias' },
      { emoji: '❤️', text: '2 condiciones' }
    ])
  })

  it('labels fenilc y lactos correctamente (antes no existian en HEALTH_LABELS, caian al fallback de codigo crudo)', () => {
    expect(HEALTH_LABELS.fenilc.label).toBe('Fenilcetonuria')
    expect(HEALTH_LABELS.lactos.label).toBe('Intolerancia a lactosa')
    const result = buildPreferenceSummary({ dietary: [], allergens: [], healthConditions: ['fenilc', 'lactos'] })
    const labels = result.chips.map(c => c.label)
    expect(labels).toContain('Fenilcetonuria')
    expect(labels).toContain('Intolerancia a lactosa')
  })

  it('omite categorías con 0 items de counts', () => {
    const result = buildPreferenceSummary({ dietary: ['vegan'], allergens: [], healthConditions: [] })
    expect(result.counts).toEqual([{ emoji: '🌱', text: '1 dietético' }])
  })

  it('arma chips con emoji, label y (para alergias) severidad traducida', () => {
    const result = buildPreferenceSummary({
      dietary: ['organic'],
      allergens: [{ code: 'lacteos', severity: 'severe' }],
      healthConditions: ['celiac']
    })
    expect(result.chips).toEqual([
      { category: 'dietary', emoji: '🌿', label: 'Orgánico', extra: null, severity: null },
      { category: 'allergens', emoji: '🥛', label: 'Lácteos', extra: 'Estricto', severity: 'severe' },
      { category: 'health', emoji: '🌾', label: 'Celiaquía', extra: null, severity: null }
    ])
  })

  it('código sin match en el mapa se muestra tal cual, sin emoji, sin romper', () => {
    const result = buildPreferenceSummary({ dietary: ['codigo_inventado'], allergens: [], healthConditions: [] })
    expect(result.chips).toEqual([
      { category: 'dietary', emoji: '', label: 'codigo_inventado', extra: null, severity: null }
    ])
    expect(result.counts).toEqual([{ emoji: '🌱', text: '1 dietético' }])
  })

  it('un alérgeno con severidad "mild" traduce extra a "Aviso" en el chip', () => {
    const result = buildPreferenceSummary({ dietary: [], allergens: [{ code: 'trigo', severity: 'mild' }], healthConditions: [] })
    expect(result.chips).toEqual([
      { category: 'allergens', emoji: '🌾', label: 'Trigo', extra: 'Aviso', severity: 'mild' }
    ])
  })

  it('un alérgeno sin severidad reconocida (o ausente) tiene extra:null en el chip', () => {
    const result = buildPreferenceSummary({ dietary: [], allergens: [{ code: 'trigo' }], healthConditions: [] })
    expect(result.chips[0].extra).toBeNull()
  })
})

describe('ALLERGEN_LABELS', () => {
  it('labels soja as "Soya"', () => {
    expect(ALLERGEN_LABELS.soja.label).toBe('Soya')
  })
})
