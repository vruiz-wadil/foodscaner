/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getIdToken = vi.fn()
const getCachedProfile = vi.fn()

vi.mock('../authClient.js', () => ({ getIdToken, getCachedProfile }))

let renderHistoryScreen

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  global.fetch = vi.fn()
  window.getLocalHistory = vi.fn().mockReturnValue([
    { barcode: '111', name: 'Producto A', brand: 'Marca', image: '', rating: 'sano' }
  ])
  window.shareResult = vi.fn()
  document.body.innerHTML = '<div id="history-root"></div>'
  const mod = await import('../history-ui.js')
  renderHistoryScreen = mod.renderHistoryScreen
})

describe('renderHistoryScreen — usuario free', () => {
  it('muestra el historial local real (sin blur) + un bloque de upsell bloqueado, sin llamar al backend', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const root = document.getElementById('history-root')
    expect(root.textContent).toMatch(/Producto A/)
    expect(root.querySelector('.history-upsell')).toBeTruthy()
    expect(root.querySelector('.history-upsell a.btn.btn-primary').textContent).toMatch(/Configurar mis preferencias/)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('renderHistoryScreen — usuario premium', () => {
  it('pide GET /api/me/history con Bearer token y renderiza la lista completa de la nube, sin bloque de upsell', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'active' })
    getIdToken.mockResolvedValue('tok-1')
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ history: [
        { barcode: '111', productName: 'Producto A', verdict: 'sano', scannedAt: '2026-07-15T10:00:00.000Z' },
        { barcode: '222', productName: 'Producto B', verdict: 'evitar', scannedAt: '2026-07-14T10:00:00.000Z' }
      ] })
    })

    await renderHistoryScreen()

    expect(global.fetch).toHaveBeenCalledWith('/api/me/history', { headers: { Authorization: 'Bearer tok-1' } })
    const root = document.getElementById('history-root')
    expect(root.textContent).toMatch(/Producto A/)
    expect(root.textContent).toMatch(/Producto B/)
    expect(root.querySelector('.history-upsell')).toBeNull()
  })
})

describe('renderHistoryScreen — estructura visual', () => {
  it('envuelve el contenido en un único .content-card, no en cards sueltas (hallazgo de reskin visual)', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const root = document.getElementById('history-root')
    expect(root.querySelectorAll(':scope > .content-card').length).toBe(1)
  })
})

describe('renderHistoryScreen — botón de compartir (usuario free, historial local)', () => {
  it('cada row-card tiene un botón de compartir que llama a window.shareResult con name/verdict normalizados desde rating', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const root = document.getElementById('history-root')
    const shareBtn = root.querySelector('.row-card .share-btn')
    expect(shareBtn).toBeTruthy()
    shareBtn.click()
    expect(window.shareResult).toHaveBeenCalledWith({ name: 'Producto A', verdict: 'sano' }, shareBtn)
  })
})

describe('renderHistoryScreen — botón de compartir (usuario premium, historial cloud)', () => {
  it('cada row-card tiene un botón de compartir que llama a window.shareResult con name/verdict normalizados desde productName/verdict', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'active' })
    getIdToken.mockResolvedValue('tok-1')
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ history: [
        { barcode: '111', productName: 'Producto A', verdict: 'sano', scannedAt: '2026-07-15T10:00:00.000Z' }
      ] })
    })

    await renderHistoryScreen()

    const root = document.getElementById('history-root')
    const shareBtn = root.querySelector('.row-card .share-btn')
    expect(shareBtn).toBeTruthy()
    shareBtn.click()
    expect(window.shareResult).toHaveBeenCalledWith({ name: 'Producto A', verdict: 'sano' }, shareBtn)
  })
})
