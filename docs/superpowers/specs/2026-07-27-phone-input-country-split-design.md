# Separar código de país en los inputs de teléfono (onboarding + Mi cuenta)

## Problema

`auth.html` ya tiene un selector de país (`COUNTRY_CODES`) + input de número local para el login por teléfono. Pero otros 3 inputs de teléfono en la app siguen siendo un solo campo de texto donde el usuario debe teclear el número completo en formato E.164 (`+525512345678`), inconsistente con el patrón ya establecido:

1. `onboarding-profile.html` — campo "Teléfono" del onboarding inicial.
2. `account-ui.js` — fila "Teléfono" editable inline (cuentas con login por correo/Google).
3. `account-ui.js` — input "Nuevo número" dentro del modal de cambio de teléfono (cuentas con login por teléfono).

## Diseño

### Helper compartido

`country-codes.js` gana una función nueva, `splitE164(phone)`, que recibe un E.164 completo y regresa `{ dial, local }` — empareja el prefijo `dial` más largo posible entre las entradas de `COUNTRY_CODES` (para no confundir, ej., `+1` de EE.UU. con `+1246` de Barbados), y si no hay match, cae a `{ dial: '+52', local: phone.replace(/^\+/, '') }` como default seguro. Solo se necesita para pre-llenar un valor YA EXISTENTE (el teléfono-contacto de `account-ui.js`); los otros dos campos siempre arrancan vacíos, así que no lo usan.

### Markup (los 3 lugares)

Mismo patrón exacto que ya usa `auth.html`/`auth-ui.js`:
- `<select>` de país, poblado con `COUNTRY_CODES.map(c => `<option value="${c.dial}">${c.name} (${c.dial}) ${flagEmoji(c.iso2)}</option>`)`, México primero/seleccionado por default.
- `<input type="tel">` solo con el número local (sin código de país).

### Reconstrucción al guardar

Igual que `handleSendCode` en `auth-ui.js`: `dialCode + localNumber.replace(/\D/g, '')` — se sigue mandando al backend como un solo string E.164, sin cambios en ningún endpoint (`PUT /api/me/profile`, `POST /api/auth/phone/send`, `POST /api/me/phone/change` siguen recibiendo el mismo formato de siempre).

### Por archivo

- **`onboarding-profile.html`/`onboarding-profile-ui.js`**: reemplaza el único input por select+input. Siempre arranca vacío (el campo entero ya se oculta si `profile.phoneNumber` existe). Al enviar, reconstruye y manda como `phone` en el body de `PUT /api/me/profile`, sin cambios en `onboarding-profile-ui.js` más allá de leer los 2 campos en vez de 1.
- **`account-ui.js` — fila teléfono-contacto inline**: el HTML de la fila en modo edición cambia de un solo input a select+input. Al ENTRAR en modo edición, usa `splitE164(phoneContact)` para pre-llenar ambos campos con el valor actual. Al guardar (`submitPhoneContactEdit`), reconstruye antes de mandar el PUT.
- **`account-ui.js` — modal de cambio de teléfono (login por teléfono)**: el input "Nuevo número" dentro de `openPhoneChangeModal` cambia a select+input. Siempre arranca vacío (es para un número NUEVO, no el actual). `submitPhoneSendCode` reconstruye antes de mandar a `/api/auth/phone/send`.

## Qué NO cambia

- Ningún endpoint de backend — todos siguen recibiendo/validando el mismo string E.164 completo.
- El campo de código de verificación SMS (`input-phone-code`) no se toca.
- `COUNTRY_CODES`/`flagEmoji` no cambian, solo se reusan en más lugares.

## Archivos afectados

- Modifica: `country-codes.js` (nueva función `splitE164`).
- Modifica: `onboarding-profile.html`, `onboarding-profile-ui.js`.
- Modifica: `account-ui.js` (2 ubicaciones: fila de teléfono-contacto y el modal de cambio de teléfono).
