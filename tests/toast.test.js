/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { showToast, setPendingToast, showPendingToast } from '../toast.js'

describe('showToast', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('crea un único #app-toast con el mensaje y lo marca visible', () => {
    showToast('Preferencias guardadas.')
    const el = document.getElementById('app-toast')
    expect(el).toBeTruthy()
    expect(el.textContent).toBe('Preferencias guardadas.')
    expect(el.classList.contains('visible')).toBe(true)
  })

  it('reusa el mismo elemento en una segunda llamada, no crea uno duplicado', () => {
    showToast('Primero')
    showToast('Segundo')
    expect(document.querySelectorAll('#app-toast').length).toBe(1)
    expect(document.getElementById('app-toast').textContent).toBe('Segundo')
  })

  it('se oculta solo tras la duración indicada', () => {
    showToast('Preferencias guardadas.', 2500)
    const el = document.getElementById('app-toast')
    vi.advanceTimersByTime(2499)
    expect(el.classList.contains('visible')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(el.classList.contains('visible')).toBe(false)
  })

  it('reinicia el temporizador si se llama de nuevo antes de que expire el anterior', () => {
    showToast('Primero', 2500)
    vi.advanceTimersByTime(2000)
    showToast('Segundo', 2500)
    vi.advanceTimersByTime(2000)
    const el = document.getElementById('app-toast')
    expect(el.classList.contains('visible')).toBe(true)
    vi.advanceTimersByTime(500)
    expect(el.classList.contains('visible')).toBe(false)
  })

  it('usa 2500ms por default si no se pasa duración', () => {
    showToast('Preferencias guardadas.')
    const el = document.getElementById('app-toast')
    vi.advanceTimersByTime(2499)
    expect(el.classList.contains('visible')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(el.classList.contains('visible')).toBe(false)
  })
})

describe('setPendingToast / showPendingToast', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    sessionStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('setPendingToast guarda el mensaje en sessionStorage bajo yomi_pending_toast', async () => {
    const { setPendingToast } = await import('../toast.js')
    setPendingToast('Preferencias guardadas.')
    expect(sessionStorage.getItem('yomi_pending_toast')).toBe('Preferencias guardadas.')
  })

  it('showPendingToast muestra el toast y limpia la key si hay un mensaje pendiente', async () => {
    const { setPendingToast, showPendingToast } = await import('../toast.js')
    setPendingToast('Preferencias guardadas.')

    showPendingToast()

    const el = document.getElementById('app-toast')
    expect(el).toBeTruthy()
    expect(el.textContent).toBe('Preferencias guardadas.')
    expect(el.classList.contains('visible')).toBe(true)
    expect(sessionStorage.getItem('yomi_pending_toast')).toBeNull()
  })

  it('showPendingToast no hace nada si no hay mensaje pendiente', async () => {
    const { showPendingToast } = await import('../toast.js')
    showPendingToast()
    expect(document.getElementById('app-toast')).toBeNull()
  })
})
