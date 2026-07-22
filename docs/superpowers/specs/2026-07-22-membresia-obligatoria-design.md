# Membresía obligatoria + onboarding completo — diseño

Fecha: 2026-07-22
Ambiente objetivo: `develop` (Firebase project `foodscaner-dev`). Se replica a prod cuando se promueva.

## Contexto

Desde el spec de 2026-07-15 (`2026-07-15-user-accounts-design.md`), Yomi tiene cuentas de usuario con `plan: 'free'|'premium'` — free podía loguearse gratis, con cuota de 5 OCR/día y sin acceso a preferencias/historial nube. Esto cambia: **ya no existe un plan gratuito**. Todo registro (Google, teléfono, correo+contraseña) requiere pagar una membresía (simulada por ahora — sin Stripe/Mercado Pago todavía, solo un checkbox "pagar"). Si la membresía no se renueva, la cuenta se desactiva.

Adicionalmente, el registro debe recolectar datos que hoy no se piden: nombre, teléfono y correo (solo los que falten según el método usado), y las preferencias dietéticas/alergias/condiciones de salud — antes exclusivas de "premium", ahora parte del alta de cualquier cuenta.

Fuera de alcance: billing real (Stripe/Mercado Pago/Conekta), cron de expiración (se resuelve con chequeo perezoso), plan familiar, borrado de la cuenta de Firebase Auth al expirar (solo se bloquea el acceso vía Firestore, la cuenta Auth persiste), y el flujo de escaneo anónimo (sin login) — que sigue sin límites, sin cambios, según ya funciona hoy vía `optionalUser`.

## Principio rector

Un usuario sin membresía activa es, en la práctica, equivalente a un usuario sin cuenta: no tiene preferencias, no tiene historial en la nube, no puede usar el OCR de ingredientes. La única diferencia entre "sin cuenta" (anónimo) y "cuenta pendiente/expirada" es que el segundo ya tiene un registro en Firebase Auth y puede completar/reactivar su membresía sin volver a registrarse.

## Modelo de datos — `users/{uid}` (cambios sobre el spec de 2026-07-15)

Se elimina `plan`, `planUpdatedAt`, y el campo `disabled` (nunca se leía en ningún lado — placeholder muerto). Se reemplaza por:

```jsonc
{
  "email": "...", "emailVerified": true,
  "displayName": "...", "phoneNumber": "...",   // igual que hoy, vienen del provider
  "providers": ["password"], "createdAt": "...", "lastLoginAt": "...",

  // NUEVO — se piden explícitamente en el onboarding, sin importar el
  // provider usado. Ausentes/null hasta que el usuario los llena en
  // onboarding-profile.html.
  "profile": {
    "displayName": "...",   // si el provider ya lo dio (Google), se prellena
                              // y no se vuelve a pedir
    "phone": "...",         // formato E.164, mismo ALLOWED que auth por teléfono
    "email": "...",         // si el provider ya lo dio (Google/email-password),
                              // no se vuelve a pedir
    "completedAt": null      // ISO date, se fija cuando los 3 campos ya están
  },

  // REEMPLAZA a plan/planUpdatedAt
  "membershipStatus": "pending",  // "pending" | "active" | "expired"
  "membershipExpiresAt": null,    // ISO date — se fija a hoy+30d al "pagar"
  "lastPaymentAt": null,          // ISO date del último pago (simulado)

  "billing": { /* sin cambios — placeholder para billing real futuro */ },

  // usage.ocrCount y su límite de 5/día SE ELIMINAN (ver sección Límites).
  // cacheRefreshCount se deja intacto (campo inerte, nunca tuvo gate real,
  // no vale la pena tocarlo). totalScans sigue igual (contador simple).
  "usage": { "date": "...", "cacheRefreshCount": 0, "totalScans": 0 },

  // preferences: SIN CAMBIO DE FORMA respecto al spec anterior (dietary,
  // allergens, healthConditions, consentGivenAt, consentNoticeVersion,
  // updatedAt). Cambia SOLO la condición de visibilidad/escritura: antes
  // `plan==='premium'`, ahora `membershipStatus==='active'`.
  "preferences": { "dietary": [...], "allergens": [...], "healthConditions": [...], "updatedAt": "..." }
}
```

Decisión: `membershipStatus` es el único campo de control de acceso — se elimina la duplicación con `disabled` que existía sin usarse.

## Middlewares (`api/index.js`)

- **`requireUser`** — sin cambios de comportamiento (verifica JWT, adjunta `req.user`). Sigue siendo la única puerta para: `/api/auth/sync`, `GET /api/me`, `PUT /api/me/profile` (nuevo), `POST /api/me/membership/pay` (nuevo), `POST /api/me/scan`.
- **`requireActiveMembership`** (nuevo, se monta DESPUÉS de `requireUser` en la cadena de middlewares) — hace el chequeo perezoso de expiración:
  1. Lee `fireGetUser(req.user.uid)`.
  2. Si no existe el doc → 404 `{error: 'user_not_found'}`.
  3. Si `membershipStatus === 'active'` y `membershipExpiresAt` ya pasó → `firePatchUserFields` pone `membershipStatus: 'expired'` y responde 402 `{error: 'membership_expired'}`.
  4. Si `membershipStatus !== 'active'` (pending o expired) → 402 `{error: 'membership_required'}` (pending) o `{error: 'membership_expired'}` (expired) — el frontend distingue el mensaje ("completa tu registro" vs "renueva tu membresía") por este código.
  5. Si activa y vigente → adjunta `req.membershipUser = user` (evita un segundo GET en el handler) y `next()`.
- Se usa en: `ocrProcessHandler`, `PUT /api/me/preferences`, `DELETE /api/me/preferences`, `POST /api/me/history`, `GET /api/me/history`. **No** se usa en `postScanHandler` (el contador `totalScans` es de "cualquier estado", como ya está documentado en el código actual — sin cambio).

## Flujo de onboarding

```
signup (Google/teléfono/correo) + consent Términos/edad  →  SIN CAMBIO
        ↓ auth-ui.js redirige aquí en vez de index.html
onboarding-profile.html (nuevo)
  — muestra SOLO los inputs de displayName/phone/email que falten
  — PUT /api/me/profile { displayName?, phone?, email? }  (requireUser, sin
    gate de membresía — es solo contacto)
        ↓
preferences.html?onboarding=1  (existente, reusada)
  — MISMA UI de dietary/allergens/healthConditions + consent de salud
  — NO llama a PUT /api/me/preferences todavía (la cuenta no está activa,
    el endpoint lo rechazaría). Guarda la selección en
    sessionStorage['yomi_pending_preferences'] al continuar.
  — botón "Continuar" Y el link "Ahora no" navegan a
    onboarding-membership.html (con o sin selección guardada)
        ↓
onboarding-membership.html (nuevo)
  — checkbox "Pagar membresía (simulado)" + botón "Confirmar pago"
  — POST /api/me/membership/pay  →  membershipStatus:'active',
    membershipExpiresAt: hoy+30d, lastPaymentAt: hoy
  — si sessionStorage['yomi_pending_preferences'] existe: inmediatamente
    después PUT /api/me/preferences con esos datos (ya permitido, cuenta
    activa), luego sessionStorage.removeItem(...)
        ↓
index.html
```

Cada paso valida que el anterior se completó leyendo `GET /api/me` al cargar (si `profile.completedAt` es null, `onboarding-profile.html` se vuelve a mostrar aunque el usuario navegue directo a otra URL — evita saltarse pasos por URL manual).

## Endpoints nuevos/modificados (`api/index.js`)

- **`PUT /api/me/profile`** (nuevo, `requireUser`) — body `{ displayName?, phone?, email? }`. Solo actualiza los campos presentes en el body (no pisa los que el provider ya dio). Valida: `displayName` no vacío tras trim, `phone` con el mismo `E164_RE` que ya usa `phoneSendHandler`, `email` con regex simple de formato. `updateMask.fieldPaths` explícito sobre `profile.displayName`/`profile.phone`/`profile.email`. Si tras el patch los 3 campos quedan no-vacíos (considerando los que ya vinieron del provider), fija `profile.completedAt`.
- **`POST /api/me/membership/pay`** (nuevo, `requireUser`, sin `requireActiveMembership` — es la acción que activa) — sin body (simulado). Fija `membershipStatus:'active'`, `membershipExpiresAt: hoy+30d` (ISO), `lastPaymentAt: hoy`. Sirve tanto para el alta inicial como para renovar desde `account.html`. `updateMask` sobre esos 3 campos.
- **`GET /api/me`** — cambia la condición de `if (user.plan === 'premium' && preferences)` a `if (user.membershipStatus === 'active' && preferences)`. Regresa también `membershipStatus`, `membershipExpiresAt`, `profile` completos siempre (el frontend los necesita para decidir a qué paso de onboarding mandar al usuario, sin gate).
- **`PUT/DELETE /api/me/preferences`, `POST/GET /api/me/history`** — se agrega `requireActiveMembership` en la cadena de middleware; se elimina el chequeo manual `if (user.plan !== 'premium') return res.status(403)...` de dentro de cada handler (ya lo resuelve el middleware antes de entrar).
- **`ocrProcessHandler`** — se elimina `OCR_FREE_DAILY_LIMIT` y todo el bloque de conteo/cuota (líneas 1101-1136 actuales). Nuevo comportamiento: si `req.user` existe (usuario logueado, vía `optionalUser` como hoy), debe tener `membershipStatus==='active'` — si no, 402 `membership_required`/`membership_expired`. Si `req.user` es `null` (anónimo, sin login) — **sin cambio**, sigue sin límite (fuera de alcance).

## Eliminado (ya no aplica sin plan free)

- `OCR_FREE_DAILY_LIMIT` y su chequeo en `ocrProcessHandler`.
- El chequeo `!req.user.emailVerified && !req.user.phoneNumber` para bloquear cuota (ya no hay cuota que bloquear).
- `shouldShowHomeUpsell()` en `home.js` y el banner "hazte premium" — se borra la función y su uso en `home.js`.
- Badge free/premium en `account-ui.js` — se reemplaza por badge de `membershipStatus` (Activa / Pendiente / Expirada).
- `history-ui.js`: `renderLocalHistoryWithUpsell` pasa a ser el fallback para "pending"/"expired" (sin mensaje de upsell premium, solo "activa tu membresía para guardar historial en la nube").
- `app.js:1725`/`1750` (`profile.plan !== 'premium'` para personalización de veredicto) — cambia a `profile.membershipStatus !== 'active'`.

## Manejo de errores

- `requireActiveMembership` — 402 (no 403: 402 Payment Required comunica mejor "falta pagar/renovar" que "prohibido") con `{error: 'membership_required'}` (nunca pagó) o `{error: 'membership_expired'}` (pagó antes, venció). El frontend (`preferences-ui.js`, `history-ui.js`, `app.js` en scan) muestra un CTA distinto para cada uno: "completa tu registro" → `onboarding-membership.html`, "renueva" → `account.html`.
- `PUT /api/me/profile` — 400 `{error: 'invalid_display_name'}` / `invalid_phone'}` / `invalid_email'}` según el campo que falle validación.
- Igual que hoy: fallas transitorias de Firestore en `/api/auth/sync` y `/api/me/membership/pay` no bloquean el login/pago del lado de Firebase Auth (que ya ocurrió) — se loguea `warn` con solo el `uid`.

## Cambios de frontend fuera de `api/index.js`

- `auth-ui.js` — `handleLogin`, `handleSignup`, `handleGoogleSignIn`, `handlePhoneSignupConsent`: cambian `window.location.href = 'index.html'` por `'onboarding-profile.html'`.
- `onboarding-profile.html` + `onboarding-profile-ui.js` (nuevos) — formulario simple, un input por campo faltante, botón "Continuar" → `PUT /api/me/profile` → redirige a `preferences.html?onboarding=1`.
- `preferences.html` / `preferences-ui.js` — con `?onboarding=1`: el botón "Guardar" se relabelea "Continuar", se agrega un link "Ahora no", y en vez de llamar `PUT /api/me/preferences` + mostrar éxito, guarda el formulario en `sessionStorage` y redirige a `onboarding-membership.html`. Sin el query param, comportamiento actual sin cambios (usuario con membresía activa editando preferencias desde `account.html`).
- `onboarding-membership.html` + `onboarding-membership-ui.js` (nuevos) — checkbox + botón, `POST /api/me/membership/pay`, luego flush de `sessionStorage['yomi_pending_preferences']` si existe, redirige a `index.html`.
- `account.html` / `account-ui.js` — badge de `membershipStatus`; si `expired`, banner + botón "Renovar membresía" (mismo checkbox simulado, mismo endpoint `POST /api/me/membership/pay`).
- `home.js`, `history-ui.js`, `app.js` — reemplazos de `plan==='premium'`/`plan!=='premium'` por `membershipStatus==='active'`/`!==`, según el detalle de la sección "Eliminado" arriba.

## Testing

- Unit: `requireActiveMembership` — activa+vigente pasa; pending → 402 `membership_required`; expirada (fecha pasada) → 402 `membership_expired` + verifica que el patch a Firestore se haya llamado (auto-corrección perezosa).
- Integración: `PUT /api/me/profile` crea/actualiza solo los campos presentes, fija `completedAt` solo cuando los 3 están completos; `POST /api/me/membership/pay` fija `membershipStatus:'active'` y `membershipExpiresAt` a +30 días exactos; `PUT /api/me/preferences` en cuenta `pending` → 402 (antes 403 premium_required); `GET /api/me` no regresa `preferences` si `membershipStatus!=='active'`.
- Se actualizan los tests existentes que asumían `plan: 'free'|'premium'` (`putPreferences.test.js`, `ocrQuota.test.js` — este último se elimina o se reduce a probar solo el gate de membresía, ya no cuota numérica; `firestore-users.test.js`, `account-ui.test.js`, `meScan.test.js`).
- Sigue el patrón/convenciones ya existentes en `tests/` (vitest).

## Preguntas abiertas (no bloquean este spec, quedan para después)

- Precio/periodicidad real de la membresía simulada (¿siempre 30 días, o distingue mensual/anual como el doc de negocio original?) — se deja en 30 días fijos para el MVP simulado; se resuelve cuando se integre billing real.
- Notificación previa al usuario antes de que expire (email/push "tu membresía vence en 3 días") — no se construye en este spec, es mejora de producto posterior.
