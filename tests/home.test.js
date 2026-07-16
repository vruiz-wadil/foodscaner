/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const homeCode = fs.readFileSync(path.join(__dirname, '..', 'home.js'), 'utf8')

let shouldShowHomeUpsell

beforeAll(() => {
  const fn = new Function(homeCode + '\nreturn { shouldShowHomeUpsell }')
  const exports = fn()
  shouldShowHomeUpsell = exports.shouldShowHomeUpsell
})

describe('shouldShowHomeUpsell', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('nunca se muestra para plan premium', () => {
    expect(shouldShowHomeUpsell({ plan: 'premium', preferences: { dietary: ['vegan'] } })).toBe(false)
  })

  it('nunca se muestra sin perfil (no logueado)', () => {
    expect(shouldShowHomeUpsell(null)).toBe(false)
  })

  it('caso base: usuario free normal, sin tope de OCR, sin descartes previos → no se muestra (el estado más común, hallazgo de cobertura de la 4a ronda)', () => {
    const profile = { plan: 'free', usage: { date: '2026-07-15', ocrCount: 1 } }
    expect(shouldShowHomeUpsell(profile)).toBe(false)
  })

  it('Trigger (único, tras eliminar el "Trigger A" inalcanzable — ver nota arriba): se muestra si ya usó 5/5 OCR hoy', () => {
    const profile = { plan: 'free', usage: { date: '2026-07-15', ocrCount: 5 } }
    expect(shouldShowHomeUpsell(profile)).toBe(true)
  })

  it('se oculta si fue descartado hace menos de 3 días', () => {
    localStorage.setItem('yomiUpsellDismiss', JSON.stringify({ count: 1, lastAt: Date.now() - 1 * 24 * 60 * 60 * 1000 }))
    const profile = { plan: 'free', usage: { date: '2026-07-15', ocrCount: 5 } }
    expect(shouldShowHomeUpsell(profile)).toBe(false)
  })

  it('reaparece después de 3 días de un solo descarte', () => {
    localStorage.setItem('yomiUpsellDismiss', JSON.stringify({ count: 1, lastAt: Date.now() - 4 * 24 * 60 * 60 * 1000 }))
    const profile = { plan: 'free', usage: { date: '2026-07-15', ocrCount: 5 } }
    expect(shouldShowHomeUpsell(profile)).toBe(true)
  })

  it('se oculta 30 días tras 2 descartes', () => {
    localStorage.setItem('yomiUpsellDismiss', JSON.stringify({ count: 2, lastAt: Date.now() - 10 * 24 * 60 * 60 * 1000 }))
    const profile = { plan: 'free', usage: { date: '2026-07-15', ocrCount: 5 } }
    expect(shouldShowHomeUpsell(profile)).toBe(false)
  })
})
