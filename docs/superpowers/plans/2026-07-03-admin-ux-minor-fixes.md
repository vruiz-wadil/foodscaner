# Admin Panel Minor UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three small, independent admin panel fixes from the UX audit's Minor tier: per-tab filter placeholder text, Escape-to-close on the JSON modal, and removal of dead confidence-tooltip CSS.

**Architecture:** Three unrelated, small changes bundled into one task since each is only a few lines — a new `FILTER_PLACEHOLDERS` lookup consumed by the existing tab-click handler, one new `keydown` listener, and a CSS deletion.

**Tech Stack:** Vanilla JS/CSS, no new dependencies.

## Global Constraints

- The `.conf-wrap`/`.conf-tooltip` CSS being removed is confirmed dead (no references anywhere in `admin/admin.js`) — this is a deletion, not an accessibility improvement to live UI. Do not add `:focus-within`/`aria-describedby` to it; just delete it.
- `FILTER_PLACEHOLDERS` covers `scan_logs`, `reports`, `products_ocr`, `products_nutrition`, `cache` — five keys, one more than `TAB_CONFIG` (which excludes `cache`), since placeholder text is a UI-only concern orthogonal to the dispatch-shape distinction that keeps `cache` out of `TAB_CONFIG`.
- `resumen` has no entry in `FILTER_PLACEHOLDERS` — it falls through to the generic `'Filtrar…'` fallback (irrelevant in practice since the toolbar containing the filter input is hidden for that tab).
- No new automated tests — matches the spec's stated approach (small UI/CSS changes, verified via syntax check + manual check + full-suite regression).

---

### Task 1: Filter placeholder, Escape-to-close, remove dead tooltip CSS

**Files:**
- Modify: `admin/index.html` (default placeholder text, remove dead CSS block)
- Modify: `admin/admin.js` (new `FILTER_PLACEHOLDERS`, tab-click handler update, new Escape listener)

**Interfaces:**
- Produces: `FILTER_PLACEHOLDERS` — `{ [col: string]: string }`, consumed inline in the tab-click handler (no other task depends on this).

- [ ] **Step 1: Change the default filter placeholder in `admin/index.html`**

Find:

```html
      <input id="filter-input" type="text" placeholder="Filtrar por ID / código de barras…">
```

Replace with:

```html
      <input id="filter-input" type="text" placeholder="Filtrar…">
```

- [ ] **Step 2: Remove the dead confidence-tooltip CSS block in `admin/index.html`**

Find and delete entirely:

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

- [ ] **Step 3: Confirm the deleted classes are truly unreferenced**

Run: `grep -n "conf-wrap\|conf-tooltip" admin/admin.js`
Expected: no output (no matches)

- [ ] **Step 4: Add `FILTER_PLACEHOLDERS` in `admin/admin.js`**

Add near `TAB_CONFIG` (either immediately before or after it — both are per-tab configuration lookups and read better placed together):

```js
  const FILTER_PLACEHOLDERS = {
    scan_logs: 'Filtrar por código, IP, sistema, producto, fuente o cache…',
    reports: 'Filtrar por código, categoría o comentario…',
    products_ocr: 'Filtrar por ID…',
    products_nutrition: 'Filtrar por ID…',
    cache: 'Filtrar por código, nombre, fuente o modelo…'
  };
```

- [ ] **Step 5: Update the tab-click handler to set the placeholder**

Find, inside `tabsEl.addEventListener('click', e => { ... })`:

```js
    filterInput.value = '';
    allItems = [];
```

Replace with:

```js
    filterInput.value = '';
    filterInput.placeholder = FILTER_PLACEHOLDERS[currentCol] || 'Filtrar…';
    allItems = [];
```

- [ ] **Step 6: Add the Escape-to-close listener**

Find:

```js
  modalClose.addEventListener('click', () => modalOverlay.classList.remove('open'));
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) modalOverlay.classList.remove('open'); });
```

Add immediately after:

```js
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('open')) modalOverlay.classList.remove('open');
  });
```

- [ ] **Step 7: Verify syntax**

Run: `node --check admin/admin.js`
Expected: no output, exit code 0

- [ ] **Step 8: Manual verification**

Confirm a server is running (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin/` should return `200`; if not, start one with `node api/index.js`). Open `http://localhost:3000/admin/`, log in.

1. Click through all 6 tabs; confirm the filter input's placeholder text changes to match each tab's `FILTER_PLACEHOLDERS` entry (Resumen's toolbar stays hidden, so its placeholder isn't visibly checkable — that's expected).
2. Go to **Reportes**, click "Ver" on any report to open the JSON modal, press `Escape`. Expected: modal closes, same as clicking ✕ or clicking outside it.
3. Go to **Cache**, click "Ver" on any AI cache entry, press `Escape`. Expected: modal closes.
4. Visually confirm the admin panel looks unchanged aside from the placeholder text (the deleted CSS had zero live references, so no visual regression is expected).

- [ ] **Step 9: Run full test suite**

Run: `npx vitest run`
Expected: PASS — all existing tests remain green (no new tests added per Global Constraints)

- [ ] **Step 10: Commit**

```bash
git add admin/index.html admin/admin.js
git commit -m "fix: per-tab filter placeholder, Escape-to-close modal, remove dead tooltip CSS"
```

---

### Task 2: Deploy

**Files:**
- None new.

- [ ] **Step 1: Push**

```bash
git push origin master
```

- [ ] **Step 2: Deploy production**

```bash
vercel --prod
```

- [ ] **Step 3: Verify in production**

Repeat Task 1 Step 8's manual checks against `https://www.yomi.mx/admin/` with real production data.
