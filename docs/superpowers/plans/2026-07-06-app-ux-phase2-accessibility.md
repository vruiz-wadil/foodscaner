# App UX Phase 2 — Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the user-facing app to basic AA accessibility: visible keyboard focus, adequate text contrast, keyboard-operable recent-product cards, screen-reader announcements for scan/result state changes, non-focusable disabled nav tabs, and proper dialog semantics + focus trapping on the 4 modals.

**Architecture:** Task 1 bundles five small, independent, low-risk CSS/HTML/JS one-liners (D1, D2, D3, D5, D6). Task 2 is the one higher-risk change: adding `role="dialog"`/`aria-modal`/`aria-labelledby` to 4 modals plus a shared `trapFocus()` helper wired into each modal's existing show/hide functions, without altering their current open/close behavior (Escape-to-close on `report-modal`/`nutrition-modal`, click-outside-to-close on all).

**Tech Stack:** Vanilla JS/CSS/HTML, no new dependencies.

## Global Constraints

- Do not remove any existing `outline: none` rule (`styles.css:393,417,630,1790`) — those suppress the mouse-click focus ring; `:focus-visible` is additive and only fires for keyboard/programmatic focus, so both must coexist.
- `--ink-3`/`--ink-muted` contrast fix touches the **defining** `:root` in each file (`styles.css:10`, `home.css:10`) — a single-line value change each, not a search-and-replace of every usage site.
- The focus-trap helper must not break any modal's existing close paths: overlay click, explicit close button, and (where already present) Escape. Verify each of the 4 modals' current close behavior before touching it.
- No new automated tests — matches the spec's approach (manual keyboard/screen-reader verification + full-suite regression for JS changes).

---

### Task 1: Focus-visible, contrast, keyboard cards, live regions, disabled tabs

**Files:**
- Modify: `styles.css` (focus-visible rule, `--ink-3` value, `.scan-help` opacity)
- Modify: `home.css` (focus-visible rule, `--ink-muted` value)
- Modify: `home.js` (keydown handler on product grid)
- Modify: `scan.html` (`aria-live` on coaching text and `#ai-error`, `role="status"` wrapper, `tabindex="-1"` on disabled nav buttons)
- Modify: `index.html` (`tabindex="-1"` on disabled nav buttons)

**Interfaces:**
- Consumes: nothing from Phase 1.
- Produces: nothing consumed by Task 2 (independent).

- [ ] **Step 1: Add `:focus-visible` rule to `styles.css`**

Add near the existing `.dietary-grid-item.selected` rule (`styles.css:984-987`), which already uses this exact treatment — reuse it verbatim as a global rule. Insert after line 987 (`}` closing `.dietary-grid-item.selected`):

```css
:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
```

- [ ] **Step 2: Add the same `:focus-visible` rule to `home.css`**

Insert near the top of the file, after the `:root` block (after the closing `}` that follows the `--ink-3` alias added in Phase 1):

```css
:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Fix contrast — `styles.css`**

Find (`styles.css:10`):

```css
  --ink-3:         #7a9080;   /* muted text */
```

Replace with:

```css
  --ink-3:         #5f7568;   /* muted text, ~4.5:1 on --paper */
```

Find (`styles.css:337-342`):

```css
.scan-help {
  color: rgba(255,255,255,0.5);
  font-size: 0.85rem;
  margin: 0;
  line-height: 1.4;
}
```

Replace the color line with:

```css
.scan-help {
  color: rgba(255,255,255,0.75);
  font-size: 0.85rem;
  margin: 0;
  line-height: 1.4;
}
```

- [ ] **Step 4: Fix contrast — `home.css`**

Find (`home.css:10`):

```css
  --ink-muted:     #7a9080;
```

Replace with:

```css
  --ink-muted:     #5f7568;
```

- [ ] **Step 5: Make recent-product cards keyboard-operable in `home.js`**

Find:

```js
  // Product card click → scan that barcode
  document.getElementById('products-grid').addEventListener('click', e => {
    const card = e.target.closest('.product-card');
    if (!card) return;
    window.location.href = 'scan.html?barcode=' + encodeURIComponent(card.dataset.barcode);
  });
```

Replace with:

```js
  // Product card click → scan that barcode
  document.getElementById('products-grid').addEventListener('click', e => {
    const card = e.target.closest('.product-card');
    if (!card) return;
    window.location.href = 'scan.html?barcode=' + encodeURIComponent(card.dataset.barcode);
  });

  // Same navigation via keyboard (cards are role="button" tabindex="0")
  document.getElementById('products-grid').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.product-card');
    if (!card) return;
    e.preventDefault();
    window.location.href = 'scan.html?barcode=' + encodeURIComponent(card.dataset.barcode);
  });
```

- [ ] **Step 6: Add live regions in `scan.html`**

Find:

```html
            <p id="scan-coaching" class="scan-coaching-text"></p>
```

Replace with:

```html
            <p id="scan-coaching" class="scan-coaching-text" aria-live="polite"></p>
```

Find:

```html
          <div id="ai-error" class="hidden" style="margin-top:8px;text-align:center;color:var(--accent-error);font-size:0.85rem;"></div>
```

Replace with:

```html
          <div id="ai-error" class="hidden" role="alert" aria-live="assertive" style="margin-top:8px;text-align:center;color:var(--accent-error);font-size:0.85rem;"></div>
```

- [ ] **Step 7: Disabled nav tabs — `scan.html`**

Find:

```html
    <button class="nav-item nav-disabled" aria-label="Análisis" aria-disabled="true">
      <img src="assets/redesign/icon-analysis.svg" alt="" class="nav-icon">
      <span class="nav-label">Análisis</span>
    </button>
    <button class="nav-item nav-disabled" aria-label="Perfil" aria-disabled="true">
      <img src="assets/redesign/icon-profile.svg" alt="" class="nav-icon">
      <span class="nav-label">Perfil</span>
    </button>
```

Replace with:

```html
    <button class="nav-item nav-disabled" aria-label="Análisis (próximamente)" aria-disabled="true" tabindex="-1">
      <img src="assets/redesign/icon-analysis.svg" alt="" class="nav-icon">
      <span class="nav-label">Análisis</span>
    </button>
    <button class="nav-item nav-disabled" aria-label="Perfil (próximamente)" aria-disabled="true" tabindex="-1">
      <img src="assets/redesign/icon-profile.svg" alt="" class="nav-icon">
      <span class="nav-label">Perfil</span>
    </button>
```

- [ ] **Step 8: Disabled nav tabs — `index.html`**

Find:

```html
      <button class="nav-item nav-disabled" aria-label="Análisis" aria-disabled="true">
        <img src="assets/redesign/icon-analysis.svg" alt="" class="nav-icon">
        <span class="nav-label nav-label-muted">Análisis</span>
      </button>
      <button class="nav-item nav-disabled" aria-label="Perfil" aria-disabled="true">
        <img src="assets/redesign/icon-profile.svg" alt="" class="nav-icon">
        <span class="nav-label nav-label-muted">Perfil</span>
      </button>
```

Replace with:

```html
      <button class="nav-item nav-disabled" aria-label="Análisis (próximamente)" aria-disabled="true" tabindex="-1">
        <img src="assets/redesign/icon-analysis.svg" alt="" class="nav-icon">
        <span class="nav-label nav-label-muted">Análisis</span>
      </button>
      <button class="nav-item nav-disabled" aria-label="Perfil (próximamente)" aria-disabled="true" tabindex="-1">
        <img src="assets/redesign/icon-profile.svg" alt="" class="nav-icon">
        <span class="nav-label nav-label-muted">Perfil</span>
      </button>
```

- [ ] **Step 9: Bump cache-bust**

In `index.html`, `home.css?v=9` → `home.css?v=10`.
In `scan.html`, `styles.css?v=42` → `styles.css?v=43`, and `app.js?v=61` is untouched by this task (no `app.js` edits here).

- [ ] **Step 10: Manual verification**

Open `index.html` and `scan.html` in a browser (or via a local static server).

1. Tab through the home page: confirm a visible focus ring appears on the scan CTA, recent-product cards, and nav items (not on mouse click, only on Tab).
2. Tab to a recent-product card, press Enter: confirm it navigates to `scan.html?barcode=...` exactly like a click.
3. Tab to the disabled Análisis/Perfil buttons: confirm Tab **skips** them entirely (not focusable).
4. Inspect `--ink-3` colored text (e.g. `.brand-text`, `.barcode-text`) with browser DevTools contrast checker: confirm ≥4.5:1 against its background.
5. During an active scan, confirm `#scan-coaching` text changes are announced by a screen reader (VoiceOver/NVDA) without needing focus to move.

- [ ] **Step 11: Run full test suite**

Run: `npx vitest run`
Expected: PASS — no existing tests touch these files' behavior in a way that should break.

- [ ] **Step 12: Commit**

```bash
git add styles.css home.css home.js scan.html index.html
git commit -m "fix: focus-visible outlines, AA text contrast, keyboard nav cards, live regions, non-focusable disabled tabs"
```

---

### Task 2: Modal dialog semantics + focus trap

**Files:**
- Modify: `scan.html` (add `id` to modal headings, `role="dialog"` + `aria-modal` + `aria-labelledby` to each `.modal-content`)
- Modify: `app.js` (new `trapFocus`/`releaseFocus` helper, wired into the 4 existing show/hide function pairs)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `openModalA11y(modalEl)` / `closeModalA11y(modalEl)` helper functions in `app.js`, called from each modal's existing `show*`/`hide*` functions. No other task depends on these names.

- [ ] **Step 1: Add heading IDs and dialog ARIA attributes in `scan.html`**

Find (`#disclaimer-modal`):

```html
  <div id="disclaimer-modal" class="modal hidden">
    <div class="modal-overlay"></div>
    <div class="modal-content disclaimer-modal-content">
      <div class="modal-header">
        <h2>👋 Antes de empezar</h2>
      </div>
```

Replace with:

```html
  <div id="disclaimer-modal" class="modal hidden">
    <div class="modal-overlay"></div>
    <div class="modal-content disclaimer-modal-content" role="dialog" aria-modal="true" aria-labelledby="disclaimer-modal-title">
      <div class="modal-header">
        <h2 id="disclaimer-modal-title">👋 Antes de empezar</h2>
      </div>
```

Find (`#report-modal`):

```html
  <div id="report-modal" class="modal hidden">
    <div class="modal-overlay" id="report-modal-overlay"></div>
    <div class="modal-content">
      <button id="report-modal-close" class="modal-close">✕</button>

      <div id="report-step-1" class="ocr-step">
        <h3>🚩 Reportar un error</h3>
```

Replace with:

```html
  <div id="report-modal" class="modal hidden">
    <div class="modal-overlay" id="report-modal-overlay"></div>
    <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="report-modal-title">
      <button id="report-modal-close" class="modal-close">✕</button>

      <div id="report-step-1" class="ocr-step">
        <h3 id="report-modal-title">🚩 Reportar un error</h3>
```

Find (`#ocr-modal`):

```html
  <div id="ocr-modal" class="modal hidden">
    <div class="modal-overlay"></div>
    <div class="modal-content glass-card">
      <div class="modal-header">
        <h2>📸 Capturar Ingredientes</h2>
        <button id="ocr-modal-close" class="modal-close">✕</button>
      </div>
```

Replace with:

```html
  <div id="ocr-modal" class="modal hidden">
    <div class="modal-overlay"></div>
    <div class="modal-content glass-card" role="dialog" aria-modal="true" aria-labelledby="ocr-modal-title">
      <div class="modal-header">
        <h2 id="ocr-modal-title">📸 Capturar Ingredientes</h2>
        <button id="ocr-modal-close" class="modal-close">✕</button>
      </div>
```

Find (`#nutrition-modal`):

```html
  <div id="nutrition-modal" class="modal hidden">
    <div class="modal-overlay" id="nutrition-modal-overlay"></div>
    <div class="modal-content">
      <button id="nutrition-modal-close" class="modal-close">✕</button>

      <div id="nutrition-step-1" class="ocr-step">
        <h3>📊 Capturar Información Nutricional</h3>
```

Replace with:

```html
  <div id="nutrition-modal" class="modal hidden">
    <div class="modal-overlay" id="nutrition-modal-overlay"></div>
    <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="nutrition-modal-title">
      <button id="nutrition-modal-close" class="modal-close">✕</button>

      <div id="nutrition-step-1" class="ocr-step">
        <h3 id="nutrition-modal-title">📊 Capturar Información Nutricional</h3>
```

- [ ] **Step 2: Add a shared focus-trap helper in `app.js`**

Add near the top-level helper functions (e.g. right before the `// === OCR INGREDIENT CAPTURE ===` section comment, `app.js:2310`):

```js
// === MODAL FOCUS MANAGEMENT (shared by disclaimer/ocr/nutrition/report modals) ===
let _lastFocusedBeforeModal = null;

function openModalA11y(modalEl) {
  if (!modalEl) return;
  _lastFocusedBeforeModal = document.activeElement;
  const heading = modalEl.querySelector('h2, h3');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }
  modalEl.addEventListener('keydown', trapTabKey);
}

function closeModalA11y(modalEl) {
  if (!modalEl) return;
  modalEl.removeEventListener('keydown', trapTabKey);
  if (_lastFocusedBeforeModal && typeof _lastFocusedBeforeModal.focus === 'function') {
    _lastFocusedBeforeModal.focus();
  }
  _lastFocusedBeforeModal = null;
}

function trapTabKey(e) {
  if (e.key !== 'Tab') return;
  const modalEl = e.currentTarget;
  const focusable = modalEl.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
```

- [ ] **Step 3: Wire `openModalA11y`/`closeModalA11y` into the disclaimer modal**

Find (`app.js:191-201`):

```js
document.addEventListener("DOMContentLoaded", () => {
  // Disclaimer gate — show on first visit, persist acceptance in localStorage
  const DISCLAIMER_KEY = 'yomi_disclaimer_accepted';
  const dm = document.getElementById('disclaimer-modal');
  if (dm && !localStorage.getItem(DISCLAIMER_KEY)) {
    dm.classList.remove('hidden');
    document.getElementById('disclaimer-accept').onclick = () => {
      localStorage.setItem(DISCLAIMER_KEY, '1');
      dm.classList.add('hidden');
    };
  }
```

Replace with:

```js
document.addEventListener("DOMContentLoaded", () => {
  // Disclaimer gate — show on first visit, persist acceptance in localStorage
  const DISCLAIMER_KEY = 'yomi_disclaimer_accepted';
  const dm = document.getElementById('disclaimer-modal');
  if (dm && !localStorage.getItem(DISCLAIMER_KEY)) {
    dm.classList.remove('hidden');
    openModalA11y(dm);
    document.getElementById('disclaimer-accept').onclick = () => {
      localStorage.setItem(DISCLAIMER_KEY, '1');
      dm.classList.add('hidden');
      closeModalA11y(dm);
    };
  }
```

- [ ] **Step 4: Wire into the OCR modal**

Find (`app.js:2312-2332`):

```js
function showOcrModal(barcode) {
  if (barcode) currentBarcode = barcode;
  const modal = document.getElementById("ocr-modal");
  if (modal) {
    modal.classList.remove("hidden");
    document.getElementById("ocr-step-1").classList.remove("hidden");
    document.getElementById("ocr-step-2").classList.add("hidden");
    document.getElementById("ocr-step-3").classList.add("hidden");
    document.getElementById("ocr-step-4").classList.add("hidden");
  }
}

function hideOcrModal() {
  const modal = document.getElementById("ocr-modal");
  if (modal) {
    const step4 = document.getElementById("ocr-step-4");
    const savedSuccessfully = step4 && !step4.classList.contains("hidden");
    modal.classList.add("hidden");
    if (savedSuccessfully && currentBarcode) analyzeBarcode(currentBarcode);
  }
}
```

Replace with:

```js
function showOcrModal(barcode) {
  if (barcode) currentBarcode = barcode;
  const modal = document.getElementById("ocr-modal");
  if (modal) {
    modal.classList.remove("hidden");
    document.getElementById("ocr-step-1").classList.remove("hidden");
    document.getElementById("ocr-step-2").classList.add("hidden");
    document.getElementById("ocr-step-3").classList.add("hidden");
    document.getElementById("ocr-step-4").classList.add("hidden");
    openModalA11y(modal);
  }
}

function hideOcrModal() {
  const modal = document.getElementById("ocr-modal");
  if (modal) {
    const step4 = document.getElementById("ocr-step-4");
    const savedSuccessfully = step4 && !step4.classList.contains("hidden");
    modal.classList.add("hidden");
    closeModalA11y(modal);
    if (savedSuccessfully && currentBarcode) analyzeBarcode(currentBarcode);
  }
}
```

- [ ] **Step 5: Wire into the nutrition modal**

Find (`app.js:2446-2466`):

```js
function showNutritionModal(barcode) {
  if (barcode) currentBarcode = barcode;
  const modal = document.getElementById("nutrition-modal");
  if (modal) {
    modal.classList.remove("hidden");
    document.getElementById("nutrition-step-1").classList.remove("hidden");
    document.getElementById("nutrition-step-2").classList.add("hidden");
    document.getElementById("nutrition-step-3").classList.add("hidden");
    document.getElementById("nutrition-step-4").classList.add("hidden");
  }
}

function hideNutritionModal() {
  const modal = document.getElementById("nutrition-modal");
  if (modal) {
    const step4 = document.getElementById("nutrition-step-4");
    const savedSuccessfully = step4 && !step4.classList.contains("hidden");
    modal.classList.add("hidden");
    if (savedSuccessfully && currentBarcode) analyzeBarcode(currentBarcode);
  }
}
```

Replace with:

```js
function showNutritionModal(barcode) {
  if (barcode) currentBarcode = barcode;
  const modal = document.getElementById("nutrition-modal");
  if (modal) {
    modal.classList.remove("hidden");
    document.getElementById("nutrition-step-1").classList.remove("hidden");
    document.getElementById("nutrition-step-2").classList.add("hidden");
    document.getElementById("nutrition-step-3").classList.add("hidden");
    document.getElementById("nutrition-step-4").classList.add("hidden");
    openModalA11y(modal);
  }
}

function hideNutritionModal() {
  const modal = document.getElementById("nutrition-modal");
  if (modal) {
    const step4 = document.getElementById("nutrition-step-4");
    const savedSuccessfully = step4 && !step4.classList.contains("hidden");
    modal.classList.add("hidden");
    closeModalA11y(modal);
    if (savedSuccessfully && currentBarcode) analyzeBarcode(currentBarcode);
  }
}
```

- [ ] **Step 6: Wire into the report modal**

Find (`app.js:2586-2610`):

```js
function showReportModal() {
  const modal = document.getElementById("report-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  document.getElementById("report-step-1").classList.remove("hidden");
  document.getElementById("report-step-2").classList.add("hidden");
  document.getElementById("report-step-3").classList.add("hidden");
  // Reset form
  document.querySelectorAll('input[name="report-cat"]').forEach(r => r.checked = false);
  const comment = document.getElementById("report-comment");
  if (comment) comment.value = "";
  const err = document.getElementById("report-error");
  if (err) err.textContent = "";
  const preview = document.getElementById("report-photo-preview");
  if (preview) { preview.src = ""; preview.style.display = "none"; }
  const nameEl = document.getElementById("report-photo-name");
  if (nameEl) nameEl.textContent = "";
  const photoInput = document.getElementById("report-photo-input");
  if (photoInput) photoInput.value = "";
}

function hideReportModal() {
  const modal = document.getElementById("report-modal");
  if (modal) modal.classList.add("hidden");
}
```

Replace with:

```js
function showReportModal() {
  const modal = document.getElementById("report-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  document.getElementById("report-step-1").classList.remove("hidden");
  document.getElementById("report-step-2").classList.add("hidden");
  document.getElementById("report-step-3").classList.add("hidden");
  // Reset form
  document.querySelectorAll('input[name="report-cat"]').forEach(r => r.checked = false);
  const comment = document.getElementById("report-comment");
  if (comment) comment.value = "";
  const err = document.getElementById("report-error");
  if (err) err.textContent = "";
  const preview = document.getElementById("report-photo-preview");
  if (preview) { preview.src = ""; preview.style.display = "none"; }
  const nameEl = document.getElementById("report-photo-name");
  if (nameEl) nameEl.textContent = "";
  const photoInput = document.getElementById("report-photo-input");
  if (photoInput) photoInput.value = "";
  openModalA11y(modal);
}

function hideReportModal() {
  const modal = document.getElementById("report-modal");
  if (modal) {
    modal.classList.add("hidden");
    closeModalA11y(modal);
  }
}
```

- [ ] **Step 7: Bump cache-bust**

In `scan.html`, `app.js?v=61` → `app.js?v=62`.

- [ ] **Step 8: Verify syntax**

Run: `node --check app.js`
Expected: no output, exit code 0

- [ ] **Step 9: Manual verification**

1. Trigger each of the 4 modals (disclaimer on first visit with localStorage cleared, OCR/nutrition capture buttons, report-error button). Confirm focus moves to the modal's heading on open.
2. Press Tab repeatedly inside an open modal: confirm focus cycles only among the modal's own controls (does not escape to the page behind it). Press Shift+Tab from the first control: confirm it wraps to the last.
3. Close each modal (close button, overlay click, and Escape where already supported on `report-modal`/`nutrition-modal`): confirm focus returns to whatever element had focus before the modal opened.
4. Confirm none of the 4 modals' existing open/close/reset behavior changed (report form still resets on open, OCR/nutrition still trigger `analyzeBarcode` on successful save-and-close).

- [ ] **Step 10: Run full test suite**

Run: `npx vitest run`
Expected: PASS — no existing tests should be affected by this additive change.

- [ ] **Step 11: Commit**

```bash
git add scan.html app.js
git commit -m "feat: add dialog semantics and focus trap to disclaimer/ocr/nutrition/report modals"
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

Repeat Task 1 Step 10 and Task 2 Step 9's manual checks against `https://www.yomi.mx/` and `https://www.yomi.mx/scan.html`.
