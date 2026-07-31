# Diagnóstico personalizado del veredicto en scan.html

## Contexto

Hoy, un usuario logueado+premium con preferencias configuradas ve un veredicto personalizado (`computeVerdict` en `app.js:1685`) pero solo como texto genérico en el banner ("✗ Mejor evítalo", "⚠ Con moderación", "✓ Puedes comerlo"). No hay explicación de POR QUÉ ese veredicto, ni qué restricción específica del perfil coincide o no con el producto.

## Cambio

### 1. `computeVerdictReasons(product, userPreferences)` — nueva función en `app.js`

Recorre cada restricción que el usuario configuró (`userPreferences.allergens`, `.dietary`, `.healthConditions`) y produce un array de filas:

```js
{ ok: boolean, icon: string, title: string, detail: string }
```

Reglas por tipo (una fila por cada restricción configurada, en este orden: alérgenos, dieta, condiciones de salud):

- **Alérgeno** (`{severity, code}`): usa `isAllergenDetected(product, code)` (con el fix de acentos, ver abajo) y `COMMON_ALLERGENS` para el emoji/label.
  - Conflicto (`ok:false`): `title: "Contiene {label}"`, `detail: "Registraste alergia {leve|grave} a {label}"`.
  - Cumple (`ok:true`): `title: "Sin {label}"`, `detail: "No detectamos tu alergia"`.
- **Dieta** (`key` de `userPreferences.dietary`): usa `product.dietary[key]` (`true`/`false`/`undefined`). Si es `undefined` (sin dato), la fila se omite — no hay base para afirmar cumplimiento o violación. Mapa de labels: mismo set de `data-dietary` de `preferences.html` (vegan→Vegano, vegetarian→Vegetariano, keto→Keto, glutenFree→Sin gluten, caseinFree→Sin caseína, organic→Orgánico, kosher→Kosher, halal→Halal, nonGmo→Sin OGM, noAdditives→Sin aditivos, palmOilFree→Sin palma, fairTrade→C. justo).
  - Conflicto (`product.dietary[key] === false`): `title: "No cumple '{label}'"`, `detail: "El producto no es {label}"`.
  - Cumple (`product.dietary[key] === true`): `title: "Cumple '{label}'"`, `detail: "Es {label}"`.
- **Condición de salud** (`cond` de `userPreferences.healthConditions`): busca en `product.notRecommended` una entrada con `certain === true` cuyo `grupoClaveVerdict(n.grupo) === cond`.
  - Conflicto: `title: "{label de HEALTH_LABELS}"`, `detail: n.razon` (texto real del producto).
  - Cumple (sin match): `title: "{label}"`, `detail: "No encontramos alertas para esta condición"`.

`HEALTH_LABELS`: diabet→Diabetes, celiac→Celiaquía, hipert→Hipertensión, ninos→Niños en casa (mismo set de `data-health` en `preferences.html`).

### 2. Refactor de `computeVerdict` — misma función, una sola fuente de verdad

`computeVerdict(product, userPreferences)` pasa a derivar el veredicto de `computeVerdictReasons(...)` en vez de reimplementar el matching: severo (alérgeno grave conflicto) → `evitar`; condición de salud conflicto → `evitar`; dieta conflicto → `evitar`; alérgeno leve conflicto (y base `sano`) → tope `regular`; si no, `computeBaseVerdict(product)`. Comportamiento observable idéntico al actual — mismos tests de `computeVerdict` deben seguir pasando sin cambios.

### 3. Fix: matching de alérgeno "lácteos" roto por acento

`isAllergenDetected` (app.js:1651) compara `code.toLowerCase()` contra `ca.match`/`ca.label` sin normalizar acentos. El código de preferencias es `"lacteos"` (sin acento, `preferences.html:108`) pero `COMMON_ALLERGENS` solo tiene `"lácteos"` (con acento) — nunca calzan, así que hoy la alergia a lácteos (el alérgeno más común) nunca se detecta ni en `computeVerdict` ni en la nueva UI. Fix: normalizar ambos lados con el mismo patrón NFD que ya usa `grupoClaveVerdict` (app.js:1636) antes de comparar.

### 4. UI — nueva tarjeta en `scan.html` / `app.js`

HTML nuevo bajo `#verdict-disclaimer` (scan.html, después de línea 226):

```html
<div id="verdict-reasons" class="reason-card hidden">
  <h3 id="verdict-reasons-title"></h3>
  <div id="verdict-reasons-list"></div>
</div>
```

`renderProductData` llama `renderPersonalizedReasons(product, userPreferences)` (nueva función en `app.js`):
- Si `userPreferences` es `null` (sin personalización activa — mismo gate que hoy usa `getUserPreferencesForVerdict`), oculta `#verdict-reasons` y no hace nada más.
- Si hay reasons: título = `"Tu perfil vs. este producto"` si algún `!ok`, o `"Cumple con tu perfil"` si todos `ok`. Clase de la tarjeta: `reason-card--warn` (fondo rojo-tenue) si algún `!ok`, `reason-card--ok` (verde-tenue) si todos `ok`. Cada fila se renderiza como `.reason-row` con ícono, título y detalle (estilo A validado en mockup — filas apiladas con separador sutil).
- Si `userPreferences` existe pero el array de reasons queda vacío (usuario premium sin ninguna restricción configurada — caso raro), oculta la tarjeta igual que el caso sin personalización.

### 5. CSS (`styles.css`)

Nuevas clases siguiendo el patrón de colores ya usado por `.verdict-sano/regular/evitar` (styles.css:865-867):

```css
.reason-card { border-radius: 14px; padding: 16px; margin: 0 0 12px; }
.reason-card--ok   { background: #f4fbf6; border: 1px solid rgba(22,163,74,0.25); }
.reason-card--warn { background: #fff5f5; border: 1px solid rgba(220,38,38,0.25); }
.reason-card h3 { font-size: 14px; margin: 0 0 6px; color: #374151; }
.reason-row { display: flex; gap: 10px; align-items: flex-start; padding: 9px 0; }
.reason-row + .reason-row { border-top: 1px solid rgba(0,0,0,0.06); }
.reason-row .reason-icon { font-size: 20px; flex-shrink: 0; width: 26px; text-align: center; }
.reason-row .reason-text strong { display: block; font-size: 14px; color: #1f2937; }
.reason-row .reason-text span { font-size: 12.5px; color: #6b7280; }
```

## Fuera de alcance

- Botón compartir / contenido compartido: sin cambios, sigue compartiendo solo nombre+veredicto+barcode.
- Historial (`history-ui.js`): sin cambios — el diagnóstico detallado solo vive en `scan.html`, no en las tarjetas de historial.
- Traducir o rediseñar `#card-not-recommended` (la sección existente de "no recomendado" con razones NOM-051) — sigue existiendo tal cual, es información distinta (reglas del producto en sí, no personalización de perfil).
