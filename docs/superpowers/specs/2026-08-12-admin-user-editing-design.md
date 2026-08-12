# Admin: editar datos de contacto y preferencias de usuarios registrados

## Problema

El panel de administración (`admin/admin.js`, sección Usuarios) permite ver el perfil de un usuario y editar su membresía (para dar cortesías/premium — funcionalidad que ya existía y cubre ese caso), pero no permite:

- Corregir nombre, correo o teléfono de contacto de un usuario.
- Ver o editar las preferencias de salud del usuario (dietas, alergias, condiciones).

## Alcance

**Incluido:**
- Editar `user.profile.{displayName, phone, email}` — los campos de contacto "adicionales" que el propio usuario llena al completar su perfil (endpoint existente `PUT /api/me/profile`). Estos son independientes del correo/teléfono de login.
- Ver y editar `user.preferences.{dietary, allergens, healthConditions}`.

**Explícitamente fuera de alcance:**
- Cambiar el correo/teléfono de login (Firebase Auth, campos top-level `email`/`phoneNumber` del user doc). Decisión: hacerlo requeriría también actualizar Firebase Auth para no romper el acceso del usuario — no se hace en este cambio.
- Cortesías/cuentas premium: ya cubierto por el editor de membresía existente (`PATCH /api/admin/users/:uid/membership`), sin cambios.
- Consentimiento legal de preferencias (`preferences.consentGivenAt`, `consentNoticeVersion`): un admin no debe alterar esos campos; se preservan tal cual al editar dietary/allergens/healthConditions.

## Backend

Dos endpoints nuevos en `api/index.js`, junto a los demás handlers `/api/admin/users/*`, protegidos por `requireAdmin` igual que el resto:

### `PATCH /api/admin/users/:uid/profile`

Body: `{ displayName?, phone?, email? }` (todos opcionales, al menos uno requerido).

Misma validación que `putProfileHandler` (línea ~1645 de `api/index.js`):
- `displayName`: string no vacía, trim, máx 100 caracteres.
- `phone`: debe matchear `E164_RE`.
- `email`: debe matchear `EMAIL_RE`, trim, máx 200 caracteres.

Escribe con `firePatchUserFields(uid, [...fieldPaths], { profile })` sobre `user.profile.*`. No toca `email`/`phoneNumber` top-level.

### `PATCH /api/admin/users/:uid/preferences`

Body: `{ dietary: string[], allergens: {code, severity}[], healthConditions: string[] }` — mismo shape que `PUT /api/me/preferences`.

Misma validación que `putPreferencesHandler` (línea ~1943): reusa las constantes existentes `ALLOWED_DIETARY`, `ALLOWED_HEALTH_CONDITIONS`, `ALLOWED_ALLERGEN_CODES`, `ALLOWED_SEVERITY`.

Escribe `preferences.{dietary, allergens, healthConditions, updatedAt}` vía `firePatchUserFields`. No incluye `consentGivenAt`/`consentNoticeVersion` en los `fieldPaths` — esos campos quedan intactos.

## Frontend

`admin/admin.js`, función `renderUserDetail`: dos secciones nuevas, siguiendo el mismo patrón visual y de wiring que la sección de membresía existente (inputs + botón "Guardar", handler en el bloque de `btn.dataset.action`, refresco de la vista al terminar).

**Datos de contacto:**
- Inputs de texto: nombre, correo, teléfono — precargados desde `profile.profile?.displayName/email/phone` (vacíos si no existen).
- Botón "Guardar datos de contacto" → `PATCH /api/admin/users/:uid/profile` con los tres valores.

**Preferencias:**
- Checkboxes agrupados (dieta / alergias / condiciones de salud), mismas etiquetas y opciones que usa `preferences.html` (`HEALTH_LABELS`, listas `ALLOWED_DIETARY` etc. del lado cliente) — reutilizar labels ya definidos en `preference-labels.js` si aplica, para no duplicar texto.
- Botón "Guardar preferencias" → `PATCH /api/admin/users/:uid/preferences`.

## Error handling

Ambos endpoints devuelven 400 con `{error: 'invalid_...'}` en validación fallida (igual que sus contrapartes `/api/me/*`), 404 si el usuario no existe, 500 en error interno. El frontend muestra el mismo patrón de alerta/error que ya usa `save-membership`.

## Testing

- Casos válidos: guardar nombre/correo/tel; guardar preferencias con selecciones válidas.
- Casos inválidos: correo/tel con formato incorrecto (400), dietary/healthCondition/allergen fuera de whitelist (400), uid inexistente (404).
- Verificar que `preferences.consentGivenAt` no cambia tras editar desde admin.
- Verificar que editar `profile.email`/`profile.phone` no afecta el login del usuario (campos top-level `email`/`phoneNumber` intactos).
