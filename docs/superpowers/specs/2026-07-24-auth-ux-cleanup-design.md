# Limpieza UX/UI del flujo de registro/login

## Problema

El flujo de `auth.html` (login/signup por correo/teléfono/Google) tiene varios defectos de UX/UI encontrados en revisión manual:

1. El botón "Ahora no" en `preferences.html` (saltar preferencias durante onboarding) no tiene ningún estilo visual.
2. Al crear cuenta por correo, el botón "Confirmar creación de cuenta" aparece antes (arriba) de los checkboxes de Términos/edad, en vez de después.
3. No se pide confirmar la contraseña al crear cuenta por correo — un typo en la contraseña original queda sin detectar hasta el primer intento de login fallido.
4. No hay verificación de correo — Firebase nunca envía el correo de confirmación, `emailVerified` queda `false` para siempre sin que nadie lo note.
5. No existe forma de recuperar contraseña olvidada.

## Diseño

### 1. Botón "Ahora no" sin estilo

Causa raíz: la clase `.link-button` (usada tanto en `preferences.html` como en varios botones de `auth.html`) solo está definida dentro del `<style>` inline de `auth.html` — nunca en un CSS compartido. `preferences.html` la usa (`id="btn-skip-preferences" class="link-button"`) pero nunca la recibe.

Arreglo: mover la regla `.link-button { ... }` del `<style>` inline de `auth.html` a `home.css` (ya cargado por ambas páginas). Sin cambios de markup en ningún archivo — cualquier botón con esa clase, en cualquier página que cargue `home.css`, queda estilizado consistentemente.

### 2. Botón de confirmar antes de los checkboxes

Causa raíz: en `auth.html`, el bloque `<div id="signup-only">` (checkboxes de Términos/edad + botón de teléfono) vive físicamente **después** del `</form>` que contiene `#btn-signup` (el botón que `auth-ui.js` renombra a "Confirmar creación de cuenta" en modo signup). Visualmente: email, contraseña, botón de confirmar, *luego* los checkboxes.

Arreglo: dado que `#signup-only` también se usa (como pantalla independiente) para el consentimiento del flujo de teléfono — donde `#login-view` completo está oculto — no puede anidarse dentro de `#login-view` sin romper esa pantalla. En vez de eso, los botones (`btn-login`/`btn-back-to-login`/`btn-signup`) se extraen a su propio bloque hermano `#login-actions`, colocado *después* de `#signup-only` en el DOM (usando el atributo HTML `form="login-form"` en `#btn-login` para que el submit nativo del formulario siga funcionando pese a vivir fuera de `<form>`). `setView()` gana una línea para ocultar/mostrar `#login-actions` igual que ya hace con `#login-view`.

### 3. Confirmar contraseña al crear cuenta

Nuevo campo `<input id="signup-password-confirm">`, dentro de `#signup-only` (visible solo en modo signup, igual que los checkboxes). En `handleSignup`, antes de llamar a Firebase: si `password !== passwordConfirm`, error inline ("Las contraseñas no coinciden.") y no continúa — mismo patrón ya usado en `account-ui.js::submitPasswordEdit` para el mismo caso.

### 4. Verificación de correo (no bloqueante)

- `firebase-init.js` exporta `sendEmailVerification` (ya existe en el SDK de Firebase Auth, solo falta importarlo/re-exportarlo, mismo patrón que `verifyBeforeUpdateEmail`).
- `handleSignup` (solo el flujo de correo/contraseña — Google y teléfono no aplican, ya vienen verificados por su proveedor) llama `sendEmailVerification(result.user)` justo después de crear la cuenta, sin esperar su resultado para continuar el flujo (best-effort, un fallo aquí no debe bloquear el registro).
- En `account-ui.js`, si `firebaseAuth.currentUser` tiene provider `password` y `!firebaseAuth.currentUser.emailVerified`, se muestra una fila discreta "Tu correo no está verificado" con botón "Reenviar correo de verificación" (llama `sendEmailVerification` de nuevo, muestra confirmación inline). No bloquea ninguna otra función de la cuenta.

### 5. Recuperar contraseña

- Nuevo link "¿Olvidaste tu contraseña?" (`link-button`) bajo el campo de contraseña en la vista de login.
- Nueva vista `forgot-password` en el mismo sistema `setView()` ya existente en `auth-ui.js` (mismo patrón que `phone-number`/`phone-code`): un solo campo de correo + botón "Enviar enlace" + link para volver a login.
- Usa `sendPasswordResetEmail(firebaseAuth, email)` (Firebase, sin backend nuevo). **Siempre** muestra el mismo mensaje de éxito ("Si ese correo tiene una cuenta, te enviamos un enlace para restablecer tu contraseña.") sin importar si `sendPasswordResetEmail` fallara con `auth/user-not-found` — evita revelar qué correos están registrados (protección estándar contra enumeración de cuentas).

## Qué NO cambia

- Ningún endpoint de backend nuevo — todo lo de este spec usa Firebase Auth client-side (`sendEmailVerification`, `sendPasswordResetEmail`) o es puro reordenamiento de markup/CSS.
- La verificación de correo **no bloquea** ningún flujo existente (registro, pago de membresía, escaneo) — es informativa únicamente.
- El check de correo duplicado (`auth/email-already-in-use` → "Ya existe una cuenta con ese correo.") ya funciona hoy vía `mapAuthError`, no se toca.
- Google/teléfono no llevan verificación de correo (no aplica a esos métodos de login).

## Archivos afectados

- `auth.html`: mover `.link-button` a `home.css`; reordenar `#signup-only` dentro del form; agregar campo de confirmar contraseña; agregar link + vista `forgot-password`.
- `home.css`: nueva regla `.link-button`.
- `auth-ui.js`: `handleSignup` valida confirmación de contraseña y dispara `sendEmailVerification`; nuevas funciones `handleForgotPassword`/wiring de la vista `forgot-password` en `setView()`.
- `firebase-init.js`: importar/re-exportar `sendEmailVerification` y `sendPasswordResetEmail`.
- `account-ui.js`: nueva fila de aviso "correo no verificado" + botón de reenviar.
