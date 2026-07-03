# Admin panel — declarative tab dispatch for standard collections

**Fecha:** 2026-07-03
**Estado:** Aprobado por usuario (brainstorming)
**Contexto:** Tercer sub-proyecto derivado del [audit UX del panel de admin](../infrastructure/2026-07-03-admin-ux-architecture-audit.md), hallazgo Importante #4. El usuario pidió explícitamente máxima precaución en este cambio — es el de mayor riesgo del audit porque toca lógica compartida entre las 6 tabs.

## Objetivo

Reemplazar los `if (currentCol === '...')` dispersos en `renderList()` y `loadCollection()` — que deciden predicado de filtro, `noun` de conteo, función de render, y hook de carga previa — por un objeto de configuración declarativo, **solo para las tabs que comparten la misma forma** (colección paginada, filtrable, borrable por ID: `scan_logs`, `reports`, `products_ocr`, `products_nutrition`). `resumen` y `cache` son estructuralmente distintos (sin paginación, sin filtro/render genérico) y **permanecen con sus ramas explícitas existentes** — no se fuerza una unificación que no corresponde.

**Restricción explícita del usuario: cero cambio de comportamiento observable.** Este es un refactor de extracción — mover lógica existente a funciones con nombre + una tabla de lookup, sin alterar ningún resultado.

## Alcance

1. Extraer 3 predicados de filtro actualmente inline en `renderList()` a funciones con nombre: `filterScanLogs(item, q)`, `filterReports(item, q)`, `filterById(item, q)` (este último ya es el fallback genérico usado por `products_ocr`/`products_nutrition`, y también sirve como filtro por defecto para cualquier tab futura de esta misma forma).
2. Nuevo objeto `TAB_CONFIG` mapeando `scan_logs`/`reports`/`products_ocr`/`products_nutrition` → `{ noun, filterPredicate, render, onLoad }`.
3. `renderList()` consulta `TAB_CONFIG[currentCol]` en vez de 3 cadenas de `if/else` separadas.
4. `loadCollection()` consulta `TAB_CONFIG[currentCol]?.onLoad` en vez del `if (currentCol === 'scan_logs' && !append) await loadBarcodeFlags();` hardcodeado.
5. `resumen` y `cache` **no se tocan** — siguen con sus checks explícitos (`currentCol === 'resumen'`, `currentCol === 'cache'`) en `loadCollection()` y el `filterInput` handler.

**Fuera de alcance:**
- Cualquier cambio de comportamiento (ordenamiento, campos de filtro, textos, etc.) — este es un refactor puro de organización de código.
- Unificar `resumen`/`cache` al mismo config — se documentan como casos estructuralmente distintos, aceptados, no un defecto a corregir.
- Los hallazgos Menores restantes del audit.

## 1. Predicados de filtro extraídos

En `admin/admin.js`, cerca de `renderList` (antes de su definición), extraer la lógica inline actual:

```js
function filterScanLogs(item, q) {
  const d = item.data || {};
  return item.id.includes(q) || (d.barcode||'').includes(q) || (d.ip||'').toLowerCase().includes(q) || (d.os||'').toLowerCase().includes(q) || (d.productName||'').toLowerCase().includes(q) || (d.cacheLevel||'').toLowerCase().includes(q) || (d.sourcesTried||[]).some(s => (s.source||'').toLowerCase().includes(q));
}

function filterReports(item, q) {
  const d = item.data || {};
  return (d.barcode||'').includes(q) || (d.category||'').toLowerCase().includes(q) || (d.comment||'').toLowerCase().includes(q);
}

function filterById(item, q) {
  return item.id.toLowerCase().includes(q);
}
```

Estas son copias literales de la lógica que hoy vive inline en `renderList()` (líneas 342-350 actuales) — sin cambios de comportamiento, solo nombradas y movidas.

## 2. `TAB_CONFIG`

```js
const TAB_CONFIG = {
  scan_logs: { noun: 'escaneo', filterPredicate: filterScanLogs, render: renderLogs, onLoad: loadBarcodeFlags },
  reports: { noun: 'reporte', filterPredicate: filterReports, render: renderReports },
  products_ocr: { noun: 'documento', filterPredicate: filterById, render: null },
  products_nutrition: { noun: 'documento', filterPredicate: filterById, render: null }
};
```

`render: null` marca las tabs que usan el render genérico inline de `doc-item` (comportamiento actual sin cambios — no se extrae a una función separada en este sub-proyecto, para minimizar el diff).

## 3. `renderList()` usa la tabla

Reemplaza las 3 cadenas de `if/else` actuales por:

```js
function renderList() {
  const q = filterInput.value.trim().toLowerCase();
  const cfg = TAB_CONFIG[currentCol];
  const items = q ? allItems.filter(i => cfg.filterPredicate(i, q)) : allItems;
  const noun = cfg.noun;
  const totalEl = document.querySelector(`.nav-count[data-count="${currentCol}"]`);
  const total = totalEl && totalEl.textContent ? parseInt(totalEl.textContent, 10) : null;
  const scopeNote = (q && nextPageToken && total != null)
    ? ` — buscando en ${allItems.length} de ${total} cargados, carga más para ampliar`
    : (q ? ' (filtrado)' : '');
  statsBar.textContent = items.length + ' ' + noun + (items.length !== 1 ? 's' : '') + scopeNote;
  if (cfg.render) { cfg.render(items); return; }
  if (!items.length) { docList.innerHTML = '<div class="empty-msg">Sin resultados.</div>'; return; }
  docList.innerHTML = items.map(item => `
    <div class="list-card doc-item" data-id="${escHtml(item.id)}">
      <div>
        <div class="doc-id">${escHtml(item.id)}</div>
        <div class="doc-meta">${escHtml(summaryOf(item))}</div>
      </div>
      <div class="doc-actions">
        <button class="btn-view" data-action="view" data-id="${escHtml(item.id)}">Ver</button>
        <button class="btn-del" data-action="del" data-id="${escHtml(item.id)}">Eliminar</button>
      </div>
    </div>`).join('');
}
```

Nota: `renderList()` solo se llama para las 4 tabs de `TAB_CONFIG` (nunca para `resumen` ni `cache`, que tienen sus propios caminos de carga/render) — `cfg` siempre existe cuando esta función corre, no hace falta un fallback para `cfg === undefined`.

## 4. `loadCollection()` usa el hook `onLoad`

Reemplaza:

```js
    if (currentCol === 'scan_logs' && !append) await loadBarcodeFlags();
```

por:

```js
    const _cfg = TAB_CONFIG[currentCol];
    if (_cfg?.onLoad && !append) await _cfg.onLoad();
```

Esta línea se ejecuta después del check de `resumen` (que ya retorna antes) y antes del check de `cache` — mismo punto exacto donde vivía el check original, solo generalizado a "cualquier tab de `TAB_CONFIG` con un `onLoad` definido" en vez de hardcodear `scan_logs`.

## Manejo de errores

No hay lógica nueva — es una reorganización. El único riesgo real es que la extracción introduzca una diferencia sutil entre la lógica original inline y la función extraída (typo, condición cambiada). La verificación exige comparar carácter por carácter cada predicado extraído contra el original.

## Verificación

Dado el pedido explícito de máximo cuidado, la verificación es un regression pass completo, no solo puntual:

- **Sintaxis:** `node --check admin/admin.js`.
- **Manual — las 6 tabs, una por una:**
  1. **Resumen** — carga normal, sin cambios esperados (no tocado).
  2. **Logs** (`scan_logs`) — carga, filtro por código/IP/OS/nombre de producto/cache level/fuente (siete campos, todos deben seguir funcionando idéntico), expand/collapse de tarjeta, eliminar un log, paginación con "Cargar más".
  3. **Reportes** — carga, filtro por barcode/categoría/comentario, ver detalle (modal), eliminar un reporte.
  4. **OCR ingredientes** (`products_ocr`) — carga, filtro por ID únicamente, ver detalle, eliminar.
  5. **OCR nutrición** (`products_nutrition`) — mismo que ingredientes.
  6. **Cache** — carga, filtro (su propio camino, no tocado), eliminar por capa (L1/L2/ambas) en productos y en análisis IA.
- **Manual — casos límite:** cambiar entre tabs varias veces seguidas (confirmar que `allItems`/`nextPageToken`/`lastCacheData` se resetean igual que antes); escribir un filtro que no coincida con nada en cada tab paginada (confirmar que la nota de alcance de la sesión anterior sigue funcionando); paginar con "Cargar más" en Logs y confirmar que `loadBarcodeFlags()` se sigue llamando (verificable indirectamente: el badge 🚩 Reporte debe seguir apareciendo en logs cuyo barcode tiene un reporte asociado).
- **Suite completa:** `npx vitest run` — sin tests nuevos (no hay lógica de negocio aislable de forma significativa; el valor de este cambio es organizacional), debe seguir en verde por regresión.

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `admin/admin.js` | 3 predicados de filtro extraídos a funciones con nombre; nuevo `TAB_CONFIG`; `renderList()` y `loadCollection()` consultan la tabla en vez de `if/else` dispersos; `resumen`/`cache` sin cambios |
