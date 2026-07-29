# Página propia de yomi.mx para verificación de correo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El link de verificación de correo deja de apuntar a la página genérica hosteada de Firebase y apunta a una página propia de Yomi (`verify-email.html`), mismo patrón ya usado para `reset-password.html`.

**Architecture:** Backend (`verificationEmailHandler`) pasa un `continueUrl` a `generateActionLink`, igual que ya hace `passwordResetHandler`. Frontend agrega `applyActionCode` al SDK re-exportado en `firebase-init.js`, y una página nueva (`verify-email.html` + `verify-email-ui.js`) que lee el `oobCode` de la URL, llama `applyActionCode`, y redirige a Mi cuenta en éxito.

**Tech Stack:** Firebase Auth JS SDK (`applyActionCode`), Express, vitest, jsdom.

## Global Constraints

- `continueUrl` usa el mismo patrón que `passwordResetHandler`: `const baseUrl = process.env.APP_BASE_URL || 'https://yomi.mx';` — esto es lo que permite seguir probando en el alias estable de preview de Vercel sin tocar código.
- Tras verificar exitosamente, la página redirige a `account.html` (decisión explícita del usuario) — NO a `auth.html`.
- Sin formulario en `verify-email.html` — solo mensaje de estado + link "Volver a iniciar sesión".
- No se toca `passwordResetHandler`, `reset-password.html`, `reset-password-ui.js`, ni el banner "correo no verificado"/`submitResendVerification()` en Mi cuenta — todos siguen igual, solo cambia a dónde apunta el link que genera `verificationEmailHandler`.

---

### Task 1: `verificationEmailHandler` pasa `continueUrl`

**Files:**
- Modify: `api/index.js` (función `verificationEmailHandler`, ~línea 1590)
- Test: `tests/authEmailRoutes.test.js` (ya existe — reemplaza el `describe('verificationEmailHandler', ...)` actual)

**Interfaces:**
- Consumes: `generateActionLink(email, requestType, continueUrl)` (ya existente en `api/emailActions.js`, sin cambios en su firma).
- Produces: sin cambios de firma pública — `verificationEmailHandler` sigue siendo `(req, res) => Promise<void>`, exportado igual que antes.

- [ ] **Step 1: Escribir los tests que fallan**

Reemplaza el `describe('verificationEmailHandler', ...)` completo (líneas 101-126 de `tests/authEmailRoutes.test.js`) por:

```js
describe('verificationEmailHandler', () => {
  const ORIGINAL_APP_BASE_URL = process.env.APP_BASE_URL

  beforeEach(() => { generateActionLink.mockReset(); sendMail.mockReset() })
  afterEach(() => {
    if (ORIGINAL_APP_BASE_URL === undefined) delete process.env.APP_BASE_URL
    else process.env.APP_BASE_URL = ORIGINAL_APP_BASE_URL
  })

  it('genera el link de VERIFY_EMAIL con continueUrl a verify-email.html (cae a yomi.mx sin APP_BASE_URL) y lo manda', async () => {
    delete process.env.APP_BASE_URL
    generateActionLink.mockResolvedValue('https://yomi.mx/verify-email.html?oobCode=xyz')
    sendMail.mockResolvedValue(undefined)
    const req = { user: { uid: 'uid-1', email: 'user@example.com' } }
    const res = makeRes()

    await verificationEmailHandler(req, res)

    expect(generateActionLink).toHaveBeenCalledWith('user@example.com', 'VERIFY_EMAIL', 'https://yomi.mx/verify-email.html')
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'user@example.com' }))
    expect(res.body).toEqual({ ok: true })
  })

  it('usa APP_BASE_URL para el continueUrl cuando está configurado (ej. el alias estable de preview)', async () => {
    process.env.APP_BASE_URL = 'https://foodscaner-git-develop-wadil-ai-studio-s-projects.vercel.app'
    generateActionLink.mockResolvedValue('https://foodscaner-git-develop-wadil-ai-studio-s-projects.vercel.app/verify-email.html?oobCode=xyz')
    sendMail.mockResolvedValue(undefined)
    const req = { user: { uid: 'uid-1', email: 'user@example.com' } }
    const res = makeRes()

    await verificationEmailHandler(req, res)

    expect(generateActionLink).toHaveBeenCalledWith('user@example.com', 'VERIFY_EMAIL', 'https://foodscaner-git-develop-wadil-ai-studio-s-projects.vercel.app/verify-email.html')
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

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/authEmailRoutes.test.js -t "verificationEmailHandler"`
Expected: FAIL — la primera y segunda prueba esperan 3 argumentos en `generateActionLink`, el código actual solo pasa 2

- [ ] **Step 3: Implementar en `api/index.js`**

Cambia `verificationEmailHandler` (~línea 1590) de:

```js
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
```

a:

```js
async function verificationEmailHandler(req, res) {
  try {
    const baseUrl = process.env.APP_BASE_URL || 'https://yomi.mx';
    const oobLink = await generateActionLink(req.user.email, 'VERIFY_EMAIL', `${baseUrl}/verify-email.html`);
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
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/authEmailRoutes.test.js`
Expected: PASS (todos los tests del archivo, incluyendo `passwordResetHandler` sin cambios)

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/authEmailRoutes.test.js
git commit -m "feat(auth): verificationEmailHandler apunta el link a verify-email.html en vez de Firebase"
```

---

### Task 2: Página `verify-email.html` + `verify-email-ui.js`

**Files:**
- Modify: `firebase-init.js` (agrega `applyActionCode` al import/export)
- Create: `verify-email.html`
- Create: `verify-email-ui.js`
- Test: `tests/verify-email-ui.test.js` (nuevo)

**Interfaces:**
- Consumes: `POST /api/me/verification-email` (Task 1, ya genera el link con `continueUrl` a esta página) — esta página no llama a ese endpoint, solo consume el `oobCode` que llega por query string en el link que ese endpoint manda por correo.
- Produces: `initVerifyEmailPage(): Promise<void>` — exportado desde `verify-email-ui.js`, corre en `DOMContentLoaded`.

- [ ] **Step 1: Escribir el test que falla**

Crea `tests/verify-email-ui.test.js`:

```js
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockAuth = {}
const applyActionCode = vi.fn()

vi.mock('../firebase-init.js', () => ({
  firebaseAuth: mockAuth,
  applyActionCode
}))

let initVerifyEmailPage

function setUrl(search) {
  delete window.location
  window.location = { search, href: '' }
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.useFakeTimers()
  setUrl('')
  document.body.innerHTML = `
    <p id="verify-email-sub"></p>
    <p id="verify-email-error" class="hidden" role="alert"></p>
    <p id="verify-email-success" class="hidden" role="status"></p>
  `
  const mod = await import('../verify-email-ui.js')
  initVerifyEmailPage = mod.initVerifyEmailPage
})

afterEach(() => {
  vi.useRealTimers()
})

describe('initVerifyEmailPage', () => {
  it('muestra error si falta oobCode en la URL, sin llamar a Firebase', async () => {
    setUrl('')
    await initVerifyEmailPage()
    expect(applyActionCode).not.toHaveBeenCalled()
    const errEl = document.getElementById('verify-email-error')
    expect(errEl.classList.contains('hidden')).toBe(false)
  })

  it('verifica el código, muestra éxito, y redirige a account.html tras 2s', async () => {
    setUrl('?oobCode=abc123')
    applyActionCode.mockResolvedValueOnce(undefined)

    await initVerifyEmailPage()

    expect(applyActionCode).toHaveBeenCalledWith(mockAuth, 'abc123')
    const successEl = document.getElementById('verify-email-success')
    expect(successEl.classList.contains('hidden')).toBe(false)
    expect(window.location.href).toBe('')
    vi.advanceTimersByTime(2000)
    expect(window.location.href).toBe('account.html')
  })

  it('muestra error si el código es inválido/expirado, sin redirigir', async () => {
    setUrl('?oobCode=expired')
    applyActionCode.mockRejectedValueOnce({ code: 'auth/invalid-action-code' })

    await initVerifyEmailPage()

    const errEl = document.getElementById('verify-email-error')
    expect(errEl.classList.contains('hidden')).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(window.location.href).toBe('')
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/verify-email-ui.test.js`
Expected: FAIL — no se puede resolver `../verify-email-ui.js`

- [ ] **Step 3: Agregar `applyActionCode` a `firebase-init.js`**

Cambia el import del SDK (~línea 7-24) agregando `applyActionCode` al final de la lista, antes de `} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";`:

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
  confirmPasswordReset,
  applyActionCode
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
```

Cambia el bloque de re-exports (~línea 52-68) agregando `applyActionCode`:

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
  confirmPasswordReset,
  applyActionCode
};
```

- [ ] **Step 4: Crear `verify-email.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.gstatic.com https://apis.google.com https://www.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.gstatic.com https://apis.google.com https://www.googleapis.com https://firebaseappcheck.googleapis.com https://content-firebaseappcheck.googleapis.com; frame-src https://*.firebaseapp.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self';">
  <title>Yomi — Verificar correo</title>
  <link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#2DBC9E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="home.css?v=15">
  <link rel="stylesheet" href="styles.css?v=15">
  <style>
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="app-shell">
    <header class="app-header">
      <img src="assets/redesign/logo.svg" alt="Yomi" class="app-logo">
    </header>
    <main class="app-main content-page">
      <section class="section-heading">
        <h1 class="heading-title">Verificar correo</h1>
        <p class="heading-sub" id="verify-email-sub">Verificando tu enlace…</p>
      </section>

      <div class="content-card">
        <p id="verify-email-error" class="hidden" role="alert"></p>
        <p id="verify-email-success" class="hidden" role="status"></p>
        <a href="auth.html" class="link-button">Volver a iniciar sesión</a>
      </div>
    </main>
  </div>
  <script type="module" src="firebase-init.js"></script>
  <script type="module" src="verify-email-ui.js"></script>
</body>
</html>
```

- [ ] **Step 5: Crear `verify-email-ui.js`**

```js
import { firebaseAuth, applyActionCode } from './firebase-init.js';

function showError(message) {
  const el = document.getElementById('verify-email-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function showSuccess(message) {
  const el = document.getElementById('verify-email-success');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function getOobCode() {
  const params = new URLSearchParams(window.location.search);
  return params.get('oobCode');
}

export async function initVerifyEmailPage() {
  const oobCode = getOobCode();
  const sub = document.getElementById('verify-email-sub');

  if (!oobCode) {
    if (sub) sub.textContent = 'Este enlace no es válido.';
    showError('Falta el código de verificación. Solicita un nuevo enlace desde Mi cuenta.');
    return;
  }

  try {
    await applyActionCode(firebaseAuth, oobCode);
    if (sub) sub.textContent = 'Tu correo fue verificado.';
    showSuccess('Tu correo fue verificado. Redirigiendo a Mi cuenta…');
    setTimeout(() => { window.location.href = 'account.html'; }, 2000);
  } catch {
    if (sub) sub.textContent = 'Este enlace no es válido.';
    showError('Este enlace ya expiró o ya fue usado. Solicita uno nuevo desde Mi cuenta.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initVerifyEmailPage();
});
```

- [ ] **Step 6: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/verify-email-ui.test.js`
Expected: PASS (3/3 tests)

- [ ] **Step 7: Commit**

```bash
git add firebase-init.js verify-email.html verify-email-ui.js tests/verify-email-ui.test.js
git commit -m "feat(auth): agrega verify-email.html, página propia para confirmar verificación de correo"
```

- [ ] **Step 8: Verificación manual**

1. `vercel dev` (o el flujo local de desarrollo del proyecto) o deploy a preview.
2. Iniciar sesión con una cuenta de correo/contraseña con el correo sin verificar (o crear una nueva).
3. En Mi cuenta, click "Reenviar correo de verificación" — **una sola vez**, sin repetir el click (un reenvío adicional invalida el código anterior).
4. Abrir el correo recibido — confirmar que el link apunta al dominio de la app (yomi.mx o el alias de preview), no a `*.firebaseapp.com`.
5. Click el link — debe mostrar "Tu correo fue verificado." y redirigir a Mi cuenta tras ~2s; el aviso de "correo no verificado" ya no debe aparecer.
6. Probar un link ya usado (click el mismo link de nuevo) — debe mostrar el mensaje de error con el link "Volver a iniciar sesión", sin redirigir.

---

## Verificación final (tras las 2 tasks)

Correr la suite completa: `npx vitest run` — debe dar el mismo resultado base ya conocido en este repo (todos los tests de vitest en verde; el único archivo que falla es `tests/e2e/scan-cycle.spec.js`, un problema de configuración de Playwright preexistente y no relacionado). Completar la verificación manual del Task 2 Step 8 antes de dar el feature por terminado.
