# App user-facing — correcciones de auditoría UX (4 fases)

**Fecha:** 2026-07-06
**Estado:** Aprobado por usuario (plan mode)
**Contexto:** El usuario pidió usar el agente UX Architect para mejorar la UI/UX del **app user-facing** (`index.html`, `home.css`, `home.js`, `scan.html`, `styles.css`, `app.js` — no el panel admin, ya auditado el 2026-07-03). El agente entregó 12 hallazgos + 3 positivos. El usuario aprobó los 4 grupos completos.

## Hallazgos verificados en código (no solo reportados por el agente)

- **F1 (regresión real):** `home.css:153,154,177` usan `var(--paper)`, `var(--border)`, `var(--ink-3)` que **no existen** en el `:root` de `home.css` (solo define `--bg/--ink/--ink-muted/--accent/--teal-soft/--white`). La card "¿Qué es Yomi?" pierde fondo blanco y borde — cae a transparente/sin borde.
- **A2:** `badgeHtml(item.rating)` (`home.js:11,53`) nunca recibe dato porque `saveToHistory(barcode,name,brand,image)` (`app.js:160`) no guarda `rating`. El badge SANO/EVITAR/REGULAR de "Productos recientes" nunca aparece.

Datos ya disponibles para derivar veredicto (usado en Fase 3): `product.sellos` (array de sellos NOM-051, construido en `app.js:1355`), `product.notRecommended` (array de grupos con flag `certain`, `app.js:1385`).

## Objetivo

Cerrar las regresiones de consistencia, subir accesibilidad básica a AA, entregar el veredicto top-line ("¿Puedo comerlo?" → SANO/REGULAR/EVITAR) que la promesa del home implica, y mejorar resiliencia de interacción (errores de cámara, validación manual, targets táctiles, escaneo offline).

## Alcance — 4 sub-proyectos independientes, shippeable cada uno por separado

### Fase 1 — Regresiones & consistencia (bajo riesgo, primero)
1. **F1** — alias de tokens faltantes en `home.css :root`:
   ```css
   --paper:  var(--white);
   --border: rgba(45,188,158,0.2);
   --ink-3:  var(--ink-muted);
   ```
   Alias, no renombrar declaraciones existentes — menor diff, `home.css` queda autoconsistente.
2. **F3** — borrar CSS huérfano confirmado sin markup vivo: `home.css` `.btn-ver-todos` (~línea 201), bloque `.section-promo/.promo-card/.promo-btn` (~367-421), `.nav-scan-ring/.nav-scan-icon` (~505-519); `styles.css` `.product-image-container/.product-info` (~848-850). Cada clase se re-verifica con grep antes de borrar (el agente pudo equivocarse de línea).
3. **E2** — quitar peso de fuente `300` del query de Google Fonts en `index.html:17` y `scan.html:22` (`Inter:wght@300;400;500;600;700;800` → sin el 300). Único uso reportado (`.sello-threshold`) fuerza Arial de todas formas.

**Fuera de alcance:** F2 (unificar los dos sistemas de tokens en un stylesheet compartido) — refactor mayor, queda como deuda futura; F1 lo mitiga puntualmente sin tocar la arquitectura.

### Fase 2 — Accesibilidad
1. **D1** — regla compartida `:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }` en `styles.css` y `home.css`. No se tocan los `outline:none` existentes (solo afectan mouse); `:focus-visible` es aditivo para teclado.
2. **D2** — contraste AA: `--ink-3`/`--ink-muted` `#7a9080` → `#5f7568` (~4.5:1 sobre `#eaf9f6`); `.scan-help` `rgba(255,255,255,0.5)` → `rgba(255,255,255,0.75)` (`styles.css:338`).
3. **D3** — `home.js`: agregar `keydown` (Enter/Space) al delegado de click del grid (`home.js:74`) que dispare la misma navegación.
4. **D5** — `aria-live="polite"` en `#scan-coaching` (`scan.html:114`) y en wrapper `role="status"` de los result-states; `aria-live="assertive"` en `#ai-error` (`scan.html:466`).
5. **D6** — tabs deshabilitadas (Análisis/Perfil) en `index.html:109-116` y `scan.html:498-505`: agregar `tabindex="-1"` + sufijo "(próximamente)" al `aria-label`.
6. **D4** — modales (`#disclaimer-modal`, `#report-modal`, `#ocr-modal`, `#nutrition-modal`): `role="dialog"`, `aria-modal="true"`, `aria-labelledby`; mover foco al heading al abrir, restaurar al cerrar, atrapar Tab. Helper `trapFocus(modalEl)` reutilizable en `app.js`.

### Fase 3 — Veredicto SANO/REGULAR/EVITAR (A1 + A2)

Lógica de derivación (nueva función `computeVerdict(product)` en `app.js`):
```js
function computeVerdict(product) {
  const sellos   = (product.sellos || []).length;
  const critical = (product.notRecommended || []).some(n => n.certain);
  if (sellos >= 3 || (critical && sellos >= 2)) return 'evitar';
  if (sellos >= 1 || critical)                  return 'regular';
  return 'sano';
}
```
1. **A1** — banner `.verdict-banner` como primer hijo de `#result-success` (antes de `.product-header`, `scan.html:196`), coloreado con el mismo sistema que los badges de home (verde/ámbar/rojo). Llenado en `renderProductData` (`app.js:1521`).
2. **A2** — `saveToHistory` recibe 5º argumento `rating`; se persiste en `yomi_history`. La llamada en `renderProductData` (`app.js:1531`) pasa `computeVerdict(product)`. `badgeHtml` (`home.js:11`) ya normaliza los 3 strings — sin cambios ahí.

### Fase 4 — Interacción & resiliencia offline
1. **B1** — reemplazar los 3 `alert()` de fallo de cámara (`app.js:324,329,465`) por `renderError(title, message)` (`app.js:2302`, ya usa el panel styled `#result-rejected` con reintento), mencionando la entrada manual como fallback.
2. **B2** — en el submit handler de entrada manual (`app.js:259`), llamar `validateBarcode(barcode)` (`app.js:131`, checksum EAN + expansión UPC-E) antes de pegarle a la API; si inválido, `renderError("Código inválido", …)` inline.
3. **C1** — `.hud-btn` `40×40` → `44×44` (`styles.css:486-488`); `.zoom-btn` `min-height:36px` + padding de hit mayor (`styles.css:517`).
4. **C2** — `.scanner-view` (`styles.css:209`) agregar `min-height:220px` para que en viewports cortos el contenido colapse antes que el preview de cámara.
5. **E1** — self-host `barcode-detector` y `@undecaf/zbar-wasm` (hoy vía esm.sh/jsdelivr en `scan.html:29-37`) en `/vendor/`, actualizar imports, precachear en `sw.js` para escaneo offline.

## Manejo de errores

- **F1:** alias en lugar de rename evita romper cualquier otro uso no detectado de los nombres actuales de `home.css`.
- **F3:** cada borrado se re-verifica con grep contra los 4 archivos consumidores antes de aplicar — si aparece una referencia viva, esa clase se excluye del borrado y se reporta como hallazgo falso del agente.
- **D4:** el trap de foco debe permitir Escape para cerrar (patrón ya usado en admin) sin bloquear el cierre por click-fuera existente.
- **A1/A2:** `computeVerdict` solo lee campos ya presentes en `product` (no requiere nueva llamada a API); umbrales documentados inline como ajustables.
- **B2:** `validateBarcode` ya existe y se usa en la ruta de cámara — reutilizarlo tal cual, sin reimplementar checksum.
- **E1:** si el self-host falla en build/deploy, hay fallback: mantener las URLs CDN como comentario y poder revertir el `<script type="module">` sin tocar el resto de la fase.

## Verificación

- **Automatizada:** `npx vitest run` tras cada fase (suite existente, `tests/app.test.js` cubre lógica de `app.js`).
- **Fase 1:** cargar home, confirmar card "¿Qué es Yomi?" con fondo blanco + borde; sin regresión visual tras los borrados de CSS.
- **Fase 2:** tab por resultados y home confirmando anillo de foco visible; verificar contraste con DevTools; NVDA/VoiceOver anuncia cambios de estado; Tab no escapa detrás del disclaimer modal.
- **Fase 3:** escanear producto con ≥3 sellos → banner EVITAR + card en recientes con badge EVITAR; producto limpio → SANO; intermedio → REGULAR.
- **Fase 4:** negar permiso de cámara → panel styled con reintento (no `alert()`); código inválido tecleado → error inline; HUD tappeable; modo avión → escáner decodifica.

## Archivos afectados

| Archivo | Fases que lo tocan |
|---|---|
| `home.css` | 1, 2 |
| `styles.css` | 1, 2, 3, 4 |
| `index.html` | 1, 2 |
| `scan.html` | 2, 3, 4 |
| `home.js` | 2, 3 |
| `app.js` | 2, 3, 4 |
| `sw.js` | 4 |
