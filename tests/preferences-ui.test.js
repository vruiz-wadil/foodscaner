/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getIdToken = vi.fn()
const getCachedProfile = vi.fn()
const syncUserProfile = vi.fn()

vi.mock('../authClient.js', () => ({ getIdToken, getCachedProfile, syncUserProfile }))

let loadPreferencesIntoForm, savePreferences, deletePreferences

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  global.fetch = vi.fn()
  document.body.innerHTML = `
    <form id="preferences-form">
      <input type="checkbox" name="dietary" value="vegan">
      <input type="checkbox" name="dietary" value="glutenFree">
      <input type="checkbox" name="healthConditions" value="diabet">
      <input type="checkbox" id="allergen-cacahuate" name="allergen" value="cacahuate">
      <select id="severity-cacahuate"><option value="mild">Leve</option><option value="severe">Severa</option></select>
      <div class="consent-block">
        <input type="checkbox" id="consent-checkbox" required>
        <p id="consent-error" class="hidden" role="alert"></p>
      </div>
      <button type="submit" id="btn-save-preferences">Guardar</button>
    </form>
    <button id="btn-delete-preferences">Borrar mis preferencias</button>
    <p id="preferences-error" class="hidden" role="alert"></p>
  `
  const mod = await import('../preferences-ui.js')
  loadPreferencesIntoForm = mod.loadPreferencesIntoForm
  savePreferences = mod.savePreferences
  deletePreferences = mod.deletePreferences
})

describe('loadPreferencesIntoForm', () => {
  it('marca los checkboxes según el perfil cacheado', () => {
    getCachedProfile.mockReturnValue({
      plan: 'premium',
      preferences: { dietary: ['vegan'], allergens: [{ code: 'cacahuate', severity: 'severe' }], healthConditions: ['diabet'] }
    })
    loadPreferencesIntoForm()
    expect(document.querySelector('[name="dietary"][value="vegan"]').checked).toBe(true)
    expect(document.querySelector('[name="dietary"][value="glutenFree"]').checked).toBe(false)
    expect(document.querySelector('[name="healthConditions"][value="diabet"]').checked).toBe(true)
    expect(document.getElementById('allergen-cacahuate').checked).toBe(true)
    expect(document.getElementById('severity-cacahuate').value).toBe('severe')
  })

  it('no marca nada si no hay preferences aún (usuario premium sin configurar)', () => {
    getCachedProfile.mockReturnValue({ plan: 'premium' })
    loadPreferencesIntoForm()
    expect(document.querySelector('[name="dietary"][value="vegan"]').checked).toBe(false)
  })
})

describe('savePreferences', () => {
  it('rechaza guardar si el checkbox de consentimiento no está marcado, y muestra el error JUNTO al checkbox (hallazgo UX: antes solo aparecía en #preferences-error, lejos si el form es largo)', async () => {
    document.getElementById('consent-checkbox').checked = false
    await expect(savePreferences()).rejects.toThrow(/consentimiento/i)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(document.getElementById('consent-error').classList.contains('hidden')).toBe(false)
  })

  it('llama PUT /api/me/preferences con Bearer token, consent:true y el body construido del form, si hay consentimiento (hallazgo legal/seguridad: el servidor ahora exige consent explícito, no solo el cliente)', async () => {
    document.getElementById('consent-checkbox').checked = true
    document.querySelector('[name="dietary"][value="vegan"]').checked = true
    document.getElementById('allergen-cacahuate').checked = true
    document.getElementById('severity-cacahuate').value = 'severe'
    document.querySelector('[name="healthConditions"][value="diabet"]').checked = true
    getIdToken.mockResolvedValue('tok-123')
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    await savePreferences()

    expect(global.fetch).toHaveBeenCalledWith('/api/me/preferences', {
      method: 'PUT',
      headers: { Authorization: 'Bearer tok-123', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dietary: ['vegan'],
        allergens: [{ code: 'cacahuate', severity: 'severe' }],
        healthConditions: ['diabet'],
        consent: true,
        consentNoticeVersion: 'v1'
      })
    })
  })

  it('muestra el error del backend cuando PUT falla (ej. 403 premium_required)', async () => {
    document.getElementById('consent-checkbox').checked = true
    getIdToken.mockResolvedValue('tok-123')
    global.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'premium_required' }) })

    await expect(savePreferences()).rejects.toThrow()
    expect(document.getElementById('preferences-error').classList.contains('hidden')).toBe(false)
  })

  it('deshabilita el botón de guardar mientras dura la petición (hallazgo UX)', async () => {
    document.getElementById('consent-checkbox').checked = true
    let resolveFetch
    getIdToken.mockResolvedValue('tok-123')
    global.fetch.mockReturnValueOnce(new Promise(resolve => { resolveFetch = resolve }))
    const btn = document.getElementById('btn-save-preferences')
    const promise = savePreferences()
    expect(btn.disabled).toBe(true)
    resolveFetch({ ok: true, json: async () => ({ ok: true }) })
    await promise
    expect(btn.disabled).toBe(false)
  })
})

describe('deletePreferences', () => {
  it('llama DELETE /api/me/preferences con Bearer token', async () => {
    getIdToken.mockResolvedValue('tok-456')
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    await deletePreferences()

    expect(global.fetch).toHaveBeenCalledWith('/api/me/preferences', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok-456' }
    })
  })
})
