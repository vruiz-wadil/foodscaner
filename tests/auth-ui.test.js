/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuth = { currentUser: null }
const signInWithEmailAndPassword = vi.fn()
const createUserWithEmailAndPassword = vi.fn()
const signInWithPopup = vi.fn()
class GoogleAuthProvider {}

vi.mock('../firebase-init.js', () => ({
  firebaseAuth: mockAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider
}))

let mapAuthError, handleLogin, handleSignup, handleGoogleSignIn

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  global.fetch = vi.fn().mockResolvedValue({ ok: true })
  document.body.innerHTML = `
    <h1 id="auth-heading-title">Inicia sesión</h1>
    <button id="btn-google">Continuar con Google</button>
    <form id="login-form" novalidate>
      <input id="login-email" type="email" required>
      <input id="login-password" type="password" required minlength="6">
      <button type="button" id="btn-toggle-password" aria-label="Mostrar contraseña">Ver</button>
      <div id="signup-only" class="hidden">
        <input type="checkbox" id="terms-checkbox">
        <input type="checkbox" id="age-checkbox">
      </div>
      <button type="submit" id="btn-login">Iniciar sesión</button>
      <button type="button" id="btn-back-to-login" class="hidden">¿Ya tienes cuenta? Inicia sesión</button>
      <button type="button" id="btn-signup">Crear cuenta</button>
    </form>
    <p id="auth-error" class="hidden" role="alert"></p>
  `
  const mod = await import('../auth-ui.js')
  mapAuthError = mod.mapAuthError
  handleLogin = mod.handleLogin
  handleSignup = mod.handleSignup
  handleGoogleSignIn = mod.handleGoogleSignIn
})

describe('mapAuthError', () => {
  it('maps email-already-in-use to a clear Spanish message', () => {
    expect(mapAuthError('auth/email-already-in-use')).toBe('Ya existe una cuenta con ese correo.')
  })

  it('maps wrong-password, user-not-found and invalid-credential to the SAME generic message (hallazgo de seguridad: evita enumeración de cuentas — antes revelaban si un correo estaba registrado)', () => {
    const generic = 'Correo o contraseña incorrectos.'
    expect(mapAuthError('auth/wrong-password')).toBe(generic)
    expect(mapAuthError('auth/user-not-found')).toBe(generic)
    expect(mapAuthError('auth/invalid-credential')).toBe(generic)
  })

  it('maps common real-world Firebase Auth codes a Mexican user will actually trigger (hallazgo UX)', () => {
    expect(mapAuthError('auth/too-many-requests')).toBe('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.')
    expect(mapAuthError('auth/network-request-failed')).toBe('Sin conexión a internet. Revisa tu red e inténtalo de nuevo.')
    expect(mapAuthError('auth/popup-blocked')).toBe('Tu navegador bloqueó la ventana de Google. Habilítala e inténtalo de nuevo.')
    expect(mapAuthError('auth/account-exists-with-different-credential')).toBe('Ya tienes una cuenta con ese correo usando otro método de acceso (ej. Google). Usa ese método para entrar.')
  })

  it('falls back to a generic message for unknown codes', () => {
    expect(mapAuthError('auth/some-unknown-code')).toBe('Ocurrió un error. Intenta de nuevo.')
  })
})

describe('handleLogin', () => {
  it('calls signInWithEmailAndPassword with the firebaseAuth instance and credentials', async () => {
    signInWithEmailAndPassword.mockResolvedValueOnce({ user: { uid: 'abc' } })
    await handleLogin('test@example.com', 'secret123')
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(mockAuth, 'test@example.com', 'secret123')
  })

  it('shows a mapped error message and re-throws when sign-in fails', async () => {
    signInWithEmailAndPassword.mockRejectedValueOnce({ code: 'auth/wrong-password' })
    await expect(handleLogin('test@example.com', 'bad')).rejects.toBeTruthy()
    const errEl = document.getElementById('auth-error')
    expect(errEl.textContent).toBe('Correo o contraseña incorrectos.')
    expect(errEl.classList.contains('hidden')).toBe(false)
  })

  it('disables the submit button while the request is in flight and re-enables it after (hallazgo UX: sin esto el botón "se congela" sin feedback)', async () => {
    let resolveSignIn
    signInWithEmailAndPassword.mockReturnValueOnce(new Promise(resolve => { resolveSignIn = resolve }))
    const btn = document.getElementById('btn-login')
    const promise = handleLogin('test@example.com', 'secret123')
    expect(btn.disabled).toBe(true)
    resolveSignIn({ user: { uid: 'abc' } })
    await promise
    expect(btn.disabled).toBe(false)
  })
})

describe('handleSignup', () => {
  it('rechaza si el checkbox de Términos no está marcado (hallazgo legal: no se puede facturar sin evidencia de aceptación)', async () => {
    document.getElementById('age-checkbox').checked = true
    document.getElementById('terms-checkbox').checked = false
    await expect(handleSignup('new@example.com', 'secret123')).rejects.toThrow(/[Tt]érminos/)
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled()
  })

  it('rechaza si el checkbox de mayoría de edad no está marcado', async () => {
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = false
    await expect(handleSignup('new@example.com', 'secret123')).rejects.toThrow(/edad/i)
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled()
  })

  it('crea la cuenta y sincroniza termsAccepted/ageConfirmed a /api/auth/sync cuando ambos checkboxes están marcados', async () => {
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true
    const getIdToken = vi.fn().mockResolvedValue('tok-new')
    createUserWithEmailAndPassword.mockResolvedValueOnce({ user: { uid: 'abc', getIdToken } })

    await handleSignup('new@example.com', 'secret123')

    expect(createUserWithEmailAndPassword).toHaveBeenCalledWith(mockAuth, 'new@example.com', 'secret123')
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-new', 'Content-Type': 'application/json' },
      body: JSON.stringify({ termsAccepted: true, ageConfirmed: true, termsVersion: 'v1' })
    })
  })
})

describe('handleGoogleSignIn', () => {
  it('calls signInWithPopup with the firebaseAuth instance and a GoogleAuthProvider', async () => {
    signInWithPopup.mockResolvedValueOnce({ user: { uid: 'abc' } })
    await handleGoogleSignIn()
    expect(signInWithPopup).toHaveBeenCalledTimes(1)
    expect(signInWithPopup.mock.calls[0][0]).toBe(mockAuth)
    expect(signInWithPopup.mock.calls[0][1]).toBeInstanceOf(GoogleAuthProvider)
  })

  it('shows a mapped error when the popup is closed by the user', async () => {
    signInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-closed-by-user' })
    await expect(handleGoogleSignIn()).rejects.toBeTruthy()
    expect(document.getElementById('auth-error').textContent).toBe('Se cerró la ventana de Google antes de terminar.')
  })
})

describe('signup-mode toggle (hallazgos #1, #2, #14: btn-login robaba el Enter en modo signup y no había forma de volver a login)', () => {
  beforeEach(() => {
    // El listener de DOMContentLoaded ya se registró en el import de arriba;
    // se dispara manualmente porque jsdom ya pasó por 'loading' antes de que
    // este test corriera.
    document.dispatchEvent(new Event('DOMContentLoaded'))
  })

  it('entering signup mode hides btn-login (its only type="submit") and reveals the back-to-login link', () => {
    document.getElementById('btn-signup').click()
    expect(document.getElementById('btn-login').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('btn-back-to-login').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('auth-heading-title').textContent).toBe('Crea tu cuenta')
  })

  it('clicking the back-to-login link restores login mode', () => {
    document.getElementById('btn-signup').click()
    document.getElementById('btn-back-to-login').click()
    expect(document.getElementById('btn-login').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('btn-back-to-login').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('auth-heading-title').textContent).toBe('Inicia sesión')
    expect(document.getElementById('btn-signup').textContent).toBe('Crear cuenta')
  })
})

describe('password toggle aria-label (hallazgo #12)', () => {
  beforeEach(() => {
    document.dispatchEvent(new Event('DOMContentLoaded'))
  })

  it('updates aria-label along with the text content when toggled', () => {
    const btn = document.getElementById('btn-toggle-password')
    btn.click()
    expect(btn.textContent).toBe('Ocultar')
    expect(btn.getAttribute('aria-label')).toBe('Ocultar contraseña')
    btn.click()
    expect(btn.textContent).toBe('Ver')
    expect(btn.getAttribute('aria-label')).toBe('Mostrar contraseña')
  })
})

describe('login submit validation (hallazgo #13)', () => {
  beforeEach(() => {
    document.dispatchEvent(new Event('DOMContentLoaded'))
  })

  it('does not call handleLogin/signInWithEmailAndPassword when required fields are invalid', () => {
    const form = document.getElementById('login-form')
    form.reportValidity = () => false
    document.getElementById('login-email').value = ''
    document.getElementById('login-password').value = ''
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled()
  })
})
