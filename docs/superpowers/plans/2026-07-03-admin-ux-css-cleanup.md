# Admin Panel CSS Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the duplicated `.doc-item`/`.scan-card` box styling into a shared base class, resolve the misleading `.log-table` name, and add basic responsive handling to tables and cards — all Important findings from the admin UX audit, zero behavior change.

**Architecture:** Two independent CSS/markup changes, each touching `admin/index.html` (styles) and `admin/admin.js` (the template-string markup that references those classes). No JavaScript logic changes — purely visual/structural.

**Tech Stack:** Vanilla JS/CSS, no new dependencies.

## Global Constraints

- Zero behavior change — this is a pure visual/structural refactor. Computed styles for `.doc-item` and `.scan-card` must be identical before and after (same declarations, redistributed between a shared base class and each element's delta).
- No new automated tests — matches the spec's stated verification approach (syntax check + manual visual comparison + full-suite regression).
- Exact class names from the spec: `.list-card` (shared card base), `.data-table` (renamed from `.log-table`), `.table-scroll` (new overflow wrapper).
- `.doc-item` gains `flex-wrap: wrap` as part of this batch (Important #6) — this is the only actual style-behavior addition; everything else is a redistribution of existing declarations.

---

### Task 1: `.list-card` — consolidate `.doc-item`/`.scan-card` shared styling

**Files:**
- Modify: `admin/index.html` (CSS rules for `.doc-item`, `.scan-card`)
- Modify: `admin/admin.js` (4 markup sites generating `doc-item`/`scan-card` elements)

**Interfaces:**
- Produces: CSS class `.list-card` — border/radius/background/shadow shared by any list-style card element. Consumed directly in markup (no JS function signature involved).

- [ ] **Step 1: Replace `.doc-item` CSS in `admin/index.html`**

Find:

```css
    .doc-item { border: 2px solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: var(--paper); box-shadow: 2px 2px 0 var(--border); }
    .doc-item:hover { border-color: var(--ink); }
```

Replace with:

```css
    .list-card { border: 2px solid var(--border); border-radius: var(--radius-sm); background: var(--paper); box-shadow: 2px 2px 0 var(--border); }
    .doc-item { padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .doc-item:hover { border-color: var(--ink); }
```

- [ ] **Step 2: Replace `.scan-card` CSS in `admin/index.html`**

Find:

```css
    .scan-card { border: 2px solid var(--border); border-radius: var(--radius-sm); background: var(--paper); box-shadow: 2px 2px 0 var(--border); cursor: pointer; transition: border-color 0.15s; }
    .scan-card:hover { border-color: var(--ink); }
```

Replace with:

```css
    .scan-card { cursor: pointer; transition: border-color 0.15s; }
    .scan-card:hover { border-color: var(--ink); }
```

- [ ] **Step 3: Update the 4 markup sites in `admin/admin.js`**

All 4 are `return`/assignment statements building a card element's opening tag. Add `list-card` to each one's class list (verify each snippet still matches before editing — if any differs, stop and report rather than guessing):

```js
// site 1 (cache tab, product entries)
return `<div class="doc-item">
// becomes
return `<div class="list-card doc-item">
```

```js
// site 2 (cache tab, AI analysis entries)
return `<div class="doc-item">
// becomes
return `<div class="list-card doc-item">
```

```js
// site 3 (scan-log cards, renderLogs)
return `<div class="scan-card" data-id="${escHtml(item.id)}">
// becomes
return `<div class="list-card scan-card" data-id="${escHtml(item.id)}">
```

```js
// site 4 (generic renderList fallback, e.g. products_ocr/products_nutrition tabs)
<div class="doc-item" data-id="${escHtml(item.id)}">
// becomes
<div class="list-card doc-item" data-id="${escHtml(item.id)}">
```

- [ ] **Step 4: Verify syntax**

Run: `node --check admin/admin.js`
Expected: no output, exit code 0

- [ ] **Step 5: Manual verification**

Confirm a server is running (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin/` should return `200`; if not, start one with `node api/index.js`). Open `http://localhost:3000/admin/`, log in, click through Logs (scan-card), Cache (doc-item ×2 variants), OCR ingredientes or OCR nutrición (generic doc-item fallback).
Expected: every card-like element looks pixel-identical to before this change — same border, corner radius, shadow, background. No layout shift.

- [ ] **Step 6: Commit**

```bash
git add admin/index.html admin/admin.js
git commit -m "refactor: consolidate .doc-item/.scan-card shared styling into .list-card"
```

---

### Task 2: Rename `.log-table` → `.data-table`, add `.table-scroll` wrapper

**Files:**
- Modify: `admin/index.html` (CSS rename + new `.table-scroll` rule)
- Modify: `admin/admin.js` (2 table markup sites: `renderStats`, `renderReports`)

**Interfaces:**
- Consumes: none from Task 1 (independent change).
- Produces: CSS classes `.data-table` (renamed) and `.table-scroll` (new overflow-x wrapper) — consumed directly in markup.

- [ ] **Step 1: Rename `.log-table` to `.data-table` in `admin/index.html`**

Find:

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

Replace with (same comment, every `.log-table` token becomes `.data-table`, plus the new `.table-scroll` rule appended):

```css
    /* Logs table */
    .data-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    .data-table th { font-family: var(--font-mono); font-weight: 600; text-align: left; padding: 8px 10px; background: var(--surface); border-bottom: 2px solid var(--border); color: var(--ink); white-space: nowrap; }
    .data-table td { padding: 7px 10px; border-bottom: 1px solid var(--border); color: var(--ink); vertical-align: top; }
    .data-table tr:hover td { background: var(--surface); }
    .data-table .mono { font-family: var(--font-mono); }
    .data-table .del-log { font-size: 0.72rem; padding: 2px 7px; border: 1px solid var(--border); background: none; color: var(--text-muted); border-radius: 3px; cursor: pointer; }
    .data-table .del-log:hover { border-color: var(--chile); color: var(--chile); }
    .table-scroll { overflow-x: auto; }
```

- [ ] **Step 2: Update the Top Productos table markup in `admin/admin.js` (`renderStats`)**

Find:

```js
          <table class="log-table"><thead><tr><th>Código</th><th>Producto</th><th>#</th></tr></thead>
          <tbody>${topRows || '<tr><td colspan="3" class="empty-msg">Sin datos.</td></tr>'}</tbody></table>
```

Replace with:

```js
          <div class="table-scroll"><table class="data-table"><thead><tr><th>Código</th><th>Producto</th><th>#</th></tr></thead>
          <tbody>${topRows || '<tr><td colspan="3" class="empty-msg">Sin datos.</td></tr>'}</tbody></table></div>
```

- [ ] **Step 3: Update the Reportes table markup in `admin/admin.js` (`renderReports`)**

Find:

```js
    docList.innerHTML = `<table class="log-table">
      <thead><tr><th>Fecha/Hora</th><th>Código</th><th>Categoría</th><th>Comentario</th><th>Sistema</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
```

Replace with:

```js
    docList.innerHTML = `<div class="table-scroll"><table class="data-table">
      <thead><tr><th>Fecha/Hora</th><th>Código</th><th>Categoría</th><th>Comentario</th><th>Sistema</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
```

- [ ] **Step 4: Confirm no remaining `log-table` references**

Run: `grep -n "log-table" admin/index.html admin/admin.js`
Expected: no output (no matches) — confirms the rename is complete and no stale reference was missed.

- [ ] **Step 5: Verify syntax**

Run: `node --check admin/admin.js`
Expected: no output, exit code 0

- [ ] **Step 6: Manual verification**

Confirm a server is running (as in Task 1, Step 5). Open `http://localhost:3000/admin/`, log in.

1. Go to **Resumen** — the "Top productos" table should render identically to before (same columns, same styling).
2. Go to **Reportes** — the table should render identically to before.
3. Open browser DevTools, switch to a narrow responsive viewport (~375px wide).
   Expected: both tables show a horizontal scrollbar within their own container instead of overflowing the page.

- [ ] **Step 7: Commit**

```bash
git add admin/index.html admin/admin.js
git commit -m "refactor: rename .log-table to .data-table, add horizontal scroll wrapper"
```

---

### Task 3: Full regression and deploy

**Files:**
- None new.

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS — all existing tests remain green (no new tests added per Global Constraints)

- [ ] **Step 2: Push**

```bash
git push origin master
```

- [ ] **Step 3: Deploy production**

```bash
vercel --prod
```

- [ ] **Step 4: Verify in production**

1. Open `https://www.yomi.mx/admin/`, log in.
2. Click through all 6 tabs (Resumen, Logs, Reportes, OCR ingredientes, OCR nutrición, Cache) — confirm no visual regression on any card or table.
3. Test the narrow-viewport horizontal scroll on Resumen and Reportes tables, using real production data.
