# Admin panel — Critical UX fixes (batch 1)

**Fecha:** 2026-07-03
**Estado:** Aprobado por usuario (brainstorming)
**Contexto:** Primer sub-proyecto derivado del [audit UX del panel de admin](../infrastructure/2026-07-03-admin-ux-architecture-audit.md), hallazgos Críticos #1 y #2.

## Objetivo

Corregir los dos hallazgos críticos del audit UX:
1. El filtro de `#doc-list` solo busca en `allItems` (registros ya paginados), produciendo un falso "no encontrado" en colecciones grandes (`scan_logs`) cuando el registro buscado aún no se cargó.
2. CSS muerta confirmada (`.log-row`, `.log-pname`, `tr.log-detail td`, `.log-detail-grid`) sobrante de la tabla de logs pre-rediseño.

## Alcance

1. Frontend: mostrar el alcance real de la búsqueda en `statsBar` cuando el filtro tiene texto y quedan páginas sin cargar — opción barata elegida sobre agregar un query param de búsqueda al backend (fuera de alcance, ver más abajo).
2. Frontend: eliminar las 4 reglas CSS muertas + su comentario obsoleto.

**Fuera de alcance:**
- Búsqueda server-side vía query param en `/api/admin/scan_logs` (la alternativa más robusta al hallazgo #1, descartada por costo/alcance para esta iteración — la etiqueta de alcance es la mitigación elegida, no una solución completa).
- Cualquiera de los hallazgos Importantes/Menores del audit (consolidación `.doc-item`/`.scan-card`, config declarativo de tabs, rename de `.log-table`, overflow-x en tablas, etc.) — cada uno es su propio sub-proyecto posterior.

## 1. Etiqueta de alcance del filtro

### Datos ya disponibles (sin llamada nueva al backend)

`loadStats()` (`admin/admin.js:28-41`) ya puebla `.nav-count[data-count="<collection>"]` con el total real de cada colección (via `/api/admin/stats`), y corre siempre al iniciar sesión (login → `loadCollection()` con `currentCol = 'resumen'` por defecto → `loadStats()`). Para cuando el admin visita cualquier otra tab, el badge ya tiene el total poblado.

### Cambio en `renderList()`

En `admin/admin.js`, la línea actual:

```js
    const noun = currentCol === 'scan_logs' ? 'escaneo' : currentCol === 'reports' ? 'reporte' : 'documento';
    statsBar.textContent = items.length + ' ' + noun + (items.length !== 1 ? 's' : '') + (q ? ' (filtrado)' : '');
```

pasa a:

```js
    const noun = currentCol === 'scan_logs' ? 'escaneo' : currentCol === 'reports' ? 'reporte' : 'documento';
    const totalEl = document.querySelector(`.nav-count[data-count="${currentCol}"]`);
    const total = totalEl && totalEl.textContent ? parseInt(totalEl.textContent, 10) : null;
    const scopeNote = (q && nextPageToken && total != null)
      ? ` — buscando en ${allItems.length} de ${total} cargados, carga más para ampliar`
      : (q ? ' (filtrado)' : '');
    statsBar.textContent = items.length + ' ' + noun + (items.length !== 1 ? 's' : '') + scopeNote;
```

### Comportamiento

- Sin filtro: sin cambio, muestra `"42 escaneos"`.
- Con filtro, todo ya cargado (`nextPageToken === null`): sin cambio, muestra `"3 escaneos (filtrado)"` — el filtro ya cubre el 100%, no hay nada que advertir.
- Con filtro, quedan páginas sin cargar, total conocido: muestra `"3 escaneos — buscando en 50 de 1230 cargados, carga más para ampliar"`.
- Con filtro, quedan páginas sin cargar, total desconocido (caso raro — badge vacío): cae al comportamiento actual `"3 escaneos (filtrado)"`, sin advertencia (no se puede afirmar el alcance sin el total).

## 2. Eliminar CSS muerta

En `admin/index.html`, eliminar el bloque completo (líneas ~97-101):

```css
    /* Logs expandibles */
    .log-row { cursor: pointer; }
    .log-pname { color: var(--text-muted); font-size: 0.75rem; }
    tr.log-detail td { background: var(--surface); font-size: 0.75rem; padding: 10px 14px; }
    .log-detail-grid { display: flex; flex-direction: column; gap: 4px; word-break: break-all; }
```

Confirmado sin referencias en `admin/admin.js` (verificado por grep en el audit). El comentario `/* Logs expandibles */` describe un mecanismo (tabla expandible fila-por-fila) que ya no existe — el rediseño de tarjetas (`.scan-card`) lo reemplazó.

## Manejo de errores

- `totalEl` puede ser `null` si el DOM aún no renderizó los tabs (no debería pasar en la práctica, ya que `renderList()` solo corre después de que el layout ya está montado) — el `&&` corto-circuita a `total = null`, cayendo al comportamiento sin advertencia.
- `parseInt` de un string vacío o no numérico da `NaN`; `NaN != null` es `true` en JS, lo que rompería la condición. Mitigación: el chequeo `totalEl.textContent` (string no vacío) antes del `parseInt` ya cubre el caso de badge vacío; si el badge tuviera contenido no numérico (no debería pasar, `renderStats` solo escribe números o cadena vacía), `total` sería `NaN` y la nota mostraría "de NaN cargados" — riesgo aceptado como extremadamente improbable dado que `renderStats` (`admin.js:38-41`) solo escribe `c` (un número) o `''`.

## Verificación

- **Sintaxis:** `node --check admin/admin.js` (o revisión manual, dado que no hay parser JS disponible vía Node para archivos de navegador con seguridad — usar el mismo método que validó Task 2 de la instrumentación de latencia).
- **Manual — etiqueta de filtro:** en `scan_logs` con más de una página de datos, escribir un filtro que no coincida con nada cargado; confirmar que aparece la nota de alcance en vez de un "0 escaneos" mudo. Escribir un filtro que si coincide con algo cargado; confirmar que la nota sigue apareciendo junto al conteo de resultados. En una colección pequeña (ej. `reports`, sin `nextPageToken`), confirmar que la nota NO aparece (comportamiento sin cambio).
- **Manual — CSS muerta:** confirmar visualmente que el panel de admin se ve idéntico tras el borrado (las reglas eliminadas no tenían ningún elemento que las usara, así que no debería haber cambio visual).
- **Suite completa:** `npx vitest run` — no se agregan tests nuevos (cambio de UI/CSS sin lógica de negocio testeable de forma aislada), debe seguir en verde por regresión.

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `admin/admin.js` | `renderList()` agrega nota de alcance de búsqueda cuando aplica |
| `admin/index.html` | Elimina 4 reglas CSS muertas + comentario obsoleto |
