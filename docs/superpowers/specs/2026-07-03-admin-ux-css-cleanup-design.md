# Admin panel — CSS cleanup (Important batch)

**Fecha:** 2026-07-03
**Estado:** Aprobado por usuario (brainstorming)
**Contexto:** Segundo sub-proyecto derivado del [audit UX del panel de admin](../infrastructure/2026-07-03-admin-ux-architecture-audit.md), hallazgos Importantes #3, #5, #6. El hallazgo Importante #4 (dispatch declarativo de tabs) queda como sub-proyecto separado — mayor riesgo, toca lógica compartida entre las 6 tabs.

## Objetivo

Consolidar tratamiento de tarjeta duplicado, resolver el nombre confuso de `.log-table`, y agregar comportamiento responsive básico a tablas y tarjetas — sin cambiar ninguna lógica de negocio ni el dispatch de tabs.

## Alcance

1. **CSS**: nueva clase base `.list-card` con el tratamiento visual compartido de `.doc-item`/`.scan-card`; ambas quedan con solo su delta.
2. **CSS**: renombrar `.log-table` → `.data-table` (nombre neutral, sirve para Reportes y Top Productos sin diferencia real de estilo).
3. **CSS**: `.doc-item` gana `flex-wrap: wrap`; ambos usos de tabla se envuelven en `.table-scroll { overflow-x: auto; }`.
4. **Markup** (`admin/admin.js`): actualizar las 4 llamadas que generan `class="doc-item"`/`class="scan-card"` (líneas 223, 249, 310, 363) para incluir `list-card`; actualizar los 2 usos de `class="log-table"` (líneas 70, 199) a `data-table` + envolver en `.table-scroll`.

**Fuera de alcance:**
- Hallazgo Importante #4 (dispatch declarativo de tabs) — sub-proyecto separado.
- Cualquier hallazgo Menor del audit (placeholder de filtro, Escape en modal, tooltip con foco, expand/collapse en Reportes).
- Cambios de comportamiento — este batch es puramente visual/estructural, cero cambio de lógica.

## 1. Clase base `.list-card`

En `admin/index.html`, reemplazar:

```css
    .doc-item { border: 2px solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: var(--paper); box-shadow: 2px 2px 0 var(--border); }
    .doc-item:hover { border-color: var(--ink); }
```

por:

```css
    .list-card { border: 2px solid var(--border); border-radius: var(--radius-sm); background: var(--paper); box-shadow: 2px 2px 0 var(--border); }
    .doc-item { padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .doc-item:hover { border-color: var(--ink); }
```

Y reemplazar:

```css
    .scan-card { border: 2px solid var(--border); border-radius: var(--radius-sm); background: var(--paper); box-shadow: 2px 2px 0 var(--border); cursor: pointer; transition: border-color 0.15s; }
    .scan-card:hover { border-color: var(--ink); }
```

por:

```css
    .scan-card { cursor: pointer; transition: border-color 0.15s; }
    .scan-card:hover { border-color: var(--ink); }
```

En `admin/admin.js`, los 4 puntos que generan markup de tarjeta agregan `list-card` a la lista de clases:

- Línea 223: `<div class="doc-item">` → `<div class="list-card doc-item">`
- Línea 249: `<div class="doc-item">` → `<div class="list-card doc-item">`
- Línea 310: `<div class="scan-card" data-id="...">` → `<div class="list-card scan-card" data-id="...">`
- Línea 363: `<div class="doc-item" data-id="...">` → `<div class="list-card doc-item" data-id="...">`

Verificación visual: el resultado computado de estilos para `.doc-item`/`.scan-card` debe ser idéntico al de antes del cambio — es una redistribución de las mismas declaraciones, no un cambio de valores.

## 2. Renombrar `.log-table` → `.data-table`

En `admin/index.html`, la regla:

```css
    /* Logs table */
    .log-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    .log-table th { font-family: var(--font-mono); font-weight: 600; text-align: left; padding: 8px 10px; background: var(--surface); border-bottom: 2px solid var(--border); color: var(--ink); white-space: nowrap; }
    .log-table td { padding: 7px 10px; border-bottom: 1px solid var(--border); color: var(--ink); vertical-align: top; }
    .log-table tr:hover td { background: var(--surface); }
    .log-table .mono { font-family: var(--font-mono); }
    .log-table .del-log { font-size: 0.72rem; padding: 2px 7px; border: 1px solid var(--border); background: none; color: var(--text-muted); border-radius: 3px; cursor: pointer; }
    .log-table .del-log:hover { border-color: var(--chile); color: var(--chile); }
```

Cambia todo `.log-table` → `.data-table` (mismo comentario `/* Logs table */` puede quedarse o renombrarse a `/* Tabla de datos */` — sin impacto funcional, se deja como está para minimizar el diff).

En `admin/admin.js`, las 2 líneas que generan `<table class="log-table">` cambian a `<table class="data-table">` (línea 70 y línea 199 — ver sección 3 para el envoltorio `.table-scroll` que también las modifica).

## 3. Scroll horizontal en tablas (`.table-scroll`)

Nueva regla CSS en `admin/index.html`:

```css
    .table-scroll { overflow-x: auto; }
```

En `admin/admin.js`, envolver ambos `<table class="data-table">` en un div `.table-scroll`:

**Línea 70-71 (Top productos, dentro de `renderStats`):**

Antes:
```js
          <table class="log-table"><thead><tr><th>Código</th><th>Producto</th><th>#</th></tr></thead>
          <tbody>${topRows || '<tr><td colspan="3" class="empty-msg">Sin datos.</td></tr>'}</tbody></table>
```

Después:
```js
          <div class="table-scroll"><table class="data-table"><thead><tr><th>Código</th><th>Producto</th><th>#</th></tr></thead>
          <tbody>${topRows || '<tr><td colspan="3" class="empty-msg">Sin datos.</td></tr>'}</tbody></table></div>
```

**Línea 199-202 (Reportes, dentro de `renderReports`):**

Antes:
```js
    docList.innerHTML = `<table class="log-table">
      <thead><tr><th>Fecha/Hora</th><th>Código</th><th>Categoría</th><th>Comentario</th><th>Sistema</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
```

Después:
```js
    docList.innerHTML = `<div class="table-scroll"><table class="data-table">
      <thead><tr><th>Fecha/Hora</th><th>Código</th><th>Categoría</th><th>Comentario</th><th>Sistema</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
```

## Manejo de errores

No hay lógica nueva — solo CSS y estructura de markup. El único riesgo es una regresión visual si el reemplazo de reglas CSS no preserva exactamente los mismos valores computados; la verificación manual (sección Verificación) cubre esto.

## Verificación

- **Sintaxis:** `node --check admin/admin.js` tras los cambios de markup.
- **Manual — consolidación de tarjetas:** abrir el panel de admin, revisar visualmente Logs (scan-card), Reportes/OCR/Cache (doc-item) — deben verse idénticos a antes del cambio (mismo borde, radio, sombra, fondo).
- **Manual — rename de tabla:** revisar Resumen (Top productos) y Reportes — ambas tablas deben verse idénticas a antes.
- **Manual — scroll horizontal:** con DevTools en modo responsive (~375px de ancho), confirmar que las tablas de Reportes y Top Productos muestran scroll horizontal en vez de desbordar la pantalla; confirmar que las tarjetas (`doc-item`) no rompen su layout con contenido largo (gracias a `flex-wrap`).
- **Suite completa:** `npx vitest run` — sin tests nuevos (cambio puramente visual/estructural), debe seguir en verde por regresión.

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `admin/index.html` | `.list-card` nueva; `.doc-item`/`.scan-card` reducidas a su delta; `.log-table` → `.data-table`; nueva `.table-scroll` |
| `admin/admin.js` | 4 sitios de markup agregan `list-card`; 2 usos de `.log-table` → `.data-table` envueltos en `.table-scroll` |
