# Envío propio de correos de Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el envío de correos de Auth roto de Firebase (reset de contraseña, verificación de correo) por envío propio: Firebase solo genera el link de acción (vía Identity Toolkit, service account, `returnOobLink:true`), nosotros lo mandamos por correo vía SMTP.com.

**Architecture:** Task 1 construye la infraestructura compartida (`api/mailer.js`, `api/emailActions.js`, export nuevo en `api/phoneAuth.js`). Task 2 agrega los 2 endpoints que la usan. Task 3 agrega la página propia de "nueva contraseña" (`reset-password.html`) que consume el link generado. Task 4 rewire el frontend existente (`auth-ui.js`, `account-ui.js`) para llamar los endpoints nuevos en vez del SDK cliente roto.

**Tech Stack:** `nodemailer` (nueva dependencia), Identity Toolkit REST (OAuth de service account, mismo patrón que `api/phoneAuth.js` ya usa), Vitest.

## Global Constraints

- `EMAIL_NOT_FOUND` (cuenta no existe) en `POST /api/auth/password-reset` SIEMPRE responde `{ ok: true }` sin mandar correo — nunca se distingue de un envío real (protección contra enumeración de cuentas). Cualquier OTRO error sí responde `500`.
- `POST /api/me/verification-email` no necesita esta protección (ya requiere sesión activa vía `requireUser`).
- `api/mailer.js`/`api/emailActions.js` no saben nada de Express/HTTP — son funciones puras reutilizables, los endpoints en `api/index.js` son la única capa que traduce a request/response.
- No se toca la configuración de SMTP custom ya hecha en la consola de Firebase — queda ahí por si algún día sirve, pero el código deja de depender de ella.

---

### Task 1: `api/mailer.js` + `api/emailActions.js` + export en `api/phoneAuth.js`

**Files:**
- Create: `api/mailer.js`
- Create: `api/emailActions.js`
- Modify: `api/phoneAuth.js` (agrega 2 nombres al `module.exports`, sin cambiar ninguna función)
- Modify: `package.json` (agrega `nodemailer`)
- Test (nuevo): `tests/mailer.test.js`
- Test (nuevo): `tests/emailActions.test.js`

**Interfaces:**
- Produces: `sendMail({ to, subject, html })` (async, `api/mailer.js`) — envía vía SMTP.com usando `SMTPCOM_HOST`/`SMTPCOM_PORT`/`SMTPCOM_USERNAME`/`SMTPCOM_PASSWORD`/`SMTPCOM_SENDER_EMAIL` de `process.env` (ya en `.env`).
- Produces: `generateActionLink(email, requestType, continueUrl)` (async, `api/emailActions.js`) — `requestType` es `'PASSWORD_RESET'` o `'VERIFY_EMAIL'`; `continueUrl` es opcional (solo se usa para `PASSWORD_RESET`). Regresa el `oobLink` (string) en éxito; en fallo lanza un `Error` con `.code` igual al `error.message` que regresa Identity Toolkit (ej. `'EMAIL_NOT_FOUND'`) cuando aplica.
- Consumes: `getAuthAccessToken`/`getAuthServiceAccount` de `api/phoneAuth.js` (ya existen ahí, privados hasta este task).

- [ ] **Step 1: Instalar `nodemailer`**

Run: `npm install nodemailer`

- [ ] **Step 2: Exportar `getAuthAccessToken`/`getAuthServiceAccount` desde `api/phoneAuth.js`**

Cambiar la última línea del archivo:

```js
module.exports = { sendVerificationCode, checkVerificationCode, createFirebaseCustomToken, setPhoneNumberClaim };
```

por:

```js
module.exports = { sendVerificationCode, checkVerificationCode, createFirebaseCustomToken, setPhoneNumberClaim, getAuthAccessToken, getAuthServiceAccount };
```

- [ ] **Step 3: Escribir el test de `api/mailer.js` (RED)**

Crear `tests/mailer.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sendMailMock = vi.fn()
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }))
vi.mock('nodemailer', () => ({ default: { createTransport: createTransportMock }, createTransport: createTransportMock }))

const { sendMail } = await import('../api/mailer.js')

describe('sendMail', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    sendMailMock.mockReset()
    createTransportMock.mockClear()
    process.env.SMTPCOM_HOST = 'smtp.com'
    process.env.SMTPCOM_PORT = '80'
    process.env.SMTPCOM_USERNAME = 'smtp@yomi.mx'
    process.env.SMTPCOM_PASSWORD = 'secret'
    process.env.SMTPCOM_SENDER_EMAIL = 'noreply@yomi.mx'
  })

  afterEach(() => { process.env = { ...ORIGINAL_ENV } })

  it('crea el transport con host/puerto/credenciales de SMTPCOM_* y envía con el remitente configurado', async () => {
    sendMailMock.mockResolvedValueOnce(undefined)

    await sendMail({ to: 'user@example.com', subject: 'Asunto', html: '<p>Hola</p>' })

    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.com', port: 80, auth: { user: 'smtp@yomi.mx', pass: 'secret' }
    }))
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      from: expect.stringContaining('noreply@yomi.mx'),
      to: 'user@example.com', subject: 'Asunto', html: '<p>Hola</p>'
    }))
  })
})
```

- [ ] **Step 4: Correr el test para confirmar que falla**

Run: `npx vitest run tests/mailer.test.js`
Expected: FAIL — `Cannot find module '../api/mailer.js'` (no existe aún).

- [ ] **Step 5: Implementar `api/mailer.js`**

```js
// Envío propio de correos transaccionales (reset de contraseña, verificación
// de correo) vía SMTP.com — Firebase Auth no despacha realmente estos
// correos para este proyecto (tier básico, sin SMTP custom real pese a la
// config). Ver docs/superpowers/specs/2026-07-27-custom-auth-emails-design.md.
const nodemailer = require('nodemailer');

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: process.env.SMTPCOM_HOST,
    port: Number(process.env.SMTPCOM_PORT),
    secure: false,
    auth: { user: process.env.SMTPCOM_USERNAME, pass: process.env.SMTPCOM_PASSWORD }
  });
  return _transporter;
}

async function sendMail({ to, subject, html }) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `Yomi <${process.env.SMTPCOM_SENDER_EMAIL}>`,
    to, subject, html
  });
}

module.exports = { sendMail };
```

- [ ] **Step 6: Correr el test para confirmar que pasa**

Run: `npx vitest run tests/mailer.test.js`
Expected: PASS, 1/1.

- [ ] **Step 7: Escribir el test de `api/emailActions.js` (RED)**

Crear `tests/emailActions.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const phoneAuthModule = requireFn('../api/phoneAuth.js')
const getAuthAccessToken = vi.fn()
const getAuthServiceAccount = vi.fn()
phoneAuthModule.getAuthAccessToken = getAuthAccessToken
phoneAuthModule.getAuthServiceAccount = getAuthServiceAccount

const { generateActionLink } = await import('../api/emailActions.js')

describe('generateActionLink', () => {
  beforeEach(() => {
    getAuthAccessToken.mockReset()
    getAuthServiceAccount.mockReset()
    getAuthAccessToken.mockResolvedValue('fake-oauth-token')
    getAuthServiceAccount.mockReturnValue({ project_id: 'foodscaner-dev' })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('llama accounts:sendOobCode con returnOobLink y regresa el oobLink (con continueUrl para PASSWORD_RESET)', async () => {
    let capturedBody
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      capturedBody = JSON.parse(options.body)
      return { ok: true, json: async () => ({ oobLink: 'https://yomi.mx/reset?oobCode=abc' }) }
    }))

    const link = await generateActionLink('user@example.com', 'PASSWORD_RESET', 'https://yomi.mx/reset-password.html')

    expect(link).toBe('https://yomi.mx/reset?oobCode=abc')
    expect(capturedBody).toEqual({
      requestType: 'PASSWORD_RESET', email: 'user@example.com', returnOobLink: true,
      continueUrl: 'https://yomi.mx/reset-password.html', canHandleCodeInApp: true
    })
  })

  it('no incluye continueUrl/canHandleCodeInApp cuando no se pasa continueUrl (caso VERIFY_EMAIL)', async () => {
    let capturedBody
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      capturedBody = JSON.parse(options.body)
      return { ok: true, json: async () => ({ oobLink: 'https://foodscaner-dev.firebaseapp.com/__/auth/action?oobCode=xyz' }) }
    }))

    await generateActionLink('user@example.com', 'VERIFY_EMAIL')

    expect(capturedBody).toEqual({ requestType: 'VERIFY_EMAIL', email: 'user@example.com', returnOobLink: true })
  })

  it('lanza un error con .code = EMAIL_NOT_FOUND cuando la cuenta no existe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 400,
      json: async () => ({ error: { message: 'EMAIL_NOT_FOUND' } })
    })))

    const err = await generateActionLink('noexiste@example.com', 'PASSWORD_RESET').catch(e => e)

    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('EMAIL_NOT_FOUND')
  })
})
```

- [ ] **Step 8: Correr el test para confirmar que falla**

Run: `npx vitest run tests/emailActions.test.js`
Expected: FAIL — `Cannot find module '../api/emailActions.js'`.

- [ ] **Step 9: Implementar `api/emailActions.js`**

```js
// Genera links de acción de Firebase Auth (reset de contraseña, verificación
// de correo) vía Identity Toolkit con returnOobLink:true, en vez de dejar
// que Firebase los mande él mismo — el envío de correo de Firebase Auth está
// roto para este proyecto. Ver docs/superpowers/specs/2026-07-27-custom-auth-emails-design.md.
const { getAuthAccessToken, getAuthServiceAccount } = require('./phoneAuth');

async function generateActionLink(email, requestType, continueUrl) {
  const token = await getAuthAccessToken();
  const sa = getAuthServiceAccount();
  if (!token || !sa) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY_DEV no configurada');

  const body = { requestType, email, returnOobLink: true };
  if (continueUrl) {
    body.continueUrl = continueUrl;
    body.canHandleCodeInApp = true;
  }

  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:sendOobCode`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data?.error?.message || `Identity Toolkit sendOobCode failed: ${resp.status}`);
    err.code = data?.error?.message;
    throw err;
  }
  return data.oobLink;
}

module.exports = { generateActionLink };
```

- [ ] **Step 10: Correr el test para confirmar que pasa**

Run: `npx vitest run tests/emailActions.test.js`
Expected: PASS, 3/3.

- [ ] **Step 11: Correr la suite completa**

Run: `npx vitest run`
Expected: PASS salvo la falla preexistente y no relacionada de `tests/e2e/scan-cycle.spec.js`.

- [ ] **Step 12: Commit**

```bash
git add api/mailer.js api/emailActions.js api/phoneAuth.js package.json package-lock.json tests/mailer.test.js tests/emailActions.test.js
git commit -m "feat(auth): infraestructura de correo propio (mailer + generateActionLink)

Nuevo api/mailer.js (nodemailer + SMTP.com) y api/emailActions.js
(genera el link real de reset/verificación vía Identity Toolkit en
vez de dejar que Firebase lo mande, que está roto para este proyecto).
Base para los endpoints de la siguiente tarea."
```

---

### Task 2: Endpoints `POST /api/auth/password-reset` y `POST /api/me/verification-email`

**Files:**
- Modify: `api/index.js`
- Test (nuevo): `tests/authEmailRoutes.test.js`

**Interfaces:**
- Consumes: `generateActionLink` (`./emailActions`), `sendMail` (`./mailer`), `EMAIL_RE` (ya existe en `api/index.js`), `requireUser` (ya existe).
- Produces: rutas `POST /api/auth/password-reset` (público) y `POST /api/me/verification-email` (requiere sesión), handlers exportados `passwordResetHandler`/`verificationEmailHandler`.

- [ ] **Step 1: Escribir el test (RED)**

Crear `tests/authEmailRoutes.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const emailActionsModule = requireFn('../api/emailActions.js')
const mailerModule = requireFn('../api/mailer.js')
const generateActionLink = vi.fn()
const sendMail = vi.fn()
emailActionsModule.generateActionLink = generateActionLink
mailerModule.sendMail = sendMail

const { passwordResetHandler, verificationEmailHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('passwordResetHandler', () => {
  beforeEach(() => { generateActionLink.mockReset(); sendMail.mockReset() })

  it('400s en un correo inválido, sin llamar a nada', async () => {
    const req = { body: { email: 'not-an-email' } }
    const res = makeRes()
    await passwordResetHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(generateActionLink).not.toHaveBeenCalled()
  })

  it('genera el link y manda el correo, responde ok:true', async () => {
    generateActionLink.mockResolvedValue('https://yomi.mx/reset-password.html?oobCode=abc')
    sendMail.mockResolvedValue(undefined)
    const req = { body: { email: 'user@example.com' } }
    const res = makeRes()

    await passwordResetHandler(req, res)

    expect(generateActionLink).toHaveBeenCalledWith('user@example.com', 'PASSWORD_RESET', 'https://yomi.mx/reset-password.html')
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'user@example.com' }))
    expect(res.body).toEqual({ ok: true })
  })

  it('responde ok:true SIN mandar correo cuando la cuenta no existe (anti-enumeración)', async () => {
    const err = new Error('EMAIL_NOT_FOUND')
    err.code = 'EMAIL_NOT_FOUND'
    generateActionLink.mockRejectedValue(err)
    const req = { body: { email: 'noexiste@example.com' } }
    const res = makeRes()

    await passwordResetHandler(req, res)

    expect(sendMail).not.toHaveBeenCalled()
    expect(res.body).toEqual({ ok: true })
  })

  it('500s en un fallo real (no EMAIL_NOT_FOUND)', async () => {
    generateActionLink.mockRejectedValue(new Error('network down'))
    const req = { body: { email: 'user@example.com' } }
    const res = makeRes()

    await passwordResetHandler(req, res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'internal_error' })
  })
})

describe('verificationEmailHandler', () => {
  beforeEach(() => { generateActionLink.mockReset(); sendMail.mockReset() })

  it('genera el link de VERIFY_EMAIL para el correo del usuario autenticado y lo manda', async () => {
    generateActionLink.mockResolvedValue('https://foodscaner-dev.firebaseapp.com/__/auth/action?oobCode=xyz')
    sendMail.mockResolvedValue(undefined)
    const req = { user: { uid: 'uid-1', email: 'user@example.com' } }
    const res = makeRes()

    await verificationEmailHandler(req, res)

    expect(generateActionLink).toHaveBeenCalledWith('user@example.com', 'VERIFY_EMAIL')
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'user@example.com' }))
    expect(res.body).toEqual({ ok: true })
  })

  it('500s si falla generar o mandar el link', async () => {
    generateActionLink.mockRejectedValue(new Error('boom'))
    const req = { user: { uid: 'uid-1', email: 'user@example.com' } }
    const res = makeRes()

    await verificationEmailHandler(req, res)

    expect(res.statusCode).toBe(500)
  })
})
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `npx vitest run tests/authEmailRoutes.test.js`
Expected: FAIL — `passwordResetHandler`/`verificationEmailHandler` no exportados de `api/index.js` aún.

- [ ] **Step 3: Implementar los handlers y rutas en `api/index.js`**

En el import del tope del archivo, agregar `require('./emailActions')` y `require('./mailer')` junto a los demás requires (después de la línea del `require('./phoneAuth')`):

```js
const { generateActionLink } = require('./emailActions');
const { sendMail } = require('./mailer');
```

Justo después de la ruta `app.put('/api/me/profile', requireUser, putProfileHandler);` (que ya está cerca de donde vive `EMAIL_RE`), agregar:

```js
async function passwordResetHandler(req, res) {
  const email = req.body?.email;
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }
  try {
    const oobLink = await generateActionLink(email, 'PASSWORD_RESET', 'https://yomi.mx/reset-password.html');
    await sendMail({
      to: email,
      subject: 'Restablece tu contraseña de Yomi',
      html: `<p>Para restablecer tu contraseña, haz click en el siguiente enlace:</p><p><a href="${oobLink}">${oobLink}</a></p><p>Si no solicitaste esto, ignora este correo.</p>`
    });
  } catch (e) {
    if (e.code === 'EMAIL_NOT_FOUND') {
      // Intencional: mismo éxito genérico sin importar si la cuenta existe
      // (protección contra enumeración de cuentas).
      return res.json({ ok: true });
    }
    console.warn('[auth/password-reset] error:', e.message);
    return res.status(500).json({ error: 'internal_error' });
  }
  res.json({ ok: true });
}

app.post('/api/auth/password-reset', passwordResetHandler);

async function verificationEmailHandler(req, res) {
  try {
    const oobLink = await generateActionLink(req.user.email, 'VERIFY_EMAIL');
    await sendMail({
      to: req.user.email,
      subject: 'Verifica tu correo para Yomi',
      html: `<p>Verifica tu correo haciendo click en el siguiente enlace:</p><p><a href="${oobLink}">${oobLink}</a></p>`
    });
    res.json({ ok: true });
  } catch (e) {
    console.warn('[me/verification-email] error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.post('/api/me/verification-email', requireUser, verificationEmailHandler);
```

Al final del archivo, junto a los demás `module.exports.*`, agregar:

```js
module.exports.passwordResetHandler = passwordResetHandler;
module.exports.verificationEmailHandler = verificationEmailHandler;
```

- [ ] **Step 4: Correr el test para confirmar que pasa**

Run: `npx vitest run tests/authEmailRoutes.test.js`
Expected: PASS, 6/6.

- [ ] **Step 5: Correr la suite completa**

Run: `npx vitest run`
Expected: PASS salvo la falla preexistente y no relacionada de `tests/e2e/scan-cycle.spec.js`.

- [ ] **Step 6: Commit**

```bash
git add api/index.js tests/authEmailRoutes.test.js
git commit -m "feat(auth): endpoints POST /api/auth/password-reset y /api/me/verification-email

Usan generateActionLink + sendMail (Task 1) en vez del envío roto de
Firebase. password-reset responde ok:true incluso si la cuenta no
existe (anti-enumeración) — un fallo real de servidor sí se distingue."
```

---

### Task 3: Página propia `reset-password.html`

**Files:**
- Modify: `firebase-init.js`
- Create: `reset-password.html`
- Create: `reset-password-ui.js`
- Test (nuevo): `tests/reset-password-ui.test.js`

**Interfaces:**
- Consumes: `firebaseAuth`, `verifyPasswordResetCode`, `confirmPasswordReset` (nuevos exports de `firebase-init.js`).
- Produces: `initResetPasswordPage()` y `submitNewPassword(oobCode, newPassword, confirmPassword)`, ambas exportadas de `reset-password-ui.js`.

- [ ] **Step 1: Agregar `verifyPasswordResetCode`/`confirmPasswordReset` a `firebase-init.js`**

En el import desde `firebase-auth.js`, agregar ambos nombres a la lista existente (junto a `sendEmailVerification`/`sendPasswordResetEmail` ya agregados antes):

```js
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  signInWithCustomToken,
  updatePassword,
  verifyBeforeUpdateEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
```

Y en el bloque `export { ... }` al final del archivo, agregar ambos nombres:

```js
export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  signInWithCustomToken,
  updatePassword,
  verifyBeforeUpdateEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset
};
```

- [ ] **Step 2: Escribir el test (RED)**

Crear `tests/reset-password-ui.test.js`:

```js
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
```

- [ ] **Step 3: Correr el test para confirmar que falla**

Run: `npx vitest run tests/reset-password-ui.test.js`
Expected: FAIL — `Cannot find module '../reset-password-ui.js'`.

- [ ] **Step 4: Crear `reset-password.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.gstatic.com https://apis.google.com https://www.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.gstatic.com https://apis.google.com https://www.googleapis.com https://firebaseappcheck.googleapis.com https://content-firebaseappcheck.googleapis.com; frame-src https://*.firebaseapp.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self';">
  <title>Yomi — Restablecer contraseña</title>
  <link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#2DBC9E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="home.css?v=15">
  <link rel="stylesheet" href="styles.css?v=15">
  <style>
    .hidden { display: none !important; }
    .password-field-wrap { position: relative; }
    .btn-toggle-password { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; font-size: 13px; }
  </style>
</head>
<body>
  <div class="app-shell">
    <header class="app-header">
      <img src="assets/redesign/logo.svg" alt="Yomi" class="app-logo">
    </header>
    <main class="app-main content-page">
      <section class="section-heading">
        <h1 class="heading-title">Restablecer contraseña</h1>
        <p class="heading-sub" id="reset-password-sub">Verificando tu enlace…</p>
      </section>

      <div class="content-card">
        <form id="reset-password-form" class="hidden" novalidate>
          <div class="form-field">
            <label for="reset-new-password">Nueva contraseña</label>
            <div class="password-field-wrap">
              <input id="reset-new-password" class="form-input" type="password" required minlength="6" autocomplete="new-password" placeholder="Mínimo 6 caracteres">
              <button type="button" id="btn-toggle-reset-password" class="btn-toggle-password" aria-label="Mostrar contraseña">Ver</button>
            </div>
          </div>
          <div class="form-field">
            <label for="reset-confirm-password">Confirmar contraseña</label>
            <input id="reset-confirm-password" class="form-input" type="password" required minlength="6" autocomplete="new-password" placeholder="Repite tu contraseña">
          </div>
          <button type="submit" id="btn-reset-password-confirm" class="btn btn-primary">Guardar nueva contraseña</button>
        </form>

        <p id="reset-password-error" class="hidden" role="alert"></p>
        <p id="reset-password-success" class="hidden" role="status"></p>
        <a href="auth.html" class="link-button">Volver a iniciar sesión</a>
      </div>
    </main>
  </div>
  <script type="module" src="firebase-init.js"></script>
  <script type="module" src="reset-password-ui.js"></script>
</body>
</html>
```

- [ ] **Step 5: Crear `reset-password-ui.js`**

```js
import { firebaseAuth, verifyPasswordResetCode, confirmPasswordReset } from './firebase-init.js';

function showError(message) {
  const el = document.getElementById('reset-password-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function getOobCode() {
  const params = new URLSearchParams(window.location.search);
  return params.get('oobCode');
}

export async function initResetPasswordPage() {
  const oobCode = getOobCode();
  const sub = document.getElementById('reset-password-sub');
  const form = document.getElementById('reset-password-form');

  if (!oobCode) {
    if (sub) sub.textContent = 'Este enlace no es válido.';
    showError('Falta el código de restablecimiento. Solicita un nuevo enlace desde la pantalla de inicio de sesión.');
    return;
  }

  try {
    const email = await verifyPasswordResetCode(firebaseAuth, oobCode);
    if (sub) sub.textContent = `Ingresa tu nueva contraseña para ${email}.`;
    form?.classList.remove('hidden');
  } catch {
    if (sub) sub.textContent = 'Este enlace no es válido.';
    showError('Este enlace ya expiró o ya fue usado. Solicita uno nuevo desde la pantalla de inicio de sesión.');
  }
}

export async function submitNewPassword(oobCode, newPassword, confirmPassword) {
  const errorEl = document.getElementById('reset-password-error');
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }

  if (newPassword !== confirmPassword) {
    showError('Las contraseñas no coinciden.');
    throw new Error('password_mismatch');
  }

  const btn = document.getElementById('btn-reset-password-confirm');
  const originalText = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    await confirmPasswordReset(firebaseAuth, oobCode, newPassword);
    const successEl = document.getElementById('reset-password-success');
    if (successEl) { successEl.textContent = 'Tu contraseña se actualizó. Redirigiendo a iniciar sesión…'; successEl.classList.remove('hidden'); }
    document.getElementById('reset-password-form')?.classList.add('hidden');
    setTimeout(() => { window.location.href = 'auth.html'; }, 2000);
  } catch (err) {
    showError('No se pudo actualizar tu contraseña. El enlace pudo haber expirado — solicita uno nuevo.');
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    throw err;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initResetPasswordPage();

  const btnToggle = document.getElementById('btn-toggle-reset-password');
  const passwordInput = document.getElementById('reset-new-password');
  if (btnToggle && passwordInput) {
    btnToggle.addEventListener('click', () => {
      const isHidden = passwordInput.type === 'password';
      passwordInput.type = isHidden ? 'text' : 'password';
      btnToggle.textContent = isHidden ? 'Ocultar' : 'Ver';
    });
  }

  const form = document.getElementById('reset-password-form');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const oobCode = getOobCode();
      const newPassword = document.getElementById('reset-new-password').value;
      const confirmPassword = document.getElementById('reset-confirm-password').value;
      submitNewPassword(oobCode, newPassword, confirmPassword).catch(() => {});
    });
  }
});
```

- [ ] **Step 6: Correr el test para confirmar que pasa**

Run: `npx vitest run tests/reset-password-ui.test.js`
Expected: PASS, 6/6.

- [ ] **Step 7: Correr la suite completa**

Run: `npx vitest run`
Expected: PASS salvo la falla preexistente y no relacionada de `tests/e2e/scan-cycle.spec.js`.

- [ ] **Step 8: Commit**

```bash
git add firebase-init.js reset-password.html reset-password-ui.js tests/reset-password-ui.test.js
git commit -m "feat(auth): página propia reset-password.html

Recibe el oobCode del link que ahora mandamos nosotros mismos,
verifica el código y aplica el cambio vía el SDK cliente
(verifyPasswordResetCode + confirmPasswordReset)."
```

---

### Task 4: Rewire `auth-ui.js` y `account-ui.js` a los endpoints nuevos

**Files:**
- Modify: `auth-ui.js`
- Modify: `account-ui.js`
- Modify: `tests/auth-ui.test.js`
- Modify: `tests/account-ui.test.js`

**Interfaces:**
- Consumes: `POST /api/auth/password-reset`, `POST /api/me/verification-email` (Task 2).
- No cambia ninguna firma exportada — `handleForgotPassword`, `handleSignup`, `submitResendVerification` mantienen los mismos nombres/parámetros, solo cambia su implementación interna.

- [ ] **Step 1: Actualizar `tests/auth-ui.test.js` (RED)**

**1a.** En el mock de `../firebase-init.js` (tope del archivo), quitar `sendEmailVerification`/`sendPasswordResetEmail` de la declaración y del objeto que regresa `vi.mock` (ya no los usa `auth-ui.js` tras este task):

```js
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
```

**1b.** Reemplazar el describe `'handleSignup — confirmar contraseña y verificación de correo'` completo (agregado en el plan anterior, al final del archivo) por:

```js
describe('handleSignup — confirmar contraseña y verificación de correo', () => {
  it('rechaza si las contraseñas no coinciden, sin llamar a Firebase', async () => {
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true

    await expect(handleSignup('new@example.com', 'secret123', 'different')).rejects.toThrow(/no coinciden/i)

    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled()
  })

  it('llama POST /api/me/verification-email con el idToken recién obtenido tras crear la cuenta', async () => {
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true
    const getIdToken = vi.fn().mockResolvedValue('tok-new')
    createUserWithEmailAndPassword.mockResolvedValueOnce({ user: { uid: 'abc', getIdToken } })
    global.fetch = vi.fn().mockResolvedValue({ ok: true })

    await handleSignup('new@example.com', 'secret123', 'secret123')

    expect(global.fetch).toHaveBeenCalledWith('/api/me/verification-email', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-new' }
    })
  })

  it('no bloquea el registro si la llamada a /api/me/verification-email falla (best-effort)', async () => {
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true
    const getIdToken = vi.fn().mockResolvedValue('tok-new')
    createUserWithEmailAndPassword.mockResolvedValueOnce({ user: { uid: 'abc', getIdToken } })
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('network down'))

    await expect(handleSignup('new@example.com', 'secret123', 'secret123')).resolves.toBeTruthy()
  })
})
```

**1c.** Reemplazar el describe `'handleForgotPassword'` completo por:

```js
describe('handleForgotPassword', () => {
  it('llama POST /api/auth/password-reset y muestra el mensaje de éxito', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true })

    await handleForgotPassword('user@example.com')

    expect(global.fetch).toHaveBeenCalledWith('/api/auth/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' })
    })
    const successEl = document.getElementById('forgot-password-success')
    expect(successEl.classList.contains('hidden')).toBe(false)
    expect(successEl.textContent).toMatch(/enlace para restablecer/)
  })

  it('muestra un error real (no el mensaje de éxito) si el backend responde no-ok — ya no es una señal de enumeración, es un fallo real', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 })

    await handleForgotPassword('user@example.com')

    const errEl = document.getElementById('auth-error')
    expect(errEl.classList.contains('hidden')).toBe(false)
    const successEl = document.getElementById('forgot-password-success')
    expect(successEl.classList.contains('hidden')).toBe(true)
  })
})
```

(Esto reemplaza contenido de describes que ya estaban al final del archivo — no cambia CUÁNTOS describes/tests hay en qué posición relativa al test frágil `'password toggle aria-label'`, solo su contenido interno. Sigue siendo seguro respecto a esa restricción.)

- [ ] **Step 2: Actualizar `tests/account-ui.test.js` (RED)**

Quitar `sendEmailVerification` del mock de `firebase-init.js` (tope del archivo) — cambiar:

```js
const sendEmailVerification = vi.fn()
...
vi.mock('../firebase-init.js', () => ({ firebaseAuth: mockAuth, signOut, reauthenticateWithCredential, verifyBeforeUpdateEmail, updatePassword, EmailAuthProvider, sendEmailVerification }))
```

por:

```js
vi.mock('../firebase-init.js', () => ({ firebaseAuth: mockAuth, signOut, reauthenticateWithCredential, verifyBeforeUpdateEmail, updatePassword, EmailAuthProvider }))
```

Reemplazar los últimos 2 tests del describe `'aviso de correo no verificado'` (los que usan `sendEmailVerification`) por:

```js
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
```

- [ ] **Step 3: Correr ambos tests para confirmar que fallan**

Run: `npx vitest run tests/auth-ui.test.js tests/account-ui.test.js`
Expected: FAIL en los tests recién reescritos (el código todavía llama a las funciones del SDK cliente, no a `fetch`).

- [ ] **Step 4: Reescribir `handleSignup` y `handleForgotPassword` en `auth-ui.js`**

Quitar `sendEmailVerification, sendPasswordResetEmail` del import de `./firebase-init.js` (vuelve a quedar como estaba antes de agregarlos, ya que ninguno se usa después de este task):

```js
import {
  firebaseAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithCustomToken
} from './firebase-init.js';
```

Dentro de `handleSignup`, reemplazar:

```js
      // Best-effort: un fallo al enviar el correo de verificación no debe
      // impedir que el usuario continúe su registro — la verificación es
      // informativa, nunca bloqueante (ver spec).
      sendEmailVerification(result.user).catch(() => {});
```

por:

```js
      // Best-effort: un fallo al enviar el correo de verificación no debe
      // impedir que el usuario continúe su registro — la verificación es
      // informativa, nunca bloqueante. Antes llamaba sendEmailVerification
      // (SDK cliente) directo, pero ese envío nunca llega — ver
      // docs/superpowers/specs/2026-07-27-custom-auth-emails-design.md.
      fetch('/api/me/verification-email', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
```

Reemplazar la función `handleForgotPassword` completa por:

```js
export async function handleForgotPassword(email) {
  clearError();
  const btn = document.getElementById('btn-send-reset');
  return withLoadingState(btn, 'Enviando…', async () => {
    // El backend (/api/auth/password-reset) ya aplica la protección contra
    // enumeración de cuentas (nunca revela si el correo existe) — un !res.ok
    // aquí es un fallo real de servidor, no una señal de "no existe", así que
    // SÍ se muestra como error real (a diferencia de antes, cuando cualquier
    // fallo de sendPasswordResetEmail se disfrazaba de éxito).
    const res = await fetch('/api/auth/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!res.ok) {
      showError('No se pudo procesar tu solicitud. Intenta de nuevo.');
      return;
    }
    const successEl = document.getElementById('forgot-password-success');
    if (successEl) {
      successEl.textContent = 'Si ese correo tiene una cuenta, te enviamos un enlace para restablecer tu contraseña.';
      successEl.classList.remove('hidden');
    }
  });
}
```

- [ ] **Step 5: Reescribir `submitResendVerification` en `account-ui.js`**

Quitar `sendEmailVerification` del import de `./firebase-init.js`:

```js
import { firebaseAuth, signOut, reauthenticateWithCredential, verifyBeforeUpdateEmail, updatePassword, EmailAuthProvider } from './firebase-init.js';
```

Reemplazar la función `submitResendVerification` completa por:

```js
export async function submitResendVerification() {
  const btn = document.getElementById('btn-resend-verification');
  const originalText = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  try {
    const token = await getIdToken();
    const res = await fetch('/api/me/verification-email', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('resend_failed');
    const successEl = document.getElementById('resend-verification-success');
    if (successEl) { successEl.textContent = 'Correo de verificación enviado.'; successEl.classList.remove('hidden'); }
  } catch (err) {
    showResendVerificationError('No se pudo reenviar el correo de verificación. Intenta de nuevo.');
    throw err;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}
```

- [ ] **Step 6: Correr ambos tests para confirmar que pasan**

Run: `npx vitest run tests/auth-ui.test.js tests/account-ui.test.js`
Expected: PASS en ambos.

- [ ] **Step 7: Correr la suite completa**

Run: `npx vitest run`
Expected: PASS salvo la falla preexistente y no relacionada de `tests/e2e/scan-cycle.spec.js`.

- [ ] **Step 8: Commit**

```bash
git add auth-ui.js account-ui.js tests/auth-ui.test.js tests/account-ui.test.js
git commit -m "fix(auth): usar los endpoints propios de correo en vez del SDK cliente roto

handleForgotPassword, el envío de verificación en handleSignup, y
submitResendVerification ahora llaman a nuestros propios endpoints
(/api/auth/password-reset, /api/me/verification-email) en vez de
sendPasswordResetEmail/sendEmailVerification del SDK cliente, cuyo
envío real nunca llega para este proyecto."
```
