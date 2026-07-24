# Rediseño UX de edición de datos en "Mi cuenta" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4-stacked-forms-with-4-save-buttons edit UI in "Mi cuenta" with read-only rows (nombre/teléfono/correo) that open an inline single-field editor (pencil → input + ✔/✖) for simple fields, and a shared modal for multi-step/sensitive changes (correo, teléfono vía SMS, contraseña).

**Architecture:** Single-file rewrite of `account-ui.js` (no new files, no new endpoints). A module-level `editingRow` variable (`'name' | 'phone' | null`) tracks which row — if any — is showing its inline editor; only name and phone-with-email-login use this (both are single-field, no-reauth saves). Everything else (email change, phone change when login is by SMS, password change) opens a generic modal built with the `.modal`/`.modal-overlay`/`.modal-content`/`.modal-close` CSS classes already defined in `styles.css` (used today by the OCR/nutrition/report modals in `app.js` — same visual language, new minimal JS helper local to `account-ui.js` since `app.js` is a classic script not loaded on `account.html` and isn't importable).

**Tech Stack:** Vanilla JS ES modules, Vitest + jsdom for tests, existing CSS variables (`--ink`, `--ink-3`, `--border`, etc.) from `styles.css`/`home.css`.

## Global Constraints

- No backend/endpoint changes. `PUT /api/me/profile`, `POST /api/auth/phone/send`, `POST /api/me/phone/change`, Firebase `reauthenticateWithCredential`/`verifyBeforeUpdateEmail`/`updatePassword` calls keep their exact existing request shapes and call sites (only the DOM around them changes).
- Only one inline row editor open at a time (`editingRow` is a single value, not a set).
- Only one modal open at a time (opening a new one closes any previous one first).
- The "Editar mis datos" toggle button and `#account-edit-section` wrapper are removed — rows are always visible.
- User-controlled string values interpolated into new templates (`displayName`, `phoneNumber`/`phone`, `email`) must go through a new `escapeHtml()` helper — the existing code already interpolates these raw into `innerHTML`/attribute strings elsewhere in this file, but since this task rewrites those exact lines, fix it here rather than carry the risk into the new markup.
- Every existing exported function name stays the same: `renderAccountHub`, `handleLogout`, `computeAlertsActive`, `handleRenewMembership`, `submitNameEdit`, `submitPhoneContactEdit`, `submitPhoneSendCode`, `submitPhoneChangeConfirm`, `submitEmailEdit`, `submitPasswordEdit`. Tests and any other importers rely on these exact names.

---

### Task 1: Rewrite `account-ui.js` edit UI + CSS + tests

**Files:**
- Modify: `account-ui.js` (full rewrite of the render/edit portion, lines ~1-390)
- Modify: `home.css` (new rows/inline-editor CSS, appended near the existing `.row-card`/`.account-summary` rules around line 552)
- Modify: `tests/account-ui.test.js` (full rewrite of the edit-related describe blocks)

**Interfaces:**
- Consumes: `getIdToken`, `getCachedProfile`, `syncUserProfile` from `./authClient.js`; `firebaseAuth`, `signOut`, `reauthenticateWithCredential`, `verifyBeforeUpdateEmail`, `updatePassword`, `EmailAuthProvider` from `./firebase-init.js`; `mapAuthError` from `./authErrors.js` — all unchanged imports.
- Produces: same exported function names as today (see Global Constraints) with unchanged signatures (all zero-arg). No new exports needed by other files.

- [ ] **Step 1: Update the test file to match the new DOM/behavior (RED)**

Replace `tests/account-ui.test.js` in full with:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail against current code**

Run: `npx vitest run tests/account-ui.test.js`
Expected: FAIL — most new tests fail because `#btn-edit-name`, `#account-data-value`, `#btn-open-phone-modal`, `#btn-edit-email`, `#btn-open-password-modal` etc. don't exist yet in the current `account-ui.js` markup.

- [ ] **Step 3: Add CSS for the new rows and reuse the existing modal classes**

In `home.css`, right after the existing rule at line 552 (`.account-summary, .account-empty { ... }`), insert:

```css
/* Filas de "Mis datos" en Mi cuenta — reemplaza el bloque de 4 forms
   apilados con 4 botones "Guardar" simultáneos (hallazgo UX). Nombre y
   teléfono (cuando el login es por correo) se editan inline aquí mismo;
   correo, teléfono-por-SMS y contraseña abren el modal genérico (reusa
   .modal/.modal-content ya definidos en styles.css para los modales de
   OCR/nutrición/reporte). */
.account-data-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 0;
  border-top: 1px solid var(--border);
}
.account-data-row:first-child { border-top: none; padding-top: 0; }

.account-data-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.account-data-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--ink-3); }
.account-data-value {
  font-size: 0.95rem;
  color: var(--ink);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-data-row-editing { gap: 8px; }
.account-data-row-editing .form-input { flex: 1; margin: 0; }

.row-icon-btn {
  flex-shrink: 0;
  background: none;
  border: none;
  font-size: 1.1rem;
  padding: 4px 8px;
  cursor: pointer;
  line-height: 1;
}

.account-password-row { justify-content: flex-start; padding-top: 14px; }
.account-link-btn { color: var(--ink); font-weight: 600; text-decoration: underline; cursor: pointer; background: none; border: none; padding: 0; font-size: 0.9rem; }
```

- [ ] **Step 4: Rewrite `account-ui.js`**

Replace the full file content with:

```js
import { firebaseAuth, signOut, reauthenticateWithCredential, verifyBeforeUpdateEmail, updatePassword, EmailAuthProvider } from './firebase-init.js';
import { getIdToken, getCachedProfile, syncUserProfile } from './authClient.js';
import { mapAuthError } from './authErrors.js';

// Suma de ítems declarados por el usuario — sin backend nuevo, se deriva
// del perfil ya cacheado. Para free (sin preferences) siempre 0.
export function computeAlertsActive(prefs) {
  if (!prefs) return 0;
  return (prefs.dietary || []).length + (prefs.allergens || []).length + (prefs.healthConditions || []).length;
}

const PROFILE_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d="M17.4167 19.25V17.4167C17.4167 16.4442 17.0304 15.5116 16.3428 14.8239C15.6551 14.1363 14.7225 13.75 13.75 13.75H8.25004C7.27758 13.75 6.34495 14.1363 5.65732 14.8239C4.96968 15.5116 4.58337 16.4442 4.58337 17.4167V19.25" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 10.0833C13.0251 10.0833 14.6667 8.44171 14.6667 6.41667C14.6667 4.39162 13.0251 2.75 11 2.75C8.975 2.75 7.33337 4.39162 7.33337 6.41667C7.33337 8.44171 8.975 10.0833 11 10.0833Z" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const BADGE_LABEL = { active: 'Activa', pending: 'Pendiente', expired: 'Expirada' };

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hasPasswordProvider() {
  const user = firebaseAuth.currentUser;
  return !!(user && Array.isArray(user.providerData) && user.providerData.some(p => p.providerId === 'password'));
}

// Solo una fila (nombre o teléfono-con-email) puede estar en edición inline
// a la vez — correo/teléfono-SMS/contraseña son multi-paso y usan el modal
// en su lugar, así que no compiten por este estado.
let editingRow = null; // 'name' | 'phone' | null

function renderNameRow(displayName) {
  if (editingRow === 'name') {
    return `
      <div class="account-data-row account-data-row-editing" data-row="name">
        <input id="input-edit-name" class="form-input" type="text" value="${escapeHtml(displayName)}">
        <button type="button" id="btn-save-name" class="row-icon-btn" aria-label="Guardar nombre">✔️</button>
        <button type="button" id="btn-cancel-name" class="row-icon-btn" aria-label="Cancelar edición de nombre">✖️</button>
      </div>
      <p id="edit-name-error" class="hidden modal-inline-error" role="alert"></p>
    `;
  }
  return `
    <div class="account-data-row" data-row="name">
      <div class="account-data-info">
        <div class="account-data-label">Nombre</div>
        <div class="account-data-value">${escapeHtml(displayName) || 'Sin nombre'}</div>
      </div>
      <button type="button" id="btn-edit-name" class="row-icon-btn" aria-label="Editar nombre">✏️</button>
    </div>
  `;
}

function renderPhoneRow(profile, phoneContact) {
  const hasEmailLogin = !!profile.email;

  if (!hasEmailLogin) {
    // Login por teléfono: cambiar el número real requiere verificar un
    // código SMS (2 pasos), así que va al modal en vez de edición inline.
    return `
      <div class="account-data-row" data-row="phone">
        <div class="account-data-info">
          <div class="account-data-label">Teléfono</div>
          <div class="account-data-value">${escapeHtml(phoneContact)}</div>
        </div>
        <button type="button" id="btn-open-phone-modal" class="row-icon-btn" aria-label="Cambiar teléfono">✏️</button>
      </div>
    `;
  }

  if (editingRow === 'phone') {
    return `
      <div class="account-data-row account-data-row-editing" data-row="phone">
        <input id="input-edit-phone-contact" class="form-input" type="tel" value="${escapeHtml(phoneContact)}">
        <button type="button" id="btn-save-phone" class="row-icon-btn" aria-label="Guardar teléfono">✔️</button>
        <button type="button" id="btn-cancel-phone" class="row-icon-btn" aria-label="Cancelar edición de teléfono">✖️</button>
      </div>
      <p id="edit-phone-error" class="hidden modal-inline-error" role="alert"></p>
    `;
  }
  return `
    <div class="account-data-row" data-row="phone">
      <div class="account-data-info">
        <div class="account-data-label">Teléfono</div>
        <div class="account-data-value">${escapeHtml(phoneContact) || 'Sin teléfono'}</div>
      </div>
      <button type="button" id="btn-edit-phone" class="row-icon-btn" aria-label="Editar teléfono">✏️</button>
    </div>
  `;
}

function renderEmailRow(profile) {
  return `
    <div class="account-data-row" data-row="email">
      <div class="account-data-info">
        <div class="account-data-label">Correo</div>
        <div class="account-data-value">${escapeHtml(profile.email)}</div>
      </div>
      <button type="button" id="btn-edit-email" class="row-icon-btn" aria-label="Editar correo">✏️</button>
    </div>
  `;
}

export function renderAccountHub() {
  const profile = getCachedProfile();
  const root = document.getElementById('account-root');
  if (!root) return;

  if (!profile) {
    window.location.href = 'auth.html';
    return;
  }

  const status = profile.membershipStatus;
  const isActive = status === 'active';
  const prefs = profile.preferences;
  const hasPrefs = prefs && ((prefs.dietary || []).length || (prefs.allergens || []).length || (prefs.healthConditions || []).length);
  const totalScans = (profile.usage && profile.usage.totalScans) || 0;
  const alertsActive = computeAlertsActive(prefs);
  const displayName = (profile.profile && profile.profile.displayName) || profile.displayName || '';
  const phoneContact = profile.phoneNumber || (profile.profile && profile.profile.phone) || '';

  const summaryHtml = hasPrefs
    ? `<p class="account-summary">Tu perfil: ${[...(prefs.dietary || []), ...(prefs.allergens || []).map(a => a.code), ...(prefs.healthConditions || [])].join(', ')}</p>`
    : '<p class="account-empty">Aún no configuraste tus preferencias.</p>';

  const renewCta = status === 'expired'
    ? { text: 'Tu membresía venció. Renuévala para seguir escaneando y guardar tu historial.', btn: 'Renovar membresía' }
    : { text: 'Completa tu membresía para desbloquear el escaneo de ingredientes.', btn: 'Activar membresía' };

  root.innerHTML = `
    <div class="content-card">
      <div class="hero-card-dark">
        <div class="icon-wrap">${PROFILE_ICON_SVG}</div>
        <div>
          <p class="account-email">${escapeHtml(profile.email || profile.phoneNumber || '')}</p>
          <span class="account-plan-badge account-plan-${status}">${BADGE_LABEL[status] || 'Pendiente'}</span>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat-tile"><div class="stat-num">${totalScans}</div><div class="stat-label">Escaneos</div></div>
        <div class="stat-tile"><div class="stat-num">${alertsActive}</div><div class="stat-label">Alertas activas</div></div>
      </div>
      <div class="row-card">
        ${summaryHtml}
        <a href="preferences.html" class="btn btn-secondary">Editar preferencias</a>
      </div>
      ${!isActive ? `
        <div class="row-card account-renew">
          <div class="icon-wrap" style="background:rgba(245,166,35,0.15);">🔔</div>
          <div>
            <p class="about-text">${renewCta.text}</p>
            <button type="button" id="btn-renew-membership" class="btn btn-primary">${renewCta.btn}</button>
            <p id="account-renew-error" class="hidden"></p>
          </div>
        </div>` : ''}
      <div class="account-data-section">
        ${renderNameRow(displayName)}
        ${renderPhoneRow(profile, phoneContact)}
        ${hasPasswordProvider() ? renderEmailRow(profile) : ''}
        ${hasPasswordProvider() ? `
          <div class="account-data-row account-password-row">
            <button type="button" id="btn-open-password-modal" class="account-link-btn">Cambiar contraseña</button>
          </div>` : ''}
      </div>
      <button type="button" id="btn-logout" class="btn btn-secondary">Cerrar sesión</button>
    </div>
  `;

  wireAccountHubEvents(profile);
}

function wireAccountHubEvents(profile) {
  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
  document.getElementById('btn-renew-membership')?.addEventListener('click', () => {
    handleRenewMembership().catch(() => {});
  });

  document.getElementById('btn-edit-name')?.addEventListener('click', () => {
    editingRow = 'name';
    renderAccountHub();
  });
  document.getElementById('btn-cancel-name')?.addEventListener('click', () => {
    editingRow = null;
    renderAccountHub();
  });
  document.getElementById('btn-save-name')?.addEventListener('click', () => {
    submitNameEdit().catch(() => {});
  });

  document.getElementById('btn-edit-phone')?.addEventListener('click', () => {
    editingRow = 'phone';
    renderAccountHub();
  });
  document.getElementById('btn-cancel-phone')?.addEventListener('click', () => {
    editingRow = null;
    renderAccountHub();
  });
  document.getElementById('btn-save-phone')?.addEventListener('click', () => {
    submitPhoneContactEdit().catch(() => {});
  });
  document.getElementById('btn-open-phone-modal')?.addEventListener('click', () => {
    openPhoneChangeModal();
  });

  document.getElementById('btn-edit-email')?.addEventListener('click', () => {
    openEmailModal(profile);
  });
  document.getElementById('btn-open-password-modal')?.addEventListener('click', () => {
    openPasswordModal();
  });
}

// === Modal genérico (correo / teléfono-SMS / contraseña) ===
// app.js ya tiene un helper equivalente (openModalA11y/closeModalA11y,
// compartido por los modales de OCR/nutrición/reporte) pero app.js es un
// script clásico que scan.html carga y account.html no — no es importable
// desde este módulo, así que account-ui.js tiene su propia copia mínima,
// reusando las mismas clases CSS (.modal/.modal-content/...) de styles.css.
let _lastFocusedBeforeModal = null;

function trapModalTabKey(e) {
  if (e.key !== 'Tab') return;
  const modalEl = e.currentTarget;
  const focusable = Array.from(modalEl.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function openModal(innerHtml) {
  closeModal();
  const modalEl = document.createElement('div');
  modalEl.id = 'account-modal';
  modalEl.className = 'modal';
  modalEl.innerHTML = `<div class="modal-overlay"></div><div class="modal-content">${innerHtml}</div>`;
  document.body.appendChild(modalEl);

  modalEl.querySelector('.modal-overlay').addEventListener('click', closeModal);
  modalEl.querySelector('.modal-close')?.addEventListener('click', closeModal);

  _lastFocusedBeforeModal = document.activeElement;
  const heading = modalEl.querySelector('h2, h3');
  if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); }
  modalEl._escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  modalEl.addEventListener('keydown', modalEl._escHandler);
  modalEl.addEventListener('keydown', trapModalTabKey);

  return modalEl;
}

function closeModal() {
  const modalEl = document.getElementById('account-modal');
  if (!modalEl) return;
  modalEl.removeEventListener('keydown', trapModalTabKey);
  if (modalEl._escHandler) modalEl.removeEventListener('keydown', modalEl._escHandler);
  modalEl.remove();
  if (_lastFocusedBeforeModal && typeof _lastFocusedBeforeModal.focus === 'function') {
    _lastFocusedBeforeModal.focus();
  }
  _lastFocusedBeforeModal = null;
}

function openPhoneChangeModal() {
  openModal(`
    <div class="modal-header"><h2>Cambiar teléfono</h2><button type="button" class="modal-close" aria-label="Cerrar">×</button></div>
    <div id="phone-login-flow">
      <div class="form-field">
        <label for="input-new-phone">Nuevo número</label>
        <input id="input-new-phone" class="form-input" type="tel" placeholder="+525512345678">
      </div>
      <button type="button" id="btn-phone-send-code" class="btn btn-secondary">Enviar código</button>
      <div class="form-field">
        <label for="input-phone-code">Código de verificación</label>
        <input id="input-phone-code" class="form-input" type="text" inputmode="numeric" maxlength="6">
      </div>
      <button type="button" id="btn-phone-confirm-change" class="btn btn-primary">Confirmar cambio</button>
    </div>
    <p id="edit-phone-error" class="hidden modal-inline-error" role="alert"></p>
  `);
  document.getElementById('btn-phone-send-code')?.addEventListener('click', () => {
    submitPhoneSendCode().catch(() => {});
  });
  document.getElementById('btn-phone-confirm-change')?.addEventListener('click', () => {
    submitPhoneChangeConfirm().then(() => closeModal()).catch(() => {});
  });
}

function openEmailModal(profile) {
  openModal(`
    <div class="modal-header"><h2>Cambiar correo</h2><button type="button" class="modal-close" aria-label="Cerrar">×</button></div>
    <form id="form-edit-email">
      <div class="form-field">
        <label for="input-edit-email">Correo nuevo</label>
        <input id="input-edit-email" class="form-input" type="email" placeholder="${escapeHtml(profile.email)}">
      </div>
      <div class="form-field">
        <label for="input-email-current-password">Confirma tu contraseña actual</label>
        <input id="input-email-current-password" class="form-input" type="password">
      </div>
      <button type="submit" class="btn btn-primary">Guardar correo</button>
      <p id="edit-email-error" class="hidden modal-inline-error" role="alert"></p>
      <p id="edit-email-success" class="hidden" role="status"></p>
    </form>
  `);
  document.getElementById('form-edit-email')?.addEventListener('submit', e => {
    e.preventDefault();
    submitEmailEdit().catch(() => {});
  });
}

function openPasswordModal() {
  openModal(`
    <div class="modal-header"><h2>Cambiar contraseña</h2><button type="button" class="modal-close" aria-label="Cerrar">×</button></div>
    <form id="form-edit-password">
      <div class="form-field">
        <label for="input-current-password">Contraseña actual</label>
        <input id="input-current-password" class="form-input" type="password">
      </div>
      <div class="form-field">
        <label for="input-new-password">Nueva contraseña</label>
        <input id="input-new-password" class="form-input" type="password" minlength="6">
      </div>
      <div class="form-field">
        <label for="input-confirm-password">Confirmar nueva contraseña</label>
        <input id="input-confirm-password" class="form-input" type="password" minlength="6">
      </div>
      <button type="submit" class="btn btn-primary">Guardar contraseña</button>
      <p id="edit-password-error" class="hidden modal-inline-error" role="alert"></p>
      <p id="edit-password-success" class="hidden" role="status"></p>
    </form>
  `);
  document.getElementById('form-edit-password')?.addEventListener('submit', e => {
    e.preventDefault();
    submitPasswordEdit().catch(() => {});
  });
}

function showRenewError(message) {
  const el = document.getElementById('account-renew-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function handleRenewMembership() {
  const btn = document.getElementById('btn-renew-membership');
  const originalText = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Procesando…'; }
  try {
    const token = await getIdToken();
    const res = await fetch('/api/me/membership/pay', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error('renew_failed');
    }
    await syncUserProfile();
    renderAccountHub();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    showRenewError('No se pudo procesar el pago. Intenta de nuevo.');
    console.warn('[account] no se pudo renovar la membresía:', err.message);
    throw err;
  }
}

function showNameError(message) {
  const el = document.getElementById('edit-name-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function submitNameEdit() {
  const input = document.getElementById('input-edit-name');
  const name = input ? input.value.trim() : '';
  const errorEl = document.getElementById('edit-name-error');
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
  if (!name) {
    showNameError('Escribe tu nombre.');
    throw new Error('invalid_display_name');
  }
  const token = await getIdToken();
  const res = await fetch('/api/me/profile', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: name })
  });
  if (!res.ok) {
    showNameError('No se pudo guardar tu nombre. Intenta de nuevo.');
    throw new Error('save_failed');
  }
  editingRow = null;
  await syncUserProfile();
  renderAccountHub();
}

function showPhoneError(message) {
  const el = document.getElementById('edit-phone-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function submitPhoneContactEdit() {
  const input = document.getElementById('input-edit-phone-contact');
  const phone = input ? input.value.trim() : '';
  const token = await getIdToken();
  const res = await fetch('/api/me/profile', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  if (!res.ok) {
    showPhoneError('No se pudo guardar tu teléfono. Intenta de nuevo.');
    throw new Error('save_failed');
  }
  editingRow = null;
  await syncUserProfile();
  renderAccountHub();
}

export async function submitPhoneSendCode() {
  const input = document.getElementById('input-new-phone');
  const phone = input ? input.value.trim() : '';
  const res = await fetch('/api/auth/phone/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  if (!res.ok) {
    showPhoneError('No se pudo enviar el código. Intenta de nuevo.');
    throw new Error('send_failed');
  }
}

const PHONE_CHANGE_ERROR_MESSAGES = {
  invalid_code: 'Código incorrecto o expirado.',
  phone_in_use: 'Ese número ya está en uso por otra cuenta.',
  verify_failed: 'No se pudo verificar el código. Intenta más tarde.'
};

export async function submitPhoneChangeConfirm() {
  const phoneInput = document.getElementById('input-new-phone');
  const codeInput = document.getElementById('input-phone-code');
  const phone = phoneInput ? phoneInput.value.trim() : '';
  const code = codeInput ? codeInput.value.trim() : '';
  const token = await getIdToken();
  const res = await fetch('/api/me/phone/change', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    showPhoneError(PHONE_CHANGE_ERROR_MESSAGES[data.error] || 'No se pudo cambiar tu teléfono. Intenta de nuevo.');
    throw new Error(data.error || 'change_failed');
  }
  await syncUserProfile();
  renderAccountHub();
}

function showEmailError(message) {
  const el = document.getElementById('edit-email-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function showEmailSuccess(message) {
  const el = document.getElementById('edit-email-success');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function submitEmailEdit() {
  const emailInput = document.getElementById('input-edit-email');
  const passwordInput = document.getElementById('input-email-current-password');
  const newEmail = emailInput ? emailInput.value.trim() : '';
  const currentPassword = passwordInput ? passwordInput.value : '';
  const errorEl = document.getElementById('edit-email-error');
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }

  const user = firebaseAuth.currentUser;
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  } catch (err) {
    showEmailError(mapAuthError(err.code));
    throw err;
  }

  try {
    await verifyBeforeUpdateEmail(user, newEmail);
    showEmailSuccess('Revisa tu correo nuevo y confirma el cambio desde ahí.');
  } catch (err) {
    showEmailError(mapAuthError(err.code));
    throw err;
  }
}

function showPasswordError(message) {
  const el = document.getElementById('edit-password-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function submitPasswordEdit() {
  const currentInput = document.getElementById('input-current-password');
  const newInput = document.getElementById('input-new-password');
  const confirmInput = document.getElementById('input-confirm-password');
  const currentPassword = currentInput ? currentInput.value : '';
  const newPassword = newInput ? newInput.value : '';
  const confirmPassword = confirmInput ? confirmInput.value : '';
  const errorEl = document.getElementById('edit-password-error');
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }

  if (newPassword !== confirmPassword) {
    showPasswordError('Las contraseñas nuevas no coinciden.');
    throw new Error('password_mismatch');
  }

  const user = firebaseAuth.currentUser;
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  } catch (err) {
    showPasswordError(mapAuthError(err.code));
    throw err;
  }

  try {
    await updatePassword(user, newPassword);
    const successEl = document.getElementById('edit-password-success');
    if (successEl) { successEl.textContent = 'Tu contraseña se actualizó correctamente.'; successEl.classList.remove('hidden'); }
  } catch (err) {
    showPasswordError(mapAuthError(err.code));
    throw err;
  }
}

export async function handleLogout() {
  await signOut(firebaseAuth);
  window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', async () => {
  await syncUserProfile();
  renderAccountHub();
});
```

- [ ] **Step 5: Run the test file again to confirm it's green**

Run: `npx vitest run tests/account-ui.test.js`
Expected: PASS, all tests green.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS for all suites except the pre-existing, unrelated `tests/e2e/scan-cycle.spec.js` Playwright-config failure (known, out of scope).

- [ ] **Step 7: Commit**

```bash
git add account-ui.js home.css tests/account-ui.test.js
git commit -m "refactor(account): edición inline por fila + modal para cambios sensibles

Reemplaza el bloque de 4 forms apilados (cada uno con su botón Guardar
visible a la vez) por filas de solo lectura con lápiz — nombre y
teléfono (login por correo) editan inline; correo, teléfono por SMS y
contraseña abren un modal (reusa .modal de styles.css)."
```
