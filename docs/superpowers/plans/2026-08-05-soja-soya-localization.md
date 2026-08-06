# Localización "Soja" → "Soya" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show "Soya" (Mexican Spanish terminology) instead of "Soja" everywhere in the UI — static labels, AI-generated analysis text, and displayed ingredient text — without touching internal allergen codes, stored preferences, or detection logic.

**Architecture:** Task 1 fixes 5 static text labels across the frontend. Tasks 2-3 add a small `normalizeSoyTerm(text)` helper (one copy in `app.js` for the frontend, one copy in `api/index.js` for the backend — these runtimes don't share modules today, same pattern as the existing duplicated `ALLERGEN_LABELS` map in `onboarding-membership-ui.js`) and wire it into the two places that render free-form/source text: ingredient text display (frontend) and AI-generated `notRecommended` reasons (backend, plus a prompt instruction).

**Tech Stack:** Vanilla JS, Vitest.

## Global Constraints

- Internal allergen code (`soja` as a key in `ALLOWED_ALLERGEN_CODES`, `ALLERGEN_CODES`, Firestore-stored preferences, `data-allergen="soja"`, `match: [...]` detection arrays) does NOT change — only display text changes. Renaming the code would break existing users' saved preferences.
- `normalizeSoyTerm(text)` behavior, exact: case-preserving whole-word replace of "soja" → "soya" using `\bsoja\b` with the `gi` flags. `'SOJA'` → `'SOYA'`, `'Soja'` → `'Soya'`, any other case (including all-lowercase `'soja'`) → `'soya'`. Non-string/falsy input returns the input unchanged.
- The two copies of `normalizeSoyTerm` (frontend in `app.js`, backend in `api/index.js`) must have identical behavior — same regex, same case-handling branches.

---

### Task 1: Static allergen labels "Soja" → "Soya"

**Files:**
- Modify: `app.js:88` (`COMMON_ALLERGENS` array)
- Modify: `app.js:1286` (`allergensMap` inside `parseApiProduct`)
- Modify: `preference-labels.js:27-37` (`ALLERGEN_LABELS`)
- Modify: `preferences.html:150-151` (soja button markup)
- Modify: `onboarding-membership-ui.js` (`ALLERGEN_LABELS` map — search for `soja:` in that file, it's a different, smaller map than `preference-labels.js`'s)
- Test: `tests/app.test.js`, `tests/preference-labels.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports — only changes the string values these existing maps/arrays return. Later tasks don't depend on this task's changes.

- [ ] **Step 1: Read the 5 target locations**

Read `app.js:80-89` (`COMMON_ALLERGENS`), `app.js:1280-1300` (`allergensMap`), `preference-labels.js:1-40`, `preferences.html:145-155`, and search `onboarding-membership-ui.js` for `ALLERGEN_LABELS` — confirm exact current text before editing (line numbers may have shifted since this plan was written).

- [ ] **Step 2: Write the failing tests**

In `tests/app.test.js`, find the `describe` block that already tests `parseApiProduct` (search for `'parseApiProduct'`) and add:

```js
  it('translates en:soybeans allergen tag to "Soya" (not "Soja")', () => {
    const product = parseApiProduct({
      product_name: 'Test Product',
      allergens_tags: ['en:soybeans']
    })
    expect(product.allergens).toContain('Soya')
    expect(product.allergens).not.toContain('Soja')
  })
```

In the same file, find the `describe('computeVerdictReasons', ...)` block (or `describe('computeVerdict', ...)`, whichever already exercises allergen reasons — search for an existing test using `allergens:` in a `userPreferences` fixture) and add:

```js
  it('labels the soja allergen as "Soya" in the reason title', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Soya'] }
    const prefs = { allergens: [{ code: 'soja', severity: 'mild' }], dietary: [], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    const soyaReason = reasons.find(r => r.type === 'allergen' && r.title.includes('Soya'))
    expect(soyaReason).toBeTruthy()
    expect(soyaReason.title).not.toContain('Soja')
  })
```

In `tests/preference-labels.test.js`, find the existing tests for `ALLERGEN_LABELS` (search for `ALLERGEN_LABELS`) and add:

```js
  it('labels soja as "Soya"', () => {
    expect(ALLERGEN_LABELS.soja.label).toBe('Soya')
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/app.test.js tests/preference-labels.test.js`
Expected: FAIL — all 3 new tests fail because the labels still say "Soja".

- [ ] **Step 4: Change the 5 labels**

In `app.js`, change line 88's `COMMON_ALLERGENS` entry:

```js
  { emoji: "🫘", label: "Soya", match: ["soja", "soya", "soy", "soybean"] }
```

(only the `label` value changes, from `"Soja"` to `"Soya"` — the `match` array stays exactly as-is, it already recognizes both spellings for detection purposes).

In `app.js`, change the `allergensMap` entry (currently `"en:soybeans": "Soja"`):

```js
    "en:soybeans": "Soya",
```

In `preference-labels.js`, in `ALLERGEN_LABELS`, change the `soja` entry's `label` from `'Soja'` to `'Soya'` (the object key `soja` stays the same).

In `preferences.html`, change the soja button's visible text and aria-label:

```html
              <button type="button" class="allergen-grid-item" id="allergen-soja" data-allergen="soja" aria-pressed="false"><span class="emoji">🫘</span><span class="label">Soya</span></button>
              <div class="severity-toggle hidden" id="severity-soja" role="radiogroup" aria-label="Severidad para Soya">
```

(only the visible text "Soja"→"Soya" changes — `id="allergen-soja"`, `data-allergen="soja"`, `id="severity-soja"` all stay unchanged, they're internal identifiers).

In `onboarding-membership-ui.js`, in its `ALLERGEN_LABELS` map, change the `soja` entry's value from `'soja'` to `'soya'` (lowercase, matching that file's existing lowercase convention for the other entries — this map is used inline in sentences like `` `Cuidado con ${allergenLabel(code)}, sin adivinar` ``).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/app.test.js tests/preference-labels.test.js`
Expected: PASS, all 3 new tests plus all pre-existing tests in both files.

- [ ] **Step 6: Manual verification**

If a browser/dev server is available: open `preferences.html`, confirm the allergen grid button reads "Soya"; scan a product with soy content, confirm the diagnostic card and any "Contiene: X" chip read "Soya". If unavailable, note as a concern in the report.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all pre-existing tests pass, no regressions. Note: this repo may have a sibling `.claude/worktrees/` or `.worktrees/` directory from other sessions that causes one unrelated, pre-existing Playwright test-collection failure when vitest globs broadly — ignore that specific failure if present.

- [ ] **Step 8: Commit**

```bash
git add app.js preference-labels.js preferences.html onboarding-membership-ui.js tests/app.test.js tests/preference-labels.test.js
git commit -m "feat(i18n): usa 'Soya' en vez de 'Soja' en labels estaticos de alergeno"
```

---

### Task 2: `normalizeSoyTerm` in `app.js` + apply to ingredient text display

**Files:**
- Modify: `app.js` (add `normalizeSoyTerm` function near `COMMON_ALLERGENS`/`allergenLabel`; modify the ingredients-text render call around line 2142)
- Test: `tests/app.test.js`

**Interfaces:**
- Produces: `normalizeSoyTerm(text: string|null|undefined): string|null|undefined` — new function, added to `app.test.js`'s export list for direct testing. Not consumed by any other task (Task 3's backend copy is independent).

- [ ] **Step 1: Read the current ingredients-text render site**

Read `app.js` around the `ingredients-section`/`ingredients-text` DOM handling (search for `ingredientsTextEl.textContent`) to confirm the exact current line and surrounding code before editing.

- [ ] **Step 2: Write the failing tests**

In `tests/app.test.js`, add `normalizeSoyTerm` to the destructured export list in the `beforeAll` block (both the `let` declaration line and the `return { ... }` object in the `new Function(...)` call, and the `exports.normalizeSoyTerm = exports.normalizeSoyTerm` assignment line — follow the exact pattern already used for `isGlutenRelated` in that same block).

Add a new `describe` block:

```js
describe('normalizeSoyTerm', () => {
  it('replaces lowercase "soja" with "soya"', () => {
    expect(normalizeSoyTerm('contiene soja y trigo')).toBe('contiene soya y trigo')
  })

  it('preserves capitalized "Soja" as "Soya"', () => {
    expect(normalizeSoyTerm('Soja: puede contener')).toBe('Soya: puede contener')
  })

  it('preserves all-caps "SOJA" as "SOYA"', () => {
    expect(normalizeSoyTerm('ALERGENOS: SOJA, TRIGO')).toBe('ALERGENOS: SOYA, TRIGO')
  })

  it('does not touch words that merely contain "soja" as a substring', () => {
    expect(normalizeSoyTerm('sojamiel')).toBe('sojamiel')
  })

  it('returns falsy input unchanged', () => {
    expect(normalizeSoyTerm(null)).toBe(null)
    expect(normalizeSoyTerm(undefined)).toBe(undefined)
    expect(normalizeSoyTerm('')).toBe('')
  })

  it('leaves text with no "soja" mention unchanged', () => {
    expect(normalizeSoyTerm('harina de trigo, azúcar')).toBe('harina de trigo, azúcar')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/app.test.js -t "normalizeSoyTerm"`
Expected: FAIL — `normalizeSoyTerm` is not defined yet.

- [ ] **Step 4: Add `normalizeSoyTerm` to `app.js`**

Add this function near `COMMON_ALLERGENS` (top of the allergen-related section of `app.js`):

```js
// Localización de terminología: "soja" es el término usado en España, pero
// en México (audiencia de la app) el término común es "soya" — mismo
// ingrediente, sinónimo regional. No toca el código interno del alérgeno
// (sigue siendo 'soja' como key/id en todo el codebase) ni los arrays de
// detección (que ya reconocen ambos términos como sinónimos).
function normalizeSoyTerm(text) {
  if (!text) return text;
  return text.replace(/\bsoja\b/gi, (match) => {
    if (match === 'SOJA') return 'SOYA';
    if (match === 'Soja') return 'Soya';
    return 'soya';
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/app.test.js -t "normalizeSoyTerm"`
Expected: PASS, all 6 cases.

- [ ] **Step 6: Apply `normalizeSoyTerm` to the ingredients-text render site**

Change the line found in Step 1 (currently `ingredientsTextEl.textContent = product.ingredientsText;`) to:

```js
      ingredientsTextEl.textContent = normalizeSoyTerm(product.ingredientsText);
```

- [ ] **Step 7: Add a test for the render-site integration**

Search `tests/app.test.js` for any existing test that exercises this ingredients-text render path (it may live inside a larger `renderProductData`-adjacent test, or there may be none — if `renderProductData` has no unit test coverage at all in this file, per this codebase's established pattern from prior analytics-instrumentation work, note this as `⚠️ Cannot verify from a unit test: no existing test infrastructure for this render path` in the report rather than inventing a new DOM-fixture test framework for it). If a suitable existing test/fixture is found, extend it to assert ingredient text containing "soja" renders as "soya".

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: all tests pass, no regressions (same pre-existing Playwright-in-worktree caveat as Task 1).

- [ ] **Step 9: Commit**

```bash
git add app.js tests/app.test.js
git commit -m "feat(i18n): normaliza 'soja' a 'soya' en el texto de ingredientes mostrado"
```

---

### Task 3: `normalizeSoyTerm` in `api/index.js` + AI prompt instruction + apply to `notRecommended`

**Files:**
- Modify: `api/index.js` (add `normalizeSoyTerm` function; add one line to the AI prompt's REGLAS section; apply normalization after `notRecommended` is filtered)
- Test: search for the existing test file covering this AI-analysis endpoint (grep for the prompt's distinctive text or the endpoint route to find it — likely a file named something like `tests/aiAnalysis*.test.js` or similar; if none exists, note as `⚠️ Cannot verify` rather than inventing new test infrastructure for the whole endpoint)

**Interfaces:**
- Produces: `normalizeSoyTerm(text)` — same behavior as Task 2's frontend copy, but a separate, independent implementation in `api/index.js` (backend and frontend don't share modules in this codebase today). Not consumed by Task 2 or vice versa — these are two independent copies by design, per the spec.

- [ ] **Step 1: Read the current AI-analysis handler**

Read `api/index.js` around the AI-analysis prompt (search for `"notRecommended":[{"grupo"` to find the prompt template, and for `parsed.notRecommended = parsed.notRecommended.filter` to find where the response is post-processed) to confirm exact current line numbers before editing.

- [ ] **Step 2: Search for existing test coverage of this handler**

Run: `grep -rln "notRecommended.*grupo\|REGLAS:" --include=*.test.js tests/`

If a test file covers this handler's response processing (as opposed to just the prompt string), read it to learn its mocking pattern (likely mocks the AI provider call, e.g. `callGroq`/`callAI`) before writing new tests. If no such test file exists, skip to Step 5 and note `⚠️ Cannot verify: no existing test infrastructure for this AI-analysis handler's post-processing` in the report — do not build a new mocking framework for the whole endpoint just for this one normalization step.

- [ ] **Step 3: Write the failing test (only if Step 2 found a suitable test file)**

Add a test asserting: given an AI provider response whose parsed JSON contains `notRecommended: [{ grupo: 'Personas alérgicas a la soja', razon: 'contiene soja' }]`, the handler's response has that item's `grupo`/`razon` normalized to say "soya" instead of "soja". Follow the exact mocking pattern from the file found in Step 2.

- [ ] **Step 4: Run the test to verify it fails**

Run the file-specific vitest command matching the test file found in Step 2.
Expected: FAIL — normalization doesn't exist yet.

- [ ] **Step 5: Add `normalizeSoyTerm` to `api/index.js`**

Add this function near the top of the AI-analysis section of `api/index.js` (same behavior as Task 2's frontend version — this is an intentional independent duplicate, not meant to be imported from `app.js`, which isn't a Node module in this codebase):

```js
// Localización de terminología: ver comentario equivalente en app.js.
// Copia independiente — backend y frontend no comparten módulos hoy.
function normalizeSoyTerm(text) {
  if (!text) return text;
  return text.replace(/\bsoja\b/gi, (match) => {
    if (match === 'SOJA') return 'SOYA';
    if (match === 'Soja') return 'Soya';
    return 'soya';
  });
}
```

- [ ] **Step 6: Add the prompt instruction**

In the AI prompt's REGLAS section (search for the line starting `- DUDAS → confidence "baja"`), add a new rule line immediately before it:

```
- Terminología: usa "soya" (no "soja") en toda respuesta — términos mexicanos
```

- [ ] **Step 7: Apply normalization to the parsed response**

Find the existing post-filter code (`parsed.notRecommended = parsed.notRecommended.filter(nr => { ... })`, search for it) and add a `.map(...)` immediately after that filter call (not before it — normalization must happen on the already-filtered array, it must not change which items pass the filter):

```js
      parsed.notRecommended = parsed.notRecommended.map(nr => ({
        ...nr,
        grupo: normalizeSoyTerm(nr.grupo),
        razon: normalizeSoyTerm(nr.razon)
      }));
```

- [ ] **Step 8: Run the test to verify it passes (if Step 3 wrote one)**

Run the same file-specific command from Step 4.
Expected: PASS.

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: all tests pass, no regressions (same pre-existing Playwright-in-worktree caveat as prior tasks).

- [ ] **Step 10: Commit**

```bash
git add api/index.js
git commit -m "feat(i18n): normaliza 'soja' a 'soya' en analisis de IA (prompt + red de seguridad)"
```

(add the test file to this commit too if Step 3 created/modified one)

---

## Self-Review Notes

- Spec coverage: 5 static labels → Task 1. Shared `normalizeSoyTerm` (frontend copy) + ingredients-text display → Task 2. Shared `normalizeSoyTerm` (backend copy) + prompt instruction + `notRecommended` normalization → Task 3. Internal codes/detection arrays explicitly left untouched, called out in Global Constraints and each task's Files/Step descriptions.
- No placeholders — full code given verbatim for every function, every prompt line, every test case.
- Type/signature consistency: `normalizeSoyTerm(text)` has identical documented behavior in both Task 2 (frontend) and Task 3 (backend) — verified against the same spec-mandated case table (SOJA→SOYA, Soja→Soya, soja→soya, falsy→unchanged).
- Tasks 2 and 3 are independent of each other (no shared code, different runtimes) and can be done in either order or by different implementers in parallel if using subagent-driven-development's task loop — though the skill's process dispatches one implementer at a time regardless.
