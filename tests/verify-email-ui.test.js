/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockAuth = {}
const applyActionCode = vi.fn()

vi.mock('../firebase-init.js', () => ({
  firebaseAuth: mockAuth,
  applyActionCode
}))

let initVerifyEmailPage

function setUrl(search) {
  delete window.location
  window.location = { search, href: '' }
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.useFakeTimers()
  setUrl('')
  document.body.innerHTML = `
    <p id="verify-email-sub"></p>
    <p id="verify-email-error" class="hidden" role="alert"></p>
    <p id="verify-email-success" class="hidden" role="status"></p>
  `
  const mod = await import('../verify-email-ui.js')
  initVerifyEmailPage = mod.initVerifyEmailPage
})

afterEach(() => {
  vi.useRealTimers()
})

describe('initVerifyEmailPage', () => {
  it('muestra error si falta oobCode en la URL, sin llamar a Firebase', async () => {
    setUrl('')
    await initVerifyEmailPage()
    expect(applyActionCode).not.toHaveBeenCalled()
    const errEl = document.getElementById('verify-email-error')
    expect(errEl.classList.contains('hidden')).toBe(false)
  })

  it('verifica el código, muestra éxito, y redirige a account.html tras 2s', async () => {
    setUrl('?oobCode=abc123')
    applyActionCode.mockResolvedValueOnce(undefined)

    await initVerifyEmailPage()

    expect(applyActionCode).toHaveBeenCalledWith(mockAuth, 'abc123')
    const successEl = document.getElementById('verify-email-success')
    expect(successEl.classList.contains('hidden')).toBe(false)
    expect(window.location.href).toBe('')
    vi.advanceTimersByTime(2000)
    expect(window.location.href).toBe('account.html')
  })

  it('muestra error si el código es inválido/expirado, sin redirigir', async () => {
    setUrl('?oobCode=expired')
    applyActionCode.mockRejectedValueOnce({ code: 'auth/invalid-action-code' })

    await initVerifyEmailPage()

    const errEl = document.getElementById('verify-email-error')
    expect(errEl.classList.contains('hidden')).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(window.location.href).toBe('')
  })
})
