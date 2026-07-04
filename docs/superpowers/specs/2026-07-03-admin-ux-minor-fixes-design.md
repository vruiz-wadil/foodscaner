# Admin panel — Minor UX fixes (batch)

**Fecha:** 2026-07-03
**Estado:** Aprobado por usuario (brainstorming)
**Contexto:** Cuarto sub-proyecto derivado del [audit UX del panel de admin](../infrastructure/2026-07-03-admin-ux-architecture-audit.md), hallazgos Menores #7, #8, y #9 (revisado — ver nota abajo). El hallazgo #10 (Reportes a tarjetas expandibles) es su propio sub-proyecto separado por tamaño/riesgo.

## Objetivo

Tres arreglos pequeños e independientes: placeholder de filtro específico por tab, cierre de modal con Escape, y limpieza de CSS muerta descubierta durante este brainstorming (el tooltip de confianza ya no se renderiza en ningún lado).

## Nota sobre el hallazgo #9

El audit original proponía agregar `:focus-within` + `aria-describedby` al tooltip de confianza (`.conf-wrap`/`.conf-tooltip`) para hacerlo accesible por teclado. Al revisar el código real, **ese markup ya no se genera en ningún lado de `admin/admin.js`** — la columna de confianza fue reemplazada por `confidenceNotes` como texto plano en el detalle de la tarjeta de scan_logs (rediseño previo). El CSS es muerto, no una UI viva sin accesibilidad. Este spec corrige el hallazgo #9 como **eliminación de CSS muerta**, no como mejora de accesibilidad — la premisa original del audit no aplicaba.

## Alcance

1. **Placeholder de filtro por tab** — objeto `FILTER_PLACEHOLDERS` (separado de `TAB_CONFIG` porque también cubre `cache`, que no está en esa tabla), aplicado en el handler de click de tabs.
2. **Escape cierra el modal de JSON** — un listener de teclado.
3. **Eliminar CSS muerta del tooltip de confianza** (`.conf-wrap`, `.conf-tooltip`, `.conf-tooltip::after`, `.conf-tooltip-level`, `.conf-tooltip-notes`) en `admin/index.html`.

**Fuera de alcance:** hallazgo #10 (Reportes a tarjetas expandibles) — sub-proyecto separado.

## 1. Placeholder de filtro por tab

En `admin/index.html`, el placeholder estático:

```html
      <input id="filter-input" type="text" placeholder="Filtrar por ID / código de barras…">
```

pasa a un fallback genérico:

```html
      <input id="filter-input" type="text" placeholder="Filtrar…">
```

En `admin/admin.js`, nuevo objeto (ubicado cerca de `TAB_CONFIG` para que ambas tablas de configuración por tab queden juntas):

```js
  const FILTER_PLACEHOLDERS = {
    scan_logs: 'Filtrar por código, IP, sistema, producto, fuente o cache…',
    reports: 'Filtrar por código, categoría o comentario…',
    products_ocr: 'Filtrar por ID…',
    products_nutrition: 'Filtrar por ID…',
    cache: 'Filtrar por código, nombre, fuente o modelo…'
  };
```

En el handler de click de tabs (`tabsEl.addEventListener('click', ...)`), agregar la actualización del placeholder junto a `filterInput.value = '';`:

```js
    filterInput.value = '';
    filterInput.placeholder = FILTER_PLACEHOLDERS[currentCol] || 'Filtrar…';
```

`resumen` no tiene entrada en `FILTER_PLACEHOLDERS` — cae al fallback genérico `'Filtrar…'`, aunque es irrelevante en la práctica porque `toolbarEl` (que contiene el input) está oculto para esa tab.

## 2. Escape cierra el modal

En `admin/admin.js`, junto a los listeners existentes del modal:

```js
  modalClose.addEventListener('click', () => modalOverlay.classList.remove('open'));
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) modalOverlay.classList.remove('open'); });
```

agregar inmediatamente después:

```js
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('open')) modalOverlay.classList.remove('open');
  });
```

## 3. Eliminar CSS muerta del tooltip de confianza

En `admin/index.html`, eliminar el bloque completo:

```css
    /* Confidence tooltip */
    .conf-wrap { position: relative; display: inline-block; cursor: help; }
    .conf-tooltip {
      display: none; position: absolute; bottom: calc(100% + 8px); left: 50%;
      transform: translateX(-50%); background: var(--ink); color: #fff;
      border-radius: 6px; padding: 10px 14px; width: 260px; font-size: 0.78rem;
      line-height: 1.5; z-index: 20; white-space: normal; pointer-events: none;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    }
    .conf-tooltip::after {
      content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
      border: 6px solid transparent; border-top-color: var(--ink);
    }
    .conf-wrap:hover .conf-tooltip { display: block; }
    .conf-tooltip-level { font-weight: 700; margin-bottom: 4px; }
    .conf-tooltip-notes { color: rgba(255,255,255,0.75); }
```

Confirmado sin referencias en `admin/admin.js` (grep de `conf-wrap|conf-tooltip` no arrojó resultados).

## Manejo de errores

Sin lógica nueva significativa — placeholder cae a un fallback genérico si falta una entrada; Escape no hace nada si el modal ya está cerrado (`classList.contains('open')` como guarda); eliminación de CSS confirmada sin referencias.

## Verificación

- **Sintaxis:** `node --check admin/admin.js`.
- **Manual — placeholder:** cambiar entre las 6 tabs, confirmar que el texto del placeholder cambia acorde a cada una (Resumen no es observable ya que el input está oculto).
- **Manual — Escape:** abrir el modal "Ver" en cualquier tab con esa acción (Reportes, Cache), presionar Escape, confirmar que se cierra igual que con el botón ✕ o click fuera.
- **Manual — CSS muerta:** confirmar visualmente que el panel se ve idéntico tras el borrado (sin referencias, no debería haber cambio).
- **Suite completa:** `npx vitest run` — sin tests nuevos, debe seguir en verde por regresión.

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `admin/index.html` | Placeholder por defecto genérico; elimina CSS muerta del tooltip de confianza |
| `admin/admin.js` | Nuevo `FILTER_PLACEHOLDERS`; placeholder dinámico en el handler de tabs; listener de Escape para el modal |
