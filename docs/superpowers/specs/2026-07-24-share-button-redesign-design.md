# Rediseño del botón "Compartir" en el resultado de escaneo — diseño

Fecha: 2026-07-24

## Contexto

El botón "Compartir" en la pantalla de resultado (`scan.html`) es hoy un `<button class="btn btn-secondary">Compartir</button>` genérico, full-width (100%, por `.btn`), sin ícono, posicionado como un CTA de peso completo debajo del disclaimer — visualmente compite con acciones primarias reales por una acción secundaria/opcional. El usuario lo calificó de "muy feo" y pidió mejorar solo apariencia/posición, sin tocar el comportamiento (sigue llamando a `window.shareResult()`, Web Share API con fallback a portapapeles, sin cambios).

Se exploraron 3 mockups visuales (companion de brainstorming) — el usuario eligió: **pill pequeño dentro del banner del veredicto, esquina superior derecha, con el color del veredicto activo (verde/ámbar/rojo)**.

Fuera de alcance: bottom-sheet con múltiples destinos (WhatsApp, etc.), cambios a `share.js` (lógica de compartir intacta), cambios al comportamiento en `history.html` (su propio botón de compartir, ya con su propio estilo, no se toca).

## Hallazgo — `verdictBanner.textContent` pisaría el botón

`app.js` (`renderProductData`, línea ~1831) hace `verdictBanner.textContent = verdictText;` en cada render de resultado — si el botón fuera un hijo directo de `#verdict-banner` en el HTML estático, esta línea lo borraría cada vez. Fix: el texto del veredicto se mueve a su propio `<span id="verdict-text">` dentro del banner; el botón vive como hermano de ese span, nunca tocado por esa línea.

## Diseño

**`scan.html`** — reemplaza:
```html
<div id="verdict-banner" class="verdict-banner" role="status"></div>
<p id="verdict-disclaimer" class="verdict-disclaimer">...</p>
```
por:
```html
<div id="verdict-banner" class="verdict-banner" role="status">
  <span id="verdict-text"></span>
  <button type="button" id="btn-share-result" class="verdict-share-btn" aria-label="Compartir resultado">
    <svg class="share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="18" cy="5" r="3"/>
      <circle cx="6" cy="12" r="3"/>
      <circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
    Compartir
  </button>
</div>
<p id="verdict-disclaimer" class="verdict-disclaimer">...</p>
```
(ícono: glifo estándar de "compartir" — 3 círculos conectados, mismo `stroke-width="2"` que el resto de los SVG inline de la app, sin archivo `.svg` externo nuevo — más simple que agregar un asset, consistente con cómo `share.js`/history-ui.js ya usan un glifo `↗` inline para compartir en otros lados.)

**`styles.css`** — agrega:
```css
.verdict-banner { justify-content: space-between; }
.verdict-share-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  background: rgba(255,255,255,0.55);
  border: 1px solid currentColor;
  color: inherit;
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}
.verdict-share-btn .share-icon { width: 14px; height: 14px; flex-shrink: 0; }
```
`color: inherit` + `border: 1px solid currentColor` — al ser descendiente de `.verdict-sano`/`.verdict-regular`/`.verdict-evitar` (ya definen `color`), el botón toma el tono correcto automático, sin reglas por-veredicto duplicadas.

**`app.js`** (`renderProductData`) — cambia:
```js
verdictBanner.textContent = verdictText;
```
por:
```js
document.getElementById('verdict-text').textContent = verdictText;
```
`verdictBanner.className = 'verdict-banner verdict-' + verdict;` no cambia (sigue en el contenedor, no afecta a los hijos). El wiring de `#btn-share-result` (`onclick = () => window.shareResult(...)`) no cambia — mismo id, mismo comportamiento, solo cambió dónde vive en el DOM/CSS.

## Testing

- `tests/app.test.js` — confirmado: el único test que referencia `#verdict-banner` es `renderPersonalizedDisclaimer`'s fixture (línea 645), y lo usa como un `<div>` vacío sin verificar su contenido — no se ve afectado por este cambio. No hay ningún test actual que dependa de `verdictBanner.textContent`/`verdict-text`.
- Verificación manual/Playwright (según se decida en el plan): confirmar que el botón aparece en la esquina del banner, toma el color correcto en los 3 veredictos, y que `shareResult()` sigue disparando igual (Web Share API / portapapeles).
