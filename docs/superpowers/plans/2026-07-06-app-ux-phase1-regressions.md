# App UX Phase 1 — Regressions & Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a real visual regression in the home screen's "¿Qué es Yomi?" card (missing tokens), delete confirmed-dead CSS, and trim an unused font weight — all zero-risk, no JS logic changes.

**Architecture:** Three independent, small, additive/subtractive CSS changes plus a `<link>` query-string edit. No new files, no new classes beyond the token aliases.

**Tech Stack:** Plain CSS/HTML, no new dependencies.

## Global Constraints

- `home.css :root` gets **token aliases**, not renamed declarations — `.about-card`/`.about-text` keep referencing `var(--paper)`/`var(--border)`/`var(--ink-3)` exactly as they do today; only the missing `:root` entries are added.
- Every CSS deletion in Task 2 MUST be re-verified with grep against `index.html`, `scan.html`, `home.js`, `app.js` immediately before deleting — if a class turns out to be referenced, skip deleting it and note that the audit's premise was wrong for that item.
- No new automated tests — this is a CSS/markup-only fix; verification is `node --check` (N/A here, no JS touched) + manual visual check + full-suite regression (`npx vitest run`, unaffected but run to confirm no accidental breakage).
- Cache-bust bump required on any changed stylesheet reference (`home.css?v=8` → `?v=9`; `styles.css?v=42` is NOT touched in this phase since `styles.css` isn't modified here).

---

### Task 1: Restore "¿Qué es Yomi?" card + remove unused font weight

**Files:**
- Modify: `home.css` (add token aliases to `:root`)
- Modify: `index.html` (Google Fonts query, cache-bust)

**Interfaces:**
- Produces: `--paper`, `--border`, `--ink-3` custom properties now resolve in `home.css`'s scope — no other task depends on this, but Task 2 in a later phase (Phase 2 accessibility) will read `--ink-3` here, so the alias must point at a real color, not `unset`.

- [ ] **Step 1: Add token aliases to `home.css`**

Find the `:root` block:

```css
:root {
  --bg:            #eaf9f6;
  --ink:           #0d3d35;
  --ink-muted:     #7a9080;
  --accent:        #f5a623;
  --teal-soft:     #4bc5ab;
  --white:         #ffffff;
  --shadow-card:   0 1px 3px rgba(45,188,158,0.07);
  --shadow-stat:   0 1px 1px rgba(45,188,158,0.05);
  --shadow-scan:   0 4px 12px rgba(45,188,158,0.2);
  --radius:        4px;
}
```

Replace with (adds 3 lines, changes nothing else):

```css
:root {
  --bg:            #eaf9f6;
  --ink:           #0d3d35;
  --ink-muted:     #7a9080;
  --accent:        #f5a623;
  --teal-soft:     #4bc5ab;
  --white:         #ffffff;
  --shadow-card:   0 1px 3px rgba(45,188,158,0.07);
  --shadow-stat:   0 1px 1px rgba(45,188,158,0.05);
  --shadow-scan:   0 4px 12px rgba(45,188,158,0.2);
  --radius:        4px;
  --paper:         var(--white);
  --border:        rgba(45,188,158,0.2);
  --ink-3:         var(--ink-muted);
}
```

- [ ] **Step 2: Remove the unused `300` font weight and bump cache-bust in `index.html`**

Find:

```html
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="home.css?v=8">
```

Replace with:

```html
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="home.css?v=9">
```

- [ ] **Step 3: Remove the same unused `300` font weight in `scan.html`**

Find (in `scan.html`):

```html
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
```

Replace with:

```html
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```

(`styles.css` itself is not modified in this phase, so its `?v=42` stays as-is — only the font query string changes on this line.)

- [ ] **Step 4: Manual verification — card restored**

Confirm a local server is running (`node api/index.js` or equivalent static serve), open `index.html` in a browser.

1. Confirm the "¿Qué es Yomi?" card now shows a white background and a visible thin border (previously blended into the mint page background).
2. Confirm the card's body text is legible (not defaulting to browser-inherited black-on-transparent).
3. Confirm no other visual change on the home page.

- [ ] **Step 5: Commit**

```bash
git add home.css index.html scan.html
git commit -m "fix: restore missing --paper/--border/--ink-3 tokens breaking About card"
```

---

### Task 2: Delete confirmed-dead CSS

**Files:**
- Modify: `home.css` (delete 3 dead blocks, after grep re-verification)
- Modify: `styles.css` (delete 1 dead block, after grep re-verification)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing consumed by later tasks — purely subtractive.

- [ ] **Step 1: Re-verify each class is truly unreferenced**

Run each of these before touching any file — if any produces a match in a `.html`/`.js` file (not just the CSS file defining it), **do not delete that specific block**; note it as a false positive from the earlier audit instead.

```bash
grep -rn "btn-ver-todos" index.html scan.html home.js app.js
grep -rn "section-promo\|promo-card\|promo-btn" index.html scan.html home.js app.js
grep -rn "nav-scan-ring\|nav-scan-icon" index.html scan.html home.js app.js
grep -rn "product-image-container\|product-info\b" index.html scan.html home.js app.js
```

Expected: no output for any of the four (all four confirmed dead by the UX Architect audit). If one does produce a hit, skip deleting that block and continue with the rest.

- [ ] **Step 2: Delete dead blocks in `home.css`**

Delete the `.btn-ver-todos` rule, the full `.section-promo`/`.promo-card`/`.promo-btn` block, and the `.nav-scan-ring`/`.nav-scan-icon` rules (exact line ranges will have shifted slightly after Task 1's 3-line addition — locate by the selector names, not the line numbers from the audit).

- [ ] **Step 3: Delete dead block in `styles.css`**

Delete the `.product-image-container`/`.product-info` rules.

- [ ] **Step 4: Manual verification — no visual regression**

Reload `index.html` and `scan.html`. Confirm both pages look pixel-identical to before this task (the deleted rules had zero live references, so there should be no visible change at all).

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: PASS — no tests touch CSS, this confirms no accidental JS breakage from editing adjacent files.

- [ ] **Step 6: Commit**

```bash
git add home.css styles.css
git commit -m "chore: remove dead CSS confirmed unreferenced (promo card, ver-todos, nav-scan-ring, product-image-container)"
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

Repeat Task 1 Step 4 and Task 2 Step 4's manual checks against `https://www.yomi.mx/` and `https://www.yomi.mx/scan.html`.
