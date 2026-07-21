/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const shareCode = fs.readFileSync(path.join(__dirname, '..', 'share.js'), 'utf8')

let buildShareText, shareResult

beforeAll(() => {
  const fn = new Function(shareCode + '\nreturn { buildShareText, shareResult }')
  const exports = fn()
  buildShareText = exports.buildShareText
  shareResult = exports.shareResult
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildShareText', () => {
  it('formats the product name and verdict in plain caps, distinct from the emoji verdict-banner text', () => {
    expect(buildShareText('Gamesa Emperador', 'evitar')).toBe('Gamesa Emperador: EVITAR — descúbrelo tú con Yomi')
    expect(buildShareText('Yogurt Natural', 'sano')).toBe('Yogurt Natural: SANO — descúbrelo tú con Yomi')
    expect(buildShareText('Cereal X', 'regular')).toBe('Cereal X: REGULAR — descúbrelo tú con Yomi')
  })
})

describe('shareResult — navigator.share available', () => {
  it('calls navigator.share with title/text/url and never touches the clipboard', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { share, clipboard: { writeText } })

    await shareResult({ name: 'Gamesa Emperador', verdict: 'evitar' })

    expect(share).toHaveBeenCalledWith({
      title: 'Yomi',
      text: 'Gamesa Emperador: EVITAR — descúbrelo tú con Yomi',
      url: 'https://yomi.mx/?utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result'
    })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('does nothing (no clipboard fallback, no error) when the user cancels the native share sheet', async () => {
    const abortError = new Error('cancelled')
    abortError.name = 'AbortError'
    const share = vi.fn().mockRejectedValue(abortError)
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { share, clipboard: { writeText } })

    await expect(shareResult({ name: 'Gamesa Emperador', verdict: 'evitar' })).resolves.toBeUndefined()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to clipboard when navigator.share fails for a reason other than AbortError', async () => {
    const share = vi.fn().mockRejectedValue(new Error('some other failure'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share, clipboard: { writeText } })

    await shareResult({ name: 'Gamesa Emperador', verdict: 'evitar' })

    expect(writeText).toHaveBeenCalledWith('Gamesa Emperador: EVITAR — descúbrelo tú con Yomi https://yomi.mx/?utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result')
  })
})

describe('shareResult — no navigator.share (Firefox desktop, old Chrome desktop)', () => {
  it('goes straight to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await shareResult({ name: 'Gamesa Emperador', verdict: 'evitar' })

    expect(writeText).toHaveBeenCalledWith('Gamesa Emperador: EVITAR — descúbrelo tú con Yomi https://yomi.mx/?utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result')
  })

  it('updates the trigger button text to "Copiado" and reverts it after 2s', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const button = document.createElement('button')
    button.textContent = 'Compartir'

    await shareResult({ name: 'Gamesa Emperador', verdict: 'evitar' }, button)

    expect(button.textContent).toBe('Copiado')
    vi.advanceTimersByTime(2000)
    expect(button.textContent).toBe('Compartir')
    vi.useRealTimers()
  })

  it('warns to console and does not throw when clipboard is also unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(shareResult({ name: 'Gamesa Emperador', verdict: 'evitar' })).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
