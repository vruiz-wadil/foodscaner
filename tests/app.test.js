/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')

let parseApiProduct, isGlutenRelated, normalizeSoyTerm, grupoClaveVerdict, extractDietaryFromLabels, eanChecksum, expandUpcE, validateBarcode, computeVerdict, computeVerdictReasons, hasNoRealData, getUserPreferencesForVerdict, renderPersonalizedDisclaimer, renderPersonalizedReasons, logScanToCloudHistory, incrementScanCounter, buildCameraConstraints, processOcrImage

beforeAll(() => {
  const fn = new Function(appCode + '\nreturn { parseApiProduct, isGlutenRelated, normalizeSoyTerm, grupoClaveVerdict, extractDietaryFromLabels, eanChecksum, expandUpcE, validateBarcode, computeVerdict, computeVerdictReasons, hasNoRealData, getUserPreferencesForVerdict, renderPersonalizedDisclaimer, renderPersonalizedReasons, logScanToCloudHistory, incrementScanCounter, buildCameraConstraints, processOcrImage }')
  const exports = fn()
  parseApiProduct = exports.parseApiProduct
  isGlutenRelated = exports.isGlutenRelated
  normalizeSoyTerm = exports.normalizeSoyTerm
  grupoClaveVerdict = exports.grupoClaveVerdict
  extractDietaryFromLabels = exports.extractDietaryFromLabels
  eanChecksum = exports.eanChecksum
  expandUpcE = exports.expandUpcE
  validateBarcode = exports.validateBarcode
  computeVerdict = exports.computeVerdict
  computeVerdictReasons = exports.computeVerdictReasons
  hasNoRealData = exports.hasNoRealData
  getUserPreferencesForVerdict = exports.getUserPreferencesForVerdict
  renderPersonalizedDisclaimer = exports.renderPersonalizedDisclaimer
  renderPersonalizedReasons = exports.renderPersonalizedReasons
  logScanToCloudHistory = exports.logScanToCloudHistory
  incrementScanCounter = exports.incrementScanCounter
  buildCameraConstraints = exports.buildCameraConstraints
  processOcrImage = exports.processOcrImage
})

// ─── normalizeSoyTerm ───────────────────────────────────────
describe('normalizeSoyTerm', () => {
  it('replaces lowercase "soja" with "soya"', () => {
    expect(normalizeSoyTerm('contiene soja y trigo')).toBe('contiene soya y trigo')
  })

  it('preserves capitalized "Soja" as "Soya"', () => {
    expect(normalizeSoyTerm('Soja: puede contener')).toBe('Soya: puede contener')
  })

  it('preserves all-caps "SOJA" as "SOYA"', () => {
    expect(normalizeSoyTerm('ALERGENOS: SOJA, TRIGO')).toBe('ALERGENOS: SOYA, TRIGO')
  })

  it('does not touch words that merely contain "soja" as a substring', () => {
    expect(normalizeSoyTerm('sojamiel')).toBe('sojamiel')
  })

  it('returns falsy input unchanged', () => {
    expect(normalizeSoyTerm(null)).toBe(null)
    expect(normalizeSoyTerm(undefined)).toBe(undefined)
    expect(normalizeSoyTerm('')).toBe('')
  })

  it('leaves text with no "soja" mention unchanged', () => {
    expect(normalizeSoyTerm('harina de trigo, azúcar')).toBe('harina de trigo, azúcar')
  })
})

// ─── buildCameraConstraints ────────────────────────────────
// hallazgo de debugging: startScanningNative() pedía la cámara con
// deviceId: {exact: cameraId} incondicionalmente. cameraId sale de
// enumerateDevices() llamado ANTES de tener permiso — en Firefox (y en
// algunos casos de Edge/Chromium) eso regresa un deviceId vacío/inválido,
// y un constraint "exact" contra un id inválido nunca puede satisfacerse:
// OverconstrainedError inmediato, sin llegar siquiera a pedir permiso.
describe('buildCameraConstraints', () => {
  it('uses an exact deviceId constraint when a real cameraId is provided', () => {
    expect(buildCameraConstraints('abc123')).toEqual({
      deviceId: { exact: 'abc123' },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    })
  })

  it('falls back to facingMode when cameraId is an empty string (pre-permission enumerateDevices on Firefox/Edge)', () => {
    expect(buildCameraConstraints('')).toEqual({
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    })
  })

  it('falls back to facingMode when cameraId is undefined', () => {
    expect(buildCameraConstraints(undefined)).toEqual({
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    })
  })
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

  it('un producto con gluten se marca dietary.glutenFree:false y notRecommended incluye Celiacos (bug reportado: producto mostraba "Sin datos" en dieta y "seguro" para celiaquia)', () => {
    const product = {
      product_name: 'Sazonador con trigo',
      ingredients_text: 'harina de trigo enriquecida, sal, especias',
      allergens_tags: ['en:gluten', 'en:soybeans'],
      nutriments: {}
    }
    const result = parseApiProduct(product)
    expect(result.gluten.hasGluten).toBe(true)
    // Antes: dietary no tenia la key glutenFree en absoluto -> siempre
    // undefined -> computeVerdictReasons mostraba "Sin datos: Sin gluten"
    // sin importar que el producto SI tuviera gluten.
    expect(result.dietary.glutenFree).toBe(false)
    // Antes: no habia ningun push deterministico de un grupo "Celiacos" en
    // notRecommended (solo diabeticos/hipertensos/lactosa/ninos/fenilcetonuricos
    // tenian deteccion propia) -> el chequeo de healthConditions:['celiac']
    // en computeVerdictReasons nunca encontraba conflicto.
    const celiacEntry = result.notRecommended.find(n => n.certain === true && grupoClaveVerdict(n.grupo) === 'celiac')
    expect(celiacEntry).toBeTruthy()
  })

  it('un producto certificado sin gluten se marca dietary.glutenFree:true y sin entrada Celiacos', () => {
    const product = {
      product_name: 'Galletas certificadas sin gluten',
      ingredients_text: 'harina de arroz, azúcar, aceite vegetal',
      labels_tags: ['en:gluten-free'],
      allergens_tags: [],
      nutriments: {}
    }
    const result = parseApiProduct(product)
    expect(result.gluten.hasGluten).toBe(false)
    expect(result.dietary.glutenFree).toBe(true)
    const celiacEntry = result.notRecommended.find(n => n.certain === true && grupoClaveVerdict(n.grupo) === 'celiac')
    expect(celiacEntry).toBeUndefined()
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

  it('translates en:soybeans allergen tag to "Soya" (not "Soja")', () => {
    const product = parseApiProduct({
      product_name: 'Test Product',
      allergens_tags: ['en:soybeans']
    })
    expect(product.allergens).toContain('Soya')
    expect(product.allergens).not.toContain('Soja')
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

  it('Regla 4: alérgeno con severity ausente/no reconocida NO topa "sano" a "regular" (matching old computeVerdict behavior)', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Lácteos'] }
    const prefs = { allergens: [{ code: 'leche', severity: undefined }], dietary: [], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('sano')
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

  it('detecta alergia a lácteos aunque el code de preferencias no tenga acento ("lacteos" vs "lácteos")', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Lácteos'] }
    const prefs = { allergens: [{ code: 'lacteos', severity: 'severe' }], dietary: [], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('evitar')
  })
})

// ─── computeVerdictReasons (filas de diagnóstico personalizado) ───

describe('computeVerdictReasons', () => {
  it('regresa array vacío si userPreferences es null/undefined', () => {
    const product = { sellos: [], notRecommended: [] }
    expect(computeVerdictReasons(product, null)).toEqual([])
    expect(computeVerdictReasons(product)).toEqual([])
  })

  it('regresa array vacío si el usuario no configuró ninguna restricción', () => {
    const product = { sellos: [], notRecommended: [] }
    const prefs = { allergens: [], dietary: [], healthConditions: [] }
    expect(computeVerdictReasons(product, prefs)).toEqual([])
  })

  it('alérgeno grave detectado: ok:false, severity:"grave", type:"allergen"', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Cacahuate'] }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'severe' }], dietary: [], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ ok: false, severity: 'grave', type: 'allergen', title: 'Contiene Cacahuate' })
    expect(reasons[0].detail).toMatch(/alergia grave a cacahuate/i)
    expect(reasons[0].type).toBe('allergen')
  })

  it('alérgeno leve NO detectado: ok:true, severity:"leve", type:"allergen"', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Huevo'] }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'mild' }], dietary: [], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ ok: true, severity: 'leve', type: 'allergen', title: 'Sin Cacahuate', detail: 'No detectamos tu alergia' })
  })

  it('alergia a trigo detectada via product.gluten.hasGluten aunque product.allergens no incluya "Trigo" (bug reportado: producto 041789001864, harina de trigo como primer ingrediente pero OFF solo taggeo en:gluten, no en:wheat)', () => {
    // allergensList real de OFF para este producto NO incluye "Trigo" (solo
    // trae en:gluten genérico) — y aunque lo incluyera, filteredAllergens
    // igual lo saca vía isGlutenRelated (ver app.js:1423, filtro deliberado
    // para no duplicar la seccion de gluten). product.gluten.hasGluten SI es
    // true (ya lo calcula bien la logica de gluten existente, via
    // hasGlutenAllergenTag/hasGlutenInIngredients).
    const product = {
      sellos: [], notRecommended: [],
      allergens: ['Crustáceos', 'Leche (Lácteos)', 'Sésamo', 'Soya'],
      gluten: { hasGluten: true, classification: 'declared', dataAvailable: true }
    }
    const prefs = { allergens: [{ code: 'trigo', severity: 'severe' }], dietary: [], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    const trigoReason = reasons.find(r => r.type === 'allergen' && r.title.includes('Trigo'))
    expect(trigoReason).toBeTruthy()
    expect(trigoReason.ok).toBe(false)
    expect(trigoReason.title).toBe('Contiene Trigo')
  })

  it('sin alergia a trigo detectada cuando product.gluten.hasGluten es false', () => {
    const product = {
      sellos: [], notRecommended: [], allergens: [],
      gluten: { hasGluten: false, classification: 'certified', dataAvailable: true }
    }
    const prefs = { allergens: [{ code: 'trigo', severity: 'severe' }], dietary: [], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    const trigoReason = reasons.find(r => r.type === 'allergen' && r.title.includes('Trigo'))
    expect(trigoReason.ok).toBe(true)
    expect(trigoReason.title).toBe('Sin Trigo')
  })

  it('alergia a trigo sin product.gluten definido: no revienta, cae al array de allergens (sin "Trigo" ahi = ok:true)', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Cacahuate'] }
    const prefs = { allergens: [{ code: 'trigo', severity: 'severe' }], dietary: [], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    const trigoReason = reasons.find(r => r.type === 'allergen' && r.title.includes('Trigo'))
    expect(trigoReason.ok).toBe(true)
    expect(trigoReason.title).toBe('Sin Trigo')
  })

  it('labels the soja allergen as "Soya" in the reason title', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Soya'] }
    const prefs = { allergens: [{ code: 'soja', severity: 'mild' }], dietary: [], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    const soyaReason = reasons.find(r => r.type === 'allergen' && r.title.includes('Soya'))
    expect(soyaReason).toBeTruthy()
    expect(soyaReason.title).not.toContain('Soja')
  })

  it('alérgeno con severity ausente/no reconocida y detectado: severity:null (no cae por default a "leve")', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Lácteos'] }
    const prefs = { allergens: [{ code: 'leche', severity: undefined }], dietary: [], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ ok: false, severity: null, type: 'allergen', title: 'Contiene Lácteos' })
  })

  it('dieta violada: ok:false, type:"dietary", title "No es {label}"', () => {
    const product = { sellos: [], notRecommended: [], dietary: { vegan: false } }
    const prefs = { allergens: [], dietary: ['vegan'], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ ok: false, severity: null, type: 'dietary', title: 'No es Vegano', detail: 'El producto no cumple esta preferencia' })
    expect(reasons[0].type).toBe('dietary')
  })

  it('dieta cumplida: ok:true, type:"dietary", title "Es {label}"', () => {
    const product = { sellos: [], notRecommended: [], dietary: { glutenFree: true } }
    const prefs = { allergens: [], dietary: ['glutenFree'], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ ok: true, type: 'dietary', title: 'Es Sin gluten', detail: 'Cumple esta preferencia' })
  })

  it('dieta sin dato (undefined): ok:null, type:"dietary", título "Sin datos: {label}"', () => {
    const product = { sellos: [], notRecommended: [], dietary: {} }
    const prefs = { allergens: [], dietary: ['keto'], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ ok: null, type: 'dietary', title: 'Sin datos: Keto' })
  })

  it('dieta con dato null se trata igual que undefined: ok:null, type:"dietary"', () => {
    const product = { sellos: [], notRecommended: [], dietary: { vegan: null } }
    const prefs = { allergens: [], dietary: ['vegan'], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons[0].ok).toBe(null)
    expect(reasons[0].type).toBe('dietary')
  })

  it('condición de salud con match certain:true: ok:false, type:"health", detail = razon del producto', () => {
    const product = { sellos: [], notRecommended: [{ grupo: 'Diabéticos', razon: 'Alto en azúcares', certain: true }] }
    const prefs = { allergens: [], dietary: [], healthConditions: ['diabet'] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ ok: false, type: 'health', title: 'Diabetes', detail: 'Alto en azúcares' })
    expect(reasons[0].type).toBe('health')
  })

  it('condición de salud sin match: ok:true, type:"health"', () => {
    const product = { sellos: [], notRecommended: [] }
    const prefs = { allergens: [], dietary: [], healthConditions: ['celiac'] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ ok: true, type: 'health', title: 'Celiaquía', detail: 'No encontramos alertas para esta condición' })
  })

  it('orden: alérgeno grave conflicto, salud conflicto, dieta conflicto, alérgeno leve conflicto, luego ok:true, luego ok:null', () => {
    const product = {
      sellos: [], allergens: ['Cacahuate', 'Lácteos'],
      notRecommended: [{ grupo: 'Diabéticos', razon: 'Alto en azúcares', certain: true }],
      dietary: { vegan: false, organic: true }
    }
    const prefs = {
      allergens: [
        { code: 'lacteos', severity: 'mild' },   // leve, conflicto
        { code: 'cacahuate', severity: 'severe' } // grave, conflicto
      ],
      dietary: ['vegan', 'organic', 'keto'], // vegan conflicto, organic ok, keto sin dato
      healthConditions: ['diabet'] // conflicto
    }
    const reasons = computeVerdictReasons(product, prefs)
    const titles = reasons.map(r => r.title)
    expect(titles).toEqual([
      'Contiene Cacahuate',   // alérgeno grave conflicto
      'Diabetes',             // salud conflicto
      'No es Vegano',         // dieta conflicto
      'Contiene Lácteos',     // alérgeno leve conflicto
      'Es Orgánico',          // ok:true
      'Sin datos: Keto'       // ok:null
    ])
  })
})

// ─── getUserPreferencesForVerdict (wiring con authClient) ───

describe('getUserPreferencesForVerdict', () => {
  afterEach(() => {
    delete window.authClient
  })

  it('regresa null cuando window.authClient no existe (usuario no logueado, authClient.js no cargó)', () => {
    delete window.authClient
    expect(getUserPreferencesForVerdict()).toBeNull()
  })

  it('regresa null cuando no hay perfil cacheado todavía', () => {
    window.authClient = { getCachedProfile: () => null }
    expect(getUserPreferencesForVerdict()).toBeNull()
  })

  it('regresa null cuando el usuario es "free" (aunque tenga preferences)', () => {
    window.authClient = { getCachedProfile: () => ({ membershipStatus: 'pending', preferences: { dietary: ['vegan'] } }) }
    expect(getUserPreferencesForVerdict()).toBeNull()
  })

  it('regresa preferences cuando el usuario es "premium" y tiene preferences', () => {
    const prefs = { dietary: ['vegan'], allergens: [], healthConditions: [] }
    window.authClient = { getCachedProfile: () => ({ membershipStatus: 'active', preferences: prefs }) }
    expect(getUserPreferencesForVerdict()).toEqual(prefs)
  })

  it('regresa null cuando el usuario es "premium" pero preferences está ausente (sin consentimiento aún)', () => {
    window.authClient = { getCachedProfile: () => ({ membershipStatus: 'active' }) }
    expect(getUserPreferencesForVerdict()).toBeNull()
  })
})

// ─── Disclaimer médico (hallazgo de revisión legal) ─────────

describe('renderPersonalizedDisclaimer', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="verdict-banner"></div><p id="verdict-disclaimer" class="verdict-disclaimer">Estimación automatizada con IA, con fines informativos — no es un diagnóstico ni sustituye el consejo de un profesional de salud.</p>'
  })

  it('agrega la advertencia de preferencias AL FINAL del mismo disclaimer cuando el veredicto SÍ fue personalizado (userPreferences no nulo) — ya no es un párrafo aparte', () => {
    renderPersonalizedDisclaimer({ dietary: ['vegan'], allergens: [], healthConditions: [] })
    const el = document.getElementById('verdict-disclaimer')
    expect(el.textContent).toMatch(/no es un diagnóstico/i)
    expect(el.textContent).toMatch(/Este resultado considera tus preferencias guardadas/i)
  })

  it('deja solo el disclaimer base, sin la advertencia de preferencias, cuando no hubo personalización', () => {
    renderPersonalizedDisclaimer(null)
    const el = document.getElementById('verdict-disclaimer')
    expect(el.textContent).toBe('Estimación automatizada con IA, con fines informativos — no es un diagnóstico ni sustituye el consejo de un profesional de salud.')
    expect(el.textContent).not.toMatch(/preferencias guardadas/i)
  })
})

// ─── renderPersonalizedReasons (tarjeta de diagnóstico) ─────

describe('renderPersonalizedReasons', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="verdict-reasons" class="reason-card hidden">
        <h3 id="verdict-reasons-title"></h3>
        <p id="verdict-reasons-summary"></p>
        <ul id="verdict-reasons-list"></ul>
      </div>
    `
  })

  afterEach(() => {
    delete window.authClient
  })

  it('resumen: "N de M restricciones en conflicto" cuando hay conflictos', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Cacahuate'], dietary: { organic: true } }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'severe' }], dietary: ['organic'], healthConditions: [] }
    renderPersonalizedReasons(product, prefs)
    expect(document.getElementById('verdict-reasons-summary').textContent).toBe('1 de 2 restricciones en conflicto')
  })

  it('resumen: "Revisamos N restricciones de tu perfil" cuando no hay conflictos', () => {
    const product = { sellos: [], notRecommended: [], dietary: { organic: true } }
    const prefs = { allergens: [], dietary: ['organic'], healthConditions: [] }
    renderPersonalizedReasons(product, prefs)
    expect(document.getElementById('verdict-reasons-summary').textContent).toBe('Revisamos 1 restricciones de tu perfil')
  })

  it('oculta la tarjeta si userPreferences es null y el producto no tiene datos reales', () => {
    renderPersonalizedReasons({ sellos: [], notRecommended: [], isFromFallback: true }, null)
    expect(document.getElementById('verdict-reasons').classList.contains('hidden')).toBe(true)
  })

  it('usuario anonimo (sin sesion, sin userPreferences) con producto real: muestra el teaser con título, 3 filas y CTA a premium-offer.html', () => {
    const product = { sellos: [], notRecommended: [], ingredientsText: 'agua, azucar' }
    renderPersonalizedReasons(product, null)
    const card = document.getElementById('verdict-reasons')
    expect(card.classList.contains('hidden')).toBe(false)
    expect(card.classList.contains('reason-card--teaser')).toBe(true)
    expect(document.getElementById('verdict-reasons-title').textContent).toBe('Desbloquea tu análisis personalizado')
    const rows = document.querySelectorAll('#verdict-reasons-list li.reason-row--teaser')
    expect(rows.length).toBe(3)
    const cta = card.querySelector('.btn-teaser-cta')
    expect(cta).not.toBeNull()
    expect(cta.getAttribute('href')).toBe('premium-offer.html')
    expect(cta.textContent).toBe('Ver mi análisis')
    const priceLine = card.querySelector('.teaser-price-line')
    expect(priceLine).not.toBeNull()
    expect(priceLine.textContent).toBe('$29.90 MXN/mes — cancela cuando quieras')
  })

  it('usuario logueado free (sin userPreferences, sin membresia activa) con producto real: CTA va a onboarding-membership.html', () => {
    window.authClient = { getCachedProfile: () => ({ membershipStatus: 'pending' }) }
    const product = { sellos: [], notRecommended: [], ingredientsText: 'agua, azucar' }
    renderPersonalizedReasons(product, null)
    const card = document.getElementById('verdict-reasons')
    const cta = card.querySelector('.btn-teaser-cta')
    expect(cta).not.toBeNull()
    expect(cta.getAttribute('href')).toBe('onboarding-membership.html')
  })

  it('usuario premium activo sin preferences configuradas: oculta la tarjeta y NO muestra el teaser', () => {
    window.authClient = { getCachedProfile: () => ({ membershipStatus: 'active' }) }
    const product = { sellos: [], notRecommended: [], ingredientsText: 'agua, azucar' }
    renderPersonalizedReasons(product, null)
    const card = document.getElementById('verdict-reasons')
    expect(card.classList.contains('hidden')).toBe(true)
    expect(card.classList.contains('reason-card--teaser')).toBe(false)
  })

  it('usuario premium sin restricciones configuradas: oculta la tarjeta (regresión)', () => {
    const prefs = { allergens: [], dietary: [], healthConditions: [] }
    renderPersonalizedReasons({ sellos: [], notRecommended: [], ingredientsText: 'agua, azucar' }, prefs)
    expect(document.getElementById('verdict-reasons').classList.contains('hidden')).toBe(true)
  })

  it('oculta la tarjeta si no hay ninguna restricción configurada', () => {
    const prefs = { allergens: [], dietary: [], healthConditions: [] }
    renderPersonalizedReasons({ sellos: [], notRecommended: [] }, prefs)
    expect(document.getElementById('verdict-reasons').classList.contains('hidden')).toBe(true)
  })

  it('muestra la tarjeta con título de conflicto cuando hay al menos un ok:false', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Cacahuate'] }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'severe' }], dietary: [], healthConditions: [] }
    renderPersonalizedReasons(product, prefs)
    const card = document.getElementById('verdict-reasons')
    expect(card.classList.contains('hidden')).toBe(false)
    expect(document.getElementById('verdict-reasons-title').textContent).toBe('Tu perfil vs. este producto')
  })

  it('muestra título positivo cuando todas las filas son ok:true', () => {
    const product = { sellos: [], notRecommended: [], dietary: { organic: true } }
    const prefs = { allergens: [], dietary: ['organic'], healthConditions: [] }
    renderPersonalizedReasons(product, prefs)
    expect(document.getElementById('verdict-reasons-title').textContent).toBe('Cumple con tu perfil')
  })

  it('renderiza una fila <li> por cada reason, con clase de estado y severidad visible cuando aplica', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Cacahuate'] }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'severe' }], dietary: ['organic'], healthConditions: [] }
    renderPersonalizedReasons(product, prefs)
    const rows = document.querySelectorAll('#verdict-reasons-list li.reason-row')
    expect(rows.length).toBe(2)
    expect(rows[0].classList.contains('reason-row--warn')).toBe(true)
    expect(rows[0].querySelector('.reason-severity').textContent).toBe('grave')
    expect(rows[0].querySelector('.reason-text strong').textContent).toBe('Contiene Cacahuate')
    expect(rows[1].querySelector('.reason-severity')).toBeNull()
  })

  it('fila ok:true de un alérgeno grave (NO detectado) no muestra el badge de severidad "grave"', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Huevo'] }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'severe' }], dietary: [], healthConditions: [] }
    renderPersonalizedReasons(product, prefs)
    const row = document.querySelector('#verdict-reasons-list li.reason-row')
    expect(row.classList.contains('reason-row--ok')).toBe(true)
    expect(row.querySelector('.reason-severity')).toBeNull()
  })

  it('fila ok:null usa la clase --unknown y el ícono ❔', () => {
    const product = { sellos: [], notRecommended: [], dietary: {} }
    const prefs = { allergens: [], dietary: ['keto'], healthConditions: [] }
    renderPersonalizedReasons(product, prefs)
    const row = document.querySelector('#verdict-reasons-list li.reason-row')
    expect(row.classList.contains('reason-row--unknown')).toBe(true)
    expect(row.querySelector('.reason-state').textContent).toBe('❔')
  })

  it('limpia el estado stale del teaser al volver a renderizar con perfil premium sin reasons', () => {
    delete window.authClient
    const product = { sellos: [], notRecommended: [], ingredientsText: 'agua, azucar' }
    renderPersonalizedReasons(product, null)
    const card = document.getElementById('verdict-reasons')
    expect(card.classList.contains('reason-card--teaser')).toBe(true)
    expect(card.querySelector('.btn-teaser-cta')).not.toBeNull()

    const prefs = { allergens: [], dietary: [], healthConditions: [] }
    renderPersonalizedReasons(product, prefs)
    expect(card.classList.contains('reason-card--teaser')).toBe(false)
    expect(card.querySelector('.btn-teaser-cta')).toBeNull()
  })

  it('limpia el label sr-only del teaser al mostrar reasons personalizadas reales', () => {
    delete window.authClient
    const product = { sellos: [], notRecommended: [], allergens: ['Cacahuate'], ingredientsText: 'agua, azucar' }
    renderPersonalizedReasons(product, null)
    const card = document.getElementById('verdict-reasons')
    expect(card.querySelector('.sr-only')).not.toBeNull()
    expect(card.querySelector('.teaser-price-line')).not.toBeNull()

    const prefs = { allergens: [{ code: 'cacahuate', severity: 'severe' }], dietary: [], healthConditions: [] }
    renderPersonalizedReasons(product, prefs)
    expect(card.querySelector('.sr-only')).toBeNull()
    expect(card.querySelector('.teaser-price-line')).toBeNull()
  })

  it('filas del teaser y sus textos llevan aria-hidden="true"', () => {
    delete window.authClient
    const product = { sellos: [], notRecommended: [], ingredientsText: 'agua, azucar' }
    renderPersonalizedReasons(product, null)
    const rows = document.querySelectorAll('#verdict-reasons-list li.reason-row--teaser')
    expect(rows.length).toBe(3)
    rows.forEach(row => {
      expect(row.querySelector('.reason-icon').getAttribute('aria-hidden')).toBe('true')
      expect(row.querySelector('.reason-text').getAttribute('aria-hidden')).toBe('true')
    })
  })

  it('dispara el evento "Paywall Hit" al mostrar el teaser a un usuario sin membresía activa', () => {
    window.track = vi.fn()
    const product = { sellos: [], notRecommended: [], ingredientsText: 'agua, azucar' }
    renderPersonalizedReasons(product, null)
    expect(window.track).toHaveBeenCalledWith('Paywall Hit', { context: 'personalized-reasons' })
  })

  it('NO dispara "Paywall Hit" para un usuario premium activo', () => {
    window.track = vi.fn()
    window.authClient = { getCachedProfile: () => ({ membershipStatus: 'active' }) }
    const product = { sellos: [], notRecommended: [], ingredientsText: 'agua, azucar' }
    renderPersonalizedReasons(product, null)
    expect(window.track).not.toHaveBeenCalled()
  })
})

// ─── logScanToCloudHistory (wiring de historial en la nube) ───

describe('logScanToCloudHistory', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, id: 'x' }) })
  })

  afterEach(() => {
    global.fetch = originalFetch
    delete window.authClient
  })

  it('no llama a fetch si el usuario no está logueado o no es premium', async () => {
    window.authClient = { getCachedProfile: () => null, getIdToken: vi.fn() }
    await logScanToCloudHistory('111', 'Producto A', 'sano')
    expect(global.fetch).not.toHaveBeenCalled()

    window.authClient = { getCachedProfile: () => ({ membershipStatus: 'pending' }), getIdToken: vi.fn() }
    await logScanToCloudHistory('111', 'Producto A', 'sano')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('POSTea a /api/me/history con Bearer token para un usuario premium', async () => {
    window.authClient = {
      getCachedProfile: () => ({ membershipStatus: 'active' }),
      getIdToken: vi.fn().mockResolvedValue('tok-789')
    }
    await logScanToCloudHistory('111', 'Producto A', 'sano', 'https://example.com/p.jpg')
    expect(global.fetch).toHaveBeenCalledWith('/api/me/history', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-789', 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: '111', productName: 'Producto A', verdict: 'sano', image: 'https://example.com/p.jpg' })
    })
  })

  it('POSTea sin campo image cuando no se pasa (producto sin imagen)', async () => {
    window.authClient = {
      getCachedProfile: () => ({ membershipStatus: 'active' }),
      getIdToken: vi.fn().mockResolvedValue('tok-789')
    }
    await logScanToCloudHistory('111', 'Producto A', 'sano')
    expect(global.fetch).toHaveBeenCalledWith('/api/me/history', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-789', 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: '111', productName: 'Producto A', verdict: 'sano' })
    })
  })

  it('no lanza si fetch falla (fire-and-forget)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    window.authClient = { getCachedProfile: () => ({ membershipStatus: 'active' }), getIdToken: vi.fn().mockResolvedValue('tok') }
    await expect(logScanToCloudHistory('111', 'Producto A', 'sano')).resolves.not.toThrow()
  })
})

// ─── incrementScanCounter (contador real de escaneos, cualquier plan) ───

describe('incrementScanCounter', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  })

  afterEach(() => {
    global.fetch = originalFetch
    delete window.authClient
  })

  it('no llama a fetch si no hay sesión (window.authClient no existe)', async () => {
    await incrementScanCounter()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('POSTea a /api/me/scan con Bearer token para CUALQUIER plan (a diferencia de logScanToCloudHistory, no filtra por premium)', async () => {
    window.authClient = { getIdToken: vi.fn().mockResolvedValue('tok-free') }
    await incrementScanCounter()
    expect(global.fetch).toHaveBeenCalledWith('/api/me/scan', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-free' }
    })
  })

  it('no lanza si fetch falla (fire-and-forget)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    window.authClient = { getIdToken: vi.fn().mockResolvedValue('tok') }
    await expect(incrementScanCounter()).resolves.not.toThrow()
  })
})

// ─── processOcrImage (fetch real de OCR — envío de Authorization + 402) ───
// hallazgo del whole-branch review: el fetch real a /api/ocr/process nunca
// mandaba Authorization, así que el gate de membershipStatus del backend
// (ocrProcessHandler) nunca se ejercitaba para usuarios logueados.

describe('processOcrImage', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    delete window.authClient
  })

  it('manda Authorization cuando hay sesión (window.authClient con token)', async () => {
    window.authClient = { getIdToken: vi.fn().mockResolvedValue('tok-123') }
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ cleanedText: 'harina, sal' }) })

    await processOcrImage('base64imagedata')

    const [, options] = global.fetch.mock.calls[0]
    expect(options.headers.Authorization).toBe('Bearer tok-123')
  })

  it('no manda Authorization sin sesión (window.authClient ausente o sin token) — comportamiento anónimo intacto', async () => {
    window.authClient = undefined
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ cleanedText: 'x' }) })

    await processOcrImage('base64imagedata')

    const [, options] = global.fetch.mock.calls[0]
    expect(options.headers.Authorization).toBeUndefined()
  })

  it('lanza un error con .code="membership_required" cuando el backend responde 402 membership_required', async () => {
    window.authClient = { getIdToken: vi.fn().mockResolvedValue('tok-123') }
    global.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'membership_required' }) })

    await expect(processOcrImage('x')).rejects.toMatchObject({ code: 'membership_required' })
  })

  it('lanza un error con .code="membership_expired" cuando el backend responde 402 membership_expired', async () => {
    window.authClient = { getIdToken: vi.fn().mockResolvedValue('tok-123') }
    global.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'membership_expired' }) })

    await expect(processOcrImage('x')).rejects.toMatchObject({ code: 'membership_expired' })
  })

  it('regresa el data.cleanedText en éxito', async () => {
    window.authClient = { getIdToken: vi.fn().mockResolvedValue('tok') }
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ cleanedText: 'harina, sal' }) })

    const result = await processOcrImage('x')

    expect(result.cleanedText).toBe('harina, sal')
  })
})
