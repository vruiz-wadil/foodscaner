/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getIdToken = vi.fn()
const getCachedProfile = vi.fn()
const syncUserProfile = vi.fn()

vi.mock('../authClient.js', () => ({ getIdToken, getCachedProfile, syncUserProfile }))

let loadPreferencesIntoForm, savePreferences, deletePreferences, setupPreferenceTiles, continueOnboardingPreferences, skipOnboardingPreferences

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  global.fetch = vi.fn()
  document.body.innerHTML = `
    <form id="preferences-form">
      <div id="dietary-tiles">
        <button type="button" data-dietary="vegan">Vegano</button>
        <button type="button" data-dietary="glutenFree">Sin gluten</button>
      </div>
      <div id="health-tiles">
        <button type="button" data-health="diabet">Diabetes</button>
      </div>
      <div id="allergen-tiles">
        <button type="button" id="allergen-cacahuate" data-allergen="cacahuate">Cacahuate</button>
      </div>
      <div class="severity-toggle hidden" id="severity-cacahuate" role="radiogroup">
        <button type="button" data-severity="mild" role="radio" aria-checked="false">Aviso</button>
        <button type="button" data-severity="severe" role="radio" aria-checked="false">Estricto</button>
      </div>
      <div class="consent-block">
        <input type="checkbox" id="consent-checkbox" required>
        <p id="consent-error" class="hidden" role="alert"></p>
      </div>
      <button type="submit" id="btn-save-preferences">Guardar</button>
    </form>
    <button id="btn-delete-preferences">Borrar mis preferencias</button>
    <p id="preferences-error" class="hidden" role="alert"></p>
    <p id="preferences-success" class="hidden" role="status"></p>
  `
  const mod = await import('../preferences-ui.js')
  loadPreferencesIntoForm = mod.loadPreferencesIntoForm
  savePreferences = mod.savePreferences
  deletePreferences = mod.deletePreferences
  setupPreferenceTiles = mod.setupPreferenceTiles
  continueOnboardingPreferences = mod.continueOnboardingPreferences
  skipOnboardingPreferences = mod.skipOnboardingPreferences
})

describe('loadPreferencesIntoForm', () => {
  it('marca los tiles de dietary/healthConditions/allergens con .chosen y activa la severidad correcta según el perfil cacheado', () => {
    getCachedProfile.mockReturnValue({
      plan: 'premium',
      preferences: { dietary: ['vegan'], allergens: [{ code: 'cacahuate', severity: 'severe' }], healthConditions: ['diabet'] }
    })
    loadPreferencesIntoForm()
    expect(document.querySelector('[data-dietary="vegan"]').classList.contains('chosen')).toBe(true)
    expect(document.querySelector('[data-dietary="glutenFree"]').classList.contains('chosen')).toBe(false)
    expect(document.querySelector('[data-health="diabet"]').classList.contains('chosen')).toBe(true)
    const cacahuateTile = document.getElementById('allergen-cacahuate')
    expect(cacahuateTile.classList.contains('chosen')).toBe(true)
    // hallazgo: los tiles deben verse rojos en "Estricto", naranja en "Aviso"
    // — .severity-severe/.severity-mild son las clases que el CSS lee para
    // eso, sincronizadas junto con .chosen/.active.
    expect(cacahuateTile.classList.contains('severity-severe')).toBe(true)
    expect(cacahuateTile.classList.contains('severity-mild')).toBe(false)
    const toggle = document.getElementById('severity-cacahuate')
    expect(toggle.classList.contains('hidden')).toBe(false)
    expect(toggle.querySelector('[data-severity="severe"]').classList.contains('active')).toBe(true)
    expect(toggle.querySelector('[data-severity="mild"]').classList.contains('active')).toBe(false)
    expect(toggle.querySelector('[data-severity="severe"]').getAttribute('aria-checked')).toBe('true')
    expect(toggle.querySelector('[data-severity="mild"]').getAttribute('aria-checked')).toBe('false')
  })

  it('no marca nada si no hay preferences aún (usuario premium sin configurar)', () => {
    getCachedProfile.mockReturnValue({ plan: 'premium' })
    loadPreferencesIntoForm()
    expect(document.querySelector('[data-dietary="vegan"]').classList.contains('chosen')).toBe(false)
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
    document.querySelector('[data-dietary="vegan"]').classList.add('chosen')
    document.getElementById('allergen-cacahuate').classList.add('chosen')
    document.getElementById('severity-cacahuate').querySelector('[data-severity="severe"]').classList.add('active')
    document.querySelector('[data-health="diabet"]').classList.add('chosen')
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
  it('llama DELETE /api/me/preferences con Bearer token cuando el usuario confirma, y muestra un mensaje de éxito (hallazgo UX #11: antes no había confirmación ni feedback de éxito)', async () => {
    window.confirm = vi.fn().mockReturnValue(true)
    getIdToken.mockResolvedValue('tok-456')
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    await deletePreferences()

    expect(window.confirm).toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledWith('/api/me/preferences', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok-456' }
    })
    expect(document.getElementById('preferences-success').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('preferences-success').textContent).toMatch(/borradas/i)
  })

  it('no llama al fetch si el usuario cancela el confirm (hallazgo UX #11)', async () => {
    window.confirm = vi.fn().mockReturnValue(false)
    await deletePreferences()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

// hallazgo de revisión (commit 52d57a1): ningún test ejercía el click real de
// los tiles — los tests existentes solo pre-seteaban .chosen con classList.add
// antes de llamar a otras funciones. setupPreferenceTiles() es la única
// función genuinamente nueva de este task (wiring de click), así que se
// ejercita aquí llamándola directamente y disparando un .click() real sobre
// un tile del fixture.
//
// Nota: NO se usa document.dispatchEvent(new Event('DOMContentLoaded')) (el
// patrón de auth-ui.test.js) porque, en este archivo, cada test reimporta el
// módulo vía vi.resetModules() dentro de beforeEach, y cada import vuelve a
// registrar un listener 'DOMContentLoaded' en el `document` compartido de
// jsdom (nunca se remueve entre tests). Verificado empíricamente: para cuando
// un test al final del archivo dispara ese evento, TODOS los listeners
// acumulados de los tests anteriores se disparan también, no solo el del
// import actual. Como setupPreferenceTiles() usa classList.toggle (no
// idempotente), el resultado del test terminaba dependiendo de si el número
// de listeners acumulados era par o impar — con los 8 tests previos de este
// archivo salía "bien" por coincidencia (9 es impar), pero corriendo el mismo
// test filtrado junto a solo 1 test previo (2 imports acumulados) el toggle
// se cancelaba y el test fallaba. Llamar a setupPreferenceTiles() directamente
// evita ese acoplamiento y ejercita la misma lógica de producción de forma
// determinística.
describe('setupPreferenceTiles (click wiring)', () => {
  it('alterna .chosen y aria-pressed en un tile de dietary al hacer click, y lo revierte en un segundo click', () => {
    setupPreferenceTiles()
    const tile = document.querySelector('[data-dietary="vegan"]')
    expect(tile.classList.contains('chosen')).toBe(false)

    tile.click()
    expect(tile.classList.contains('chosen')).toBe(true)
    expect(tile.getAttribute('aria-pressed')).toBe('true')

    tile.click()
    expect(tile.classList.contains('chosen')).toBe(false)
    expect(tile.getAttribute('aria-pressed')).toBe('false')
  })

  it('también alterna .chosen y aria-pressed en un tile de healthConditions al hacer click', () => {
    setupPreferenceTiles()
    const tile = document.querySelector('[data-health="diabet"]')
    expect(tile.classList.contains('chosen')).toBe(false)

    tile.click()
    expect(tile.classList.contains('chosen')).toBe(true)
    expect(tile.getAttribute('aria-pressed')).toBe('true')

    tile.click()
    expect(tile.classList.contains('chosen')).toBe(false)
    expect(tile.getAttribute('aria-pressed')).toBe('false')
  })
})

// Mismo razonamiento que el describe anterior: se llama setupPreferenceTiles()
// directamente en vez de disparar DOMContentLoaded a mano, para no depender
// de listeners acumulados de imports previos del módulo (no determinístico,
// ver nota arriba) y para no pasar además por el gate de getCachedProfile()
// del listener real (que redirige a auth.html si no hay perfil cacheado).
describe('setupPreferenceTiles — interacción de alergias', () => {
  it('togglear un tile de alergeno muestra/oculta su toggle de severidad, con "Aviso" activo por default', () => {
    setupPreferenceTiles()
    const tile = document.getElementById('allergen-cacahuate')
    const toggle = document.getElementById('severity-cacahuate')

    tile.click()
    expect(tile.classList.contains('chosen')).toBe(true)
    expect(toggle.classList.contains('hidden')).toBe(false)
    expect(toggle.querySelector('[data-severity="mild"]').classList.contains('active')).toBe(true)
    expect(toggle.querySelector('[data-severity="mild"]').getAttribute('aria-checked')).toBe('true')
    expect(toggle.querySelector('[data-severity="severe"]').getAttribute('aria-checked')).toBe('false')
    // hallazgo: naranja (severity-mild) por default al elegir, no rojo.
    expect(tile.classList.contains('severity-mild')).toBe(true)
    expect(tile.classList.contains('severity-severe')).toBe(false)

    tile.click()
    expect(tile.classList.contains('chosen')).toBe(false)
    expect(toggle.classList.contains('hidden')).toBe(true)
  })

  it('togglear los botones de severidad activa uno exclusivamente dentro de su propio grupo', () => {
    setupPreferenceTiles()
    const tile = document.getElementById('allergen-cacahuate')
    const toggle = document.getElementById('severity-cacahuate')
    tile.click()

    const mildBtn = toggle.querySelector('[data-severity="mild"]')
    const severeBtn = toggle.querySelector('[data-severity="severe"]')
    expect(mildBtn.classList.contains('active')).toBe(true)
    expect(mildBtn.getAttribute('aria-checked')).toBe('true')
    expect(severeBtn.getAttribute('aria-checked')).toBe('false')

    severeBtn.click()
    expect(severeBtn.classList.contains('active')).toBe(true)
    expect(mildBtn.classList.contains('active')).toBe(false)
    expect(severeBtn.getAttribute('aria-checked')).toBe('true')
    expect(mildBtn.getAttribute('aria-checked')).toBe('false')
    // hallazgo: cambiar a "Estricto" pinta el tile de rojo (severity-severe).
    expect(tile.classList.contains('severity-severe')).toBe(true)
    expect(tile.classList.contains('severity-mild')).toBe(false)

    mildBtn.click()
    expect(mildBtn.classList.contains('active')).toBe(true)
    expect(severeBtn.classList.contains('active')).toBe(false)
    expect(mildBtn.getAttribute('aria-checked')).toBe('true')
    expect(severeBtn.getAttribute('aria-checked')).toBe('false')
    // y volver a "Aviso" lo regresa a naranja (severity-mild).
    expect(tile.classList.contains('severity-mild')).toBe(true)
    expect(tile.classList.contains('severity-severe')).toBe(false)
  })

  it('no reactiva "Aviso" al re-elegir un tile de alergeno si ya había una severidad marcada (no pisa la elección previa del usuario)', () => {
    setupPreferenceTiles()
    const tile = document.getElementById('allergen-cacahuate')
    const toggle = document.getElementById('severity-cacahuate')
    const mildBtn = toggle.querySelector('[data-severity="mild"]')
    const severeBtn = toggle.querySelector('[data-severity="severe"]')

    tile.click() // elige el tile, "Aviso" activo por default
    severeBtn.click() // el usuario cambia a "Estricto"
    tile.click() // deselecciona el tile (oculta el toggle, no toca .active)
    tile.click() // vuelve a elegir el tile

    expect(severeBtn.classList.contains('active')).toBe(true)
    expect(mildBtn.classList.contains('active')).toBe(false)
    expect(severeBtn.getAttribute('aria-checked')).toBe('true')
    expect(mildBtn.getAttribute('aria-checked')).toBe('false')
  })
})

describe('onboarding mode (?onboarding=1)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    document.getElementById('consent-checkbox').checked = true
  })

  it('continueOnboardingPreferences stores the payload in sessionStorage and redirects to onboarding-membership.html without calling fetch', async () => {
    document.querySelector('#dietary-tiles [data-dietary="vegan"]').classList.add('chosen')
    delete window.location
    window.location = { href: '' }

    await continueOnboardingPreferences()

    const stored = JSON.parse(sessionStorage.getItem('yomi_pending_preferences'))
    expect(stored.dietary).toEqual(['vegan'])
    expect(stored.consent).toBe(true)
    expect(window.location.href).toBe('onboarding-membership.html')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('continueOnboardingPreferences requires consent, same as the normal save flow', async () => {
    document.getElementById('consent-checkbox').checked = false
    await expect(continueOnboardingPreferences()).rejects.toThrow()
    expect(sessionStorage.getItem('yomi_pending_preferences')).toBeNull()
  })

  it('skipOnboardingPreferences clears any pending selection and redirects without requiring consent', () => {
    sessionStorage.setItem('yomi_pending_preferences', JSON.stringify({ dietary: ['vegan'] }))
    delete window.location
    window.location = { href: '' }

    skipOnboardingPreferences()

    expect(sessionStorage.getItem('yomi_pending_preferences')).toBeNull()
    expect(window.location.href).toBe('onboarding-membership.html')
  })
})
