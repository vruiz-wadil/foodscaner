# Commercial Series Cleanup (deferred minors, phases 1-4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the deferred/parked minor findings from the 4-phase commercial-improvement series's code reviews — accessibility gaps, a stale-state bug, test hygiene, and a copy grammar issue.

**Architecture:** Small, independent fixes across `onboarding-membership.html`, `app.js`, `styles.css`, `onboarding-membership-ui.js`, `account-ui.js`, `home.css`, and `tests/app.test.js`. No new features, no backend changes — pure polish/bugfix.

**Tech Stack:** Vanilla JS/HTML/CSS, vitest.

## Global Constraints

- No behavior change beyond what's described per task — these are targeted fixes, not refactors.
- Every fix must keep the existing test suite green plus add coverage for the specific bug/gap fixed where practical.

---

### Task 1: Accessibility — membership comparison table (phase 1 minor)

**Files:**
- Modify: `onboarding-membership.html` (the `.membership-compare` table, and its `<th>`/`<td>` cells)

**Interfaces:** None — pure markup/attribute change, no JS/CSS interface.

- [ ] **Step 1: Read the current table markup**

Read `onboarding-membership.html` in full, locate the `<table class="membership-compare">` block.

- [ ] **Step 2: Add accessible labels**

Add `scope="col"` to the two column `<th>` cells ("Gratis", "Premium") and the corner `<th>`. For empty `<td>` cells (rows where a feature isn't included in the free tier), add `aria-label="No incluido"`. For `<td>` cells containing `✓`, add `aria-label="Incluido"` and wrap the checkmark so it isn't read as a literal "check mark" glyph twice (use `<span aria-hidden="true">✓</span>` pattern, consistent with how `reasonStateGlyph` is marked `aria-hidden="true"` in `app.js`).

- [ ] **Step 3: Manual verification**

If a browser is available, inspect the table's accessibility tree (devtools) to confirm cells announce "Incluido"/"No incluido" instead of silence or a bare glyph. If unavailable, note as a concern.

- [ ] **Step 4: Commit**

```bash
git add onboarding-membership.html
git commit -m "fix(a11y): etiquetas accesibles en tabla comparativa de membresia"
```

---

### Task 2: Accessibility + stale-state fix — teaser card (phase 2 minors)

**Files:**
- Modify: `app.js` (`renderPersonalizedReasons`, `renderTeaserReasons`)
- Modify: `styles.css` (`.reason-card--teaser` rules)
- Test: `tests/app.test.js` (extend `renderPersonalizedReasons` describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports — same function signatures.

- [ ] **Step 1: Read current code**

Read `app.js`'s `renderPersonalizedReasons` and `renderTeaserReasons` functions, and the `.reason-card--teaser`/`.btn-teaser-cta` CSS rules in `styles.css`.

- [ ] **Step 2: Fix stale teaser state on hide paths**

In `renderPersonalizedReasons`, both early-return "hide" branches (the `!userPreferences && hasNoRealData(product)` branch, and the premium `!reasons.length` branch) currently do `card.classList.add('hidden'); return;` without clearing `reason-card--teaser` or removing a stale `.btn-teaser-cta`. Add the same cleanup used elsewhere in the function before each of these returns:

```js
card.classList.remove('reason-card--teaser');
const existingCta = card.querySelector('.btn-teaser-cta');
if (existingCta) existingCta.remove();
card.classList.add('hidden');
return;
```

- [ ] **Step 3: Screen-reader affordance for blurred teaser rows**

In `renderTeaserReasons`, mark each teaser row's text as decorative to assistive tech (since it's not real data, no point reading it) and add one visually-hidden label communicating the locked state. Update the teaser row template:

```js
list.innerHTML = teaserRows.map(r => `
  <li class="reason-row reason-row--teaser">
    <span class="reason-icon" aria-hidden="true">${escReasons(r.icon)}</span>
    <span class="reason-text" aria-hidden="true"><strong>${escReasons(r.title)}</strong><span>${escReasons(r.detail)}</span></span>
  </li>
`).join('');
```

And add one visually-hidden paragraph right after the summary element is set (in the same function, after the `summaryEl.textContent = ...` line):

```js
const listEl = document.getElementById('verdict-reasons-list');
if (listEl && !listEl.previousElementSibling?.classList.contains('sr-only')) {
  const srLabel = document.createElement('p');
  srLabel.className = 'sr-only';
  srLabel.textContent = 'Vista previa bloqueada — suscríbete para ver tu análisis real.';
  listEl.parentNode.insertBefore(srLabel, listEl);
}
```

If a `.sr-only` utility class doesn't already exist in `styles.css`, add the standard visually-hidden pattern:

```css
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
```

(Search `styles.css` for `.sr-only` first — if it exists, reuse it, don't duplicate.)

- [ ] **Step 4: Add regression tests**

In `tests/app.test.js`, add cases: (a) after showing the teaser then calling `renderPersonalizedReasons` again with a premium profile and empty reasons, the card no longer has `reason-card--teaser` and has no `.btn-teaser-cta` present; (b) teaser rows and their text spans carry `aria-hidden="true"`.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add app.js styles.css tests/app.test.js
git commit -m "fix(scan): limpia estado stale del teaser y agrega affordance de a11y"
```

---

### Task 3: Test hygiene — window.authClient cleanup (phase 2 parked minor)

**Files:**
- Modify: `tests/app.test.js` (the `renderPersonalizedReasons` describe block)

**Interfaces:** None.

- [ ] **Step 1: Read the describe block**

Read the `describe('renderPersonalizedReasons', ...)` block in `tests/app.test.js` in full, including its existing `beforeEach`.

- [ ] **Step 2: Add afterEach cleanup**

Add an `afterEach` in that same describe block (mirroring the pattern already used in other describe blocks in the same file, e.g. `getUserPreferencesForVerdict`'s):

```js
afterEach(() => {
  delete window.authClient
})
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all pass, no order-dependent failures introduced or revealed.

- [ ] **Step 4: Commit**

```bash
git add tests/app.test.js
git commit -m "test(app): limpia window.authClient entre tests de renderPersonalizedReasons"
```

---

### Task 4: Dietary copy grammar fix (phase 3 minor)

**Files:**
- Modify: `onboarding-membership-ui.js` (`DIETARY_LABELS` map and the dietary headline template)
- Test: `tests/onboarding-membership-ui.test.js`

**Interfaces:** None — internal copy change only.

- [ ] **Step 1: Read current code**

Read `onboarding-membership-ui.js`'s `DIETARY_LABELS` map and the dietary branch of `pickHeadline()`.

- [ ] **Step 2: Fix the grammar for non-adjectival diets**

The template `` `Come ${dietaryLabel(dietary)} sin leer etiquetas` `` reads badly for labels like "sin gluten", "sin OGM", "comercio justo" ("Come sin gluten sin leer etiquetas"). Replace the single template with a per-key phrase map so each diet gets grammatically correct copy:

```js
const DIETARY_HEADLINE_PHRASE = {
  vegan: 'Come vegano sin leer etiquetas',
  vegetarian: 'Come vegetariano sin leer etiquetas',
  keto: 'Come keto sin leer etiquetas',
  glutenFree: 'Evita el gluten sin leer etiquetas',
  caseinFree: 'Evita la caseína sin leer etiquetas',
  organic: 'Encuentra lo orgánico sin leer etiquetas',
  kosher: 'Come kosher sin leer etiquetas',
  halal: 'Come halal sin leer etiquetas',
  nonGmo: 'Evita los OGM sin leer etiquetas',
  noAdditives: 'Evita los aditivos sin leer etiquetas',
  palmOilFree: 'Evita el aceite de palma sin leer etiquetas',
  fairTrade: 'Prioriza el comercio justo sin leer etiquetas'
};
```

Update the dietary branch of `pickHeadline()` to use this map instead of the generic template:

```js
const dietary = (payload.dietary || [])[0];
if (dietary) {
  return {
    title: DIETARY_HEADLINE_PHRASE[dietary] || `Come ${dietaryLabel(dietary)} sin leer etiquetas`,
    sub: 'Premium filtra automáticamente lo que no encaja con tu dieta.'
  };
}
```

The `|| dietaryLabel(dietary)` fallback keeps behavior safe for any future dietary key not yet added to the phrase map.

- [ ] **Step 3: Update/add tests**

In `tests/onboarding-membership-ui.test.js`, update the existing dietary test (currently asserting `'Come vegano sin leer etiquetas'`, which still holds) and add one case for a non-adjectival key, e.g. `glutenFree` → `'Evita el gluten sin leer etiquetas'`.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add onboarding-membership-ui.js tests/onboarding-membership-ui.test.js
git commit -m "fix(onboarding): corrige gramatica del CTA personalizado para dietas no adjetivas"
```

---

### Task 5: Invite-friend card layout fix (phase 4 minor)

**Files:**
- Modify: `account-ui.js` (the "Invita a un amigo" card's inner markup)

**Interfaces:** None — markup-only change, no new classes needed beyond what phase 4 already added.

- [ ] **Step 1: Read current markup**

Read the "Invita a un amigo" card block in `account-ui.js`'s `renderAccountHub()` template, and the sibling "Suscripción" renew-card block (`renderCta`/renew markup) that already wraps its `<p>`+`<button>` in a `<div>` to avoid the same flex-row misalignment.

- [ ] **Step 2: Wrap the text+button in a div, matching the renew-card pattern**

Change:

```html
<div class="row-card">
  <p class="about-text">¿Conoces a alguien a quien le sirva saber qué come? Compártele Yomi.</p>
  <button type="button" id="btn-invite-friend" class="btn btn-secondary">Compartir Yomi</button>
</div>
```

to:

```html
<div class="row-card">
  <div>
    <p class="about-text">¿Conoces a alguien a quien le sirva saber qué come? Compártele Yomi.</p>
    <button type="button" id="btn-invite-friend" class="btn btn-secondary">Compartir Yomi</button>
  </div>
</div>
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all pass — the existing `tests/account-ui.test.js` assertions target `#btn-invite-friend` by id, unaffected by the wrapping `<div>`.

- [ ] **Step 4: Commit**

```bash
git add account-ui.js
git commit -m "fix(account): corrige alineacion vertical de la card invita a un amigo"
```

---

## Self-Review Notes

- Coverage: all 5 actionable deferred minors from phases 1-4 reviews addressed (a11y table, teaser stale-state + a11y, test hygiene, dietary grammar, invite-card layout). Skipped as genuinely non-actionable per prior review rulings: hardcoded price duplication (documented tradeoff), duplicated label maps (documented tradeoff), `shareApp`/`shareResult` control-flow duplication (plan-mandated, structurally justified), unguarded `window.shareApp` call (consistent with existing codebase pattern), CTA click instrumentation (out of scope, needs its own analytics spec).
- No placeholders — full code given verbatim per task.
- Each task is independently testable and independently committable.
