# Reportes — rediseño a tarjetas expandibles

**Fecha:** 2026-07-03
**Estado:** Aprobado por usuario (brainstorming)
**Contexto:** Quinto y último sub-proyecto derivado del [audit UX del panel de admin](../infrastructure/2026-07-03-admin-ux-architecture-audit.md), hallazgo Menor #10 — separado de los otros 3 menores por tamaño (es una reescritura de UI, no un ajuste puntual).

## Objetivo

Convertir `renderReports` de tabla a tarjetas expandibles, con paridad total de patrón de interacción respecto a `renderLogs` (scan_logs) — la otra tab de "revisar y moderar" del panel. Elimina el botón "Ver"/modal para esta tab; todo el detalle (incluida la imagen adjunta) se muestra inline al expandir.

## Alcance

1. Reescribir `renderReports(items)` en `admin/admin.js` para generar tarjetas en vez de filas de tabla.
2. Reutilizar las clases CSS ya existentes (`.list-card`, `.scan-card`, `.scan-card-summary`, `.scan-card-top`, `.scan-card-date`, `.scan-card-badges`, `.scan-card-barcode`, `.scan-card-name`, `.scan-card-meta`, `.scan-card-detail`, `.scan-card-detail-row`, `.scan-card-detail-label`, `.scan-card-actions`) — **cero CSS nueva**.
3. El handler de click de `docList` ya escucha por clase `.scan-card` (no por tab) para el toggle de expand/collapse, y ya maneja `data-action="del"` genéricamente vía `currentCol` — **no requiere cambios**, solo la nueva estructura de card generada por `renderReports` lo activa automáticamente.
4. Se elimina el botón "Ver" (`data-action="view"`) de las tarjetas de Reportes — el detalle expandido reemplaza esa función.

**Fuera de alcance:**
- Cambios al modal genérico (`#modal-overlay`) — sigue existiendo y en uso para `products_ocr`/`products_nutrition`/cache IA, solo deja de usarse desde Reportes.
- Cualquier cambio a `TAB_CONFIG` (ya apunta a `render: renderReports`, sigue siendo válido sin cambios).
- La tabla `.data-table`/`.table-scroll` de "Top productos" en Resumen no se toca — solo Reportes deja de usar tabla.

## 1. `renderReports` — nueva implementación

Reemplaza la función completa en `admin/admin.js`:

```js
function renderReports(items) {
  if (!items.length) { docList.innerHTML = '<div class="empty-msg">Sin reportes todavía.</div>'; return; }
  docList.innerHTML = items.map(item => {
    const d = item.data || {};
    const fecha = d.ts ? new Date(d.ts).toLocaleString('es-MX') : '—';
    const loc = [d.city, d.region, d.country].filter(Boolean).join(', ') || '—';
    const bc = d.barcode || '';
    const badges = d.image ? '<span class="log-badge log-badge-blue">📷 Imagen</span>' : '';
    const metaParts = [
      `📍 ${escHtml(loc)}`,
      `🖥 ${escHtml(d.os || '—')}`,
      d.category ? `🏷 ${escHtml(d.category)}` : ''
    ].filter(Boolean);
    const imgHtml = d.image
      ? `<img src="data:image/jpeg;base64,${d.image}" style="max-width:100%;border-radius:6px;margin-top:8px;display:block;">`
      : '';
    const detailParts = [
      `<div class="scan-card-detail-row"><span class="scan-card-detail-label">Comentario:</span><span>${escHtml(d.comment || '—')}</span></div>`,
      `<div class="scan-card-detail-row"><span class="scan-card-detail-label">IP:</span><span>${escHtml(d.ip || '—')}</span></div>`,
      `<div class="scan-card-detail-row"><span class="scan-card-detail-label">User-Agent:</span><span>${escHtml(d.ua || '—')}</span></div>`,
      `<div class="scan-card-detail-row"><span class="scan-card-detail-label">ID:</span><span>${escHtml(item.id)}</span></div>`
    ].join('') + imgHtml;
    return `<div class="list-card scan-card" data-id="${escHtml(item.id)}">
      <div class="scan-card-summary">
        <div class="scan-card-top">
          <span class="scan-card-date">${escHtml(fecha)}</span>
          <div class="scan-card-badges">${badges}</div>
        </div>
        ${bc ? `<a href="https://www.yomi.mx/scan.html?barcode=${encodeURIComponent(bc)}" target="_blank" rel="noopener" class="scan-card-barcode">${escHtml(bc)}</a>` : ''}
        ${d.productName ? `<div class="scan-card-name">${escHtml(d.productName)}</div>` : ''}
        <div class="scan-card-meta">${metaParts.map(p => `<span>${p}</span>`).join('')}</div>
      </div>
      <div class="scan-card-detail" hidden>${detailParts}
        <div class="scan-card-actions">
          <button class="btn-del" data-action="del" data-id="${escHtml(item.id)}">Eliminar</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
```

Nota: el badge 📷 usa la clase existente `.log-badge`/`.log-badge-blue` (ya usada por `renderLogs` para "Ing OCR"/"Nut OCR") — misma semántica visual, "hay contenido adicional de tipo imagen/OCR".

## 2. Por qué no se necesita tocar el click handler

El handler existente en `docList.addEventListener('click', ...)` ya:
- Detecta `.scan-card` por clase CSS, no por `currentCol` — cualquier markup con esa clase activa el toggle expand/collapse automáticamente.
- Maneja `data-action="del"` leyendo `currentCol` dinámicamente para construir la URL de borrado (`/api/admin/' + currentCol + '/' + id`) — ya funciona correctamente para `reports` sin cambios.

Al quitar el botón `data-action="view"` de la tarjeta, la rama `if (btn.dataset.action === 'view')` del handler simplemente deja de dispararse desde Reportes (sigue existiendo y activa para otras tabs que sí generan ese botón).

## Manejo de errores

- `d.image` ausente → sin badge, sin bloque de imagen en el detalle (comportamiento actual del modal, que también omitía la imagen si no existía).
- `d.category` ausente → se omite del meta row (mismo patrón que `ingredientSource`/`nutritionSource` condicionales en `renderLogs`).
- `d.comment` ausente → muestra "—" en el detalle (igual que el resto de campos opcionales).
- Reportes sin `barcode` (comentario general sin código) → no se muestra el link, mismo patrón que scan_logs cuando `bc` está vacío.

## Verificación

- **Sintaxis:** `node --check admin/admin.js`.
- **Manual:** ir a Reportes, confirmar que las tarjetas se ven con el mismo lenguaje visual que Logs. Expandir una tarjeta con imagen adjunta y confirmar que se ve inline. Expandir una sin imagen y confirmar que no deja un hueco vacío. Eliminar un reporte y confirmar que sigue funcionando. Confirmar que ya no aparece botón "Ver" en esta tab.
- **Suite completa:** `npx vitest run` — sin tests nuevos, debe seguir en verde por regresión.

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `admin/admin.js` | `renderReports` reescrita a tarjetas expandibles; sin cambios al click handler ni a `TAB_CONFIG` |
