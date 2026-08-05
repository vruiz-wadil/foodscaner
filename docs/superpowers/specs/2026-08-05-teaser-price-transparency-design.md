# Transparencia de precio en el teaser de veredicto (scan.html)

## Contexto

El CTA del teaser ("Ver mi análisis") llevaba a usuarios sin sesión directo a `auth.html` (fix previo, `app.js:1988-1990`), pero `auth.html` no menciona precio ni condiciones — el usuario no ve el precio ($29.90 MXN/mes) hasta llegar a `onboarding-membership.html`, al final de un funnel de 4 pantallas (auth → perfil → preferencias → membresía). Genera fricción/sorpresa: se le pide crear cuenta sin saber que hay un costo involucrado.

Decisión: no crear una pantalla intermedia nueva — agregar la info de precio directo en la tarjeta del teaser que ya existe en `scan.html`, antes de que el usuario haga cualquier click. Cambio mínimo, mismo lugar donde ya está el copy del teaser.

## Cambio

En `renderTeaserReasons` (`app.js:1946+`), entre las 3 filas borrosas (`teaserRows`) y el botón CTA:

1. **Nueva línea de precio + confianza**, agregada como elemento propio dentro de la tarjeta (mismo nivel que el CTA, no dentro de `#verdict-reasons-list`):

```js
const existingPriceLine = card.querySelector('.teaser-price-line');
if (existingPriceLine) existingPriceLine.remove();
const priceLine = document.createElement('p');
priceLine.className = 'teaser-price-line';
priceLine.textContent = '$29.90 MXN/mes — cancela cuando quieras';
card.appendChild(priceLine);
```

Se agrega en el mismo lugar donde hoy se agrega el CTA (`card.appendChild(cta)`), justo ANTES del `cta`, para que quede visualmente arriba del botón.

2. **Botón CTA simplificado** — el texto pasa de `'Ver mi análisis — $29.90/mes'` a `'Ver mi análisis'` (el precio ya no vive en el botón, vive en la línea nueva arriba). El resto del botón (clase, lógica de `href` según login) no cambia.

3. **`clearTeaserState` (`app.js:1933-1938`)** se extiende para remover también `.teaser-price-line` en los mismos 3 puntos donde ya limpia `.btn-teaser-cta` y `.sr-only` — mismo patrón, evita que la línea de precio quede stale si la tarjeta pasa de teaser a análisis real (fix previo del mismo tipo de bug, `commit 55577e6`).

4. **CSS mínimo** — una regla para `.teaser-price-line` (tamaño de fuente chico, similar a `.reason-summary` ya existente en la tarjeta, para que no compita visualmente con el título).

## Sin cambios

- Destino del CTA según login (logueado → `onboarding-membership.html`, sin sesión → `auth.html`): sin cambios, ya arreglado en el fix anterior.
- `onboarding-membership.html`, `auth.html`, flujo de perfil/preferencias: sin cambios — el precio ya se mostraba ahí, ahora se muestra ANTES también, no se duplica lógica de pago.
- Las 3 filas borrosas del teaser (`teaserRows`), título, summary: sin cambios.
