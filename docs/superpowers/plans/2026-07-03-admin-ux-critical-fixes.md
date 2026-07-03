# Admin Panel Critical UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two Critical findings from the admin panel UX architecture audit: a filter that can silently produce a false "not found" on partially-loaded collections, and confirmed-dead CSS left over from a prior redesign.

**Architecture:** Both fixes are small, independent, single-area changes. The filter-scope fix reuses data already fetched by `loadStats()` (no new backend call) to add a scope disclaimer to the existing `statsBar` text in `renderList()`. The dead-CSS fix is a straight deletion of unreferenced rules in `admin/index.html`.

**Tech Stack:** Vanilla JS/CSS, no new dependencies.

## Global Constraints

- No new backend endpoint or query param — the filter-scope fix is UI-only, reusing the `.nav-count` badge total already populated by `loadStats()`.
- No visual change when a filter matches everything already loaded, or when the collection has no more pages (`nextPageToken === null`) — the existing `(filtrado)` behavior must be preserved unchanged in those cases.
- Dead CSS removal must not change any visible element — verify no other file references the removed classes before deleting.
- No new automated tests for either fix (UI/CSS changes without isolatable business logic — matches the spec's stated verification approach: syntax check + manual check + full-suite regression).

---

### Task 1: Filter-scope disclaimer in `renderList()`

**Files:**
- Modify: `admin/admin.js` (`renderList` function)

**Interfaces:**
- Produces: `statsBar.textContent` includes a scope note (`" — buscando en N de M cargados, carga más para ampliar"`) when a filter is active, more pages remain (`nextPageToken` truthy), and the total for `currentCol` is known via the `.nav-count[data-count="<col>"]` DOM badge (populated by the existing `loadStats()`/`renderStats()` flow). Falls back to the current `(filtrado)` text otherwise.

- [ ] **Step 1: Locate and replace the `statsBar` line in `renderList()`**

Find in `admin/admin.js`:

```js
    const noun = currentCol === 'scan_logs' ? 'escaneo' : currentCol === 'reports' ? 'reporte' : 'documento';
    statsBar.textContent = items.length + ' ' + noun + (items.length !== 1 ? 's' : '') + (q ? ' (filtrado)' : '');
```

Replace with:

```js
    const noun = currentCol === 'scan_logs' ? 'escaneo' : currentCol === 'reports' ? 'reporte' : 'documento';
    const totalEl = document.querySelector(`.nav-count[data-count="${currentCol}"]`);
    const total = totalEl && totalEl.textContent ? parseInt(totalEl.textContent, 10) : null;
    const scopeNote = (q && nextPageToken && total != null)
      ? ` — buscando en ${allItems.length} de ${total} cargados, carga más para ampliar`
      : (q ? ' (filtrado)' : '');
    statsBar.textContent = items.length + ' ' + noun + (items.length !== 1 ? 's' : '') + scopeNote;
```

- [ ] **Step 2: Verify syntax**

Run: `node --check admin/admin.js`
Expected: no output, exit code 0 (a clean parse produces no output)

- [ ] **Step 3: Manual verification**

Run: `node api/index.js` (or confirm it's already running: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin/` should return `200`). Open `http://localhost:3000/admin/`, log in.

1. Go to the **Logs** tab (`scan_logs`). If there's a "Cargar más" button visible (more pages remain), type a filter string that matches nothing currently loaded.
   Expected: `stats-bar` shows `"0 escaneos — buscando en <N> de <M> cargados, carga más para ampliar"` instead of a bare `"0 escaneos (filtrado)"`.
2. Clear the filter, go to the **Reportes** tab (small collection, no "Cargar más" button — all loaded).
   Type any filter text.
   Expected: `stats-bar` shows the unchanged `"<N> reportes (filtrado)"` — no scope note, since `nextPageToken` is `null` for this tab.
3. In **Logs**, clear the filter entirely.
   Expected: `stats-bar` shows the unchanged plain count with no `(filtrado)` suffix at all.

- [ ] **Step 4: Commit**

```bash
git add admin/admin.js
git commit -m "fix: show filter scope disclaimer when not all records are loaded"
```

---

### Task 2: Remove dead CSS

**Files:**
- Modify: `admin/index.html`

**Interfaces:**
- None — this task has no interface other people depend on; it only removes unreferenced code.

- [ ] **Step 1: Confirm the classes are truly unreferenced**

Run: `grep -n "log-row\|log-pname\|log-detail" admin/admin.js`
Expected: no output (no matches) — confirms these classes are not used anywhere in the JS that generates the admin panel's markup.

- [ ] **Step 2: Delete the dead CSS block**

Find in `admin/index.html`:

```css
    /* Logs expandibles */
    .log-row { cursor: pointer; }
    .log-pname { color: var(--text-muted); font-size: 0.75rem; }
    tr.log-detail td { background: var(--surface); font-size: 0.75rem; padding: 10px 14px; }
    .log-detail-grid { display: flex; flex-direction: column; gap: 4px; word-break: break-all; }
```

Delete it entirely (all 5 lines, including the comment).

- [ ] **Step 3: Manual verification**

Run: `node api/index.js` (or confirm already running as in Task 1, Step 3). Open `http://localhost:3000/admin/`, log in, click through all 6 tabs (Resumen, Logs, Reportes, OCR ingredientes, OCR nutrición, Cache).
Expected: visually identical to before the change — no layout shift, no missing styles, since the deleted rules had zero live references.

- [ ] **Step 4: Commit**

```bash
git add admin/index.html
git commit -m "fix: remove dead CSS from pre-card-redesign log table"
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
2. Repeat Task 1's manual verification (filter-scope disclaimer) against real production data in the **Logs** tab.
3. Repeat Task 2's manual verification (click through all 6 tabs, confirm no visual regression).
