# CTA personalizado post-preferencias en pantalla de membresía (3 de 4)

## Contexto

`continueOnboardingPreferences()` (`preferences-ui.js:12-24`) guarda el payload de preferencias (`{dietary, allergens, healthConditions}`, armado por `buildPreferencesPayload()` en `preferences-ui.js:138-148`) en `sessionStorage` bajo la key `yomi_pending_preferences`, y redirige a `onboarding-membership.html` — el usuario aún no pagó, el guardado real al backend pasa después del pago (fuera de alcance de este spec, sin cambios).

Hoy `onboarding-membership.html` (rediseñada en fase 1) muestra el mismo copy genérico a todos: *"Activa tu membresía"* / *"Compara lo que obtienes gratis vs. con Yomi Premium."* — sin usar el hecho de que el usuario acaba de invertir tiempo contándole a la app sus alergias, dietas y condiciones de salud. Es el momento de mayor intención de todo el funnel (fase 1 ya identificó el momento post-scan como el segundo más caliente — fase 2 — este es el primero).

Decisión tomada (ver spec de fase 1, opción descartada): NO se reabre el guardado de preferencias a usuarios free ni se toca el backend/gating — puramente lectura de un dato que ya existe en el cliente, para personalizar copy de una pantalla que ya existe.

## Cambio

### 1. `onboarding-membership-ui.js` — leer sessionStorage y personalizar

Al cargar la página (nuevo código en el listener de `DOMContentLoaded`, antes del wiring de botones existente):

```js
const PENDING_PREFS_KEY = 'yomi_pending_preferences';

function pickHeadline() {
  let payload = null;
  try {
    payload = JSON.parse(sessionStorage.getItem(PENDING_PREFS_KEY) || 'null');
  } catch (_) {
    payload = null;
  }
  if (!payload) return null;

  const severeAllergen = (payload.allergens || []).find(a => a.severity === 'severe');
  if (severeAllergen) {
    return {
      title: `No más sustos con ${allergenLabel(severeAllergen.code)}`,
      sub: 'Premium te avisa automáticamente cuando un producto lo contiene.'
    };
  }
  const anyAllergen = (payload.allergens || [])[0];
  if (anyAllergen) {
    return {
      title: `Cuidado con ${allergenLabel(anyAllergen.code)}, sin adivinar`,
      sub: 'Premium revisa cada producto contra tu alergia automáticamente.'
    };
  }
  const healthCondition = (payload.healthConditions || [])[0];
  if (healthCondition) {
    return {
      title: `Cuida tu salud sin adivinar`,
      sub: 'Cada escaneo revisa el producto contra tu perfil de salud.'
    };
  }
  const dietary = (payload.dietary || [])[0];
  if (dietary) {
    return {
      title: `Come ${dietaryLabel(dietary)} sin leer etiquetas`,
      sub: 'Premium filtra automáticamente lo que no encaja con tu dieta.'
    };
  }
  return null;
}
```

Prioridad de personalización (primera que aplique gana, replica el orden de severidad ya usado en `computeVerdictReasons` de `app.js`): alergia grave > alergia (cualquier severidad) > condición de salud > dieta. Sin datos (`payload` null, o `continueOnboardingPreferences` nunca corrió — ej. usuario llegó directo a esta URL) → sin personalización, queda el copy genérico actual.

Al final del listener existente, después de `pickHeadline()`:

```js
const headline = pickHeadline();
if (headline) {
  const titleEl = document.querySelector('.heading-title');
  const subEl = document.querySelector('.heading-sub');
  if (titleEl) titleEl.textContent = headline.title;
  if (subEl) subEl.textContent = headline.sub;
}
```

`allergenLabel` y `dietaryLabel`: funciones nuevas y pequeñas, locales a `onboarding-membership-ui.js` (este script no carga `app.js`, que es donde viven `allergenLabel`/`DIETARY_LABELS` hoy — duplicar un mapa mínimo acá es más simple que importar el archivo grande solo por esto). Mapas exactos:

```js
const ALLERGEN_LABELS = {
  cacahuate: 'cacahuate', lacteos: 'lácteos', nueces: 'nueces', trigo: 'trigo',
  huevo: 'huevo', pescado: 'pescado', mariscos: 'mariscos', soja: 'soja'
};
function allergenLabel(code) { return ALLERGEN_LABELS[code] || code; }

const DIETARY_LABELS = {
  vegan: 'vegano', vegetarian: 'vegetariano', keto: 'keto', glutenFree: 'sin gluten',
  caseinFree: 'sin caseína', organic: 'orgánico', kosher: 'kosher', halal: 'halal',
  nonGmo: 'sin OGM', noAdditives: 'sin aditivos', palmOilFree: 'sin palma', fairTrade: 'comercio justo'
};
function dietaryLabel(key) { return DIETARY_LABELS[key] || key; }
```

Estos mapas son copias reducidas de los que ya existen en `app.js` (`ALLERGEN_CODES`/`COMMON_ALLERGENS`/`DIETARY_LABELS`) — misma fuente de verdad conceptual, duplicados deliberadamente para no acoplar esta pantalla a `app.js`. Si `app.js` agrega un alérgeno o dieta nueva, este mapa se actualiza a mano (mismo patrón de duplicación consciente que el precio hardcodeado en fase 1).

### 2. `onboarding-membership.html` — botón primario dinámico

El botón primario (`#btn-confirm-payment`) cambia su copy según haya o no personalización, para capitalizar el compromiso emocional cuando existe:

- Con personalización: **"Sí, quiero Premium — $29.90/mes"**
- Sin personalización (fallback genérico, comportamiento actual): **"Suscribirme — $29.90/mes"** (sin cambios)

Esto se resuelve en el mismo bloque de JS de arriba — si `headline` no es null, además de actualizar título/subtítulo, actualizar el texto del botón (conservando el ícono de Stripe, mismo patrón `innerHTML` ya usado en el fix de fase 1 para el error path — no usar `textContent` para no perder el `<img>`).

### 3. Botón teaser (fase 2) — sin cambios

El CTA del teaser en `scan.html` (`app.js` → `renderTeaserReasons`) sigue diciendo "Ver mi análisis — $29.90/mes", sin personalización — ese momento es pre-preferencias (usuario free que ni siquiera empezó onboarding de preferencias), no hay dato que personalizar ahí. Fuera de alcance.

## Sin cambios

- Backend (`api/index.js`), gating de `/api/me/preferences`: sin cambios — este spec es puramente lectura de sessionStorage + copy dinámico en una pantalla que ya existe.
- `preferences-ui.js`: sin cambios — el payload que ya guarda en sessionStorage es suficiente, no hace falta agregar nada ahí.
- Flujo de pago (`confirmMembershipPayment()`, Stripe checkout): sin cambios — el botón dinámico sigue disparando exactamente el mismo flujo, solo cambia el texto visible.
- Botón "Seguir sin membresía" (fase 1): sin cambios.
- Tabla comparativa y precio (fase 1): sin cambios — la personalización solo toca el heading superior y el texto del botón primario, no la tabla.
