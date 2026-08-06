/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuth = {}
const verifyPasswordResetCode = vi.fn()
const confirmPasswordReset = vi.fn()

vi.mock('../firebase-init.js', () => ({
  firebaseAuth: mockAuth,
  verifyPasswordResetCode,
  confirmPasswordReset
}))

let initResetPasswordPage, submitNewPassword

function setUrl(search) {
  delete window.location
  window.location = { search, href: '' }
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  setUrl('')
  document.body.innerHTML = `
    <p id="reset-password-sub"></p>
    <form id="reset-password-form" class="hidden">
      <input id="reset-new-password" type="password">
      <input id="reset-confirm-password" type="password">
      <button type="submit" id="btn-reset-password-confirm">Guardar nueva contraseña</button>
    </form>
    <p id="reset-password-error" class="hidden" role="alert"></p>
    <p id="reset-password-success" class="hidden" role="status"></p>
  `
  const mod = await import('../reset-password-ui.js')
  initResetPasswordPage = mod.initResetPasswordPage
  submitNewPassword = mod.submitNewPassword
})

describe('initResetPasswordPage', () => {
  it('muestra error si falta oobCode en la URL, sin llamar a Firebase', async () => {
    setUrl('')
    await initResetPasswordPage()
    expect(verifyPasswordResetCode).not.toHaveBeenCalled()
    const errEl = document.getElementById('reset-password-error')
    expect(errEl.classList.contains('hidden')).toBe(false)
    expect(document.getElementById('reset-password-form').classList.contains('hidden')).toBe(true)
  })

  it('verifica el código y revela el formulario con el correo asociado', async () => {
    setUrl('?oobCode=abc123')
    verifyPasswordResetCode.mockResolvedValueOnce('ana@example.com')

    await initResetPasswordPage()

    expect(verifyPasswordResetCode).toHaveBeenCalledWith(mockAuth, 'abc123')
    expect(document.getElementById('reset-password-form').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('reset-password-sub').textContent).toMatch(/ana@example.com/)
  })

  it('muestra error si el código es inválido/expirado, sin revelar el formulario', async () => {
    setUrl('?oobCode=expired')
    verifyPasswordResetCode.mockRejectedValueOnce({ code: 'auth/invalid-action-code' })

    await initResetPasswordPage()

    const errEl = document.getElementById('reset-password-error')
    expect(errEl.classList.contains('hidden')).toBe(false)
    expect(document.getElementById('reset-password-form').classList.contains('hidden')).toBe(true)
  })
})

describe('submitNewPassword', () => {
  it('rechaza si las contraseñas no coinciden, sin llamar a Firebase', async () => {
    await expect(submitNewPassword('code1', 'secret123', 'different')).rejects.toThrow(/no coinciden/i)
    expect(confirmPasswordReset).not.toHaveBeenCalled()
  })

  it('llama confirmPasswordReset y muestra éxito cuando coinciden', async () => {
    confirmPasswordReset.mockResolvedValueOnce(undefined)

    await submitNewPassword('code1', 'secret123', 'secret123')

    expect(confirmPasswordReset).toHaveBeenCalledWith(mockAuth, 'code1', 'secret123')
    const successEl = document.getElementById('reset-password-success')
    expect(successEl.classList.contains('hidden')).toBe(false)
  })

  it('muestra error si confirmPasswordReset falla (enlace expirado)', async () => {
    confirmPasswordReset.mockRejectedValueOnce({ code: 'auth/invalid-action-code' })

    await expect(submitNewPassword('code1', 'secret123', 'secret123')).rejects.toBeTruthy()

    const errEl = document.getElementById('reset-password-error')
    expect(errEl.classList.contains('hidden')).toBe(false)
  })
})
