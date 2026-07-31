# Look & feel del banner de veredicto y tarjeta de diagnóstico

## Contexto

`#result-success` hereda `align-items: center` de `.result-state` (styles.css:661). Sin `width:100%`/`align-self:stretch` explícito, `.verdict-banner` y `.reason-card` se encogen a su contenido y quedan centradas en vez de ocupar el ancho completo — el resto de las secciones ya tienen ancho fijo por otros medios, estas dos son las únicas afectadas.

## Cambios (todos en `scan.html` / `styles.css` / `app.js`)

1. **Ancho completo**: `width: 100%` en `.verdict-banner` (styles.css:822-832) y `.reason-card` (styles.css:2312).
2. **Radio consistente**: `.verdict-banner` pasa de `border-radius: var(--radius-sm)` a `var(--radius-lg)`, igual que `.reason-card`.
3. **Ícono grande en el banner**: nuevo `<span id="verdict-icon" class="verdict-icon"></span>` antes de `#verdict-text` en `scan.html`. `app.js` lo llena con el glifo (✓/⚠/✗) por separado; `verdictText` ya NO incluye el glifo (queda solo "Puedes comerlo"/"Con moderación"/"Mejor evítalo"/mensaje sin-datos). CSS: `font-size: 1.6rem; line-height: 1;`.
4. **Íconos de fila más grandes**: `.reason-row .reason-icon` de `font-size: 20px` a `24px` (mismo tamaño que `.allergen-grid-item .emoji`, styles.css:1275).
5. **Animación de entrada en la tarjeta**: reusa `@keyframes scaleIn` ya existente (styles.css:868/1249, 0.3s ease-out). En `renderPersonalizedReasons` (app.js), al mostrar la tarjeta (transición de `.hidden` a visible), se remueve/re-agrega una clase `verdict-reasons-reveal` para forzar el reflow y reiniciar la animación en cada escaneo (mismo patrón ya usado para `verdict-reveal` en el banner).
6. **Resumen de conflictos**: nueva línea antes de la lista, dentro de `#verdict-reasons` — `<p id="verdict-reasons-summary" class="reason-summary"></p>`. Texto: `"{n} de {total} restricciones en conflicto"` cuando `n > 0` (conflictos = filas con `ok:false`, total = `reasons.length`); si `n === 0`, texto: `"Revisamos {total} restricciones de tu perfil"`.

## Fuera de alcance

- No se toca la lógica de `computeVerdictReasons`/`computeVerdict` — solo presentación.
- No se rediseña `#card-not-recommended` (tarjeta de riesgo del producto, distinta de esta).
