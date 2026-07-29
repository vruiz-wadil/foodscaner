# Integración real de Stripe para membresía — Diseño

## Problema

El flujo de membresía (`docs/superpowers/specs/2026-07-24-subscription-management-design.md`) ya está implementado en producción, pero el "pago" es simulado: `payMembershipHandler` escribe `membershipStatus: 'active'` directo en Firestore vía `fireRecordMembershipPayment(uid)`, sin cobrar nada (`amount: 0`, `method: 'simulado'`). `cancelMembershipHandler`/`reactivateMembershipHandler` solo togglean el campo local `autoRenew`, sin ninguna pasarela real detrás. El campo `autoRenew` se dejó preparado a propósito para este momento.

Se necesita reemplazar la simulación por Stripe real: cobro recurrente mensual de **$29.90 MXN**, vía Stripe Checkout hospedado (sin construir formulario de tarjeta propio).

## Diseño

### Provisión (Vercel Marketplace)

- Instalar integración nativa: `vercel integration add stripe --yes` (paso "connectable" — puede requerir completar vinculación de cuenta Stripe en el dashboard/browser antes de continuar).
- `vercel env pull --yes` para traer `STRIPE_SECRET_KEY` (provista por la integración) al entorno local.
- Vars manuales, no provistas por la integración:
  - `STRIPE_PRICE_ID`: se crea un Product + Price recurrente ($29.90 MXN, mensual) en el Stripe Dashboard (modo test primero), y se pega el `price_...` resultante como env var en Vercel.
  - `STRIPE_WEBHOOK_SECRET`: se crea un webhook endpoint en Stripe Dashboard apuntando a `https://<dominio>/api/webhooks/stripe` y se copia su signing secret. Necesita **un endpoint distinto por entorno** (producción `www.yomi.mx` y, si se prueba ahí, el preview de Vercel) — cada uno tiene su propio secret.

### Modelo de datos (Firestore, doc `users/{uid}`)

Campos nuevos:
- `stripeCustomerId: string | null` — id del Customer de Stripe, creado en el primer checkout.
- `stripeSubscriptionId: string | null` — id de la Subscription activa.

`paymentHistory` deja de tener entradas fijas `{amount: 0, method: 'simulado'}`; cada entrada real queda `{ date: ISO, amount: 29.90, currency: 'mxn', method: 'stripe', stripeInvoiceId: string }`. El `stripeInvoiceId` sirve de clave de idempotencia: antes de agregar una entrada, el helper de fulfillment revisa si ya existe una con ese id (el webhook de Stripe puede reintentar la misma entrega).

`autoRenew` mantiene su nombre y semántica (¿se auto-cobrará el próximo periodo?), pero ahora es un espejo de `cancel_at_period_end` en Stripe en vez de un booleano puramente local — se sincroniza vía webhook cada vez que cambia en Stripe.

### Backend — checkout

`POST /api/me/membership/pay` (misma ruta que hoy, usada tanto para el pago inicial de onboarding como para "Renovar membresía" en cuentas pending/expired) cambia de comportamiento:
1. Si el usuario no tiene `stripeCustomerId`, crea un Customer en Stripe (`email`, `metadata.firebaseUid: uid`) y lo guarda.
2. Crea una Checkout Session: `mode: 'subscription'`, `line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }]`, `customer: stripeCustomerId`, `client_reference_id: uid`, `success_url: '<origin>/account.html?stripe=success&session_id={CHECKOUT_SESSION_ID}'`, `cancel_url: '<origin>/account.html?stripe=cancel'`.
3. Responde `{ ok: true, checkoutUrl }` (ya no `{ membershipStatus, membershipExpiresAt }` — esos solo se saben después de que el usuario paga en Stripe).

No hay más escritura directa a `membershipStatus` en este handler — eso ahora solo lo hace el fulfillment (ver abajo), disparado por webhook o por la verificación de retorno.

### Backend — fulfillment idempotente

Nuevo helper `fireFulfillStripeSubscription({ uid, subscription, invoice })` en `api/firestore.js`, reemplaza el uso de `fireRecordMembershipPayment` para el caso real (ese helper simulado se elimina, ya no tiene consumidores). Dado un `stripeInvoiceId`:
1. Si ya existe en `paymentHistory` → no-op (idempotente, para reintentos de webhook).
2. Si no, en una sola escritura con precondición (mismo patrón retry-on-409 que ya usa `fireIncrementUsageCounter`): fija `membershipStatus: 'active'`, `membershipExpiresAt` (= `subscription.current_period_end` convertido a ISO), `lastPaymentAt`, `stripeCustomerId`, `stripeSubscriptionId`, `autoRenew: !subscription.cancel_at_period_end`, y agrega la entrada a `paymentHistory`.

Este helper se llama desde dos lugares (ambos deben poder ejecutarlo con seguridad, de ahí la idempotencia):

- **`GET /api/me/membership/checkout-result?session_id=`** (nuevo, requireUser): al volver de Stripe, para que la UI no tenga que esperar al webhook. Recupera la Checkout Session (`stripe.checkout.sessions.retrieve(session_id, { expand: ['subscription', 'invoice'] })`), valida que `client_reference_id === req.user.uid` y `payment_status === 'paid'`, y llama al fulfillment. Responde el estado de membresía actualizado.
- **`POST /api/webhooks/stripe`** (nuevo, sin auth, monta `express.raw({ type: 'application/json' })` en esta ruta específica, registrado **antes** del `express.json()` global de la línea 43 para no perder el body crudo). Verifica firma con `STRIPE_WEBHOOK_SECRET` vía `stripe.webhooks.constructEvent`. Maneja:
  - `checkout.session.completed` → fulfillment (cubre el caso en que el usuario cierra la pestaña antes de volver a `success_url`).
  - `invoice.paid` (renovaciones mensuales automáticas, sin que el usuario haga nada) → fulfillment con la nueva `stripeInvoiceId`.
  - `customer.subscription.updated` → sincroniza `autoRenew` desde `cancel_at_period_end` (cubre cancelar/reactivar hecho fuera de nuestra UI, y confirma lo que hicimos nosotros).
  - `customer.subscription.deleted` → `autoRenew: false` (la expiración real de acceso la sigue decidiendo, como hoy, el chequeo perezoso de `membershipExpiresAt` en `requireActiveMembership` — este webhook no fuerza `membershipStatus: 'expired'`).
  - Cualquier otro evento → 200 sin acción (Stripe reintenga si no hay 200).

### Backend — cancelar / reactivar

`POST /api/me/membership/cancel` y `POST /api/me/membership/reactivate` mantienen sus rutas y sus respuestas de error (`409 not_active` si `membershipStatus !== 'active'`, `404 user_not_found`). Cambia la implementación: antes de tocar Firestore, llaman `stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: true|false })`. Si el usuario no tiene `stripeSubscriptionId` (cuenta activa de antes de esta migración, nunca pasó por Stripe real), el patch de Firestore ocurre igual que hoy (solo local) — no hay nada que sincronizar con Stripe todavía.

### Frontend (`account-ui.js`)

- Botón "Renovar membresía": el submit ya no actualiza el hub directo — recibe `{ checkoutUrl }` y hace `window.location.href = checkoutUrl`.
- Al cargar `account.html`, revisa `URLSearchParams`:
  - `stripe=success&session_id=...` → llama `GET /api/me/membership/checkout-result`, en éxito `syncUserProfile()` + `renderAccountHub()`, limpia los params de la URL con `history.replaceState`.
  - `stripe=cancel` → toast "Pago cancelado", limpia params.
- Bloque "Suscripción" (auto-renovar/cancelar/historial) y modal de cancelar: sin cambios de UI — mismos endpoints, misma forma de respuesta (`{ ok, autoRenew }`).

## Qué NO cambia

- Cuentas con `membershipStatus: 'active'` de antes de este cambio (sin `stripeCustomerId`) conservan acceso hasta su `membershipExpiresAt` actual, sin migración forzada. Cuando expiren y usen "Renovar membresía", entran al flujo Stripe real por primera vez.
- `requireActiveMembership` no cambia — sigue basándose solo en `membershipStatus`/`membershipExpiresAt`.
- El bloque "Suscripción" y el modal de cancelar en `account-ui.js` no cambian de diseño visual, solo lo que hay detrás de los botones.
- No se usa el Customer Portal de Stripe ni Elements embebido — todo pago pasa por Checkout hospedado.

## Archivos afectados

- `api/firestore.js`: nuevos campos default en `fireUpsertUser`, nuevo helper `fireFulfillStripeSubscription`, elimina `fireRecordMembershipPayment` (simulado, sin más consumidores).
- `api/index.js`: nueva inicialización del cliente Stripe (`STRIPE_SECRET_KEY`), `payMembershipHandler` reescrito (crea Checkout Session), nuevo `checkoutResultHandler` + ruta `GET /api/me/membership/checkout-result`, nuevo `stripeWebhookHandler` + ruta `POST /api/webhooks/stripe` (con `express.raw` montado antes del `express.json()` global), `cancelMembershipHandler`/`reactivateMembershipHandler` llaman Stripe antes de Firestore.
- `account-ui.js`: botón renovar redirige a `checkoutUrl`, manejo de `?stripe=success|cancel` al cargar `account.html`.
- `package.json`: nueva dependencia `stripe` (SDK oficial de Node).
- Env vars nuevas (Vercel): `STRIPE_SECRET_KEY` (via integración), `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`.
