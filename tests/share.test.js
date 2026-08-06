/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const shareCode = fs.readFileSync(path.join(__dirname, '..', 'share.js'), 'utf8')

let buildShareText, shareResult, shareApp

beforeAll(() => {
  const fn = new Function(shareCode + '\nreturn { buildShareText, shareResult, shareApp }')
  const exports = fn()
  buildShareText = exports.buildShareText
  shareResult = exports.shareResult
  shareApp = exports.shareApp
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildShareText', () => {
  it('sano verdict produces emoji-led copy with call to action', () => {
    expect(buildShareText('Yogurt Natural', 'sano')).toBe('✅ Yogurt Natural está SANO según Yomi. Escanea el tuyo gratis.')
  })

  it('regular verdict produces warning emoji and time-value copy', () => {
    expect(buildShareText('Cereal X', 'regular')).toBe('⚠️ Cereal X: REGULAR. Yomi te dice por qué en 2 segundos.')
  })

  it('evitar verdict produces stop emoji with question engagement copy', () => {
    expect(buildShareText('Gamesa Emperador', 'evitar')).toBe('🚫 Gamesa Emperador salió EVITAR en Yomi. ¿El tuyo qué dirá?')
  })

  it('unknown/unexpected verdict falls back to the old generic format without throwing', () => {
    expect(buildShareText('Unknown Product', 'misterio')).toBe('Unknown Product: misterio — descúbrelo tú con Yomi')
  })
})

describe('shareResult — navigator.share available', () => {
  it('calls navigator.share with title/text/url apuntando al producto (barcode), nunca al home', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { share, clipboard: { writeText } })

    await shareResult({ name: 'Gamesa Emperador', verdict: 'evitar', barcode: '7501000673209' })

    expect(share).toHaveBeenCalledWith({
      title: 'Yomi',
      text: '🚫 Gamesa Emperador salió EVITAR en Yomi. ¿El tuyo qué dirá?',
      url: 'https://yomi.mx/scan.html?barcode=7501000673209&utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result'
    })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('cae al home (sin barcode) solo si algún caller futuro no lo manda — caso defensivo, no debería pasar en producción', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share, clipboard: { writeText: vi.fn() } })

    await shareResult({ name: 'Gamesa Emperador', verdict: 'evitar' })

    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://yomi.mx/?utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result'
    }))
  })

  it('does nothing (no clipboard fallback, no error) when the user cancels the native share sheet', async () => {
    const abortError = new Error('cancelled')
    abortError.name = 'AbortError'
    const share = vi.fn().mockRejectedValue(abortError)
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { share, clipboard: { writeText } })

    await expect(shareResult({ name: 'Gamesa Emperador', verdict: 'evitar', barcode: '7501000673209' })).resolves.toBeUndefined()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to clipboard when navigator.share fails for a reason other than AbortError', async () => {
    const share = vi.fn().mockRejectedValue(new Error('some other failure'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share, clipboard: { writeText } })

    await shareResult({ name: 'Gamesa Emperador', verdict: 'evitar', barcode: '7501000673209' })

    expect(writeText).toHaveBeenCalledWith('🚫 Gamesa Emperador salió EVITAR en Yomi. ¿El tuyo qué dirá? https://yomi.mx/scan.html?barcode=7501000673209&utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result')
  })
})

describe('shareResult — no navigator.share (Firefox desktop, old Chrome desktop)', () => {
  it('goes straight to clipboard con el link del producto', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await shareResult({ name: 'Gamesa Emperador', verdict: 'evitar', barcode: '7501000673209' })

    expect(writeText).toHaveBeenCalledWith('🚫 Gamesa Emperador salió EVITAR en Yomi. ¿El tuyo qué dirá? https://yomi.mx/scan.html?barcode=7501000673209&utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result')
  })

  it('escapa el barcode al construir la URL (caracteres especiales no rompen el query string)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await shareResult({ name: 'Producto', verdict: 'sano', barcode: '750 100&067' })

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('barcode=750%20100%26067'))
  })

  it('updates the trigger button text to "Copiado" and reverts it after 2s', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const button = document.createElement('button')
    button.textContent = 'Compartir'

    await shareResult({ name: 'Gamesa Emperador', verdict: 'evitar', barcode: '7501000673209' }, button)

    expect(button.textContent).toBe('Copiado')
    vi.advanceTimersByTime(2000)
    expect(button.textContent).toBe('Compartir')
    vi.useRealTimers()
  })

  it('warns to console and does not throw when clipboard is also unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(shareResult({ name: 'Gamesa Emperador', verdict: 'evitar', barcode: '7501000673209' })).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('shareApp', () => {
  it('calls navigator.share with the invite text and a URL containing utm_medium=invite_friend', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { share, clipboard: { writeText } })

    await shareApp()

    expect(share).toHaveBeenCalledWith({
      title: 'Yomi',
      text: 'Yo uso Yomi para saber en 2 segundos si un producto me conviene. Pruébalo tú:',
      url: 'https://yomi.mx/?utm_source=share&utm_medium=invite_friend&utm_campaign=account_invite'
    })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to copyShareFallback (clipboard) when navigator.share is absent', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const button = document.createElement('button')
    button.textContent = 'Compartir Yomi'

    await shareApp(button)

    expect(writeText).toHaveBeenCalledWith('Yo uso Yomi para saber en 2 segundos si un producto me conviene. Pruébalo tú: https://yomi.mx/?utm_source=share&utm_medium=invite_friend&utm_campaign=account_invite')
    expect(button.textContent).toBe('Copiado')
  })
})
