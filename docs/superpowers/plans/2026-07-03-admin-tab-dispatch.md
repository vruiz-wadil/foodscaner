# Admin Panel Declarative Tab Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scattered `if (currentCol === '...')` checks in `renderList()` and `loadCollection()` with a single `TAB_CONFIG` lookup table, for the four tabs that share the same shape (paginated, filterable, delete-by-ID collection) — `scan_logs`, `reports`, `products_ocr`, `products_nutrition`. `resumen` and `cache` are structurally different and are explicitly NOT touched.

**Architecture:** Pure extraction refactor — no behavior change. Three filter predicates currently inline in `renderList()` become named functions; a new `TAB_CONFIG` object maps each of the four tabs to `{ noun, filterPredicate, render, onLoad }`; `renderList()` and `loadCollection()` consult this table instead of their current `if/else` chains.

**Tech Stack:** Vanilla JS, no new dependencies.

## Global Constraints

- **Zero behavior change.** This is an extraction — every filter predicate, render dispatch, and load hook must produce byte-identical results to what the current `if/else` chains already produce. Any difference is a bug in this task, not an intentional improvement.
- `resumen` and `cache` are NOT touched — their `currentCol === 'resumen'` / `currentCol === 'cache'` checks in `loadCollection()` and the `filterInput` handler remain exactly as they are today. Do not attempt to fold them into `TAB_CONFIG`.
- `TAB_CONFIG` covers exactly 4 keys: `scan_logs`, `reports`, `products_ocr`, `products_nutrition`.
- `renderList()` is only ever called for these 4 tabs (never for `resumen` or `cache`, which have their own load/render paths) — `TAB_CONFIG[currentCol]` is guaranteed to exist whenever `renderList()` runs, so no `undefined` fallback is needed inside it.
- No new automated tests — matches the spec's stated approach (this is an organizational refactor with no isolatable new business logic; verification is exact-match code review + full manual regression across all 6 tabs, per the user's explicit request for extra care on this change).

---

### Task 1: Extract filter predicates and introduce `TAB_CONFIG`

**Files:**
- Modify: `admin/admin.js` (add 3 named functions, add `TAB_CONFIG`, rewrite `renderList()` and one line in `loadCollection()`)

**Interfaces:**
- Produces: `filterScanLogs(item, q)`, `filterReports(item, q)`, `filterById(item, q)` — each `(item: {id, data}, q: string) => boolean`. `TAB_CONFIG` — `{ [col: string]: { noun: string, filterPredicate: Function, render: Function|null, onLoad?: Function } }`.

- [ ] **Step 1: Add the 3 extracted filter predicate functions**

In `admin/admin.js`, immediately before the `function renderList()` declaration, add:

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

These must be character-for-character equivalent in logic to the inline conditions currently inside `renderList()`'s filter (compare against Step 3 below before deleting the original inline code).

- [ ] **Step 2: Add `TAB_CONFIG`**

Immediately after the 3 functions from Step 1 (still before `renderList()`), add:

```js
  const TAB_CONFIG = {
    scan_logs: { noun: 'escaneo', filterPredicate: filterScanLogs, render: renderLogs, onLoad: loadBarcodeFlags },
    reports: { noun: 'reporte', filterPredicate: filterReports, render: renderReports },
    products_ocr: { noun: 'documento', filterPredicate: filterById, render: null },
    products_nutrition: { noun: 'documento', filterPredicate: filterById, render: null }
  };
```

`renderLogs`, `renderReports`, and `loadBarcodeFlags` are pre-existing functions already defined elsewhere in this file — do not redefine them, just reference them here.

- [ ] **Step 3: Rewrite `renderList()` to use `TAB_CONFIG`**

Find the current `renderList()` function:

```js
  function renderList() {
    const q = filterInput.value.trim().toLowerCase();
    const items = q ? allItems.filter(i => {
      if (currentCol === 'scan_logs') {
        const d = i.data || {};
        return i.id.includes(q) || (d.barcode||'').includes(q) || (d.ip||'').toLowerCase().includes(q) || (d.os||'').toLowerCase().includes(q) || (d.productName||'').toLowerCase().includes(q) || (d.cacheLevel||'').toLowerCase().includes(q) || (d.sourcesTried||[]).some(s => (s.source||'').toLowerCase().includes(q));
      }
      if (currentCol === 'reports') {
        const d = i.data || {};
        return (d.barcode||'').includes(q) || (d.category||'').toLowerCase().includes(q) || (d.comment||'').toLowerCase().includes(q);
      }
      return i.id.toLowerCase().includes(q);
    }) : allItems;
    const noun = currentCol === 'scan_logs' ? 'escaneo' : currentCol === 'reports' ? 'reporte' : 'documento';
    const totalEl = document.querySelector(`.nav-count[data-count="${currentCol}"]`);
    const total = totalEl && totalEl.textContent ? parseInt(totalEl.textContent, 10) : null;
    const scopeNote = (q && nextPageToken && total != null)
      ? ` — buscando en ${allItems.length} de ${total} cargados, carga más para ampliar`
      : (q ? ' (filtrado)' : '');
    statsBar.textContent = items.length + ' ' + noun + (items.length !== 1 ? 's' : '') + scopeNote;
    if (currentCol === 'scan_logs') { renderLogs(items); return; }
    if (currentCol === 'reports') { renderReports(items); return; }
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

Replace it entirely with:

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

Note: only the filter/noun/render-dispatch logic changed — the `totalEl`/`total`/`scopeNote`/`statsBar.textContent` lines and the generic `doc-item` HTML template are untouched, copied verbatim.

- [ ] **Step 4: Update the `loadBarcodeFlags` call site in `loadCollection()`**

Find:

```js
    if (currentCol === 'scan_logs' && !append) await loadBarcodeFlags();
```

Replace with:

```js
    const _cfg = TAB_CONFIG[currentCol];
    if (_cfg?.onLoad && !append) await _cfg.onLoad();
```

This line sits between the `resumen` early-return and the `cache` branch in `loadCollection()` — same position as the original, just generalized. Do not move it elsewhere in the function.

- [ ] **Step 5: Verify syntax**

Run: `node --check admin/admin.js`
Expected: no output, exit code 0

- [ ] **Step 6: Verify byte-for-byte predicate equivalence**

This step exists because Global Constraints require zero behavior change — do it even though it's unusual to include in a plan. Re-read the 3 new functions from Step 1 side-by-side with the original inline conditions quoted in Step 3's "find this" block. Confirm each condition (operators, field names, method calls, order of `||` clauses) is character-for-character identical, just wrapped in a named function instead of an inline arrow/if. Write down in your report which fields each predicate checks, to make the comparison explicit.

- [ ] **Step 7: Manual verification — all 6 tabs**

Confirm a server is running (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin/` should return `200`; if not, start one with `node api/index.js`). Open `http://localhost:3000/admin/`, log in, and go through EVERY tab (this task's Global Constraints demand full regression, not spot-checking):

1. **Resumen** — loads normally. (Not touched by this task — confirms no accidental regression from shared code.)
2. **Logs** (`scan_logs`) — loads, paginate with "Cargar más" if available, filter by a barcode (confirm it still matches), filter by an IP fragment, filter by OS name, filter by cache level (`L1`/`L2`), expand/collapse a scan card, delete one log entry.
3. **Reportes** — loads, filter by barcode, filter by category text, filter by comment text, open the "Ver" modal, delete one report.
4. **OCR ingredientes** (`products_ocr`) — loads, filter by document ID only (confirm barcode/other-field filtering does NOT match, since `filterById` only checks `item.id`), open "Ver", delete one entry.
5. **OCR nutrición** (`products_nutrition`) — same checks as OCR ingredientes.
6. **Cache** — loads (not touched by this task), filter (its own separate code path), delete a product-cache entry by layer, delete an AI-cache entry by layer.
7. **Cross-tab reset check** — switch between Logs → Reportes → Cache → Logs several times in a row; confirm the document list and filter box reset cleanly each time (no stale data leaking between tabs), matching pre-refactor behavior.
8. **`loadBarcodeFlags` indirect check** — in Logs, confirm the 🚩 "Reporte" badge still appears on any scan-log card whose barcode has an associated report (this only works if `loadBarcodeFlags()` is still being called via the new `onLoad` hook).

Document the pass/fail of every one of these 8 checks in your report — do not summarize as "looks fine," list each one.

- [ ] **Step 8: Run full test suite**

Run: `npx vitest run`
Expected: PASS — all existing tests remain green (no new tests added per Global Constraints)

- [ ] **Step 9: Commit**

```bash
git add admin/admin.js
git commit -m "refactor: replace scattered currentCol dispatch with TAB_CONFIG for standard collections"
```

---

### Task 2: Full regression and deploy

**Files:**
- None new.

- [ ] **Step 1: Full test suite (re-confirm)**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 2: Push**

```bash
git push origin master
```

- [ ] **Step 3: Deploy production**

```bash
vercel --prod
```

- [ ] **Step 4: Verify in production**

Repeat Task 1 Step 7's full 8-point manual check against `https://www.yomi.mx/admin/` with real production data, since this is the highest-risk change in the admin UX audit series and the user explicitly asked for extra care. Do not skip any of the 6 tabs.
