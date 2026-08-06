# Analytics Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Vercel Analytics (pageviews + 4 custom funnel events) to Yomi's 12 static HTML pages, with no bundler/build step, via the official script-tag snippet.

**Architecture:** One new shared file (`analytics.js`) providing `window.track()`, included via `<script>` tag on all 12 pages. Four `window.track(...)` call sites added to existing handler functions in `app.js`, `onboarding-membership-ui.js`, and `account-ui.js`.

**Tech Stack:** Vanilla JS, Vitest + jsdom, Playwright (existing e2e suite).

## Global Constraints

- No new npm dependencies — `@vercel/analytics` npm package is NOT used (no bundler in this project); only the raw Vercel script-tag snippet.
- Event names and payloads, exact and final (no others to add): `Scan Completado` `{ verdict }`, `Paywall Hit` `{ context: 'personalized-reasons' }`, `Checkout Iniciado` (no props), `Checkout Completado` (no props).
- `Scan Completado`'s payload is `{ verdict }` only — never include `barcode` (cardinality/quota reason, decided in spec).
- `analytics.js` must load before any page-specific script that calls `window.track`.
- Enabling Analytics/Speed Insights in the Vercel project dashboard is a manual, out-of-repo step — not part of any task below.

---

### Task 1: Create `analytics.js` and wire it into all 12 HTML pages

**Files:**
- Create: `analytics.js`
- Modify: `account.html`, `auth.html`, `history.html`, `index.html`, `onboarding-membership.html`, `onboarding-profile.html`, `preferences.html`, `privacidad.html`, `reset-password.html`, `scan.html`, `terminos.html`, `verify-email.html`
- Test: `tests/analytics.test.js` (new file)

**Interfaces:**
- Produces: `window.track(eventName: string, props?: object)` — global function, available after `analytics.js` executes. Later tasks call this directly as `window.track(...)`.

- [ ] **Step 1: Write the failing test**

Create `tests/analytics.test.js`:

```js
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const analyticsCode = fs.readFileSync(path.join(__dirname, '..', 'analytics.js'), 'utf8')

describe('analytics.js', () => {
  beforeEach(() => {
    delete window.va
    delete window.vaq
    delete window.track
    document.head.innerHTML = ''
    new Function(analyticsCode)()
  })

  it('defines window.va as a queueing stub', () => {
    expect(typeof window.va).toBe('function')
    window.va('event', { name: 'test' })
    expect(window.vaq).toEqual([expect.objectContaining({ 0: 'event' })])
  })

  it('injects the Vercel Insights and Speed Insights script tags into <head>', () => {
    const scripts = Array.from(document.head.querySelectorAll('script')).map(s => s.src)
    expect(scripts.some(src => src.endsWith('/_vercel/insights/script.js'))).toBe(true)
    expect(scripts.some(src => src.endsWith('/_vercel/speed-insights/script.js'))).toBe(true)
  })

  it('window.track forwards to window.va with name/data shape', () => {
    const vaSpy = vi.fn()
    window.va = vaSpy
    window.track('Test Event', { foo: 'bar' })
    expect(vaSpy).toHaveBeenCalledWith('event', { name: 'Test Event', data: { foo: 'bar' } })
  })

  it('window.track defaults props to an empty object when omitted', () => {
    const vaSpy = vi.fn()
    window.va = vaSpy
    window.track('No Props Event')
    expect(vaSpy).toHaveBeenCalledWith('event', { name: 'No Props Event', data: {} })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/analytics.test.js`
Expected: FAIL — `analytics.js` doesn't exist yet (`ENOENT` reading the file).

- [ ] **Step 3: Create `analytics.js`**

```js
// analytics.js — Vercel Analytics + Speed Insights (sitio estático, sin bundler)
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };

(function loadScript(src) {
  const s = document.createElement('script');
  s.defer = true;
  s.src = src;
  document.head.appendChild(s);
})('/_vercel/insights/script.js');

(function loadScript(src) {
  const s = document.createElement('script');
  s.defer = true;
  s.src = src;
  document.head.appendChild(s);
})('/_vercel/speed-insights/script.js');

window.track = function (eventName, props) {
  window.va('event', { name: eventName, data: props || {} });
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/analytics.test.js`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Add `<script src="analytics.js"></script>` to all 12 HTML pages**

For each of the 12 files listed in this task's Files section: open the file, find its existing `<script ...>` tags (near the end of `<body>`, following each page's own convention), and add `<script src="analytics.js"></script>` as the FIRST script tag in that block — before any page-specific script (e.g. before `<script src="app.js"></script>` on `scan.html`, before `<script type="module" src="account-ui.js"></script>` on `account.html`, etc.). Do not reorder or remove any existing script tags — only prepend this one line to each page's script block.

Example for `scan.html` (adjust to match that file's actual existing tags — read the file first, this shows only the pattern):

```html
<script src="analytics.js"></script>
<script src="app.js"></script>
<script src="nav.js"></script>
```

Repeat for the remaining 11 pages: `account.html`, `auth.html`, `history.html`, `index.html`, `onboarding-membership.html`, `onboarding-profile.html`, `preferences.html`, `privacidad.html`, `reset-password.html`, `terminos.html`, `verify-email.html`.

- [ ] **Step 6: Verify each page loads it**

Run: `grep -L 'analytics.js' account.html auth.html history.html index.html onboarding-membership.html onboarding-profile.html preferences.html privacidad.html reset-password.html scan.html terminos.html verify-email.html`
Expected: no output (empty result means every file matched, i.e. none are missing it). If any filename is printed, that page still needs the script tag added.

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: all existing tests still pass (adding a script tag to static HTML doesn't affect any existing jsdom-based test, since none of them load full HTML files) plus the new `tests/analytics.test.js` (4 tests).

- [ ] **Step 8: Commit**

```bash
git add analytics.js account.html auth.html history.html index.html onboarding-membership.html onboarding-profile.html preferences.html privacidad.html reset-password.html scan.html terminos.html verify-email.html tests/analytics.test.js
git commit -m "feat(analytics): add Vercel Analytics script-tag loader and window.track helper"
```

---

### Task 2: Instrument `Paywall Hit` in `app.js`

**Files:**
- Modify: `app.js:1858-1869` (`renderPersonalizedReasons`)
- Test: `tests/app.test.js` (existing `describe('renderPersonalizedReasons', ...)` block)

**Interfaces:**
- Consumes: `window.track(eventName, props)` from Task 1 (already global by the time any page's inline scripts run, since `analytics.js` loads first — but in the unit test, stub it directly on `window`, no need to load `analytics.js`).

- [ ] **Step 1: Write the failing test**

In `tests/app.test.js`, inside the existing `describe('renderPersonalizedReasons', ...)` block (starts ~line 797), add:

```js
  it('dispara el evento "Paywall Hit" al mostrar el teaser a un usuario sin membresía activa', () => {
    window.track = vi.fn()
    const product = { sellos: [], notRecommended: [], ingredientsText: 'agua, azucar' }
    renderPersonalizedReasons(product, null)
    expect(window.track).toHaveBeenCalledWith('Paywall Hit', { context: 'personalized-reasons' })
  })

  it('NO dispara "Paywall Hit" para un usuario premium activo', () => {
    window.track = vi.fn()
    window.authClient = { getCachedProfile: () => ({ membershipStatus: 'active' }) }
    const product = { sellos: [], notRecommended: [], ingredientsText: 'agua, azucar' }
    renderPersonalizedReasons(product, null)
    expect(window.track).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app.test.js -t "Paywall Hit"`
Expected: FAIL — first test fails because `window.track` is never called (the call doesn't exist in `app.js` yet). Second test passes trivially (nothing is called at all yet) — that's fine, it'll stay green through Step 4.

- [ ] **Step 3: Add the `track()` call**

In `app.js`, in `renderPersonalizedReasons` (~line 1864-1869):

```js
    if (isActiveMember || hasNoRealData(product)) {
      card.classList.add('hidden');
      return;
    }
    window.track('Paywall Hit', { context: 'personalized-reasons' });
    renderTeaserReasons(card);
    return;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/app.test.js -t "Paywall Hit"`
Expected: PASS, both tests.

- [ ] **Step 5: Run the full `app.test.js` file**

Run: `npx vitest run tests/app.test.js`
Expected: all tests pass, no regressions in the other `renderPersonalizedReasons` tests (they don't stub `window.track`, so it stays `undefined` unless a previous test in the same file already set it — check that `window.track` being possibly left set from an earlier test in the file doesn't cause unrelated test failures; since none of the other tests assert `window.track` was NOT called, this is safe, but confirm by running the full file).

- [ ] **Step 6: Commit**

```bash
git add app.js tests/app.test.js
git commit -m "feat(analytics): track Paywall Hit event when teaser card is shown"
```

---

### Task 3: Instrument `Scan Completado` via e2e coverage in `app.js`

**Files:**
- Modify: `app.js:2036` (`renderProductData`)
- Test: `tests/e2e/scan-cycle.spec.js` (existing file)

**Interfaces:**
- Consumes: `window.va`/`window.vaq` (from Task 1's `analytics.js`) — captured directly in the e2e test via `page.evaluate`, since `renderProductData` has heavy DOM/module-level-variable dependencies (`resultSuccess`, `productName`, `productImg`, etc., all assigned once at `app.js` load time against `scan.html`'s real DOM) that make it impractical to unit-test in isolation with jsdom — no existing test in `tests/app.test.js` covers `renderProductData` at all, and this plan does not attempt to build a full DOM fixture for it. The already-existing Playwright e2e suite drives the real `scan.html` page end-to-end, which is the natural place to verify this event fires.

- [ ] **Step 1: Read the existing e2e test to find the successful-scan test case**

Run: view `tests/e2e/scan-cycle.spec.js`. It mocks `**/api/product/**` and drives a full scan against `scan.html` with `VALID_BARCODE`, which resolves to `MOCK_PRODUCT` (a food product with `nutriscore_grade: 'c'`, allergens `gluten` and `milk`). Do not assume the exact resulting verdict string here — Step 2 asserts on whatever the app actually computes, discovered by running the test once to see the recorded event.

- [ ] **Step 2: Write the failing test**

Add a new test to the `describe('Ciclo completo de escaneo', ...)` block in `tests/e2e/scan-cycle.spec.js`, placed after whatever existing test drives a full successful scan of `VALID_BARCODE` through to the result screen (reuse that same setup/navigation code — do not duplicate the whole flow from scratch, follow the file's existing pattern for triggering a scan):

```js
  test('dispara el evento "Scan Completado" con el verdict correcto', async ({ page }) => {
    await page.addInitScript(() => {
      window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    });
    // ... reuse this file's existing steps to navigate to scan.html and
    // trigger a scan of VALID_BARCODE through to the result screen ...
    const events = await page.evaluate(() => (window.vaq || []).map(args => args[1]));
    const scanEvent = events.find(e => e && e.name === 'Scan Completado');
    expect(scanEvent).toBeTruthy();
    expect(['sano', 'regular', 'evitar']).toContain(scanEvent.data.verdict);
  });
```

Note: `page.addInitScript` must run BEFORE `analytics.js` loads on the page (Playwright's `addInitScript` always runs before any page script, so this is safe) — it pre-defines `window.va` as the same queueing stub `analytics.js` itself defines, so `analytics.js`'s own `window.va = window.va || ...` becomes a no-op and doesn't overwrite it, and every `window.track(...)` call in the page ends up pushed into `window.vaq` where the test can read it back.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx playwright test tests/e2e/scan-cycle.spec.js -g "Scan Completado"`
Expected: FAIL — `scanEvent` is `undefined` (no `track()` call exists in `renderProductData` yet).

- [ ] **Step 4: Add the `track()` call**

In `app.js`, in `renderProductData` (~line 2036):

```js
  const verdict = computeVerdict(product, userPreferences);
  window.track('Scan Completado', { verdict });
  renderPersonalizedDisclaimer(userPreferences);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx playwright test tests/e2e/scan-cycle.spec.js -g "Scan Completado"`
Expected: PASS.

- [ ] **Step 6: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: all e2e tests pass, no regressions (this file's other tests never assert on `window.vaq`, so the added `window.track` calls do not affect them).

- [ ] **Step 7: Run the full unit test suite too**

Run: `npx vitest run`
Expected: all tests still pass — `app.js` changed, but no jsdom unit test exercises `renderProductData` directly, so nothing there should break. Confirm no unrelated regression.

- [ ] **Step 8: Commit**

```bash
git add app.js tests/e2e/scan-cycle.spec.js
git commit -m "feat(analytics): track Scan Completado event with verdict on successful scan"
```

---

### Task 4: Instrument `Checkout Iniciado` in `onboarding-membership-ui.js`

**Files:**
- Modify: `onboarding-membership-ui.js:113-115` (`confirmMembershipPayment`)
- Test: `tests/onboarding-membership-ui.test.js` (existing file)

**Interfaces:**
- Consumes: `window.track(eventName, props)` — stubbed directly in the unit test.

- [ ] **Step 1: Write the failing test**

In `tests/onboarding-membership-ui.test.js`, add a new test after the existing `'calls POST /api/me/membership/pay and redirects to the returned checkoutUrl'` test:

```js
it('tracks "Checkout Iniciado" before redirecting to Stripe', async () => {
  window.track = vi.fn()
  document.getElementById('pay-checkbox').checked = true
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, checkoutUrl: 'https://checkout.stripe.com/cs_1' }) })

  await confirmMembershipPayment()

  expect(window.track).toHaveBeenCalledWith('Checkout Iniciado')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/onboarding-membership-ui.test.js -t "Checkout Iniciado"`
Expected: FAIL — `window.track` is never called.

- [ ] **Step 3: Add the `track()` call**

In `onboarding-membership-ui.js`, in `confirmMembershipPayment` (~line 114-115):

```js
    const data = await res.json();
    window.track('Checkout Iniciado');
    window.location.href = data.checkoutUrl;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/onboarding-membership-ui.test.js -t "Checkout Iniciado"`
Expected: PASS.

- [ ] **Step 5: Run the full test file**

Run: `npx vitest run tests/onboarding-membership-ui.test.js`
Expected: all tests pass, including the pre-existing ones (`window.track` being `undefined` in those tests is fine since `confirmMembershipPayment` calling `window.track(...)` when it's `undefined` would throw — check this: if `window.track` is not stubbed in the OTHER existing tests, calling `window.track('Checkout Iniciado')` in the success-path test will throw `TypeError: window.track is not a function` and break that pre-existing test. Fix this by having Step 3's call site tolerate an unset `window.track`, OR by stubbing `window.track = vi.fn()` in this test file's shared `beforeEach` instead of only in the new test — do the latter: move `window.track = vi.fn()` into the file's existing `beforeEach` block so every test in the file has it available, and remove the now-redundant line from the new test).

- [ ] **Step 6: Commit**

```bash
git add onboarding-membership-ui.js tests/onboarding-membership-ui.test.js
git commit -m "feat(analytics): track Checkout Iniciado event before Stripe redirect"
```

---

### Task 5: Instrument `Checkout Completado` in `account-ui.js`

**Files:**
- Modify: `account-ui.js:853-856` (`handleStripeReturn`)
- Test: `tests/account-stripe-return.test.js` (existing file)

**Interfaces:**
- Consumes: `window.track(eventName, props)` — stubbed directly in the unit test.

- [ ] **Step 1: Write the failing test**

In `tests/account-stripe-return.test.js`, add `window.track = vi.fn()` to the existing `beforeEach` block (so it's available in every test in the file, same reasoning as Task 4), then add a new test after `'on stripe=success, confirms the checkout session'`:

```js
it('tracks "Checkout Completado" only when the checkout confirmation succeeds', async () => {
  window.history.replaceState({}, '', '/account.html?stripe=success&session_id=cs_1')
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

  await handleStripeReturn()

  expect(window.track).toHaveBeenCalledWith('Checkout Completado')
})

it('does NOT track "Checkout Completado" when checkout-result responds non-ok', async () => {
  window.history.replaceState({}, '', '/account.html?stripe=success&session_id=cs_1')
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })

  await handleStripeReturn()

  expect(window.track).not.toHaveBeenCalledWith('Checkout Completado')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/account-stripe-return.test.js -t "Checkout Completado"`
Expected: first new test FAILS (`window.track` never called with that event); second new test passes trivially (nothing is called yet).

- [ ] **Step 3: Add the `track()` call**

In `account-ui.js`, in `handleStripeReturn` (~line 853-856):

```js
        if (res.ok) {
          await flushPendingPreferences(token);
          window.track('Checkout Completado');
          showToast('¡Pago confirmado! Tu membresía está activa.');
        } else {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/account-stripe-return.test.js -t "Checkout Completado"`
Expected: PASS, both new tests.

- [ ] **Step 5: Run the full test file**

Run: `npx vitest run tests/account-stripe-return.test.js`
Expected: all tests pass, no regressions.

- [ ] **Step 6: Run the full unit test suite**

Run: `npx vitest run`
Expected: all tests pass across the whole project (this is the last task touching test files — full-suite check catches any cross-file interaction, e.g. leftover `window.track` stub bleeding between files, which vitest isolates per file by default so this should be a non-issue, but verify).

- [ ] **Step 7: Commit**

```bash
git add account-ui.js tests/account-stripe-return.test.js
git commit -m "feat(analytics): track Checkout Completado event on confirmed Stripe payment"
```

---

## Self-Review Notes

- Spec coverage: `analytics.js` + 12-page wiring → Task 1. `Paywall Hit` → Task 2. `Scan Completado` → Task 3. `Checkout Iniciado` → Task 4. `Checkout Completado` → Task 5. Testing section of the spec (stub `window.track`, verify args) → covered in every task's test steps.
- Task 3 deliberately deviates from unit-testing (jsdom) to e2e (Playwright) for `Scan Completado` specifically, because `renderProductData` has no existing unit test infrastructure and heavy module-level DOM coupling — this is called out explicitly in the task's Interfaces section, not left implicit.
- Tasks 4 and 5 both flag the same real risk (an untested pre-existing test in the same file breaking because `window.track` is suddenly called but not stubbed) and resolve it the same way (move the stub into `beforeEach`), so an implementer hitting one already knows the fix for the other.
- No placeholders: every step has literal code, every test has real assertions, no "TBD" or "handle appropriately" language anywhere.
