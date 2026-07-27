# Envío propio de correos de Auth (reset de contraseña + verificación)

## Problema

Firebase Auth (tier básico, `subtype: "FIREBASE_AUTH"` en la config del proyecto — no Identity Platform) no despacha realmente los correos de "restablecer contraseña" ni "verificar correo", sin importar la configuración de SMTP custom que se le ponga en la consola (confirmado empíricamente: cero conexiones salientes al servidor SMTP configurado, en múltiples puertos, con credenciales ya verificadas como correctas vía una prueba SMTP cruda independiente). Es una limitación de producto, no un bug de configuración.

## Diseño

### Infraestructura de correo compartida

- `api/mailer.js` (nuevo): expone `sendMail({ to, subject, html })`, usando `nodemailer` (nueva dependencia — reimplementar el protocolo SMTP a mano no vale la pena) con un transport SMTP configurado desde `SMTPCOM_HOST`/`SMTPCOM_PORT`/`SMTPCOM_USERNAME`/`SMTPCOM_PASSWORD`/`SMTPCOM_SENDER_EMAIL` (ya en `.env`, verificados con una prueba SMTP directa — auth exitosa en los puertos 80/2525/587/465).
- `api/phoneAuth.js` exporta su helper existente `getAuthAccessToken` (ya usado para el claim de teléfono) para reusar la misma lógica de token OAuth de service account, sin duplicarla.
- `api/emailActions.js` (nuevo): `generateActionLink(email, requestType, continueUrl)` — llama `POST https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode` autenticado con el OAuth del service account (no la API key pública — se necesita el modo privilegiado para que Firebase regrese el link real en vez de solo intentar enviarlo él mismo), con `returnOobLink: true`. `requestType` es `'PASSWORD_RESET'` o `'VERIFY_EMAIL'`; `continueUrl` + `canHandleCodeInApp: true` solo se pasan para el caso de reset (para que el link apunte a nuestra propia página en vez de la genérica de Firebase). Regresa el `oobLink` de la respuesta.

### Endpoints nuevos

- `POST /api/auth/password-reset` — público, body `{ email }`. Ya cubierto por el rate-limit global existente (`/api/` → 60 req/min). Llama `generateActionLink(email, 'PASSWORD_RESET', 'https://yomi.mx/reset-password.html')`, arma el correo con plantilla de marca Yomi y lo manda con `sendMail`. Si `generateActionLink` falla porque la cuenta no existe (Identity Toolkit responde `EMAIL_NOT_FOUND`), no se manda ningún correo pero se responde el mismo éxito genérico que el resto de casos — mismo principio anti-enumeración de cuentas ya aplicado en el frontend. Un error real de servidor (cualquier otro código) sí se distingue y responde `500`.
- `POST /api/me/verification-email` — autenticado (`requireUser`), sin body (usa `req.user.email`). Llama `generateActionLink(email, 'VERIFY_EMAIL')` (sin `continueUrl` — el link apunta a la página de confirmación genérica que Firebase ya hostea, aprobado como suficiente ya que no requiere formulario) y manda el correo. Esta ruta no necesita protección anti-enumeración (ya requiere sesión activa).

### Frontend

- `firebase-init.js` agrega `verifyPasswordResetCode`, `confirmPasswordReset` a los imports/exports (mismo patrón que el resto de funciones del SDK ya re-exportadas).
- `reset-password.html` + `reset-password-ui.js` (nuevo, mismo estilo visual que `auth.html`): lee `oobCode` de la query string. Llama `verifyPasswordResetCode(auth, oobCode)` para validar el código y obtener el correo asociado (se muestra como contexto, ej. "Restableciendo contraseña para ana@ejemplo.com"); si el código es inválido/expiró, muestra error claro sin formulario. Si es válido, muestra formulario de nueva contraseña + confirmar (mismo patrón de validación ya usado en el signup de `auth.html`: deben coincidir antes de enviar). Al confirmar, llama `confirmPasswordReset(auth, oobCode, newPassword)`; en éxito, redirige a `auth.html` con un mensaje de éxito.
- `auth-ui.js::handleForgotPassword(email)` deja de llamar `sendPasswordResetEmail` (roto) y en su lugar hace `POST /api/auth/password-reset`. La UI sigue mostrando el mismo mensaje de éxito genérico en el camino feliz; si el `fetch` mismo falla (network) o el backend responde `500`, se muestra un error real (no se disfraza como éxito — la protección anti-enumeración es sobre "¿existe la cuenta?", no sobre "¿el servidor está caído?").
- `account-ui.js::submitResendVerification()` deja de llamar `sendEmailVerification` (roto) y en su lugar hace `POST /api/me/verification-email` con el Bearer token, mismo patrón que el resto de `submit*` autenticados del archivo.

## Qué NO cambia

- La UI de "Olvidé mi contraseña" en `auth.html` (campo de correo, botón, mensaje genérico) no cambia de forma — solo cambia a qué endpoint llama.
- El aviso de "correo no verificado" en Mi cuenta no cambia de forma — solo cambia a qué endpoint llama su botón de reenviar.
- No se toca la configuración de Firebase Auth ya hecha (SMTP custom queda configurado en la consola por si algún día el proyecto se actualiza a Identity Platform y empieza a funcionar solo, pero el código deja de depender de que funcione).
- Sin backend nuevo para SMS/teléfono — esto es exclusivo de los flujos de correo.

## Archivos afectados

- Nuevo: `api/mailer.js`, `api/emailActions.js`, `reset-password.html`, `reset-password-ui.js`.
- Modifica: `api/phoneAuth.js` (exporta `getAuthAccessToken`), `api/index.js` (2 rutas nuevas), `firebase-init.js` (2 exports nuevos), `auth-ui.js` (`handleForgotPassword`), `account-ui.js` (`submitResendVerification`), `package.json` (agrega `nodemailer`).
