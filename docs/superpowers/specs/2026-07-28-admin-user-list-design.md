# Lista de usuarios en la tab "Usuarios" del panel admin — Diseño

## Contexto

La tab "Usuarios" (agregada en `docs/superpowers/plans/2026-07-27-admin-user-management.md`, implementada 2026-07-28) solo soporta búsqueda exacta por correo/teléfono. Al entrar a la tab sin buscar, se muestra un mensaje estático ("Busca un usuario por correo o teléfono"). El usuario esperaba, además del buscador, poder ver un listado completo de usuarios.

## Por qué no se reutiliza el visor genérico de colecciones

El panel ya tiene un visor paginado genérico (`GET /api/admin/:collection`, `fireListDocs`) usado por `scan_logs`/`reports`/`products_ocr`/`products_nutrition`. No se reutiliza para `users` por dos razones:

1. **Restricción explícita del plan anterior**: `ADMIN_COLLECTIONS` (en `api/firestore.js`) no debe modificarse — `users` no se agrega ahí.
2. **Incompatibilidad de esquema**: `fireListDocs` asume que cada doc guarda su payload en un campo `_data` (string JSON), patrón usado por `scan_logs`/`reports`/cache. Los docs de `users` usan campos nativos de Firestore (`fireUpsertUser`/`fromFirestoreFields`), un esquema completamente distinto. Forzar ambos casos en una función mezclaría dos formatos de documento no relacionados.

Por eso esta feature agrega un endpoint y una función de listado dedicados a `users`, en vez de extender el mecanismo genérico.

## Arquitectura

- **Backend**: nueva función `fireListUsers(pageToken)` en `api/firestore.js` — usa `runQuery` (structured query) contra la colección `users`, `orderBy: createdAt DESC`, `limit: 50`, cursor de paginación vía `startAfter` (valor = `createdAt` del último item de la página anterior). Devuelve `{ items, nextPageToken }`, cada item una fila liviana: `{ uid, email, phoneNumber, displayName, membershipStatus, createdAt }` (no el perfil completo — eso solo se pide al abrir el detalle).
- **Backend**: se extrae `buildUserDetail(uid)` (la lógica ya existente dentro de `searchUserHandler`: `fireGetUserRaw` + `lookupAuthAccount`, armado como `{uid, profile, auth}`) a una función compartida. `searchUserHandler` la usa después de resolver el uid por correo/teléfono; un nuevo handler la usa directo con el uid de la fila clickeada.
- **Rutas nuevas**: `GET /api/admin/users/list?pageToken=` (llama a `fireListUsers`) y `GET /api/admin/users/:uid` (llama a `buildUserDetail`) — ambas bajo `requireAdmin`, mismo patrón que las 3 rutas ya existentes.
- **Frontend**: `loadCollection()` reemplaza el mensaje estático de la rama `users` por una llamada a `loadUserList()`, que pinta filas `.list-card` (mismo patrón visual que las demás tabs) con `displayName || email || phoneNumber`, badge de estado de membresía, y fecha de creación. Reusa el botón/patrón `loadMoreEl` ya existente para paginar.
- **Frontend**: click en una fila (`data-action="view-user"`) llama `GET /api/admin/users/:uid` y pinta la misma card de detalle (`renderUserDetail`) que ya usa el buscador — mismos controles de editar membresía y desactivar/reactivar.
- **Frontend**: se agrega `currentDetailUid` (variable de estado) — se setea cada vez que se pinta una card de detalle, sin importar si vino de búsqueda o de la lista. Los handlers de guardar-membresía/desactivar-cuenta, que hoy refrescan llamando `searchUser(lastUserSearch)`, cambian a refrescar vía `GET /api/admin/users/:uid` usando `currentDetailUid` — así el refresh funciona igual sin importar el origen de la card, y se elimina la dependencia de que `lastUserSearch` siga siendo válido.
- **Frontend**: la card de detalle agrega un botón "← Volver a la lista" que llama `loadUserList()` desde la página 1 (no se preserva scroll/paginación previa — aceptable para una herramienta admin).

## Decisiones explícitas (de la sesión de brainstorming)

- Click en fila de la lista abre la **misma card completa** de detalle (perfil + editar membresía + desactivar/reactivar), no una vista de solo lectura.
- Cada fila muestra correo/teléfono + estado de membresía + fecha de creación (misma densidad que las otras tabs), no solo el identificador.
- Orden: **más reciente primero** (`createdAt DESC`) — requiere `orderBy` vía `runQuery`, no el `documents.list` simple.
- Al entrar a la tab, la lista se carga sola (paginada, igual que las demás tabs). Buscar reemplaza temporalmente la vista por la card de ese usuario; un botón explícito "Volver a la lista" regresa.

## Fuera de alcance (YAGNI, explícitamente diferido)

- Filtro/orden por estado de membresía u otros campos — solo `createdAt DESC`, sin más.
- Proyección de campos en la query de Firestore (`select`) para reducir payload — el volumen actual de usuarios no lo justifica.
- Manejo de colisión de cursor cuando dos usuarios comparten `createdAt` exacto al milisegundo — riesgo muy bajo (ISO string con milisegundos), no se resuelve ahora.

## Errores

- `fireListUsers`: mismo patrón que `findUserByEmail`/`fireGetPhoneIndex` — token/query fallan → throw con mensaje descriptivo; ruta captura y responde 500 con `console.warn` (mismo convenio ya usado en las 3 rutas existentes de `/api/admin/users/*`).
- `GET /api/admin/users/:uid`: 404 si `fireGetUserRaw` devuelve `null` (uid no existe) — mismo criterio que ya usa `searchUserHandler`.
- Frontend: si `loadUserList()` falla (respuesta no-ok), mostrar mensaje de error en `docList` (mismo patrón ya usado en `searchUser`).

## Testing

- `fireListUsers`: tests en `tests/firestore-users.test.js` — página con `nextPageToken`, última página (`nextPageToken: null`), error de Firestore (throw).
- `buildUserDetail` + nuevo handler `getUserByUidHandler`: tests en `tests/adminUsers.test.js` — 404 cuando no existe el uid, 200 con `{uid, profile, auth}`, 500 cuando algún dependency lanza. Se actualizan los tests existentes de `searchUserHandler` si el refactor a `buildUserDetail` cambia algo observable (no debería — mismo comportamiento externo, solo se mueve el código).
- `admin.js` (frontend): sin tests automatizados, consistente con el resto del archivo (patrón ya establecido, documentado en el plan anterior). Verificación manual se agrega al checklist ya pendiente del plan anterior (login, ver lista, paginar con "cargar más", click en una fila, buscar, volver a la lista, editar membresía desde ambos orígenes, desactivar/reactivar desde ambos orígenes).
