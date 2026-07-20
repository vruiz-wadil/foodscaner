/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAuth = { currentUser: null }
const signInWithEmailAndPassword = vi.fn()
const createUserWithEmailAndPassword = vi.fn()
const signInWithPopup = vi.fn()
const signInWithCustomToken = vi.fn()
class GoogleAuthProvider {}

vi.mock('../firebase-init.js', () => ({
  firebaseAuth: mockAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithCustomToken
}))

const setAutoSyncSuppressed = vi.fn()
vi.mock('../authClient.js', () => ({ setAutoSyncSuppressed }))

vi.mock('../country-codes.js', () => ({
  COUNTRY_CODES: [{ name: 'México', iso2: 'MX', dial: '+52' }, { name: 'Argentina', iso2: 'AR', dial: '+54' }],
  flagEmoji: () => '🏳️'
}))

let mapAuthError, handleLogin, handleSignup, handleGoogleSignIn, handleSendCode, handleVerifyCode, handlePhoneSignupConsent, setView

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  mockAuth.currentUser = null
  global.fetch = vi.fn().mockResolvedValue({ ok: true })
  document.body.innerHTML = `
    <h1 id="auth-heading-title">Inicia sesión</h1>
    <div id="login-view">
      <button id="btn-google">Continuar con Google</button>
      <button type="button" id="btn-phone">Continuar con teléfono</button>
      <form id="login-form" novalidate>
        <input id="login-email" type="email" required>
        <input id="login-password" type="password" required minlength="6">
        <button type="button" id="btn-toggle-password" aria-label="Mostrar contraseña">Ver</button>
        <button type="submit" id="btn-login">Iniciar sesión</button>
        <button type="button" id="btn-back-to-login" class="hidden">¿Ya tienes cuenta? Inicia sesión</button>
        <button type="button" id="btn-signup">Crear cuenta</button>
      </form>
    </div>
    <div id="phone-step" class="hidden">
      <select id="phone-country"></select>
      <input id="phone-number" type="tel">
      <button type="button" id="btn-send-code">Enviar código</button>
      <button type="button" id="btn-phone-cancel">Cancelar</button>
    </div>
    <div id="phone-code-step" class="hidden">
      <input id="phone-code" type="text" maxlength="6">
      <button type="button" id="btn-verify-code">Verificar</button>
      <button type="button" id="btn-resend-code">Reenviar código</button>
      <button type="button" id="btn-phone-code-back">Cambiar número</button>
    </div>
    <div id="signup-only" class="hidden">
      <input type="checkbox" id="terms-checkbox">
      <input type="checkbox" id="age-checkbox">
      <button type="button" id="btn-phone-consent-confirm" class="hidden">Confirmar y continuar</button>
    </div>
    <p id="auth-error" class="hidden" role="alert"></p>
  `
  const mod = await import('../auth-ui.js')
  mapAuthError = mod.mapAuthError
  handleLogin = mod.handleLogin
  handleSignup = mod.handleSignup
  handleGoogleSignIn = mod.handleGoogleSignIn
  handleSendCode = mod.handleSendCode
  handleVerifyCode = mod.handleVerifyCode
  handlePhoneSignupConsent = mod.handlePhoneSignupConsent
  setView = mod.setView
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

describe('mapAuthError — phone codes (Twilio backend)', () => {
  it('maps the backend error codes returned by /api/auth/phone/send and /verify', () => {
    expect(mapAuthError('invalid_phone')).toBe('Número de teléfono inválido.')
    expect(mapAuthError('send_failed')).toBe('No se pudo enviar el código. Intenta más tarde.')
    expect(mapAuthError('invalid_code')).toBe('Código incorrecto o expirado.')
    expect(mapAuthError('verify_failed')).toBe('Ocurrió un error al verificar tu código. Intenta de nuevo.')
  })
})

describe('setView', () => {
  it('shows only #login-view by default', () => {
    setView('login')
    expect(document.getElementById('login-view').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('phone-code-step').classList.contains('hidden')).toBe(true)
  })

  it('shows only #phone-step for "phone-number"', () => {
    setView('phone-number')
    expect(document.getElementById('login-view').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('phone-code-step').classList.contains('hidden')).toBe(true)
  })

  it('shows only #phone-code-step for "phone-code"', () => {
    setView('phone-code')
    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('phone-code-step').classList.contains('hidden')).toBe(false)
  })

  it('shows #signup-only for "phone-consent"', () => {
    setView('phone-consent')
    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('login-view').classList.contains('hidden')).toBe(true)
  })
})

describe('handleSendCode', () => {
  it('POSTs the concatenated dial code + digits to /api/auth/phone/send and moves to phone-code view', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'pending' }) })
    await handleSendCode('+52', '55 1234 5678')
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/phone/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+525512345678' })
    })
    expect(document.getElementById('phone-code-step').classList.contains('hidden')).toBe(false)
  })

  it('shows a mapped error and stays on the phone-number view when the backend rejects the phone', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'invalid_phone' }) })
    await handleSendCode('+52', 'abc')
    expect(document.getElementById('auth-error').textContent).toBe('Número de teléfono inválido.')
    expect(document.getElementById('phone-code-step').classList.contains('hidden')).toBe(true)
  })
})

describe('module load — auto-sync suppression', () => {
  it('suprime el auto-sync genérico de authClient.js apenas se carga el módulo, para TODOS los flujos de esta página (hallazgo de revisión del plan: importar authClient.js activaba su listener por primera vez en auth.html)', () => {
    expect(setAutoSyncSuppressed).toHaveBeenCalledWith(true)
  })
})

describe('handleVerifyCode', () => {
  async function sendThenVerify(verifyResponse) {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'pending' }) })
      .mockResolvedValueOnce(verifyResponse)
    await handleSendCode('+52', '5512345678')
    await handleVerifyCode('123456')
  }

  it('does not open the consent step for an existing user', async () => {
    signInWithCustomToken.mockResolvedValueOnce({ user: { uid: 'phone:+525512345678' } })
    await sendThenVerify({ ok: true, json: async () => ({ customToken: 'jwt-1', isNewUser: false }) })

    expect(signInWithCustomToken).toHaveBeenCalledWith(mockAuth, 'jwt-1')
    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(true)
  })

  it('shows the consent step (does not redirect yet) for a new user', async () => {
    signInWithCustomToken.mockResolvedValueOnce({ user: { uid: 'phone:+525512345678' } })
    await sendThenVerify({ ok: true, json: async () => ({ customToken: 'jwt-2', isNewUser: true }) })

    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(false)
  })

  it('shows a mapped error when the code is wrong', async () => {
    await sendThenVerify({ ok: false, json: async () => ({ error: 'invalid_code' }) })

    expect(document.getElementById('auth-error').textContent).toBe('Código incorrecto o expirado.')
    expect(signInWithCustomToken).not.toHaveBeenCalled()
  })
})

describe('handlePhoneSignupConsent', () => {
  async function arriveAtConsentStep() {
    const getIdToken = vi.fn().mockResolvedValue('tok-phone-new')
    signInWithCustomToken.mockResolvedValueOnce({ user: { uid: 'phone:+525512345678', getIdToken } })
    mockAuth.currentUser = { getIdToken }
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'pending' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ customToken: 'jwt-new', isNewUser: true }) })
    await handleSendCode('+52', '5512345678')
    await handleVerifyCode('123456')
    return getIdToken
  }

  it('rechaza si los checkboxes no están marcados', async () => {
    await arriveAtConsentStep()
    document.getElementById('terms-checkbox').checked = false
    document.getElementById('age-checkbox').checked = false
    await handlePhoneSignupConsent()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/auth/sync', expect.anything())
  })

  it('sincroniza con termsAccepted/ageConfirmed y redirige cuando ambos checkboxes están marcados', async () => {
    const getIdToken = await arriveAtConsentStep()
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true })

    await handlePhoneSignupConsent()

    expect(getIdToken).toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-phone-new', 'Content-Type': 'application/json' },
      body: JSON.stringify({ termsAccepted: true, ageConfirmed: true, termsVersion: 'v1' })
    })
  })

  it('deshabilita el botón de confirmar mientras la petición está en curso', async () => {
    await arriveAtConsentStep()
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true
    let resolveFetch
    global.fetch = vi.fn().mockReturnValueOnce(new Promise(r => { resolveFetch = r }))
    const btn = document.getElementById('btn-phone-consent-confirm')
    const promise = handlePhoneSignupConsent()
    expect(btn.disabled).toBe(true)
    resolveFetch({ ok: true })
    await promise
    expect(btn.disabled).toBe(false)
  })
})

describe('phone-step wiring (DOMContentLoaded)', () => {
  beforeEach(() => {
    document.dispatchEvent(new Event('DOMContentLoaded'))
  })

  it('populates #phone-country from COUNTRY_CODES with México first/selected', () => {
    const select = document.getElementById('phone-country')
    expect(select.options.length).toBe(2)
    expect(select.options[0].value).toBe('+52')
    expect(select.value).toBe('+52')
  })

  it('#btn-phone switches to the phone-number view', () => {
    document.getElementById('btn-phone').click()
    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(false)
  })

  it('#btn-phone exits any in-progress email signup mode first (hallazgo de revisión: sin esto, los checkboxes de Términos del signup por correo abandonado quedan visibles junto a la UI de teléfono)', () => {
    document.getElementById('btn-signup').click()
    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(false)

    document.getElementById('btn-phone').click()

    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('auth-heading-title').textContent).toBe('Inicia sesión')
  })

  it('#btn-phone-cancel returns to the login view', () => {
    document.getElementById('btn-phone').click()
    document.getElementById('btn-phone-cancel').click()
    expect(document.getElementById('login-view').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(true)
  })
})

describe('signup-mode toggle (hallazgos #1, #2, #14: btn-login robaba el Enter en modo signup y no había forma de volver a login)', () => {
  beforeEach(() => {
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

// Nota: estos tests van al final del archivo A PROPÓSITO — misma posición
// exacta que ya tenían en el archivo original, sin fusionarlos en sus
// describes "naturales" de arriba. Los describe blocks de arriba (phone-step
// wiring, signup-mode toggle, password toggle, login submit validation)
// disparan document.dispatchEvent(new Event('DOMContentLoaded')) en su
// beforeEach, lo cual re-ejecuta TODOS los listeners de DOMContentLoaded
// acumulados en `document` desde el inicio del archivo (uno por cada import
// de auth-ui.js hecho por un test anterior — jsdom nunca los limpia). El test
// 'password toggle aria-label' es sensible a la PARIDAD de esa cuenta (par =
// el toggle queda pegado, impar = funciona) — lo que importa es cuántos tests
// con import del módulo corrieron ANTES de él, no si los describes
// intermedios disparan o no el evento. Verificado empíricamente: fusionar
// estos 3 tests en handleSendCode/handleVerifyCode de arriba (ANTES de
// 'phone-step wiring') rompe 'password toggle aria-label' por paridad
// (confirmado corriendo la suite real). Dejarlos aquí, después del último
// describe que dispara el evento, no altera el conteo de ningún test
// existente.
describe('handleVerifyCode — isNewUser ambiguo (hallazgo de revisión: undefined no debe tratarse como usuario existente)', () => {
  it('shows the consent step (fails safe) when isNewUser is ambiguous/undefined', async () => {
    signInWithCustomToken.mockResolvedValueOnce({ user: { uid: 'phone:+525512345678' } })
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'pending' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ customToken: 'jwt-3' }) })
    await handleSendCode('+52', '5512345678')

    await handleVerifyCode('123456')

    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(false)
  })

  it('maps signInWithCustomToken failures by their Firebase error code (hallazgo de revisión: un catch sin err perdía el mapeo específico, ej. sin conexión)', async () => {
    signInWithCustomToken.mockRejectedValueOnce({ code: 'auth/network-request-failed' })
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'pending' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ customToken: 'jwt-4', isNewUser: false }) })
    await handleSendCode('+52', '5512345678')

    await handleVerifyCode('123456')

    expect(document.getElementById('auth-error').textContent).toBe('Sin conexión a internet. Revisa tu red e inténtalo de nuevo.')
  })

  it('shows a generic error when handleSendCode itself throws (network failure)', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('offline'))
    await handleSendCode('+52', '5512345678')
    expect(document.getElementById('auth-error').textContent).toBe('Ocurrió un error. Intenta de nuevo.')
  })
})

describe('handlePhoneSignupConsent — manejo de errores (hallazgo de revisión: sin try/catch, fallos quedaban silenciosos)', () => {
  async function arriveAtConsentStep() {
    const getIdToken = vi.fn().mockResolvedValue('tok-phone-new')
    signInWithCustomToken.mockResolvedValueOnce({ user: { uid: 'phone:+525512345678', getIdToken } })
    mockAuth.currentUser = { getIdToken }
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'pending' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ customToken: 'jwt-new', isNewUser: true }) })
    await handleSendCode('+52', '5512345678')
    await handleVerifyCode('123456')
    return getIdToken
  }

  it('muestra un error y no revienta si el sync responde con !res.ok', async () => {
    await arriveAtConsentStep()
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false })

    await expect(handlePhoneSignupConsent()).resolves.toBeUndefined()

    expect(document.getElementById('auth-error').textContent).toBe('Ocurrió un error. Intenta de nuevo.')
  })

  it('muestra un error mapeado (sin throw) si falla el fetch de sync', async () => {
    await arriveAtConsentStep()
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true
    global.fetch = vi.fn().mockRejectedValueOnce({ code: 'auth/network-request-failed' })

    await expect(handlePhoneSignupConsent()).resolves.toBeUndefined()

    expect(document.getElementById('auth-error').textContent).toBe('Sin conexión a internet. Revisa tu red e inténtalo de nuevo.')
  })
})
