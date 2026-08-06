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
    expect(window.shareResult).toHaveBeenCalledWith({ name: 'Producto A', verdict: 'sano', barcode: '111' }, shareBtn)
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
    expect(window.shareResult).toHaveBeenCalledWith({ name: 'Producto A', verdict: 'sano', barcode: '111' }, shareBtn)
  })
})

describe('renderHistoryScreen — thumbnail', () => {
  it('muestra la imagen del producto cuando item.image existe (historial local)', async () => {
    window.getLocalHistory.mockReturnValue([
      { barcode: '111', name: 'Producto A', brand: 'Marca', image: 'https://example.com/a.jpg', rating: 'sano' }
    ])
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const img = document.querySelector('#history-root .row-card img')
    expect(img.src).toBe('https://example.com/a.jpg')
  })

  it('muestra un placeholder cuando item.image esta vacio (historial local)', async () => {
    window.getLocalHistory.mockReturnValue([
      { barcode: '111', name: 'Producto A', brand: 'Marca', image: '', rating: 'sano' }
    ])
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const root = document.getElementById('history-root')
    expect(root.querySelector('.row-card img')).toBeNull()
    expect(root.querySelector('.row-card .history-thumb-placeholder')).toBeTruthy()
  })

  it('muestra la imagen del producto cuando el entry de la nube trae image (historial premium)', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'active' })
    getIdToken.mockResolvedValue('tok-1')
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ history: [
        { barcode: '111', productName: 'Producto A', verdict: 'sano', scannedAt: '2026-07-15T10:00:00.000Z', image: 'https://example.com/a.jpg' }
      ] })
    })
    await renderHistoryScreen()
    const img = document.querySelector('#history-root .row-card img')
    expect(img.src).toBe('https://example.com/a.jpg')
  })

  it('muestra un placeholder cuando el entry de la nube no trae image', async () => {
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
    expect(root.querySelector('.row-card img')).toBeNull()
    expect(root.querySelector('.row-card .history-thumb-placeholder')).toBeTruthy()
  })
})

describe('renderHistoryScreen — click navega a scan.html', () => {
  let originalLocation

  beforeEach(() => {
    originalLocation = window.location
    delete window.location
    window.location = { href: '' }
  })

  afterEach(() => {
    window.location = originalLocation
  })

  it('click en la row-card (historial local) navega a scan.html?barcode=X', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const link = document.querySelector('#history-root .row-card .row-card-link')
    link.click()
    expect(window.location.href).toBe('scan.html?barcode=111')
  })

  it('click en el boton de compartir NO navega (stopPropagation)', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const shareBtn = document.querySelector('#history-root .row-card .share-btn')
    shareBtn.click()
    expect(window.location.href).toBe('')
  })

  it('click en la row-card (historial cloud) navega a scan.html?barcode=X', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'active' })
    getIdToken.mockResolvedValue('tok-1')
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ history: [
        { barcode: '222', productName: 'Producto B', verdict: 'evitar', scannedAt: '2026-07-14T10:00:00.000Z' }
      ] })
    })
    await renderHistoryScreen()
    const link = document.querySelector('#history-root .row-card .row-card-link')
    link.click()
    expect(window.location.href).toBe('scan.html?barcode=222')
  })

  it('click en el upsell (usuario free) no navega, ya que no tiene data-barcode', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const upsell = document.querySelector('#history-root .history-upsell')
    upsell.click()
    expect(window.location.href).toBe('')
  })

  it('click en el link "Configurar mis preferencias" del upsell no navega a scan.html', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const link = document.querySelector('#history-root .history-upsell a.btn.btn-primary')
    link.click()
    expect(window.location.href).toBe('')
  })
})

describe('renderHistoryScreen — escapado de nombre de producto (XSS)', () => {
  it('escapa h.name en el texto visible y en data-name del share-btn (historial local)', async () => {
    window.getLocalHistory.mockReturnValue([
      { barcode: '111', name: '<img src=x onerror=alert(1)>', brand: 'Marca', image: '', rating: 'sano' }
    ])
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const root = document.getElementById('history-root')
    const nameEl = root.querySelector('.history-item-name')
    expect(nameEl.querySelector('img')).toBeNull()
    expect(nameEl.textContent).toBe('<img src=x onerror=alert(1)>')
    const shareBtn = root.querySelector('.share-btn')
    expect(shareBtn.dataset.name).toBe('<img src=x onerror=alert(1)>')
    expect(root.querySelectorAll('img').length).toBe(0)
  })

  it('escapa h.productName en el texto visible y en data-name del share-btn (historial cloud)', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'active' })
    getIdToken.mockResolvedValue('tok-1')
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ history: [
        { barcode: '111', productName: '<script>alert(1)</script>', verdict: 'sano', scannedAt: '2026-07-15T10:00:00.000Z' }
      ] })
    })
    await renderHistoryScreen()
    const root = document.getElementById('history-root')
    const nameEl = root.querySelector('.history-item-name')
    expect(nameEl.textContent).toBe('<script>alert(1)</script>')
    expect(root.querySelector('script')).toBeNull()
    const shareBtn = root.querySelector('.share-btn')
    expect(shareBtn.dataset.name).toBe('<script>alert(1)</script>')
  })
})

describe('renderHistoryScreen — botón de compartir por teclado no navega', () => {
  let originalLocation

  beforeEach(() => {
    originalLocation = window.location
    delete window.location
    window.location = { href: '' }
  })

  afterEach(() => {
    window.location = originalLocation
  })

  it('Enter/Space en el share-btn (focus + keydown) no navega la row-card', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const shareBtn = document.querySelector('#history-root .row-card .share-btn')
    shareBtn.focus()
    shareBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(window.location.href).toBe('')
  })
})

describe('renderHistoryScreen — estructura ARIA de la row-card', () => {
  it('no usa role="button" en .row-card (evita controles interactivos anidados) y expone un <a> real hacia scan.html', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const root = document.getElementById('history-root')
    const card = root.querySelector('.row-card[data-barcode]')
    expect(card.getAttribute('role')).toBeNull()
    expect(card.getAttribute('tabindex')).toBeNull()
    const link = card.querySelector('a.row-card-link')
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe('scan.html?barcode=111')
    const shareBtn = card.querySelector('.share-btn')
    expect(link.contains(shareBtn)).toBe(false)
  })
})
