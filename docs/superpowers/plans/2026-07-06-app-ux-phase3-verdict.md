# App UX Phase 3 — SANO/REGULAR/EVITAR Verdict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the top-line verdict the home screen's "¿Puedo comerlo?" promise implies — a SANO/REGULAR/EVITAR banner at the top of the results screen — and wire the same verdict into the "Productos recientes" badge on the home screen, which today is permanently empty because `rating` is never persisted.

**Architecture:** One pure function `computeVerdict(product)` in `app.js`, derived entirely from fields already computed by `parseApiProduct` (`product.sellos`, `product.notRecommended`) — no new API calls, no new data fetched. The verdict is rendered as a new `.verdict-banner` element (first child of `#result-success`) and passed as a 5th argument to the existing `saveToHistory`, which already writes to the same `yomi_history` localStorage key that `home.js`'s `badgeHtml` already knows how to render.

**Tech Stack:** Vanilla JS/CSS/HTML, no new dependencies.

## Global Constraints

- `computeVerdict` reads only `product.sellos` (array, from `app.js:1357` construction) and `product.notRecommended` (array of `{icon, grupo, razon, certain}`, from `app.js:1387` construction) — both already present on every parsed product by the time `renderProductData` runs. No new backend fields, no new fetch.
- The verdict strings are exactly `'sano'` / `'regular'` / `'evitar'` (lowercase) — this matches what `badgeHtml` in `home.js:11-20` already normalizes (it lowercases and does substring matching), so no changes to `badgeHtml` are needed.
- `.verdict-banner` colors reuse the exact hex values already defined for the home badges in `home.css:360-362` (`#16a34a` green / `#eab308` amber / `#dc2626` red) — do not invent a new palette.
- `saveToHistory`'s existing 4-arg call sites elsewhere (if any) must still work — the 5th `rating` argument is added with a default so it's backward compatible.
- No new automated tests — matches the spec's approach (manual scan-and-observe verification + full-suite regression, since `computeVerdict` is simple enough that a full test isn't required by the spec, though Task 1 includes a quick inline sanity check).

---

### Task 1: `computeVerdict` + verdict banner on results screen

**Files:**
- Modify: `app.js` (new `computeVerdict` function, new banner render call in `renderProductData`)
- Modify: `scan.html` (new `#verdict-banner` element, cache-bust bump)
- Modify: `styles.css` (new `.verdict-banner` rules, cache-bust bump in `scan.html`)

**Interfaces:**
- Produces: `computeVerdict(product) → 'sano' | 'regular' | 'evitar'`, called from `renderProductData`. Task 2 (saveToHistory wiring) consumes this same function — do not change its name or return values.

- [ ] **Step 1: Add `computeVerdict` in `app.js`**

Add immediately before `function renderNotRecommended(product) {` (`app.js:1503`):

```js
// Derive a top-line SANO/REGULAR/EVITAR verdict from data already computed
// by parseApiProduct (NOM-051 sellos + notRecommended groups) — no new data needed.
function computeVerdict(product) {
  const sellos = (product.sellos || []).length;
  const critical = (product.notRecommended || []).some(n => n.certain !== false);
  if (sellos >= 3 || (critical && sellos >= 2)) return 'evitar';
  if (sellos >= 1 || critical) return 'regular';
  return 'sano';
}
```

- [ ] **Step 2: Add the banner element in `scan.html`**

Find (`scan.html:193-196`):

```html
        <div id="result-success" class="result-state">

          <!-- 1. IDENTIDAD DEL PRODUCTO -->
          <div class="product-header">
```

Replace with:

```html
        <div id="result-success" class="result-state">

          <!-- 0. VEREDICTO -->
          <div id="verdict-banner" class="verdict-banner" role="status"></div>

          <!-- 1. IDENTIDAD DEL PRODUCTO -->
          <div class="product-header">
```

- [ ] **Step 3: Add `.verdict-banner` CSS in `styles.css`**

Add near `.product-header` (search for its rule and insert directly above it):

```css
.verdict-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: var(--radius-sm);
  font-weight: 700;
  font-size: 0.95rem;
  margin-bottom: 12px;
}
.verdict-banner.hidden { display: none; }
.verdict-sano    { background: rgba(22,163,74,0.12);  color: #16a34a; }
.verdict-regular { background: rgba(234,179,8,0.15);  color: #eab308; }
.verdict-evitar  { background: rgba(220,38,38,0.12);  color: #dc2626; }
```

- [ ] **Step 4: Render the banner in `renderProductData`**

Find (`app.js:1523-1530`):

```js
// Render dynamic results onto success screen
function renderProductData(product, barcode) {
  if (!product.isFood) {
    renderRejected(product);
    return;
  }

  currentBarcode = barcode;
  showState(resultSuccess);
```

Replace with:

```js
// Render dynamic results onto success screen
function renderProductData(product, barcode) {
  if (!product.isFood) {
    renderRejected(product);
    return;
  }

  currentBarcode = barcode;
  showState(resultSuccess);

  const verdict = computeVerdict(product);
  const verdictBanner = document.getElementById('verdict-banner');
  if (verdictBanner) {
    const verdictText = { sano: '✓ Puedes comerlo', regular: '⚠ Con moderación', evitar: '✗ Mejor evítalo' }[verdict];
    verdictBanner.className = 'verdict-banner verdict-' + verdict;
    verdictBanner.textContent = verdictText;
  }
```

(This inserts the banner logic right after `showState(resultSuccess)` and before the existing `cardAllergens.classList.add("hidden");` line — do not remove or reorder any existing line, only insert.)

- [ ] **Step 5: Bump cache-bust**

In `scan.html`: `styles.css?v=43` → `?v=44`, `app.js?v=62` → `?v=63`.

- [ ] **Step 6: Verify syntax**

Run: `node --check app.js`
Expected: no output, exit code 0

- [ ] **Step 7: Inline sanity check of `computeVerdict`**

Run this quick Node check (no test file needed, per Global Constraints):

```bash
node -e "
function computeVerdict(product) {
  const sellos = (product.sellos || []).length;
  const critical = (product.notRecommended || []).some(n => n.certain !== false);
  if (sellos >= 3 || (critical && sellos >= 2)) return 'evitar';
  if (sellos >= 1 || critical) return 'regular';
  return 'sano';
}
console.log(computeVerdict({sellos: [], notRecommended: []}));
console.log(computeVerdict({sellos: [1], notRecommended: []}));
console.log(computeVerdict({sellos: [1,2,3], notRecommended: []}));
console.log(computeVerdict({sellos: [], notRecommended: [{certain:true}]}));
"
```

Expected output: `sano`, `regular`, `evitar`, `regular`

- [ ] **Step 8: Manual verification**

Scan (or look up via manual entry) three real products: one with no NOM-051 seals and no restricted groups, one with 1-2 seals, one with 3+ seals. Confirm:

1. Clean product → green "✓ Puedes comerlo" banner appears above the product image.
2. Borderline product → amber "⚠ Con moderación" banner.
3. Product with many seals → red "✗ Mejor evítalo" banner.
4. Banner appears before any other content in the results panel, doesn't shift/overlap other elements.

- [ ] **Step 9: Run full test suite**

Run: `npx vitest run`
Expected: PASS — `tests/app.test.js` exercises `parseApiProduct`/related logic; confirm nothing there broke from the insertion in `renderProductData`.

- [ ] **Step 10: Commit**

```bash
git add app.js scan.html styles.css
git commit -m "feat: add SANO/REGULAR/EVITAR verdict banner to results screen"
```

---

### Task 2: Wire verdict into "Productos recientes" badge

**Files:**
- Modify: `app.js` (`saveToHistory` gains 5th `rating` param, `renderProductData`'s call site passes it)

**Interfaces:**
- Consumes: `computeVerdict(product)` from Task 1.
- Produces: `yomi_history` localStorage entries now include a `rating` field — `home.js`'s `badgeHtml(item.rating)` (unchanged) will now receive real data.

- [ ] **Step 1: Add `rating` parameter to `saveToHistory`**

Find (`app.js:160-166`):

```js
function saveToHistory(barcode, name, brand, image) {
  const history = getHistory().filter(h => h.barcode !== barcode);
  history.unshift({ barcode, name, brand, image: image || '' });
  if (history.length > 5) history.length = 5;
  localStorage.setItem("yomi_history", JSON.stringify(history));
  renderHistory();
}
```

Replace with:

```js
function saveToHistory(barcode, name, brand, image, rating) {
  const history = getHistory().filter(h => h.barcode !== barcode);
  history.unshift({ barcode, name, brand, image: image || '', rating: rating || '' });
  if (history.length > 5) history.length = 5;
  localStorage.setItem("yomi_history", JSON.stringify(history));
  renderHistory();
}
```

- [ ] **Step 2: Pass the verdict at the call site**

Find (`app.js:1533`, inside `renderProductData`, now after Task 1's Step 4 insertion — locate by this exact line, which Task 1 did not modify):

```js
  saveToHistory(barcode, product.name, product.brand, product.image);
```

Replace with:

```js
  saveToHistory(barcode, product.name, product.brand, product.image, verdict);
```

(`verdict` is the local variable computed in Task 1's Step 4 — this call site must run after that computation. If `renderProductData`'s current structure calls `saveToHistory` before the verdict block from Task 1, move the verdict computation earlier in the function so `verdict` is defined before this line; otherwise leave order as Task 1 already placed it.)

- [ ] **Step 3: Verify syntax**

Run: `node --check app.js`
Expected: no output, exit code 0

- [ ] **Step 4: Manual verification**

1. Scan a product with 3+ NOM-051 seals, then go to the home screen. Confirm its card in "Productos recientes" now shows the red "EVITAR" badge.
2. Scan a clean product, return home. Confirm its card shows the green "SANO" badge.
3. Confirm existing recent-product cards scanned before this change (no `rating` in their stored object) render with no badge (empty `product-card-badge-row`) rather than throwing an error — `badgeHtml('')` already returns `''` per its existing `if (!rating) return ''` guard.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: wire computed verdict into saveToHistory so recent-product badges render"
```

---

### Task 3: Deploy

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

Repeat Task 1 Step 8 and Task 2 Step 4's manual checks against `https://www.yomi.mx/scan.html` and `https://www.yomi.mx/` with real products.
