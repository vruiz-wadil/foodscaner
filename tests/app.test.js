/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')

let parseApiProduct, isGlutenRelated, extractDietaryFromLabels, eanChecksum, expandUpcE, validateBarcode, computeVerdict, hasNoRealData

beforeAll(() => {
  const fn = new Function(appCode + '\nreturn { parseApiProduct, isGlutenRelated, extractDietaryFromLabels, eanChecksum, expandUpcE, validateBarcode, computeVerdict, hasNoRealData }')
  const exports = fn()
  parseApiProduct = exports.parseApiProduct
  isGlutenRelated = exports.isGlutenRelated
  extractDietaryFromLabels = exports.extractDietaryFromLabels
  eanChecksum = exports.eanChecksum
  expandUpcE = exports.expandUpcE
  validateBarcode = exports.validateBarcode
  computeVerdict = exports.computeVerdict
  hasNoRealData = exports.hasNoRealData
})

// ─── isGlutenRelated ───────────────────────────────────────

describe('isGlutenRelated', () => {
  it('returns true for gluten', () => {
    expect(isGlutenRelated('gluten')).toBe(true)
  })

  it('returns true for trigo', () => {
    expect(isGlutenRelated('trigo')).toBe(true)
  })

  it('returns true for trigo (gluten)', () => {
    expect(isGlutenRelated('trigo (gluten)')).toBe(true)
  })

  it('returns true for cebada, centeno, avena', () => {
    expect(isGlutenRelated('cebada')).toBe(true)
    expect(isGlutenRelated('centeno')).toBe(true)
    expect(isGlutenRelated('avena')).toBe(true)
  })

  it('returns false for unrelated allergens', () => {
    expect(isGlutenRelated('leche')).toBe(false)
    expect(isGlutenRelated('huevo')).toBe(false)
    expect(isGlutenRelated('cacahuate')).toBe(false)
  })

  it('is case insensitive', () => {
    expect(isGlutenRelated('GLUTEN')).toBe(true)
    expect(isGlutenRelated('Trigo')).toBe(true)
  })

  it('handles trimmed input', () => {
    expect(isGlutenRelated('  gluten  ')).toBe(true)
  })
})

// ─── extractDietaryFromLabels ──────────────────────────────

describe('extractDietaryFromLabels', () => {
  it('returns all null for empty tags', () => {
    const result = extractDietaryFromLabels([])
    expect(result).toEqual({
      vegan: null, vegetarian: null, keto: null, kosher: null, halal: null,
      organic: null, nonGmo: null, noAdditives: null, palmOilFree: null, fairTrade: null, caseinFree: null
    })
  })

  it('returns all null for undefined', () => {
    const result = extractDietaryFromLabels(undefined)
    expect(result.vegan).toBeNull()
  })

  it('detects vegan from en:vegan', () => {
    const result = extractDietaryFromLabels(['en:vegan'])
    expect(result.vegan).toBe(true)
    expect(result.vegetarian).toBeNull()
  })

  it('detects vegetarian from en:vegetarian', () => {
    const result = extractDietaryFromLabels(['en:vegetarian'])
    expect(result.vegetarian).toBe(true)
  })

  it('detects kosher label', () => {
    const result = extractDietaryFromLabels(['en:kosher'])
    expect(result.kosher).toBe(true)
  })

  it('detects halal from en:halal', () => {
    const result = extractDietaryFromLabels(['en:halal'])
    expect(result.halal).toBe(true)
  })

  it('detects multiple organic labels', () => {
    expect(extractDietaryFromLabels(['en:organic']).organic).toBe(true)
    expect(extractDietaryFromLabels(['en:eu-organic']).organic).toBe(true)
    expect(extractDietaryFromLabels(['en:usda-organic']).organic).toBe(true)
    expect(extractDietaryFromLabels(['en:bio']).organic).toBe(true)
  })

  it('detects nonGmo from en:non-gmo-project', () => {
    const result = extractDietaryFromLabels(['en:non-gmo-project'])
    expect(result.nonGmo).toBe(true)
  })

  it('detects noAdditives', () => {
    expect(extractDietaryFromLabels(['en:no-additives']).noAdditives).toBe(true)
    expect(extractDietaryFromLabels(['en:additive-free']).noAdditives).toBe(true)
  })

  it('detects palmOilFree', () => {
    const result = extractDietaryFromLabels(['en:palm-oil-free'])
    expect(result.palmOilFree).toBe(true)
  })

  it('detects fairTrade', () => {
    expect(extractDietaryFromLabels(['en:fair-trade']).fairTrade).toBe(true)
    expect(extractDietaryFromLabels(['en:fairtrade']).fairTrade).toBe(true)
    expect(extractDietaryFromLabels(['en:comercio-justo']).fairTrade).toBe(true)
  })

  it('handles multiple labels simultaneously', () => {
    const result = extractDietaryFromLabels(['en:vegan', 'en:organic', 'en:fair-trade', 'en:palm-oil-free'])
    expect(result.vegan).toBe(true)
    expect(result.organic).toBe(true)
    expect(result.fairTrade).toBe(true)
    expect(result.palmOilFree).toBe(true)
    expect(result.kosher).toBeNull()
    expect(result.halal).toBeNull()
  })

  it('is case insensitive', () => {
    const result = extractDietaryFromLabels(['EN:VEGAN', 'En:Organic'])
    expect(result.vegan).toBe(true)
    expect(result.organic).toBe(true)
  })
})

// ─── parseApiProduct ───────────────────────────────────────

describe('parseApiProduct', () => {
  it('parses a basic food product with nutriments', () => {
    const product = {
      product_name: 'Galletas Integrales',
      brands: 'Marca Test',
      categories: 'galletas, cereales',
      nutriments: {
        'energy-kcal_100g': 450,
        'sugars_100g': 20,
        'carbohydrates_100g': 65,
        'fiber_100g': 5,
        'proteins_100g': 8,
        'saturated-fat_100g': 5,
        'sodium_100g': 0.3
      },
      ingredients_text: 'harina integral, azúcar, aceite vegetal',
      allergens_tags: ['en:gluten', 'en:milk'],
      labels_tags: ['en:organic'],
      nutriscore_grade: 'c'
    }
    const result = parseApiProduct(product)
    expect(result.isFood).toBe(true)
    expect(result.name).toBe('Galletas Integrales')
    expect(result.brand).toBe('Marca Test')
    expect(result.calories.value).toBe(450)
    expect(result.calories.level).toBe('Alto')
    expect(result.sugars.value).toBe(20)
    expect(result.sugars.level).toBe('Medio')
    expect(result.carbohydrates.value).toBe(65)
    expect(result.carbohydrates.fiber).toBe(5)
    expect(result.proteins.value).toBe(8)
    expect(result.proteins.level).toBe('Moderado')
    expect(result.nutriscore).toBe('c')
    expect(result.isBeverage).toBe(false)
    expect(result.dietary.organic).toBe(true)
    expect(result.sellos.length).toBeGreaterThanOrEqual(1)
    expect(result.gluten.hasGluten).toBe(true)
    expect(result.allergens).toContain('Leche (Lácteos)')
  })

  it('detects non-food products', () => {
    const product = {
      product_name: 'Shampoo Suave',
      brands: 'Marca Test',
      categories: 'cosmetics, shampoo, higiene',
      nutriments: {},
      ingredients_text: '',
      allergens_tags: []
    }
    const result = parseApiProduct(product)
    expect(result.isFood).toBe(false)
  })

  it('handles products with no nutriments', () => {
    const product = {
      product_name: 'Producto Test',
      brands: 'Marca',
      categories: 'comida',
      nutriments: {},
      ingredients_text: 'agua, sal',
      allergens_tags: []
    }
    const result = parseApiProduct(product)
    expect(result.isFood).toBe(true)
    expect(result.calories.value).toBe(0)
    expect(result.calories.level).toBe('Bajo')
    expect(result.nutriscore).toBe('-')
  })

  it('converts kJ to kcal when no kcal provided', () => {
    const product = {
      product_name: 'Producto Test',
      brands: 'Marca',
      categories: 'comida',
      nutriments: {
        'energy_100g': 836.8
      },
      ingredients_text: 'agua',
      allergens_tags: []
    }
    const result = parseApiProduct(product)
    expect(result.calories.value).toBe(200)
    expect(result.calories.level).toBe('Moderado')
  })

  it('detects beverage and adjusts sugar thresholds', () => {
    const product = {
      product_name: 'Refresco Cola',
      brands: 'Marca',
      categories: 'bebida, refresco',
      nutriments: {
        'energy-kcal_100g': 42,
        'sugars_100g': 10.6,
        'carbohydrates_100g': 10.6
      },
      ingredients_text: 'agua, azúcar',
      allergens_tags: []
    }
    const result = parseApiProduct(product)
    expect(result.isBeverage).toBe(true)
    expect(result.sugars.level).toBe('Medio')
  })

  it('parses Contiene and Puede Contener declarations', () => {
    const product = {
      product_name: 'Producto Test',
      brands: 'Marca',
      categories: 'comida',
      nutriments: { 'energy-kcal_100g': 100 },
      ingredients_text: 'Ingredientes: harina. Contiene: leche, huevo. Puede contener: cacahuate, nueces.',
      allergens_tags: []
    }
    const result = parseApiProduct(product)
    expect(result.allergens).toContain('Lácteos')
    expect(result.allergens).toContain('Huevo')
    expect(result.traces.some(t => t.toLowerCase().includes('cacahuate') || t.toLowerCase().includes('maní'))).toBe(true)
  })

  it('generates Mexican warning seals correctly', () => {
    const product = {
      product_name: 'Pastel Alto Calorías',
      brands: 'Marca',
      categories: 'pastel, postre',
      nutriments: {
        'energy-kcal_100g': 350,
        'sugars_100g': 30,
        'saturated-fat_100g': 10,
        'sodium_100g': 0.5
      },
      ingredients_text: 'azúcar, harina, grasa',
      allergens_tags: []
    }
    const result = parseApiProduct(product)
    const sealLabels = result.sellos.map(s => s.label)
    expect(sealLabels).toContain('CALORÍAS')
    expect(sealLabels).toContain('AZÚCARES')
    expect(sealLabels).toContain('GRASAS SATURADAS')
    expect(sealLabels).toContain('SODIO')
  })

  it('detects gluten from allergens_tags', () => {
    const product = {
      product_name: 'Pan Blanco',
      brands: 'Marca',
      categories: 'pan, cereales',
      nutriments: { 'energy-kcal_100g': 250 },
      ingredients_text: 'harina de trigo, agua, sal',
      allergens_tags: ['en:gluten', 'en:wheat']
    }
    const result = parseApiProduct(product)
    expect(result.gluten.hasGluten).toBe(true)
    expect(result.gluten.classification).toBe('declared')
  })

  it('detects gluten-free certified products', () => {
    const product = {
      product_name: 'Pan Sin Gluten',
      brands: 'Marca',
      categories: 'pan, cereales',
      nutriments: { 'energy-kcal_100g': 200 },
      ingredients_text: 'harina de arroz, agua, sal',
      allergens_tags: [],
      labels_tags: ['en:gluten-free']
    }
    const result = parseApiProduct(product)
    expect(result.gluten._isGf).toBe(true)
    expect(result.gluten.classification).toBe('certified')
  })

  it('builds not-recommended lists correctly', () => {
    const product = {
      product_name: 'Bebida Energética',
      brands: 'Marca',
      categories: 'bebida, energética',
      nutriments: {
        'energy-kcal_100g': 48,
        'sugars_100g': 12,
        'sodium_100g': 0.35
      },
      ingredients_text: 'agua, azúcar, cafeína, edulcorantes',
      allergens_tags: []
    }
    const result = parseApiProduct(product)
    const grupos = result.notRecommended.map(n => n.grupo)
    expect(grupos).toContain('Niños')
    expect(grupos).toContain('Diabéticos')
    expect(grupos).toContain('Hipertensos')
  })

  it('estimates sodium from salt when sodium not available', () => {
    const product = {
      product_name: 'Producto Salado',
      brands: 'Marca',
      categories: 'comida',
      nutriments: {
        'energy-kcal_100g': 200,
        'salt_100g': 2
      },
      ingredients_text: 'sal, ingredientes',
      allergens_tags: []
    }
    const result = parseApiProduct(product)
    expect(result.sellos.some(s => s.label === 'SODIO')).toBe(true)
  })

  it('handles products with enriched USDA gluten data', () => {
    const product = {
      product_name: 'Producto con gluten',
      brands: 'Marca',
      categories: 'comida',
      nutriments: { 'energy-kcal_100g': 100 },
      ingredients_text: '',
      allergens_tags: [],
      _gluten_enriched: { hasGluten: true, details: 'Contiene gluten detectado por USDA', detected: ['gluten'] }
    }
    const result = parseApiProduct(product)
    expect(result.gluten.hasGluten).toBe(true)
    expect(result.gluten.source).toBe('ai')
  })

  it('provides default name and brand when missing', () => {
    const product = {
      categories: 'comida',
      nutriments: { 'energy-kcal_100g': 100 },
      ingredients_text: 'agua',
      allergens_tags: []
    }
    const result = parseApiProduct(product)
    expect(result.name).toBe('Producto Desconocido')
    expect(result.brand).toBe('Marca genérica')
  })
})

// ─── eanChecksum ───────────────────────────────────────────────
describe('eanChecksum', () => {
  it('validates a correct EAN-13', () => {
    expect(eanChecksum('4006381333931')).toBe(true)
  })
  it('rejects an EAN-13 with wrong check digit', () => {
    expect(eanChecksum('4006381333932')).toBe(false)
  })
  it('validates a correct UPC-A', () => {
    expect(eanChecksum('036000291452')).toBe(true)
  })
  it('rejects a UPC-A with wrong check digit', () => {
    expect(eanChecksum('036000291453')).toBe(false)
  })
  it('validates a correct EAN-8', () => {
    expect(eanChecksum('40111223')).toBe(true)
  })
  it('rejects an EAN-8 with wrong check digit', () => {
    expect(eanChecksum('40111221')).toBe(false)
  })
})

// ─── expandUpcE ───────────────────────────────────────────────
describe('expandUpcE', () => {
  it('expands UPC-E with last digit 6 → UPC-A', () => {
    // UPC-E 01234565: mid=123456, last=6 (>=5)
    // S d1d2d3d4d5 0000 last E → 0 12345 0000 6 5 = 012345000065
    expect(expandUpcE('01234565')).toBe('012345000065')
  })
  it('expands UPC-E with last digit 3 → UPC-A', () => {
    // UPC-E 01234535: mid=123453, last=3
    // S d1d2d3 00000 d4d5 E → 0 123 00000 45 5 = 012300000455
    expect(expandUpcE('01234535')).toBe('012300000455')
  })
})

// ─── validateBarcode ────────────────────────────────────────────
describe('validateBarcode', () => {
  it('accepts a valid EAN-13', () => {
    const r = validateBarcode('4006381333931')
    expect(r.valid).toBe(true)
    expect(r.code).toBe('4006381333931')
  })
  it('rejects a truncated code (7 digits)', () => {
    expect(validateBarcode('7500227').valid).toBe(false)
  })
  it('rejects a code with bad checksum', () => {
    expect(validateBarcode('4006381333932').valid).toBe(false)
  })
  it('accepts a valid UPC-A', () => {
    const r = validateBarcode('036000291452')
    expect(r.valid).toBe(true)
    expect(r.code).toBe('036000291452')
  })
  it('accepts a valid EAN-8', () => {
    const r = validateBarcode('40111223')
    expect(r.valid).toBe(true)
    expect(r.code).toBe('40111223')
  })
  it('expands a valid UPC-E to UPC-A', () => {
    // '01234531' fails EAN-8 check (computed check digit = 4 ≠ 1) but
    // expands as a valid UPC-E: mid='123453', last='3' → '012300000451'
    const r = validateBarcode('01234531')
    expect(r.valid).toBe(true)
    expect(r.code).toBe('012300000451')
  })

  it('returns EAN-8 as-is when 8-digit code starting with 0 passes EAN-8 checksum', () => {
    // '01234565' is valid EAN-8 (check digit 5 matches); EAN-8 wins over UPC-E
    const r = validateBarcode('01234565')
    expect(r.valid).toBe(true)
    expect(r.code).toBe('01234565')
  })
  it('strips spaces and dashes before validating', () => {
    expect(validateBarcode('4006381 333931').valid).toBe(true)
  })
  it('rejects non-digit characters', () => {
    expect(validateBarcode('ABCDEFGHIJKLM').valid).toBe(false)
  })
})

// ─── computeVerdict (personalización premium) ──────────────

describe('computeVerdict — sin userPreferences (retrocompatibilidad)', () => {
  it('regresa "regular" cuando no hay datos reales', () => {
    const product = { isFromFallback: true, sellos: [], notRecommended: [] }
    expect(computeVerdict(product)).toBe('regular')
  })

  it('regresa "sano" sin sellos ni notRecommended', () => {
    const product = { sellos: [], notRecommended: [] }
    expect(computeVerdict(product)).toBe('sano')
  })

  it('regresa "evitar" con 3+ sellos', () => {
    const product = { sellos: ['a', 'b', 'c'], notRecommended: [] }
    expect(computeVerdict(product)).toBe('evitar')
  })

  it('undefined como segundo argumento se comporta igual que sin argumento', () => {
    const product = { sellos: ['a'], notRecommended: [] }
    expect(computeVerdict(product, undefined)).toBe(computeVerdict(product))
  })
})

describe('computeVerdict — con userPreferences', () => {
  it('Regla 1: alérgeno severity "severe" detectado → evitar, incluso si el producto sería "sano"', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Cacahuate'] }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'severe' }], dietary: [], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('evitar')
  })

  it('Regla 1: no aplica si el alérgeno severo no está en product.allergens', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Huevo'] }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'severe' }], dietary: [], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('sano')
  })

  it('Regla 2: healthCondition matchea un grupo certain:true en notRecommended → evitar', () => {
    const product = { sellos: [], notRecommended: [{ grupo: 'Diabéticos', razon: 'Alto en azúcares', certain: true }] }
    const prefs = { allergens: [], dietary: [], healthConditions: ['diabet'] }
    expect(computeVerdict(product, prefs)).toBe('evitar')
  })

  it('Regla 2: no aplica si el grupo notRecommended no es certain:true', () => {
    const product = { sellos: [], notRecommended: [{ grupo: 'Diabéticos', razon: 'Posible', certain: false }] }
    const prefs = { allergens: [], dietary: [], healthConditions: ['diabet'] }
    expect(computeVerdict(product, prefs)).toBe('sano')
  })

  it('Regla 3: dieta violada explícitamente (dietary.vegan === false) → evitar', () => {
    const product = { sellos: [], notRecommended: [], dietary: { vegan: false } }
    const prefs = { allergens: [], dietary: ['vegan'], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('evitar')
  })

  it('Regla 3: no aplica si dietary[key] es null/undefined (sin datos, no violación)', () => {
    const product = { sellos: [], notRecommended: [], dietary: { vegan: null } }
    const prefs = { allergens: [], dietary: ['vegan'], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('sano')
  })

  it('Regla 4: alérgeno mild detectado topa "sano" a "regular"', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Lácteos'] }
    const prefs = { allergens: [{ code: 'leche', severity: 'mild' }], dietary: [], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('regular')
  })

  it('Regla 4: no sube el verdict si ya era "regular" o "evitar" por otras causas', () => {
    const product = { sellos: ['a'], notRecommended: [], allergens: ['Lácteos'] }
    const prefs = { allergens: [{ code: 'leche', severity: 'mild' }], dietary: [], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('regular')
  })

  it('Regla 5: sin conflictos, comportamiento normal', () => {
    const product = { sellos: [], notRecommended: [], allergens: [], dietary: {} }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'severe' }], dietary: ['vegan'], healthConditions: ['diabet'] }
    expect(computeVerdict(product, prefs)).toBe('sano')
  })

  it('precedencia: Regla 1 (severe) gana sobre Regla 3 (dieta) si ambas aplican', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Cacahuate'], dietary: { vegan: false } }
    const prefs = {
      allergens: [{ code: 'cacahuate', severity: 'severe' }],
      dietary: ['vegan'],
      healthConditions: []
    }
    expect(computeVerdict(product, prefs)).toBe('evitar')
  })

  // Cross-pairs adicionales (hallazgo de cobertura de la 4a ronda — Test
  // Results Analyzer: solo Regla 1 vs 3 estaba cubierta; el if-chain es
  // secuencial así que el riesgo es bajo, pero cerrar el resto de pares.
  it('precedencia: Regla 2 (condición de salud) gana sobre Regla 4 (alérgeno mild) si ambas aplican', () => {
    const product = { sellos: [], notRecommended: [{ grupo: 'Diabéticos', razon: 'Alto en azúcares', certain: true }], allergens: ['Lácteos'] }
    const prefs = { allergens: [{ code: 'leche', severity: 'mild' }], dietary: [], healthConditions: ['diabet'] }
    expect(computeVerdict(product, prefs)).toBe('evitar')
  })

  it('precedencia: Regla 3 (dieta violada) gana sobre Regla 4 (alérgeno mild) si ambas aplican', () => {
    const product = { sellos: [], notRecommended: [], dietary: { vegan: false }, allergens: ['Lácteos'] }
    const prefs = { allergens: [{ code: 'leche', severity: 'mild' }], dietary: ['vegan'], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('evitar')
  })
})
