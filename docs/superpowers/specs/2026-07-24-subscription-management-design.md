# Administrar suscripción (estilo Netflix) — Diseño

## Problema

Hoy `account.html` solo muestra un badge de estado de membresía (Activa/Pendiente/Expirada) y, si no está activa, un botón "Renovar membresía" (pago simulado, sin pasarela real). No hay forma de:
- Ver cuándo se renovará o vence la membresía activa.
- Cancelar la renovación (dejar de auto-renovarse, conservando acceso hasta el vencimiento — patrón Netflix).
- Reactivar antes de que expire, si ya se había cancelado.
- Ver un historial de pagos anteriores.

No existe pasarela de pago real todavía (el botón actual solo simula el cobro con $0). El usuario planea integrar Stripe con cargo automático más adelante — este diseño debe dejar el modelo de datos listo para eso (un flag de auto-renovación que un futuro cron/webhook de Stripe pueda leer), sin implementar Stripe ahora.

## Diseño

### Modelo de datos (Firestore, doc `users/{uid}`)

Dos campos nuevos, inicializados en `fireUpsertUser` (rama de usuario nuevo) junto a los campos de membresía existentes:
- `autoRenew: boolean` — default `false` (no tiene sentido hasta el primer pago).
- `paymentHistory: array<{ date: string(ISO), amount: number, method: string }>` — default `[]`.

`payMembershipHandler` (el endpoint existente `POST /api/me/membership/pay`, usado tanto en el pago inicial de onboarding como en "Renovar membresía" para cuentas pending/expired) se extiende para, en la misma escritura:
- Seguir fijando `membershipStatus: 'active'`, `membershipExpiresAt` (+30 días), `lastPaymentAt`.
- Fijar `autoRenew: true` (todo pago, simulado o real, implica intención de auto-renovarse — igual que suscribirse en Netflix).
- Agregar una entrada a `paymentHistory`: `{ date: <now ISO>, amount: 0, method: 'simulado' }`.

Como esto requiere leer el arreglo actual antes de escribir (no hay operación atómica de "append" en la capa REST de Firestore que ya usa este proyecto), se agrega un helper nuevo en `api/firestore.js`, `fireRecordMembershipPayment(uid)`, que sigue el mismo patrón de reintento con precondición que ya usa `fireIncrementUsageCounter` (lee con `fireGetUserRaw`, escribe con `firePatchUserFieldsWithPrecondition`, reintenta hasta 3 veces si hay conflicto 409). `payMembershipHandler` pasa a llamar este helper en vez de escribir los campos directo.

### Cancelar / reactivar (nuevos endpoints)

- `POST /api/me/membership/cancel` (requireUser): si `membershipStatus !== 'active'` → 409 `{ error: 'not_active' }`. Si es activa, fija `autoRenew: false` (patch simple, sin precondición — es un solo booleano, no un arreglo). **No** toca `membershipStatus` ni `membershipExpiresAt` — el usuario conserva acceso completo hasta que venza, igual que cancelar en Netflix. Cuando el middleware `requireActiveMembership` detecte que `membershipExpiresAt` ya pasó (chequeo perezoso que ya existe), la cuenta pasa a `expired` normalmente — el sistema nunca intenta cobrar de nuevo hoy (no hay cron), así que este flag no cambia el comportamiento actual de expiración, solo documenta la intención del usuario para cuando exista cobro automático real.
- `POST /api/me/membership/reactivate` (requireUser): si `membershipStatus !== 'active'` → 409 `{ error: 'not_active' }` (reactivar una cuenta ya expirada/pendiente es lo que ya hace "Renovar membresía" vía `/api/me/membership/pay`, sin tocar este endpoint). Si es activa, fija `autoRenew: true`. Sin cobro, sin cambiar `membershipExpiresAt`.

### UI — `account.html` / `account-ui.js`

Nuevo bloque "Suscripción", visible únicamente cuando `membershipStatus === 'active'` (el bloque existente de "Renovar membresía" para pending/expired no cambia, sigue mostrándose solo cuando `!isActive`; nunca se solapan). Se ubica en el mismo lugar donde hoy está ese bloque de renovación (justo después de la fila de preferencias).

Contenido del bloque, según `autoRenew` (se trata como `true` salvo que sea explícitamente `false` — cubre cuentas activas de antes de este cambio que aún no tienen el campo, para las que asumir "se renovará" es lo correcto ya que nunca cancelaron):
- `autoRenew !== false`: "Se renovará automáticamente el {membershipExpiresAt formateado}." + botón-texto "Cancelar suscripción".
- `autoRenew === false`: "Vence el {membershipExpiresAt formateado} — no se renovará." + botón-texto "Reactivar suscripción".

Debajo, "Historial de pagos": lista de `paymentHistory`, más reciente primero, cada fila `{fecha formateada} — $0.00 (simulado)`. Si el arreglo está vacío, no se renderiza la lista (no debería pasar para una cuenta activa, pero es defensivo).

Fechas se formatean con `toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })` (ej. "22 ago 2026"), sin utilidad compartida nueva — no hay una existente en el proyecto para reusar, y es una sola línea en un solo archivo.

**Cancelar**: abre el modal genérico ya existente en `account-ui.js` (mismo helper `openModal`/`closeModal` que usan correo/teléfono-SMS/contraseña), con:
- Título: "¿Cancelar tu suscripción?"
- Cuerpo: "Conservas acceso completo hasta el {fecha}. Después de esa fecha no se te volverá a cobrar y tu cuenta pasará a inactiva."
- Botones: "Volver" (cierra modal, sin acción) / "Sí, cancelar" (llama `POST /api/me/membership/cancel`, en éxito hace `syncUserProfile()` + `renderAccountHub()` + `closeModal()`).

**Reactivar**: sin modal, un solo click llama `POST /api/me/membership/reactivate`, en éxito `syncUserProfile()` + `renderAccountHub()`.

## Qué NO cambia

- El flujo de pago inicial (onboarding) y "Renovar membresía" para pending/expired (`POST /api/me/membership/pay`) mantiene su comportamiento visible actual — solo gana los 2 efectos secundarios nuevos (`autoRenew: true` + entrada en `paymentHistory`) de forma transparente.
- El middleware `requireActiveMembership` no cambia — sigue basándose solo en `membershipStatus`/`membershipExpiresAt`.
- No se integra Stripe ni ninguna pasarela real en este diseño — `amount` siempre es `0` y `method` siempre `'simulado'`.
- No se muestra ningún precio/monto real en la UI (no existe ninguno definido en el sistema hoy).

## Archivos afectados

- `api/firestore.js`: nuevos defaults en `fireUpsertUser` (rama usuario nuevo), nuevo helper `fireRecordMembershipPayment(uid)`.
- `api/index.js`: `payMembershipHandler` usa el nuevo helper; nuevos handlers `cancelMembershipHandler`/`reactivateMembershipHandler` + rutas `POST /api/me/membership/cancel` y `POST /api/me/membership/reactivate`.
- `account-ui.js`: nuevo bloque "Suscripción" (render condicional + historial), reusa el modal genérico existente para cancelar, dos nuevas funciones exportadas `submitCancelSubscription`/`submitReactivateSubscription`.
