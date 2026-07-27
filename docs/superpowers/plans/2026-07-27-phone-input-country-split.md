# Separar código de país en inputs de teléfono — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los 3 inputs de teléfono que hoy piden el E.164 completo como un solo texto (`onboarding-profile.html`, y 2 en `account-ui.js`) pasan a select-de-país + input-de-número-local, igual que ya funciona en `auth.html`.

**Architecture:** `country-codes.js` gana `splitE164(phone)` (empareja el prefijo `dial` más largo posible contra `COUNTRY_CODES`, fallback a México). Cada lugar reconstruye `dial + dígitos-del-local` al enviar, exactamente como ya hace `handleSendCode` en `auth-ui.js`. Ningún endpoint de backend cambia — todos siguen recibiendo un string E.164 completo.

**Tech Stack:** Vanilla JS ES modules, Vitest + jsdom.

## Global Constraints

- Reconstrucción siempre: `dialCode + localNumber.replace(/\D/g, '')` — mismo patrón que `auth-ui.js::handleSendCode` ya usa.
- Selects poblados desde `COUNTRY_CODES` con el mismo template ya usado en `auth-ui.js`: `` `${c.name} (${c.dial}) ${flagEmoji(c.iso2)}` `` por opción, `value="${c.dial}"`.
- Solo el input de teléfono-contacto de `account-ui.js` pre-llena un valor existente (vía `splitE164`) — los otros 2 (onboarding, "nuevo número" del modal SMS) siempre arrancan vacíos, sin necesidad de pre-llenado.
- Ningún endpoint de backend cambia.

---

### Task 1: `country-codes.js` (`splitE164`) + `onboarding-profile.html`/`onboarding-profile-ui.js`

**Files:**
- Modify: `country-codes.js`
- Modify: `onboarding-profile.html`
- Modify: `onboarding-profile-ui.js`
- Modify: `tests/onboarding-profile-ui.test.js`

**Interfaces:**
- Produces: `splitE164(phone)` (nuevo export de `country-codes.js`) — regresa `{ dial: string, local: string }`.

- [ ] **Step 1: Escribir el test de `splitE164` y actualizar el de `submitProfile` (RED)**

Crear `tests/country-codes.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { splitE164 } from '../country-codes.js'

describe('splitE164', () => {
  it('separa un E.164 de México en { dial, local }', () => {
    expect(splitE164('+525512345678')).toEqual({ dial: '+52', local: '5512345678' })
  })

  it('usa el match más largo posible (Barbados +1246, no EE.UU. +1)', () => {
    expect(splitE164('+12463334444')).toEqual({ dial: '+1246', local: '3334444' })
  })

  it('cae a México (+52) con el número tal cual si no hay match', () => {
    expect(splitE164('+99999999')).toEqual({ dial: '+52', local: '99999999' })
  })

  it('cae a México con local vacío si el teléfono es vacío/null', () => {
    expect(splitE164('')).toEqual({ dial: '+52', local: '' })
    expect(splitE164(null)).toEqual({ dial: '+52', local: '' })
  })
})
```

En `tests/onboarding-profile-ui.test.js`, agregar el mock de `country-codes.js` (después de los imports existentes):

```js
vi.mock('../country-codes.js', () => ({
  COUNTRY_CODES: [{ name: 'México', iso2: 'MX', dial: '+52' }, { name: 'Argentina', iso2: 'AR', dial: '+54' }],
  flagEmoji: () => '🏳️'
}))
```

Y reemplazar el fixture del `field-phone` en el `document.body.innerHTML` (dentro de `beforeEach`) de:

```js
    <div class="form-field" id="field-phone"><input id="input-phone"></div>
```

por:

```js
    <div class="form-field" id="field-phone"><select id="input-phone-country"></select><input id="input-phone"></div>
```

Y reemplazar el test `'sends only the visible fields and redirects to preferences.html?onboarding=1 on success'` completo por:

```js
  it('sends only the visible fields and redirects to preferences.html?onboarding=1 on success', async () => {
    document.getElementById('field-name').classList.add('hidden')
    document.getElementById('field-email').classList.add('hidden')
    document.getElementById('field-phone').classList.remove('hidden')
    document.getElementById('input-phone-country').innerHTML = '<option value="+52">México</option>'
    document.getElementById('input-phone-country').value = '+52'
    document.getElementById('input-phone').value = '5512345678'
    delete window.location
    window.location = { href: '' }

    await submitProfile()

    const [, options] = global.fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ phone: '+525512345678' })
    expect(window.location.href).toBe('preferences.html?onboarding=1')
  })
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `npx vitest run tests/country-codes.test.js tests/onboarding-profile-ui.test.js`
Expected: FAIL — `splitE164` no existe aún; el test de `submitProfile` falla porque el código sigue leyendo un solo input.

- [ ] **Step 3: Implementar `splitE164` en `country-codes.js`**

Al final del archivo, después de `flagEmoji`, agregar:

```js

// Separa un E.164 completo en { dial, local } — usado para pre-llenar el
// select+input de país/número cuando ya existe un teléfono guardado (ver
// docs/superpowers/specs/2026-07-27-phone-input-country-split-design.md).
// Empareja el prefijo MÁS LARGO posible (ej. +1246 de Barbados antes que
// +1 de EE.UU./Canadá) para no cortar mal el número local.
export function splitE164(phone) {
  if (!phone) return { dial: '+52', local: '' };
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.dial.length - a.dial.length);
  const match = sorted.find(c => phone.startsWith(c.dial));
  if (match) return { dial: match.dial, local: phone.slice(match.dial.length) };
  return { dial: '+52', local: phone.replace(/^\+/, '') };
}
```

- [ ] **Step 4: Actualizar `onboarding-profile.html`**

Reemplazar el bloque:

```html
          <div class="form-field" id="field-phone">
            <label for="input-phone">Teléfono</label>
            <input id="input-phone" class="form-input" type="tel" autocomplete="tel" placeholder="+525512345678">
          </div>
```

por:

```html
          <div class="form-field" id="field-phone">
            <label for="input-phone">Teléfono</label>
            <select id="input-phone-country" class="form-input"></select>
            <input id="input-phone" class="form-input" type="tel" autocomplete="tel" placeholder="5512345678">
          </div>
```

- [ ] **Step 5: Actualizar `onboarding-profile-ui.js`**

Agregar el import al tope del archivo:

```js
import { getIdToken, syncUserProfile, getCachedProfile } from './authClient.js';
import { COUNTRY_CODES, flagEmoji } from './country-codes.js';
```

Dentro de `submitProfile`, reemplazar el bloque:

```js
  if (fieldPhone && !fieldPhone.classList.contains('hidden')) {
    const v = document.getElementById('input-phone').value.trim();
    if (!v) { showError('Escribe tu teléfono.'); throw new Error('invalid_phone'); }
    body.phone = v;
  }
```

por:

```js
  if (fieldPhone && !fieldPhone.classList.contains('hidden')) {
    const dial = document.getElementById('input-phone-country')?.value || '';
    const local = document.getElementById('input-phone').value.trim();
    if (!local) { showError('Escribe tu teléfono.'); throw new Error('invalid_phone'); }
    body.phone = dial + local.replace(/\D/g, '');
  }
```

Dentro de `initOnboardingProfilePage`, justo antes de `renderMissingFields(profile);`, agregar la población del select (mismo patrón/formato exacto que `auth-ui.js` ya usa para `#phone-country`):

```js
  const phoneCountrySelect = document.getElementById('input-phone-country');
  if (phoneCountrySelect) {
    phoneCountrySelect.innerHTML = COUNTRY_CODES.map(c => `<option value="${c.dial}">${c.name} (${c.dial}) ${flagEmoji(c.iso2)}</option>`).join('');
  }
```

- [ ] **Step 6: Correr los tests para confirmar que pasan**

Run: `npx vitest run tests/country-codes.test.js tests/onboarding-profile-ui.test.js`
Expected: PASS, todos verdes.

- [ ] **Step 7: Correr la suite completa**

Run: `npx vitest run`
Expected: PASS salvo la falla preexistente y no relacionada de `tests/e2e/scan-cycle.spec.js`.

- [ ] **Step 8: Commit**

```bash
git add country-codes.js onboarding-profile.html onboarding-profile-ui.js tests/country-codes.test.js tests/onboarding-profile-ui.test.js
git commit -m "feat(onboarding): separa código de país del número en el teléfono del onboarding

Mismo patrón que auth.html: select de país (COUNTRY_CODES) + input de
número local, reconstruidos a E.164 al enviar. Nuevo splitE164() en
country-codes.js, reusado por la siguiente tarea en account-ui.js."
```

---

### Task 2: `account-ui.js` — fila teléfono-contacto + modal de cambio de teléfono

**Files:**
- Modify: `account-ui.js`
- Modify: `tests/account-ui.test.js`

**Interfaces:**
- Consumes: `COUNTRY_CODES`, `flagEmoji`, `splitE164` de `./country-codes.js` (Task 1).

- [ ] **Step 1: Actualizar los tests (RED)**

En `tests/account-ui.test.js`, agregar el mock de `country-codes.js` junto a los demás mocks del tope del archivo:

```js
vi.mock('../country-codes.js', () => ({
  COUNTRY_CODES: [{ name: 'México', iso2: 'MX', dial: '+52' }, { name: 'Argentina', iso2: 'AR', dial: '+54' }],
  flagEmoji: () => '🏳️',
  splitE164: (phone) => {
    if (!phone) return { dial: '+52', local: '' }
    if (phone.startsWith('+54')) return { dial: '+54', local: phone.slice(3) }
    return { dial: '+52', local: phone.replace(/^\+52/, '') }
  }
}))
```

Reemplazar el test `'submitPhoneContactEdit llama PUT /api/me/profile con { phone } y re-sincroniza'` por:

```js
  it('submitPhoneContactEdit llama PUT /api/me/profile con { phone } reconstruido de país+local, y re-sincroniza', async () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active' })
    renderAccountHub()
    document.getElementById('btn-edit-phone').click()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    document.getElementById('input-edit-phone-country').value = '+52'
    document.getElementById('input-edit-phone-contact').value = '5512345678'

    await submitPhoneContactEdit()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/me/profile')
    expect(JSON.parse(options.body)).toEqual({ phone: '+525512345678' })
    expect(syncUserProfile).toHaveBeenCalled()
  })
```

Reemplazar el test `'submitPhoneSendCode llama /api/auth/phone/send con el número nuevo'` por:

```js
  it('submitPhoneSendCode llama /api/auth/phone/send con el número reconstruido de país+local', async () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    renderAccountHub()
    document.getElementById('btn-open-phone-modal').click()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'pending' }) })
    document.getElementById('input-new-phone-country').value = '+52'
    document.getElementById('input-new-phone').value = '5512345678'

    await submitPhoneSendCode()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/auth/phone/send')
    expect(JSON.parse(options.body)).toEqual({ phone: '+525512345678' })
  })
```

Reemplazar el test `'submitPhoneChangeConfirm llama POST /api/me/phone/change con phone+code y re-sincroniza'` por:

```js
  it('submitPhoneChangeConfirm llama POST /api/me/phone/change con phone (país+local) y code, y re-sincroniza', async () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    renderAccountHub()
    document.getElementById('btn-open-phone-modal').click()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    document.getElementById('input-new-phone-country').value = '+52'
    document.getElementById('input-new-phone').value = '5512345678'
    document.getElementById('input-phone-code').value = '123456'

    await submitPhoneChangeConfirm()

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/me/phone/change')
    expect(options.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(options.body)).toEqual({ phone: '+525512345678', code: '123456' })
    expect(syncUserProfile).toHaveBeenCalled()
  })
```

Reemplazar el test `'submitPhoneChangeConfirm muestra "phone_in_use" de forma legible si el 409 ocurre, modal sigue abierto'` por:

```js
  it('submitPhoneChangeConfirm muestra "phone_in_use" de forma legible si el 409 ocurre, modal sigue abierto', async () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525500000000', membershipStatus: 'active' })
    renderAccountHub()
    document.getElementById('btn-open-phone-modal').click()
    getIdToken.mockResolvedValue('tok')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'phone_in_use' }) })
    document.getElementById('input-new-phone-country').value = '+52'
    document.getElementById('input-new-phone').value = '5512345678'
    document.getElementById('input-phone-code').value = '123456'

    await expect(submitPhoneChangeConfirm()).rejects.toThrow()

    expect(syncUserProfile).not.toHaveBeenCalled()
    const errorEl = document.getElementById('edit-phone-error')
    expect(errorEl.textContent).toMatch(/ya está en uso/)
    expect(document.getElementById('phone-login-flow')).toBeTruthy()
  })
```

Agregar un test nuevo al final del describe `'fila Teléfono — cuenta CON email (edición inline, sin SMS)'`, verificando el pre-llenado:

```js
  it('pre-llena el select de país y el número local a partir del teléfono existente', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', membershipStatus: 'active', phoneNumber: '+525512345678' })
    renderAccountHub()
    document.getElementById('btn-edit-phone').click()
    expect(document.getElementById('input-edit-phone-country').value).toBe('+52')
    expect(document.getElementById('input-edit-phone-contact').value).toBe('5512345678')
  })
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `npx vitest run tests/account-ui.test.js`
Expected: FAIL — los selects `input-edit-phone-country`/`input-new-phone-country` no existen aún.

- [ ] **Step 3: Implementar en `account-ui.js`**

Agregar el import al tope del archivo:

```js
import { firebaseAuth, signOut, reauthenticateWithCredential, verifyBeforeUpdateEmail, updatePassword, EmailAuthProvider } from './firebase-init.js';
import { getIdToken, getCachedProfile, syncUserProfile } from './authClient.js';
import { mapAuthError } from './authErrors.js';
import { COUNTRY_CODES, flagEmoji, splitE164 } from './country-codes.js';
```

Agregar un helper compartido justo antes de `function renderPhoneRow`:

```js
function renderCountryOptions(selectedDial) {
  return COUNTRY_CODES.map(c => `<option value="${c.dial}" ${c.dial === selectedDial ? 'selected' : ''}>${c.name} (${c.dial}) ${flagEmoji(c.iso2)}</option>`).join('');
}
```

Dentro de `renderPhoneRow`, reemplazar la rama `if (editingRow === 'phone')`:

```js
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
```

por:

```js
  if (editingRow === 'phone') {
    const { dial, local } = splitE164(phoneContact);
    return `
      <div class="account-data-row account-data-row-editing" data-row="phone">
        <select id="input-edit-phone-country" class="form-input">${renderCountryOptions(dial)}</select>
        <input id="input-edit-phone-contact" class="form-input" type="tel" value="${escapeHtml(local)}">
        <button type="button" id="btn-save-phone" class="row-icon-btn" aria-label="Guardar teléfono">✔️</button>
        <button type="button" id="btn-cancel-phone" class="row-icon-btn" aria-label="Cancelar edición de teléfono">✖️</button>
      </div>
      <p id="edit-phone-error" class="hidden modal-inline-error" role="alert"></p>
    `;
  }
```

Dentro de `openPhoneChangeModal`, reemplazar el bloque del `<div class="form-field">` de "Nuevo número":

```js
      <div class="form-field">
        <label for="input-new-phone">Nuevo número</label>
        <input id="input-new-phone" class="form-input" type="tel" placeholder="+525512345678">
      </div>
```

por:

```js
      <div class="form-field">
        <label for="input-new-phone">Nuevo número</label>
        <select id="input-new-phone-country" class="form-input">${renderCountryOptions('+52')}</select>
        <input id="input-new-phone" class="form-input" type="tel" placeholder="5512345678">
      </div>
```

Reemplazar `submitPhoneContactEdit`:

```js
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
```

por:

```js
export async function submitPhoneContactEdit() {
  const dial = document.getElementById('input-edit-phone-country')?.value || '';
  const local = document.getElementById('input-edit-phone-contact')?.value.trim() || '';
  const phone = dial + local.replace(/\D/g, '');
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
```

Reemplazar `submitPhoneSendCode`:

```js
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
```

por:

```js
export async function submitPhoneSendCode() {
  const dial = document.getElementById('input-new-phone-country')?.value || '';
  const local = document.getElementById('input-new-phone')?.value.trim() || '';
  const phone = dial + local.replace(/\D/g, '');
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
```

Dentro de `submitPhoneChangeConfirm`, reemplazar sus primeras 3 líneas:

```js
  const phoneInput = document.getElementById('input-new-phone');
  const codeInput = document.getElementById('input-phone-code');
  const phone = phoneInput ? phoneInput.value.trim() : '';
  const code = codeInput ? codeInput.value.trim() : '';
```

por:

```js
  const dial = document.getElementById('input-new-phone-country')?.value || '';
  const localInput = document.getElementById('input-new-phone');
  const codeInput = document.getElementById('input-phone-code');
  const phone = dial + (localInput ? localInput.value.trim().replace(/\D/g, '') : '');
  const code = codeInput ? codeInput.value.trim() : '';
```

- [ ] **Step 4: Correr los tests para confirmar que pasan**

Run: `npx vitest run tests/account-ui.test.js`
Expected: PASS, todos verdes (incluyendo el test nuevo de pre-llenado).

- [ ] **Step 5: Correr la suite completa**

Run: `npx vitest run`
Expected: PASS salvo la falla preexistente y no relacionada de `tests/e2e/scan-cycle.spec.js`.

- [ ] **Step 6: Commit**

```bash
git add account-ui.js tests/account-ui.test.js
git commit -m "feat(account): separa código de país del número en los 2 inputs de teléfono de Mi cuenta

Mismo patrón que auth.html/onboarding: select de país + input de
número local. La fila de teléfono-contacto (cuentas con login por
correo/Google) pre-llena ambos campos desde el número existente vía
splitE164(); el modal de cambio de teléfono (cuentas con login por
teléfono) siempre arranca vacío, es para un número nuevo."
```
