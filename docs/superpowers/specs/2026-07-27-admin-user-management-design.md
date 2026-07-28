# Gestión de usuarios en el panel de administración

## Problema

El panel admin (`admin/index.html` + `admin/admin.js`) tiene tabs para `scan_logs`, `reports`, `products_ocr`, `products_nutrition` y `cache`, todos respaldados por el visor genérico de colecciones (`/api/admin/:collection`, `ADMIN_COLLECTIONS` en `api/firestore.js`). `users` NO está en `ADMIN_COLLECTIONS` — no hay forma de buscar un usuario por correo/teléfono, ver su perfil completo, desactivar su cuenta o ajustar su membresía manualmente desde el panel. Hoy esas operaciones requieren tocar Firestore/Firebase Auth a mano.

## Diseño

### Backend

Nuevo módulo `api/adminUsers.js`:

- `findUserByEmail(email)` — Firestore `runQuery` sobre la colección `users` con `where email == <email>` (match exacto), `limit 1`. Sigue el patrón de `fireListUserHistory` en `api/firestore.js` (mismo endpoint `:runQuery`, mismo `getAccessToken`), pero contra la colección raíz `users` en vez de una subcolección.
- `lookupAuthAccount(uid)` — Identity Toolkit `accounts:lookup` con `{localId: [uid]}`, reusando `getAuthAccessToken`/`getAuthServiceAccount` ya exportados de `api/phoneAuth.js`. Devuelve `{disabled, emailVerified}` leídos directo de Firebase Auth (fuente de verdad real, no el espejo en Firestore).
- `setUserDisabled(uid, disabled)` — Identity Toolkit `accounts:update` con `{localId: uid, disableUser: disabled}`. Mismo patrón exacto que `setPhoneNumberClaim` en `api/phoneAuth.js` (mismo endpoint, mismo token).

Rutas nuevas en `api/index.js`, todas tras `requireAdmin` (igual que el resto de `/api/admin/*`):

- `GET /api/admin/users/search?q=<valor>` — si `q` contiene `@`, busca por email (`findUserByEmail`); si no, trata `q` como teléfono E.164 completo y resuelve el `uid` vía `fireGetPhoneIndex(q)` (ya existente). Con el `uid` resuelto: `fireGetUserRaw(uid)` (perfil Firestore) + `lookupAuthAccount(uid)` (estado real de Auth), combinados en una sola respuesta JSON. Responde 404 si no hay match en ningún caso (email sin resultado, teléfono sin entrada en `phoneIndex`, o `uid` resuelto pero sin doc en `users`).
- `PATCH /api/admin/users/:uid/membership` — body `{membershipStatus, membershipExpiresAt}`. Usa `firePatchUserFields` (ya existente, sin el lock optimista de `firePatchUserFieldsWithPrecondition` — ese lock existe para proteger el flujo real de pago contra carreras concurrentes; una edición manual de un admin actuando solo no tiene ese riesgo).
- `POST /api/admin/users/:uid/disabled` — body `{disabled: true|false}`. Llama `setUserDisabled`.

### Frontend

`admin/index.html`:
- Nueva tab en el sidebar: `<button class="tab-btn" data-col="users">👤 Usuarios</button>`.

`admin/admin.js`:
- `SECTION_TITLES` gana `users: 'Usuarios'`.
- `FILTER_PLACEHOLDERS` gana `users: 'Correo o teléfono (+52...)'`.
- El toolbar existente (`filterInput`) se reutiliza como buscador para esta tab, en vez de filtro-en-memoria de una lista ya cargada. Se agrega un botón "Buscar" al toolbar (oculto salvo en la tab `users`) que dispara la búsqueda al hacer click o al presionar Enter sobre `filterInput`.
- `loadCollection()` gana una rama `currentCol === 'users'`: no autocarga nada (sin lista, sin paginación) — solo deja el buscador listo y limpia cualquier resultado previo.
- Funciones nuevas:
  - `searchUser(q)` — llama `GET /api/admin/users/search?q=<q>`, maneja 404 (sin resultado) y errores de red.
  - `renderUserDetail(data)` — renderiza una sola card (no lista) con el resultado.

**Card de resultado** muestra: uid, email, teléfono, displayName, badge de estado Auth ("Activa" / "Desactivada", según `lookupAuthAccount.disabled`), membership actual (status + expiresAt formateado), providers, createdAt/lastLoginAt, `usage.totalScans`. Dos acciones:

1. Form inline de membresía: `<select>` con status (`pending`/`active`/`expired`) + `<input type="date">` (opcional, puede quedar vacío) para `membershipExpiresAt` + botón "Guardar" → `PATCH .../membership`. El valor del `<input type="date">` (`YYYY-MM-DD`) se convierte a ISO datetime (`new Date(valor + 'T00:00:00.000Z').toISOString()`, igual formato que ya usa `fireRecordMembershipPayment`) antes de enviarlo; si el campo queda vacío se manda `membershipExpiresAt: null`. Mismo patrón `disabled=true` + texto `'…'` mientras carga que ya usan los botones `btn-del` existentes en el archivo.
2. Botón "Desactivar cuenta" / "Reactivar cuenta" (la etiqueta cambia según el estado actual) con `confirm()` antes de ejecutar, mismo patrón que los botones destructivos existentes (`del`, `del-cache`).

Sin resultado → mensaje "No se encontró ningún usuario con ese correo/teléfono." (reutiliza la clase `.empty-msg` ya existente). Errores de red/servidor → `alert()`, igual que el resto del panel (`admin.js` no importa `toast.js` en ningún otro lugar — confirmado, se mantiene esa convención).

Tras guardar membresía o cambiar el estado de la cuenta con éxito, se vuelve a pedir el mismo usuario (`searchUser` con el último `q` usado) para refrescar la card con los datos reales, en vez de mutar el estado local a mano.

## Qué NO cambia

- `ADMIN_COLLECTIONS` — no se agrega `users` ahí; el visor genérico no es el mecanismo para esto (necesita búsqueda por campo, no listado paginado por ID).
- El flujo de pago real (`fireRecordMembershipPayment` / `firePatchUserFieldsWithPrecondition`) — la edición manual de admin es un camino aparte, sin el lock optimista.
- Ningún endpoint público (`/api/me/*`) — todo lo nuevo vive bajo `/api/admin/*`, protegido por `requireAdmin`.
- Sin búsqueda parcial/prefijo — solo match exacto de correo o teléfono completo (decisión explícita del usuario).

## Archivos afectados

- Nuevo: `api/adminUsers.js`.
- Modifica: `api/index.js` (3 rutas nuevas bajo `/api/admin/users/*`).
- Modifica: `admin/index.html` (tab nueva).
- Modifica: `admin/admin.js` (buscador + render de card + acciones).
