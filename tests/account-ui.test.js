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

  it('muestra el badge "Pendiente" y el CTA para activar membresía, con botón de editar preferencias (unconditional desde Task 11)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'pending' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.account-plan-pending')).toBeTruthy()
    expect(root.textContent).toMatch(/Completa tu membresía/)
    expect(root.querySelector('a[href="preferences.html"]').textContent).toMatch(/[Ee]ditar preferencias/)
  })

  it('muestra el badge "Expirada" y el CTA de renovar cuando la membresía venció, con botón de editar preferencias (unconditional desde Task 11)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'expired' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.account-plan-expired')).toBeTruthy()
    expect(root.textContent).toMatch(/Tu membresía venció/)
    expect(document.getElementById('btn-renew-membership').textContent).toMatch(/Renovar membresía/)
    expect(root.querySelector('a[href="preferences.html"]').textContent).toMatch(/[Ee]ditar preferencias/)
  })

  it('muestra el número de teléfono en vez de vacío cuando el perfil no tiene email (cuenta creada por SMS)', () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525512345678', membershipStatus: 'pending' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.account-email').textContent).toBe('+525512345678')
  })

  it('muestra el resumen del perfil dietético/alérgico ANTES de cualquier upsell, y botón editar preferencias para membresía activa', () => {
    getCachedProfile.mockReturnValue({
      email: 'a@b.com', membershipStatus: 'active',
      preferences: { dietary: ['vegan'], allergens: [{ code: 'cacahuate', severity: 'severe' }], healthConditions: [] }
    })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.account-plan-active')).toBeTruthy()
    expect(root.textContent).toMatch(/vegan/)
    expect(root.querySelector('a[href="preferences.html"]').textContent).toMatch(/[Ee]ditar preferencias/)
    expect(root.querySelector('.account-upsell')).toBeNull()
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

  it('el total de escaneos y alertas activas es 0 si el perfil no tiene usage/preferences todavía (recién creado)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'pending' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    const nums = Array.from(root.querySelectorAll('.stat-num')).map(el => el.textContent)
    expect(nums).toEqual(['0', '0'])
  })

  it('envuelve todo el contenido en un único .content-card, no en cards sueltas (hallazgo de reskin visual)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'pending' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelectorAll(':scope > .content-card').length).toBe(1)
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

  it('deja el botón en su texto original y habilitado si el pago responde no-ok, en vez de trabado en "Procesando…"', async () => {
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'expired' })
    document.body.innerHTML = '<div id="account-root"></div><button id="btn-renew-membership">Renovar membresía</button><p id="account-renew-error" class="hidden"></p>'

    await expect(handleRenewMembership()).rejects.toThrow()

    const btn = document.getElementById('btn-renew-membership')
    expect(btn.textContent).not.toMatch(/Procesando/)
    expect(btn.textContent).toBe('Renovar membresía')
    expect(btn.disabled).toBe(false)
    expect(syncUserProfile).not.toHaveBeenCalled()
    const errorEl = document.getElementById('account-renew-error')
    expect(errorEl.classList.contains('hidden')).toBe(false)
    expect(errorEl.textContent).toMatch(/No se pudo procesar el pago/)
  })

  it('deja el botón en su texto original y habilitado si el fetch rechaza (error de red)', async () => {
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'expired' })
    document.body.innerHTML = '<div id="account-root"></div><button id="btn-renew-membership">Renovar membresía</button><p id="account-renew-error" class="hidden"></p>'

    await expect(handleRenewMembership()).rejects.toThrow('network down')

    const btn = document.getElementById('btn-renew-membership')
    expect(btn.textContent).not.toMatch(/Procesando/)
    expect(btn.textContent).toBe('Renovar membresía')
    expect(btn.disabled).toBe(false)
    expect(syncUserProfile).not.toHaveBeenCalled()
  })
})

describe('toggle de edición + submitNameEdit', () => {
  it('el botón "Editar mis datos" muestra la sección oculta al hacer click', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    const section = document.getElementById('account-edit-section')
    expect(section.classList.contains('hidden')).toBe(true)
    document.getElementById('btn-toggle-edit').click()
    expect(section.classList.contains('hidden')).toBe(false)
  })

  it('precarga el nombre actual en el input (profile.profile.displayName)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', profile: { displayName: 'Ana Ruiz' } })
    renderAccountHub()
    expect(document.getElementById('input-edit-name').value).toBe('Ana Ruiz')
  })

  it('submitNameEdit rechaza un nombre vacío sin llamar a fetch', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    global.fetch = vi.fn()
    document.getElementById('input-edit-name').value = '   '
    await expect(submitNameEdit()).rejects.toThrow()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('submitNameEdit llama PUT /api/me/profile con el nombre y re-sincroniza', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    document.getElementById('input-edit-name').value = 'Ana Ruiz'

    await submitNameEdit()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/me/profile')
    expect(options.method).toBe('PUT')
    expect(JSON.parse(options.body)).toEqual({ displayName: 'Ana Ruiz' })
    expect(syncUserProfile).toHaveBeenCalled()
  })

  it('submitNameEdit muestra error y no re-sincroniza si el PUT falla', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    document.getElementById('input-edit-name').value = 'Ana Ruiz'

    await expect(submitNameEdit()).rejects.toThrow()

    expect(syncUserProfile).not.toHaveBeenCalled()
    const errorEl = document.getElementById('edit-name-error')
    expect(errorEl.classList.contains('hidden')).toBe(false)
  })
})

describe('sub-form Teléfono — cuenta CON email (contacto, sin SMS)', () => {
  it('renderiza un solo input + botón Guardar cuando profile.email existe', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    expect(document.getElementById('input-edit-phone-contact')).toBeTruthy()
    expect(document.getElementById('phone-login-flow')).toBeNull()
  })

  it('submitPhoneContactEdit llama PUT /api/me/profile con { phone } y re-sincroniza', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
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

describe('sub-form Teléfono — cuenta SIN email (phone-login, requiere SMS)', () => {
  it('renderiza el flujo de 2 pasos (enviar código / confirmar) cuando no hay profile.email', () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    renderAccountHub()
    expect(document.getElementById('phone-login-flow')).toBeTruthy()
    expect(document.getElementById('input-edit-phone-contact')).toBeNull()
  })

  it('submitPhoneSendCode llama /api/auth/phone/send con el número nuevo', async () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    renderAccountHub()
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

  it('submitPhoneChangeConfirm muestra "phone_in_use" de forma legible si el 409 ocurre', async () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    renderAccountHub()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'phone_in_use' }) })
    document.getElementById('input-new-phone').value = '+525512345678'
    document.getElementById('input-phone-code').value = '123456'

    await expect(submitPhoneChangeConfirm()).rejects.toThrow()

    expect(syncUserProfile).not.toHaveBeenCalled()
    const errorEl = document.getElementById('edit-phone-error')
    expect(errorEl.textContent).toMatch(/ya está en uso/)
  })
})

describe('sub-form Correo', () => {
  it('renderiza el input de correo nuevo + input de contraseña actual para reautenticar', () => {
    getCachedProfile.mockReturnValue({ email: 'old@example.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'old@example.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    expect(document.getElementById('input-edit-email')).toBeTruthy()
    expect(document.getElementById('input-email-current-password')).toBeTruthy()
  })

  it('submitEmailEdit reautentica y llama verifyBeforeUpdateEmail, muestra el mensaje de "revisa tu correo"', async () => {
    getCachedProfile.mockReturnValue({ email: 'old@example.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'old@example.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
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
    reauthenticateWithCredential.mockRejectedValue({ code: 'auth/wrong-password' })
    document.getElementById('input-edit-email').value = 'new@example.com'
    document.getElementById('input-email-current-password').value = 'wrong'

    await expect(submitEmailEdit()).rejects.toBeTruthy()

    expect(verifyBeforeUpdateEmail).not.toHaveBeenCalled()
    const errorEl = document.getElementById('edit-email-error')
    expect(errorEl.classList.contains('hidden')).toBe(false)
  })

  it('NO se renderiza para una cuenta sin provider password (Google o phone-login)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'google.com' }] }
    renderAccountHub()
    expect(document.getElementById('form-edit-email')).toBeNull()
  })
})

describe('sub-form Contraseña', () => {
  it('se renderiza cuando el provider incluye password', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
    expect(document.getElementById('form-edit-password')).toBeTruthy()
  })

  it('NO se renderiza para una cuenta Google (sin provider password)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'google.com' }] }
    renderAccountHub()
    expect(document.getElementById('form-edit-password')).toBeNull()
  })

  it('submitPasswordEdit rechaza si nueva y confirmar no coinciden, sin llamar a Firebase', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    mockAuth.currentUser = { email: 'a@b.com', providerData: [{ providerId: 'password' }] }
    renderAccountHub()
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
    reauthenticateWithCredential.mockRejectedValue({ code: 'auth/wrong-password' })
    document.getElementById('input-current-password').value = 'wrong'
    document.getElementById('input-new-password').value = 'new12345'
    document.getElementById('input-confirm-password').value = 'new12345'

    await expect(submitPasswordEdit()).rejects.toBeTruthy()

    expect(updatePassword).not.toHaveBeenCalled()
  })
})
