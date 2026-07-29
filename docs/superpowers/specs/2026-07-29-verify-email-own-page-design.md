# Página propia de yomi.mx para confirmar verificación de correo — Diseño

## Contexto

`docs/superpowers/specs/2026-07-27-custom-auth-emails-design.md` implementó el envío propio de correos de auth (SMTP.com + `generateActionLink`) porque Firebase Auth no despachaba realmente estos correos. Para `VERIFY_EMAIL`, ese diseño decidió deliberadamente NO pasar `continueUrl` ("aprobado como suficiente ya que no requiere formulario") — el link resultante apunta a la página hosteada genérica de Firebase (`…firebaseapp.com/__/auth/action`).

Al probarlo en vivo, el usuario reportó que el link llega directo a Firebase (no a yomi.mx) — quiere el mismo tratamiento de marca que ya tiene `reset-password.html`. (Nota aparte, ya resuelta durante el debugging: un "expirado" reportado en el camino fue causado por reenvíos de prueba consecutivos invalidando el código anterior, no un bug de código — confirmado con una prueba limpia de un solo reenvío.)

## Diseño

Mismo patrón que ya existe para `PASSWORD_RESET`, aplicado a `VERIFY_EMAIL`:

- **Backend** (`api/index.js`, `verificationEmailHandler`): agrega `const baseUrl = process.env.APP_BASE_URL || 'https://yomi.mx';` y pasa `${baseUrl}/verify-email.html` como `continueUrl` a `generateActionLink(email, 'VERIFY_EMAIL', continueUrl)` — mismo patrón exacto que ya usa el handler de `password-reset` (esto también es lo que permite seguir probando en previews de Vercel vía `APP_BASE_URL`, no solo en producción).
- **`firebase-init.js`**: agrega `applyActionCode` al import desde el SDK de Firebase Auth y a la lista de re-exports — mismo patrón ya usado para `verifyPasswordResetCode`/`confirmPasswordReset`.
- **`verify-email.html`** (nuevo): mismo esqueleto visual que `reset-password.html` (mismo `<head>`, CSP, `app-shell`/`app-header`/`content-card`) pero SIN formulario — solo un mensaje de estado y un link de vuelta.
- **`verify-email-ui.js`** (nuevo): lee `oobCode` de la query string. Si falta, muestra error inmediato ("Este enlace no es válido"). Si está presente, llama `applyActionCode(firebaseAuth, oobCode)`:
  - Éxito: muestra "Tu correo fue verificado. Redirigiendo a Mi cuenta…" y hace `setTimeout(() => window.location.href = 'account.html', 2000)`.
  - Error (código expirado/ya usado/inválido — cualquier excepción de `applyActionCode`): muestra "Este enlace ya expiró o ya fue usado. Solicita uno nuevo desde Mi cuenta." + link "Volver a iniciar sesión" (`auth.html`), sin redirect automático.

## Testing

- `tests/authEmailRoutes.test.js` (ya existe, cubre `verificationEmailHandler`): agrega/actualiza el test que verifica los argumentos de `generateActionLink` — debe incluir el `continueUrl` esperado (`${baseUrl}/verify-email.html`), igual que el test ya existente para `password-reset` verifica su propio `continueUrl`.
- `tests/reset-password-ui.test.js` ya existe y cubre `initResetPasswordPage`/`submitNewPassword` — `verify-email-ui.js` agrega `tests/verify-email-ui.test.js` con la misma estructura (mock de `firebase-init.js`, casos: sin `oobCode`, éxito, error).

## Fuera de alcance

- No se toca el flujo de `password-reset` (ya usa `continueUrl` correctamente).
- No se cambia nada del banner "correo no verificado" en Mi cuenta ni de `submitResendVerification()` — siguen llamando al mismo endpoint, solo cambia a dónde apunta el link que ese endpoint genera.
