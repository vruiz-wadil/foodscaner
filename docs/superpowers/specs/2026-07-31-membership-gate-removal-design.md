# Desmontar el gate forzado de membresía (1 de 4: CTAs comerciales)

## Contexto

`onboarding-membership.html` hoy es un paywall duro: sin precio visible, sin comparación de features, sin salida. Copy actual: *"Yomi funciona con una membresía de pago — sin ella no hay cuenta activa."* Único botón: "Continuar al pago" → Stripe. Si el usuario no paga, `home.js:83-88` (`redirectTargetForIncompleteOnboarding`) lo redirige de vuelta a esa misma pantalla en cada visita futura mientras `membershipStatus === 'pending'` — no hay forma de usar una cuenta creada sin pagar.

Esto fue señalado independientemente por 3 agentes especializados (growth, offer, UX) como el problema estructural #1 antes de agregar cualquier CTA nuevo — patrón de "forced continuity/roach motel", riesgo de contracargos/reputación en una app de salud.

Este es el primero de 4 specs independientes para hacer la app "comercialmente más llamativa" — los otros 3 (teaser de veredicto personalizado, CTA proactivo post-preferencias, cuentas familiares/compartir viral) quedan fuera de este spec, ciclo aparte.

## Cambio

### 1. `onboarding-membership.html` — pantalla de valor + precio + salida real

Reemplaza el `<label class="consent-block">` + botón único por:

- Tabla comparativa gratis vs. premium (5 filas: escaneo por código de barras, veredicto básico, análisis personalizado, escaneo de ingredientes por foto, historial en la nube — las 2 primeras en ambas columnas, las 3 últimas solo premium).
- Precio explícito: **"$29.90 MXN/mes"**.
- Checkbox de consentimiento de pago (igual que hoy, mismo texto) — solo gatea el botón de pago.
- Botón primario **"Suscribirme — $29.90/mes"** (mismo flujo que el botón actual: `confirmMembershipPayment()` → Stripe checkout).
- Botón secundario **"Seguir sin membresía"** (nuevo) → navega a `index.html`, sin gatear con el checkbox.

Precio hardcodeado en el HTML (no hay endpoint que lo traiga de Stripe hoy) — simplificación consciente; si el precio de Stripe cambia, este texto se actualiza a mano. Fuera de alcance traer el precio dinámicamente.

### 2. `onboarding-membership-ui.js` — wire del botón nuevo

Nuevo listener: `document.getElementById('btn-skip-membership')` → `window.location.href = 'index.html'`. `confirmMembershipPayment()` no cambia.

### 3. `home.js` — quita el loop forzado

`redirectTargetForIncompleteOnboarding` (home.js:83-88) elimina la línea `if (profile.membershipStatus === 'pending') return 'onboarding-membership.html';`. Se mantiene el redirect por perfil incompleto (`!profile.profile.completedAt` → `onboarding-profile.html`) — eso es setup básico de cuenta, no cobro, y no es el problema señalado.

## Sin cambios

- `account.html`: el botón "Activar membresía" (para `membershipStatus === 'pending'`) y "Renovar membresía" (`'expired'`) siguen funcionando igual — es el camino de regreso para quien decidió "Seguir sin membresía" y luego cambia de opinión.
- `api/index.js` (`payMembershipHandler`, Stripe checkout, webhooks): sin cambios — la lógica de pago ya funciona, solo se le agrega una salida antes de llegar ahí.
- Los otros 3 puntos del plan comercial (teaser de veredicto, CTA post-preferencias, cuentas familiares/viral): fuera de alcance de este spec.
