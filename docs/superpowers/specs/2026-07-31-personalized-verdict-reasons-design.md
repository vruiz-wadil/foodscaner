# Diagnóstico personalizado del veredicto en scan.html

## Contexto

Hoy, un usuario logueado+premium con preferencias configuradas ve un veredicto personalizado (`computeVerdict` en `app.js:1685`) pero solo como texto genérico en el banner ("✗ Mejor evítalo", "⚠ Con moderación", "✓ Puedes comerlo"). No hay explicación de POR QUÉ ese veredicto, ni qué restricción específica del perfil coincide o no con el producto.

Este diseño fue revisado por 3 agentes especializados (UX, UI visual, accesibilidad) antes de escribirse la versión final — sus hallazgos ya están incorporados abajo, no como anexo.

## Cambio

### 1. `computeVerdictReasons(product, userPreferences)` — nueva función en `app.js`

Recorre cada restricción que el usuario configuró (`userPreferences.allergens`, `.dietary`, `.healthConditions`) y produce un array de filas:

```js
{ ok: boolean, severity: 'grave'|'leve'|null, icon: string, title: string, detail: string }
```

`severity` solo aplica a alérgenos (`'grave'` para `severity:"severe"`, `'leve'` para `"mild"`); `null` en dieta/salud.

Reglas por tipo:

- **Alérgeno** (`{severity, code}`): usa `isAllergenDetected(product, code)` (con el fix de acentos, ver sección 3) y `COMMON_ALLERGENS` para el emoji/label.
  - Conflicto (`ok:false`): `title: "Contiene {label}"`, `detail: "Registraste alergia {leve|grave} a {label}"`.
  - Cumple (`ok:true`): `title: "Sin {label}"`, `detail: "No detectamos tu alergia"`.
- **Dieta** (`key` de `userPreferences.dietary`): usa `product.dietary[key]` (`true`/`false`/`undefined`). Mapa de labels: mismo set de `data-dietary` de `preferences.html` (vegan→Vegano, vegetarian→Vegetariano, keto→Keto, glutenFree→Sin gluten, caseinFree→Sin caseína, organic→Orgánico, kosher→Kosher, halal→Halal, nonGmo→Sin OGM, noAdditives→Sin aditivos, palmOilFree→Sin palma, fairTrade→C. justo).
  - Conflicto (`=== false`): `title: "No es {label}"`, `detail: "El producto no cumple esta preferencia"`. *(antes: `"No cumple '{label}'"` — quitado el estilo de cita de base de datos, y ya no duplica el detail con el title.)*
  - Cumple (`=== true`): `title: "Es {label}"`, `detail: "Cumple esta preferencia"`.
  - **Sin dato** (`=== undefined`): **ya NO se omite.** Fila explícita `ok: null` (tercer estado, ni check ni cruz), `title: "Sin datos: {label}"`, `detail: "No tenemos información sobre esta preferencia para este producto"`. Omitir la fila se leía como falsa confirmación silenciosa (hallazgo UX) — mejor mostrar honestamente que no se pudo verificar.
- **Condición de salud** (`cond` de `userPreferences.healthConditions`): busca en `product.notRecommended` una entrada con `certain === true` cuyo `grupoClaveVerdict(n.grupo) === cond`.
  - Conflicto: `title: "{label de HEALTH_LABELS}"`, `detail: n.razon` (texto real del producto — truncar a 140 caracteres si es más largo, viene de fuente externa).
  - Cumple (sin match): `title: "{label}"`, `detail: "No encontramos alertas para esta condición"`.

`HEALTH_LABELS`: diabet→Diabetes, celiac→Celiaquía, hipert→Hipertensión, ninos→Niños en casa (mismo set de `data-health` en `preferences.html`).

**Orden del array (hallazgo UX+UI — antes era alérgenos→dieta→salud sin criterio de riesgo, ahora es por severidad):**
1. Alérgeno grave, conflicto
2. Salud, conflicto
3. Dieta, conflicto
4. Alérgeno leve, conflicto
5. Todo lo que es `ok:true`
6. Todo lo que es `ok:null` (sin dato)

Dentro de cada grupo, se preserva el orden en que el usuario configuró la restricción.

### 2. Refactor de `computeVerdict` — misma función, una sola fuente de verdad

`computeVerdict(product, userPreferences)` pasa a derivar el veredicto de `computeVerdictReasons(...)` en vez de reimplementar el matching: alérgeno grave conflicto → `evitar`; condición de salud conflicto → `evitar`; dieta conflicto → `evitar`; alérgeno leve conflicto (y base `sano`) → tope `regular`; si no, `computeBaseVerdict(product)`. Fila `ok:null` (sin dato) nunca afecta el veredicto. Comportamiento observable idéntico al actual — mismos tests de `computeVerdict` deben seguir pasando sin cambios.

### 3. Fix: matching de alérgeno "lácteos" roto por acento

`isAllergenDetected` (app.js:1651) compara `code.toLowerCase()` contra `ca.match`/`ca.label` sin normalizar acentos. El código de preferencias es `"lacteos"` (sin acento, `preferences.html:108`) pero `COMMON_ALLERGENS` solo tiene `"lácteos"` (con acento) — nunca calzan, así que hoy la alergia a lácteos (el alérgeno más común) nunca se detecta ni en `computeVerdict` ni en la nueva UI. Fix: normalizar ambos lados con el mismo patrón NFD que ya usa `grupoClaveVerdict` (app.js:1636) antes de comparar.

### 4. UI — nueva tarjeta en `scan.html` / `app.js`

HTML nuevo bajo `#verdict-disclaimer` (scan.html, después de línea 226). Card neutral (no roja/verde — ver sección 5 por qué), lista semántica, dentro del mismo `role="status"` que ya cubre el banner de veredicto para que los cambios se anuncien juntos:

```html
<div id="verdict-reasons" class="reason-card hidden">
  <h3 id="verdict-reasons-title"></h3>
  <ul id="verdict-reasons-list"></ul>
</div>
```

`renderProductData` llama `renderPersonalizedReasons(product, userPreferences)` (nueva función en `app.js`):
- Si `userPreferences` es `null` (sin personalización activa — mismo gate que hoy usa `getUserPreferencesForVerdict`), oculta `#verdict-reasons` y no hace nada más.
- Si `computeVerdictReasons` regresa array vacío (usuario premium sin ninguna restricción configurada — caso raro), oculta la tarjeta igual que el caso sin personalización.
- Si hay reasons: título = `"Tu perfil vs. este producto"` si algún `ok:false`, o `"Cumple con tu perfil"` si no hay ninguno. Cada fila es un `<li class="reason-row">`:
  ```html
  <li class="reason-row reason-row--{ok|warn|unknown}">
    <span class="reason-icon">{emoji de categoría}</span>
    <span class="reason-state" aria-hidden="true">{✅|❌|❔}</span>
    <span class="reason-text"><strong>{title}</strong><span>{detail}</span></span>
    {si severity==='grave': <span class="reason-severity">grave</span>}
  </li>
  ```
  El emoji de categoría (🥛🌾🥜 etc.) es el mismo para ok y conflicto de la misma restricción — el estado ok/conflicto/sin-dato se comunica con el ícono `.reason-state` (✅/❌/❔, `aria-hidden` porque el texto del título ya lo dice) + el color del borde izquierdo de la fila, nunca con el color de toda la tarjeta.

### 5. CSS (`styles.css`)

**Cambio de enfoque vs. la primera versión:** la tarjeta ya NO se tiñe roja/verde completa — eso competía visualmente con `#card-not-recommended` (que ya usa rojo para "el producto en sí trae riesgo") apilado justo debajo, y con el propio `.verdict-banner` arriba. El color ahora vive en el borde izquierdo de cada fila individual, y la tarjeta se queda neutral. La lista tiene tope de altura con scroll interno para perfiles con muchas restricciones, así nunca empuja el resto de la pantalla fuera de vista.

```css
.reason-card { border-radius: 14px; padding: 16px; margin: 0 0 12px; background: var(--surface, #fff); border: 1px solid var(--border, #e5e7eb); }
.reason-card h3 { font-size: 14px; margin: 0 0 10px; color: #374151; }
#verdict-reasons-list { list-style: none; margin: 0; padding: 0; max-height: 340px; overflow-y: auto; }
.reason-row { display: flex; gap: 8px; align-items: flex-start; padding: 9px 6px; border-left: 3px solid transparent; }
.reason-row + .reason-row { border-top: 1px solid rgba(0,0,0,0.06); }
.reason-row--warn { border-left-color: #ac1e1e; }
.reason-row--ok { border-left-color: #107535; }
.reason-row--unknown { border-left-color: #9ca3af; }
.reason-row .reason-icon { font-size: 20px; flex-shrink: 0; width: 24px; text-align: center; }
.reason-row .reason-state { font-size: 13px; flex-shrink: 0; margin-top: 2px; }
.reason-row .reason-text { flex: 1; }
.reason-row .reason-text strong { display: block; font-size: 14px; color: #1f2937; }
.reason-row .reason-text span { font-size: 12.5px; color: #5b6472; }
.reason-severity { flex-shrink: 0; align-self: center; font-size: 0.65rem; font-weight: 700; padding: 1px 6px; border-radius: 8px; background: rgba(220,38,38,0.15); color: #ac1e1e; text-transform: uppercase; }
```

Nota de contraste: `#5b6472` (antes `#6b7280`) para el texto de detalle da más margen sobre AA que el original, revisado en el audit de accesibilidad.

Nota de animación: `#verdict-reasons` existe siempre en el DOM (se oculta con la clase `.hidden`, no se inserta/remueve condicionalmente), para que su layout esté estable antes de que corra la animación `verdict-reveal` del banner y no se sienta como un salto de layout simultáneo.

## Fuera de alcance

- Botón compartir / contenido compartido: sin cambios, sigue compartiendo solo nombre+veredicto+barcode.
- Historial (`history-ui.js`): sin cambios — el diagnóstico detallado solo vive en `scan.html`, no en las tarjetas de historial.
- Traducir o rediseñar `#card-not-recommended` (la sección existente de "no recomendado" con razones NOM-051) — sigue existiendo tal cual, es información distinta (reglas del producto en sí, no personalización de perfil).
- Agrupar visualmente en subsecciones colapsables "problemas encontrados" / "sin problemas" — el tope de altura + scroll (sección 5) resuelve el mismo problema de densidad con menos superficie nueva; se puede revisitar si en uso real el scroll resulta incómodo.
