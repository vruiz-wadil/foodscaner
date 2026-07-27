/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const signOut = vi.fn()
const mockAuth = {}
const getCachedProfile = vi.fn()
const syncUserProfile = vi.fn()
const getIdToken = vi.fn()

const reauthenticateWithCredential = vi.fn()
const verifyBeforeUpdateEmail = vi.fn()
const updatePassword = vi.fn()
class EmailAuthProvider {
  static credential(email, password) { return { email, password } }
}
vi.mock('../firebase-init.js', () => ({ firebaseAuth: mockAuth, signOut, reauthenticateWithCredential, verifyBeforeUpdateEmail, updatePassword, EmailAuthProvider }))
vi.mock('../authClient.js', () => ({ getCachedProfile, syncUserProfile, getIdToken }))

let renderAccountHub, handleLogout, computeAlertsActive, handleRenewMembership, submitNameEdit
let submitPhoneContactEdit, submitPhoneSendCode, submitPhoneChangeConfirm, submitEmailEdit, submitPasswordEdit
let submitCancelSubscription, submitReactivateSubscription, submitResendVerification, submitEmailContactEdit
let originalLocation

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  document.body.innerHTML = '<div id="account-root"></div>'
  originalLocation = window.location
  delete window.location
  window.location = { href: '' }
  const mod = await import('../account-ui.js')
  renderAccountHub = mod.renderAccountHub
  handleLogout = mod.handleLogout
  computeAlertsActive = mod.computeAlertsActive
  handleRenewMembership = mod.handleRenewMembership
  submitNameEdit = mod.submitNameEdit
  submitPhoneContactEdit = mod.submitPhoneContactEdit
  submitPhoneSendCode = mod.submitPhoneSendCode
  submitPhoneChangeConfirm = mod.submitPhoneChangeConfirm
  submitEmailEdit = mod.submitEmailEdit
  submitPasswordEdit = mod.submitPasswordEdit
  submitCancelSubscription = mod.submitCancelSubscription
  submitReactivateSubscription = mod.submitReactivateSubscription
  submitResendVerification = mod.submitResendVerification
  submitEmailContactEdit = mod.submitEmailContactEdit
})

afterEach(() => {
  window.location = originalLocation
})

describe('renderAccountHub', () => {
  it('redirige a auth.html si no hay perfil cacheado (sin sesión)', () => {
    getCachedProfile.mockReturnValue(null)
    renderAccountHub()
    expect(window.location.href).toBe('auth.html')
  })

  it('muestra el badge "Pendiente" y el CTA para activar membresía, con botón de editar preferencias', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'pending' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.account-plan-pending')).toBeTruthy()
    expect(root.textContent).toMatch(/Completa tu membresía/)
    expect(root.querySelector('a[href="preferences.html"]').textContent).toMatch(/[Ee]ditar preferencias/)
  })

  it('muestra el badge "Expirada" y el CTA de renovar cuando la membresía venció', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'expired' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.account-plan-expired')).toBeTruthy()
    expect(root.textContent).toMatch(/Tu membresía venció/)
    expect(document.getElementById('btn-renew-membership').textContent).toMatch(/Renovar membresía/)
  })

  it('muestra el número de teléfono en vez de vacío cuando el perfil no tiene email (cuenta creada por SMS)', () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525512345678', membershipStatus: 'pending' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.account-email').textContent).toBe('+525512345678')
  })

  it('muestra el nombre del usuario en el cuadro superior sin importar el método de acceso (Google/teléfono/email)', () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525512345678', membershipStatus: 'active', profile: { displayName: 'Ana Ruiz' } })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.hero-card-dark .account-name').textContent).toBe('Ana Ruiz')
  })

  it('muestra "Sin nombre" en el cuadro superior si el perfil todavía no tiene nombre guardado', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.hero-card-dark .account-name').textContent).toBe('Sin nombre')
  })

  it('muestra el resumen del perfil dietético/alérgico y botón editar preferencias para membresía activa', () => {
    getCachedProfile.mockReturnValue({
      email: 'a@b.com', membershipStatus: 'active',
      preferences: { dietary: ['vegan'], allergens: [{ code: 'cacahuate', severity: 'severe' }], healthConditions: [] }
    })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.textContent).toMatch(/vegan/)
    expect(root.querySelector('a[href="preferences.html"]').textContent).toMatch(/[Ee]ditar preferencias/)
  })

  it('siempre incluye el botón de cerrar sesión, sin importar el estado de membresía', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'pending' })
    renderAccountHub()
    expect(document.getElementById('btn-logout')).toBeTruthy()
  })

  it('muestra el total de escaneos y alertas activas reales del perfil cacheado', () => {
    getCachedProfile.mockReturnValue({
      email: 'a@b.com', membershipStatus: 'active',
      usage: { date: '2026-07-16', ocrCount: 1, cacheRefreshCount: 0, totalScans: 12 },
      preferences: { dietary: ['vegan'], allergens: [{ code: 'cacahuate', severity: 'severe' }], healthConditions: [] }
    })
    renderAccountHub()
    const root = document.getElementById('account-root')
    const nums = Array.from(root.querySelectorAll('.stat-num')).map(el => el.textContent)
    expect(nums).toEqual(['12', '2'])
  })

  it('el total de escaneos y alertas activas es 0 si el perfil no tiene usage/preferences todavía', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'pending' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    const nums = Array.from(root.querySelectorAll('.stat-num')).map(el => el.textContent)
    expect(nums).toEqual(['0', '0'])
  })

  it('envuelve todo el contenido en un único .content-card, no en cards sueltas', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'pending' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelectorAll(':scope > .content-card').length).toBe(1)
  })

  it('escapa HTML en el nombre mostrado (valor guardado hostil no inyecta markup)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', profile: { displayName: '<img src=x onerror=alert(1)>' } })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('img')).toBeNull()
    expect(root.innerHTML).toMatch(/&lt;img/)
  })
})

describe('handleLogout', () => {
  it('llama signOut y redirige a index.html', async () => {
    await handleLogout()
    expect(signOut).toHaveBeenCalledWith(mockAuth)
    expect(window.location.href).toBe('index.html')
  })
})

describe('handleRenewMembership', () => {
  it('calls POST /api/me/membership/pay and re-renders after syncing the profile', async () => {
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    document.body.innerHTML = '<div id="account-root"></div><button id="btn-renew-membership"></button>'

    await handleRenewMembership()

    expect(global.fetch).toHaveBeenCalledWith('/api/me/membership/pay', expect.objectContaining({ method: 'POST' }))
    expect(syncUserProfile).toHaveBeenCalled()
  })

  it('deja el botón en su texto original y habilitado si el pago responde no-ok', async () => {
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'expired' })
    document.body.innerHTML = '<div id="account-root"></div><button id="btn-renew-membership">Renovar membresía</button><p id="account-renew-error" class="hidden"></p>'

    await expect(handleRenewMembership()).rejects.toThrow()

    const btn = document.getElementById('btn-renew-membership')
    expect(btn.textContent).toBe('Renovar membresía')
    expect(btn.disabled).toBe(false)
    expect(syncUserProfile).not.toHaveBeenCalled()
  })

  it('deja el botón en su texto original y habilitado si el fetch rechaza (error de red)', async () => {
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'expired' })
    document.body.innerHTML = '<div id="account-root"></div><button id="btn-renew-membership">Renovar membresía</button><p id="account-renew-error" class="hidden"></p>'

    await expect(handleRenewMembership()).rejects.toThrow('network down')

    const btn = document.getElementById('btn-renew-membership')
    expect(btn.textContent).toBe('Renovar membresía')
    expect(btn.disabled).toBe(false)
    expect(syncUserProfile).not.toHaveBeenCalled()
  })
})

describe('fila Nombre — edición inline', () => {
  it('se muestra en modo lectura por default, sin input visible', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', profile: { displayName: 'Ana Ruiz' } })
    renderAccountHub()
    expect(document.getElementById('input-edit-name')).toBeNull()
    expect(document.querySelector('[data-row="name"] .account-data-value').textContent).toBe('Ana Ruiz')
  })

  it('click en el lápiz abre el input precargado con el nombre actual', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', profile: { displayName: 'Ana Ruiz' } })
    renderAccountHub()
    document.getElementById('btn-edit-name').click()
    expect(document.getElementById('input-edit-name').value).toBe('Ana Ruiz')
  })

  it('click en cancelar (✖) descarta el input y vuelve a modo lectura sin llamar a fetch', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', profile: { displayName: 'Ana Ruiz' } })
    renderAccountHub()
    global.fetch = vi.fn()
    document.getElementById('btn-edit-name').click()
    document.getElementById('input-edit-name').value = 'Otro Nombre'
    document.getElementById('btn-cancel-name').click()
    expect(document.getElementById('input-edit-name')).toBeNull()
    expect(document.querySelector('[data-row="name"] .account-data-value').textContent).toBe('Ana Ruiz')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('submitNameEdit rechaza un nombre vacío sin llamar a fetch', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    document.getElementById('btn-edit-name').click()
    global.fetch = vi.fn()
    document.getElementById('input-edit-name').value = '   '
    await expect(submitNameEdit()).rejects.toThrow()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('submitNameEdit llama PUT /api/me/profile con el nombre, re-sincroniza y vuelve a modo lectura', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    document.getElementById('btn-edit-name').click()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    document.getElementById('input-edit-name').value = 'Ana Ruiz'

    await submitNameEdit()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/me/profile')
    expect(options.method).toBe('PUT')
    expect(JSON.parse(options.body)).toEqual({ displayName: 'Ana Ruiz' })
    expect(syncUserProfile).toHaveBeenCalled()
    expect(document.getElementById('input-edit-name')).toBeNull()
  })

  it('submitNameEdit muestra error, no re-sincroniza, y el input sigue visible para reintentar', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    document.getElementById('btn-edit-name').click()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    document.getElementById('input-edit-name').value = 'Ana Ruiz'

    await expect(submitNameEdit()).rejects.toThrow()

    expect(syncUserProfile).not.toHaveBeenCalled()
    const errorEl = document.getElementById('edit-name-error')
    expect(errorEl.classList.contains('hidden')).toBe(false)
    expect(document.getElementById('input-edit-name')).toBeTruthy()
  })
})

describe('fila Teléfono — cuenta CON email (edición inline, sin SMS)', () => {
  it('click en el lápiz abre un input simple (no el flujo de 2 pasos)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', phoneNumber: '+525512345678' })
    renderAccountHub()
    document.getElementById('btn-edit-phone').click()
    expect(document.getElementById('input-edit-phone-contact')).toBeTruthy()
    expect(document.getElementById('phone-login-flow')).toBeNull()
  })

  it('submitPhoneContactEdit llama PUT /api/me/profile con { phone } y re-sincroniza', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    document.getElementById('btn-edit-phone').click()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    document.getElementById('input-edit-phone-contact').value = '+525512345678'

    await submitPhoneContactEdit()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/me/profile')
    expect(JSON.parse(options.body)).toEqual({ phone: '+525512345678' })
    expect(syncUserProfile).toHaveBeenCalled()
  })
})

describe('fila Teléfono — cuenta SIN email (phone-login, modal con flujo SMS)', () => {
  it('el lápiz abre un modal con el flujo de 2 pasos (enviar código / confirmar)', () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    renderAccountHub()
    expect(document.getElementById('phone-login-flow')).toBeNull()
    document.getElementById('btn-open-phone-modal').click()
    expect(document.getElementById('phone-login-flow')).toBeTruthy()
    expect(document.getElementById('input-edit-phone-contact')).toBeNull()
  })

  it('submitPhoneSendCode llama /api/auth/phone/send con el número nuevo', async () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    renderAccountHub()
    document.getElementById('btn-open-phone-modal').click()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'pending' }) })
    document.getElementById('input-new-phone').value = '+525512345678'

    await submitPhoneSendCode()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/auth/phone/send')
    expect(JSON.parse(options.body)).toEqual({ phone: '+525512345678' })
  })

  it('submitPhoneChangeConfirm llama POST /api/me/phone/change con phone+code y re-sincroniza', async () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    renderAccountHub()
    document.getElementById('btn-open-phone-modal').click()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    document.getElementById('input-new-phone').value = '+525512345678'
    document.getElementById('input-phone-code').value = '123456'

    await submitPhoneChangeConfirm()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/me/phone/change')
    expect(options.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(options.body)).toEqual({ phone: '+525512345678', code: '123456' })
    expect(syncUserProfile).toHaveBeenCalled()
  })

  it('submitPhoneChangeConfirm muestra "phone_in_use" de forma legible si el 409 ocurre, modal sigue abierto', async () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    renderAccountHub()
    document.getElementById('btn-open-phone-modal').click()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'phone_in_use' }) })
    document.getElementById('input-new-phone').value = '+525512345678'
    document.getElementById('input-phone-code').value = '123456'

    await expect(submitPhoneChangeConfirm()).rejects.toThrow()

    expect(syncUserProfile).not.toHaveBeenCalled()
    const errorEl = document.getElementById('edit-phone-error')
    expect(errorEl.textContent).toMatch(/ya está en uso/)
    expect(document.getElementById('phone-login-flow')).toBeTruthy()
  })
})

describe('fila Correo (contacto) — cuenta sin login por password ni email de identidad', () => {
  it('se muestra editable inline para una cuenta de teléfono sin correo (hallazgo: onboarding sí lo pide, pero no había forma de editarlo)', () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active', profile: { email: 'contacto@example.com' } })
    mockAuth.currentUser = { phoneNumber: '+525500000000', providerData: [{ providerId: 'phone' }] }
    renderAccountHub()
    expect(document.querySelector('[data-row="email"] .account-data-value').textContent).toBe('contacto@example.com')
    expect(document.getElementById('btn-edit-email-contact')).toBeTruthy()
  })

  it('NO se muestra para una cuenta de Google (ya tiene profile.email real, mostrado arriba en el hero, no es "sin correo")', () => {
    getCachedProfile.mockReturnValue({ email: 'a@gmail.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@gmail.com', providerData: [{ providerId: 'google.com' }] }
    renderAccountHub()
    expect(document.getElementById('btn-edit-email-contact')).toBeNull()
  })

  it('NO se muestra para una cuenta de correo/contraseña (usa la fila de modal existente en su lugar)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    expect(document.getElementById('btn-edit-email-contact')).toBeNull()
    expect(document.getElementById('btn-edit-email')).toBeTruthy()
  })

  it('click en el lápiz abre el input inline', () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    mockAuth.currentUser = { phoneNumber: '+525500000000', providerData: [{ providerId: 'phone' }] }
    renderAccountHub()
    document.getElementById('btn-edit-email-contact').click()
    expect(document.getElementById('input-edit-email-contact')).toBeTruthy()
  })

  it('submitEmailContactEdit llama PUT /api/me/profile con { email } y re-sincroniza', async () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    mockAuth.currentUser = { phoneNumber: '+525500000000', providerData: [{ providerId: 'phone' }] }
    renderAccountHub()
    document.getElementById('btn-edit-email-contact').click()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    document.getElementById('input-edit-email-contact').value = 'nuevo@example.com'

    await submitEmailContactEdit()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/me/profile')
    expect(JSON.parse(options.body)).toEqual({ email: 'nuevo@example.com' })
    expect(syncUserProfile).toHaveBeenCalled()
  })

  it('submitEmailContactEdit muestra error y no re-sincroniza si el PUT falla', async () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    mockAuth.currentUser = { phoneNumber: '+525500000000', providerData: [{ providerId: 'phone' }] }
    renderAccountHub()
    document.getElementById('btn-edit-email-contact').click()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    document.getElementById('input-edit-email-contact').value = 'nuevo@example.com'

    await expect(submitEmailContactEdit()).rejects.toThrow()

    expect(syncUserProfile).not.toHaveBeenCalled()
    const errorEl = document.getElementById('edit-email-contact-error')
    expect(errorEl.classList.contains('hidden')).toBe(false)
  })
})

describe('fila Correo — modal', () => {
  it('el lápiz solo aparece si el provider incluye password', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'google.com' }] }
    renderAccountHub()
    expect(document.getElementById('btn-edit-email')).toBeNull()
  })

  it('click en el lápiz abre el modal con correo nuevo + contraseña actual', () => {
    getCachedProfile.mockReturnValue({ email: 'old@example.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'old@example.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    document.getElementById('btn-edit-email').click()
    expect(document.getElementById('input-edit-email')).toBeTruthy()
    expect(document.getElementById('input-email-current-password')).toBeTruthy()
  })

  it('submitEmailEdit reautentica y llama verifyBeforeUpdateEmail, muestra el mensaje de "revisa tu correo"', async () => {
    getCachedProfile.mockReturnValue({ email: 'old@example.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'old@example.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    document.getElementById('btn-edit-email').click()
    reauthenticateWithCredential.mockResolvedValue({})
    verifyBeforeUpdateEmail.mockResolvedValue(undefined)
    document.getElementById('input-edit-email').value = 'new@example.com'
    document.getElementById('input-email-current-password').value = 'secret123'

    await submitEmailEdit()

    expect(reauthenticateWithCredential).toHaveBeenCalledWith(mockAuth.currentUser, { email: 'old@example.com', password: 'secret123' })
    expect(verifyBeforeUpdateEmail).toHaveBeenCalledWith(mockAuth.currentUser, 'new@example.com')
    const successEl = document.getElementById('edit-email-success')
    expect(successEl.classList.contains('hidden')).toBe(false)
    expect(successEl.textContent).toMatch(/revisa tu correo/i)
  })

  it('submitEmailEdit muestra error de contraseña incorrecta sin llamar verifyBeforeUpdateEmail', async () => {
    getCachedProfile.mockReturnValue({ email: 'old@example.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'old@example.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    document.getElementById('btn-edit-email').click()
    reauthenticateWithCredential.mockRejectedValue({ code: 'auth/wrong-password' })
    document.getElementById('input-edit-email').value = 'new@example.com'
    document.getElementById('input-email-current-password').value = 'wrong'

    await expect(submitEmailEdit()).rejects.toBeTruthy()

    expect(verifyBeforeUpdateEmail).not.toHaveBeenCalled()
    const errorEl = document.getElementById('edit-email-error')
    expect(errorEl.classList.contains('hidden')).toBe(false)
  })
})

describe('Contraseña — modal', () => {
  it('el link "Cambiar contraseña" solo aparece si el provider incluye password', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'google.com' }] }
    renderAccountHub()
    expect(document.getElementById('btn-open-password-modal')).toBeNull()
  })

  it('click en el link abre el modal con los 3 campos de contraseña', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    document.getElementById('btn-open-password-modal').click()
    expect(document.getElementById('input-current-password')).toBeTruthy()
    expect(document.getElementById('input-new-password')).toBeTruthy()
    expect(document.getElementById('input-confirm-password')).toBeTruthy()
  })

  it('submitPasswordEdit rechaza si nueva y confirmar no coinciden, sin llamar a Firebase', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    document.getElementById('btn-open-password-modal').click()
    document.getElementById('input-current-password').value = 'old123'
    document.getElementById('input-new-password').value = 'new123'
    document.getElementById('input-confirm-password').value = 'different'

    await expect(submitPasswordEdit()).rejects.toThrow()

    expect(reauthenticateWithCredential).not.toHaveBeenCalled()
  })

  it('submitPasswordEdit reautentica y llama updatePassword cuando coinciden', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    document.getElementById('btn-open-password-modal').click()
    reauthenticateWithCredential.mockResolvedValue({})
    updatePassword.mockResolvedValue(undefined)
    document.getElementById('input-current-password').value = 'old123'
    document.getElementById('input-new-password').value = 'new12345'
    document.getElementById('input-confirm-password').value = 'new12345'

    await submitPasswordEdit()

    expect(reauthenticateWithCredential).toHaveBeenCalledWith(mockAuth.currentUser, { email: 'a@b.com', password: 'old123' })
    expect(updatePassword).toHaveBeenCalledWith(mockAuth.currentUser, 'new12345')
    const successEl = document.getElementById('edit-password-success')
    expect(successEl.classList.contains('hidden')).toBe(false)
  })

  it('submitPasswordEdit muestra error si la contraseña actual es incorrecta, sin llamar updatePassword', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    document.getElementById('btn-open-password-modal').click()
    reauthenticateWithCredential.mockRejectedValue({ code: 'auth/wrong-password' })
    document.getElementById('input-current-password').value = 'wrong'
    document.getElementById('input-new-password').value = 'new12345'
    document.getElementById('input-confirm-password').value = 'new12345'

    await expect(submitPasswordEdit()).rejects.toBeTruthy()

    expect(updatePassword).not.toHaveBeenCalled()
  })
})

describe('bloque Suscripción (membresía activa)', () => {
  it('muestra "se renovará" y botón Cancelar cuando autoRenew !== false', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z', autoRenew: true })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.textContent).toMatch(/Se renovará automáticamente/)
    expect(document.getElementById('btn-open-cancel-subscription-modal')).toBeTruthy()
    expect(document.getElementById('btn-reactivate-subscription')).toBeNull()
  })

  it('trata autoRenew ausente como true (cuentas activas de antes de este cambio)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z' })
    renderAccountHub()
    expect(document.getElementById('btn-open-cancel-subscription-modal')).toBeTruthy()
  })

  it('muestra "vence" y botón Reactivar cuando autoRenew === false', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z', autoRenew: false })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.textContent).toMatch(/no se renovará/)
    expect(document.getElementById('btn-reactivate-subscription')).toBeTruthy()
    expect(document.getElementById('btn-open-cancel-subscription-modal')).toBeNull()
  })

  it('no se muestra para membresías pending/expired', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'pending' })
    renderAccountHub()
    expect(document.querySelector('[data-row="subscription"]')).toBeNull()
  })

  it('muestra el historial de pagos, más reciente primero', () => {
    getCachedProfile.mockReturnValue({
      email: 'a@b.com', membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z', autoRenew: true,
      paymentHistory: [
        { date: '2026-06-22T12:00:00.000Z', amount: 0, method: 'simulado' },
        { date: '2026-07-22T12:00:00.000Z', amount: 0, method: 'simulado' }
      ]
    })
    renderAccountHub()
    const rows = Array.from(document.querySelectorAll('.account-payment-row')).map(r => r.textContent)
    expect(rows[0]).toMatch(/22 jul 2026/)
    expect(rows[1]).toMatch(/22 jun 2026/)
  })

  it('click en "Cancelar suscripción" abre el modal de confirmación', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z', autoRenew: true })
    renderAccountHub()
    document.getElementById('btn-open-cancel-subscription-modal').click()
    expect(document.getElementById('btn-cancel-subscription-confirm')).toBeTruthy()
  })

  it('submitCancelSubscription llama POST /api/me/membership/cancel y re-sincroniza', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z', autoRenew: true })
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    await submitCancelSubscription()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/me/membership/cancel')
    expect(options.method).toBe('POST')
    expect(syncUserProfile).toHaveBeenCalled()
  })

  it('submitReactivateSubscription llama POST /api/me/membership/reactivate y re-sincroniza', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z', autoRenew: false })
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    await submitReactivateSubscription()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/me/membership/reactivate')
    expect(options.method).toBe('POST')
    expect(syncUserProfile).toHaveBeenCalled()
  })

  it('submitReactivateSubscription muestra error, no re-sincroniza, si el API responde no-ok', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', membershipExpiresAt: '2026-08-21T12:00:00.000Z', autoRenew: false })
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })

    await expect(submitReactivateSubscription()).rejects.toThrow()

    expect(syncUserProfile).not.toHaveBeenCalled()
    const errorEl = document.getElementById('reactivate-subscription-error')
    expect(errorEl.classList.contains('hidden')).toBe(false)
    expect(errorEl.textContent).toMatch(/No se pudo reactivar/)
  })
})

describe('aviso de correo no verificado', () => {
  it('se muestra cuando el provider es password y emailVerified es false', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', emailVerified: false, providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    expect(document.getElementById('btn-resend-verification')).toBeTruthy()
  })

  it('NO se muestra si el correo ya está verificado', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', emailVerified: true, providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    expect(document.getElementById('btn-resend-verification')).toBeNull()
  })

  it('NO se muestra para cuentas sin provider password (Google/teléfono)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', emailVerified: false, providerData: [{ providerId: 'google.com' }] }
    renderAccountHub()
    expect(document.getElementById('btn-resend-verification')).toBeNull()
  })

  it('submitResendVerification llama POST /api/me/verification-email y muestra confirmación', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', emailVerified: false, providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true })

    await submitResendVerification()

    expect(global.fetch).toHaveBeenCalledWith('/api/me/verification-email', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' }
    })
    const successEl = document.getElementById('resend-verification-success')
    expect(successEl.classList.contains('hidden')).toBe(false)
  })

  it('submitResendVerification muestra error, mantiene el botón visible para reintentar', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', emailVerified: false, providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })

    await expect(submitResendVerification()).rejects.toThrow()

    const errorEl = document.getElementById('resend-verification-error')
    expect(errorEl.classList.contains('hidden')).toBe(false)
    expect(errorEl.textContent).toMatch(/No se pudo reenviar/)
    const successEl = document.getElementById('resend-verification-success')
    expect(successEl.classList.contains('hidden')).toBe(true)
  })
})
