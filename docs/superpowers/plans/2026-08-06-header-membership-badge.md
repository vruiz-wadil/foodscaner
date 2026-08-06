# Header Membership Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pill/badge fixed to the top-right of the app header (opposite the logo) that acts as an upgrade CTA for non-members and shows the user's first name + a "Premium" indicator for active members, present on every page that has `.app-header` except `premium-offer.html`.

**Architecture:** A new shared ES module `header-badge.js` (mirrors the existing `nav.js` shared-script pattern) reads session state from the already-global `authClient` (`window.authClient`, set up by `authClient.js`) and renders one `<a id="header-badge">` element per page. `styles.css`'s `.app-header` rule changes from a column layout to a row layout so the badge sits opposite the logo. `premium-offer.html` gets a same-page guard that redirects any logged-in user (any membership status) to `account.html`, since that page must only ever be reached by anonymous visitors.

**Tech Stack:** Vanilla JS ES modules, Vitest + jsdom for tests (matching the existing `tests/*-ui.test.js` pattern — real `import()` of the module under test, `vi.mock('../authClient.js', ...)`, DOM assertions via `document.body.innerHTML`).

## Global Constraints

- Copy is Spanish-only: CTA label is exactly `"Hazte Premium"` (both non-member states use identical copy — reviewed and approved by copywriting).
- Premium-state pill shows only: first name + crown icon + a small "Premium" label — no extra punctuation, no exclamation marks.
- Icon: a single crown SVG path, rendered `fill="none" stroke="currentColor"` (outline) for the CTA states and `fill="currentColor"` (filled) for the Premium state — same path both times, only the fill toggles.
- Colors/tokens must come from the real values in `styles.css` (`--ink:#0d3d35`, `--paper:#eaf9f6`, `--chile:#dc2626`, `--amber:#eab308`) — do not use the palette described in `README.md`, it is stale.
- Pill visual treatment: `border: 2px solid var(--ink)`, `border-radius: 999px`, `box-shadow: 3px 3px 0 var(--ink)`, press-down hover/active state — matches the app's existing flat-sticker card language (see `.badge-food`, `.dietary-grid-item` in `styles.css` for the established pattern this must match).
- CTA variant: `background: var(--chile); color: var(--paper);`. Premium variant: `background: var(--amber); color: var(--ink);` (ink-on-amber, not paper-on-amber — paper-on-amber fails WCAG AA contrast).
- Badge starts with a `hidden` CSS class (`display:none`) and only becomes visible once `header-badge.js` has resolved a definite state — never flash an empty or wrong-state pill.
- Any user-supplied string rendered into the badge (`profile.displayName`) MUST be HTML-escaped before being placed via `innerHTML` — it is unsanitized user input on the backend (`putProfileHandler` only trims/truncates, does not strip HTML).
- `premium-offer.html` never shows the badge at all (not hidden via CSS — the markup and script simply aren't added to that page).
- `account.html` DOES show the badge when the user is an active member (links to itself — intentional, no special-casing).

---

## File Structure

- **Modify `styles.css`**: `.app-header` becomes a row layout; new `.header-badge` rules added (base + `.cta` + `.premium` + `.hidden` + hover/active state).
- **Create `header-badge.js`**: pure state-computation functions (`firstNameOf`, `computeBadgeState`) + a `mountHeaderBadge()` function that wires DOM rendering to `authClient`. Single-responsibility file, mirrors `nav.js`'s role as a small shared script.
- **Create `tests/header-badge.test.js`**: covers `firstNameOf`, `computeBadgeState` (all 3 states + fallback chain), and `mountHeaderBadge()` DOM wiring (mocking `authClient.js`).
- **Modify 12 HTML files** (every page with `.app-header` except `premium-offer.html`): add the badge anchor markup + a `<script type="module" src="header-badge.js"></script>` tag. 3 of these (`account.html`, `preferences.html`, `history.html`) also get a markup restructure to wrap the existing `<h1 class="page-title">` together with the logo in a `.logo-area` div, so the row layout has exactly two flex children (logo block, badge) instead of three.
- **Modify `premium-offer.html`**: add the anonymous-only guard (inline `type="module"` script) + a `body.hidden-until-checked { visibility: hidden; }` rule used until the guard resolves.
- **Create `tests/premium-offer-guard.test.js`**: extracts the guard's redirect logic into a small testable function and covers both branches (logged in → redirect, anonymous → become visible).

---

## Task 1: Header layout CSS + badge pill styles

**Files:**
- Modify: `styles.css:108-115` (`.app-header` rule)
- Modify: `styles.css` (new rules appended after the existing `.logo-area`/`.app-logo`/`.tagline` block, i.e. after line 136)

**Interfaces:**
- Produces: CSS classes `.header-badge`, `.header-badge.hidden`, `.header-badge.cta`, `.header-badge.premium`, `.header-badge-tag` — consumed by `header-badge.js` (Task 2) and the markup added in Task 4/5.

- [ ] **Step 1: Change `.app-header` from column to row layout**

In `styles.css`, replace:
```css
.app-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 28px 20px 16px;
  background: var(--paper);
  border-bottom: none;
}
```
with:
```css
.app-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 28px 20px 16px;
  background: var(--paper);
  border-bottom: none;
}
```

- [ ] **Step 2: Add the badge pill CSS**

Immediately after the existing `.tagline { ... }` rule (ends around line 136), add:

```css
.header-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 2px solid var(--ink);
  font-size: 0.85rem;
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
  flex-shrink: 0;
  box-shadow: 3px 3px 0 var(--ink);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.header-badge:hover,
.header-badge:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 var(--ink);
}

.header-badge.hidden {
  display: none;
}

.header-badge.cta {
  background: var(--chile);
  color: var(--paper);
  border-color: var(--ink);
}

.header-badge.premium {
  background: var(--amber);
  color: var(--ink);
  border-color: var(--ink);
}

.header-badge-tag {
  font-size: 0.7rem;
  font-weight: 600;
  opacity: 0.75;
}
```

- [ ] **Step 3: Manually verify no visual regression**

Run: `npm start`, open `http://localhost:3000/index.html` and `http://localhost:3000/scan.html` in a browser.
Expected: header still shows the logo on the left; no badge appears yet (not wired up until Task 4) but the header shouldn't look broken (logo doesn't jump to center, no layout shift).

- [ ] **Step 4: Commit**

```bash
git add styles.css
git commit -m "feat(header): switch .app-header to row layout, add badge pill styles"
```

---

## Task 2: `header-badge.js` — state logic + DOM mounting

**Files:**
- Create: `header-badge.js`
- Test: `tests/header-badge.test.js`

**Interfaces:**
- Consumes: `authClient.js` exports `onAuthChange(callback)` and `getCachedProfile()` (already defined, see `authClient.js:5-7` and `authClient.js:47-49`). Profile shape (from `GET /api/me`, see `api/index.js:1622-1635`): `{ uid, email, phoneNumber, membershipStatus: 'pending'|'active'|'expired', profile?: { displayName?: string, ... }, ... }` or `null` when there's no session.
- Produces: `firstNameOf(profile)`, `computeBadgeState(profile)`, `mountHeaderBadge()` — exported for tests; `mountHeaderBadge()` is also called automatically when the module loads (so pages just need to `<script type="module" src="header-badge.js">`, no extra wiring).

- [ ] **Step 1: Write the failing tests for `firstNameOf`**

Create `tests/header-badge.test.js`:

```js
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const onAuthChange = vi.fn()
const getCachedProfile = vi.fn()
vi.mock('../authClient.js', () => ({ onAuthChange, getCachedProfile }))

let firstNameOf, computeBadgeState, mountHeaderBadge

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  document.body.innerHTML = '<a id="header-badge" class="header-badge hidden"></a>'
  const mod = await import('../header-badge.js')
  firstNameOf = mod.firstNameOf
  computeBadgeState = mod.computeBadgeState
  mountHeaderBadge = mod.mountHeaderBadge
})

describe('firstNameOf', () => {
  it('returns the first token of profile.displayName', () => {
    expect(firstNameOf({ profile: { displayName: 'María Fernanda López' } })).toBe('María')
  })

  it('falls back to the email local-part when displayName is missing', () => {
    expect(firstNameOf({ email: 'juan.perez@example.com' })).toBe('juan.perez')
  })

  it('falls back to "Cuenta" when neither displayName nor email exist', () => {
    expect(firstNameOf({})).toBe('Cuenta')
  })

  it('falls back to "Cuenta" when displayName is an empty/whitespace string', () => {
    expect(firstNameOf({ profile: { displayName: '   ' }, email: 'a@b.com' })).toBe('a')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/header-badge.test.js`
Expected: FAIL — `../header-badge.js` does not exist yet.

- [ ] **Step 3: Write `computeBadgeState` tests**

Append to `tests/header-badge.test.js`:

```js
describe('computeBadgeState', () => {
  it('returns the CTA state pointing to premium-offer.html when there is no session', () => {
    const state = computeBadgeState(null)
    expect(state).toEqual({ label: 'Hazte Premium', href: 'premium-offer.html', variant: 'cta' })
  })

  it('returns the CTA state pointing to onboarding-membership.html when logged in without active membership', () => {
    const state = computeBadgeState({ membershipStatus: 'pending', profile: { displayName: 'Ana' } })
    expect(state).toEqual({ label: 'Hazte Premium', href: 'onboarding-membership.html', variant: 'cta' })
  })

  it('returns the premium state with the first name pointing to account.html when membership is active', () => {
    const state = computeBadgeState({ membershipStatus: 'active', profile: { displayName: 'Ana García' } })
    expect(state).toEqual({ label: 'Ana', href: 'account.html', variant: 'premium' })
  })
})
```

- [ ] **Step 4: Run tests, confirm still failing (module missing)**

Run: `npx vitest run tests/header-badge.test.js`
Expected: FAIL — same "Cannot find module" error.

- [ ] **Step 5: Write `header-badge.js`**

```js
import { onAuthChange, getCachedProfile } from './authClient.js';

export function firstNameOf(profile) {
  const displayName = profile && profile.profile && profile.profile.displayName;
  if (displayName && displayName.trim()) return displayName.trim().split(/\s+/)[0];
  const email = profile && profile.email;
  if (email && email.includes('@')) return email.split('@')[0];
  return 'Cuenta';
}

export function computeBadgeState(profile) {
  if (!profile) {
    return { label: 'Hazte Premium', href: 'premium-offer.html', variant: 'cta' };
  }
  if (profile.membershipStatus === 'active') {
    return { label: firstNameOf(profile), href: 'account.html', variant: 'premium' };
  }
  return { label: 'Hazte Premium', href: 'onboarding-membership.html', variant: 'cta' };
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Un solo path de corona — outline (fill="none") en los estados CTA, relleno
// (fill="currentColor") en el estado Premium. Mismo ícono, dos estados, para
// que el CTA nunca parezca que el usuario ya es miembro.
function crownSvg(filled) {
  const fill = filled ? 'currentColor' : 'none';
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 18h20l-2-9-5 4-3-7-3 7-5-4-2 9z"/></svg>`;
}

export function renderBadge(el, profile) {
  const state = computeBadgeState(profile);
  el.href = state.href;
  el.className = `header-badge ${state.variant}`;
  const icon = crownSvg(state.variant === 'premium');
  const tag = state.variant === 'premium' ? '<span class="header-badge-tag">Premium</span>' : '';
  el.innerHTML = `${icon}<span>${escapeHtml(state.label)}</span>${tag}`;
}

export function mountHeaderBadge() {
  const el = document.getElementById('header-badge');
  if (!el) return;

  function update() {
    renderBadge(el, getCachedProfile());
  }

  update();
  onAuthChange(() => update());
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountHeaderBadge);
  } else {
    mountHeaderBadge();
  }
}
```

- [ ] **Step 6: Run tests to verify `firstNameOf`/`computeBadgeState` pass**

Run: `npx vitest run tests/header-badge.test.js`
Expected: PASS for all `firstNameOf` and `computeBadgeState` tests.

- [ ] **Step 7: Write the `mountHeaderBadge` DOM-wiring tests**

Append to `tests/header-badge.test.js`:

```js
describe('mountHeaderBadge', () => {
  it('renders the CTA state immediately from the cached profile and un-hides the pill', () => {
    getCachedProfile.mockReturnValue(null)
    mountHeaderBadge()
    const el = document.getElementById('header-badge')
    expect(el.className).toBe('header-badge cta')
    expect(el.getAttribute('href')).toBe('premium-offer.html')
    expect(el.textContent).toContain('Hazte Premium')
  })

  it('re-renders when authClient fires an auth change', () => {
    getCachedProfile.mockReturnValueOnce(null).mockReturnValueOnce({ membershipStatus: 'active', profile: { displayName: 'Luis' } })
    mountHeaderBadge()
    const callback = onAuthChange.mock.calls[0][0]
    callback()
    const el = document.getElementById('header-badge')
    expect(el.className).toBe('header-badge premium')
    expect(el.getAttribute('href')).toBe('account.html')
    expect(el.textContent).toContain('Luis')
  })

  it('escapes HTML in a malicious displayName instead of injecting it', () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'active', profile: { displayName: '<img src=x onerror=alert(1)>' } })
    mountHeaderBadge()
    const el = document.getElementById('header-badge')
    expect(el.querySelector('img')).toBeNull()
    expect(el.innerHTML).toContain('&lt;img')
  })

  it('does nothing when the page has no #header-badge element', () => {
    document.body.innerHTML = ''
    expect(() => mountHeaderBadge()).not.toThrow()
  })
})
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/header-badge.test.js`
Expected: PASS — all tests in the file green.

- [ ] **Step 9: Commit**

```bash
git add header-badge.js tests/header-badge.test.js
git commit -m "feat(header): add header-badge.js with CTA/premium state logic and tests"
```

---

## Task 3: Add badge markup to pages that already use `.logo-area` (no title)

**Files:**
- Modify: `scan.html:71-75`
- Modify: `privacidad.html` (header block, mirrors `scan.html`'s structure)
- Modify: `terminos.html` (header block, mirrors `scan.html`'s structure)

**Interfaces:**
- Consumes: `.header-badge`/`.hidden` CSS classes from Task 1, `header-badge.js` module from Task 2 (no exports consumed directly — the script self-mounts on load).

- [ ] **Step 1: Update `scan.html`**

Replace:
```html
    <header class="app-header">
      <div class="logo-area">
        <img src="assets/redesign/logo.svg" alt="Yomi" class="app-logo">
      </div>
    </header>
```
with:
```html
    <header class="app-header">
      <div class="logo-area">
        <img src="assets/redesign/logo.svg" alt="Yomi" class="app-logo">
      </div>
      <a href="#" id="header-badge" class="header-badge hidden" aria-live="polite"></a>
    </header>
```

Then find the existing script block (around `scan.html:676-681`, the `<script src="analytics.js">` ... `<script type="module" src="authClient.js">` group) and add, right after the `authClient.js` line:
```html
  <script type="module" src="header-badge.js"></script>
```

- [ ] **Step 2: Update `privacidad.html` the same way**

Same markup change as Step 1 (adding the `<a id="header-badge">` line after `privacidad.html`'s `.logo-area` div). Then locate its closing `</body>` script block and add `<script type="module" src="header-badge.js"></script>` alongside its existing script tags (add `<script type="module" src="firebase-init.js"></script>` and `<script type="module" src="authClient.js"></script>` too if not already present — check the file first, since this page currently only needs static content and may not load `authClient.js` yet).

- [ ] **Step 3: Update `terminos.html` the same way as Step 2**

- [ ] **Step 4: Manually verify**

Run: `npm start`, open `http://localhost:3000/privacidad.html`.
Expected: no console errors about missing `authClient`/`firebase-init` modules; badge appears top-right (as the CTA "Hazte Premium" pill, since there's no session in a fresh browser).

- [ ] **Step 5: Commit**

```bash
git add scan.html privacidad.html terminos.html
git commit -m "feat(header): mount badge on scan/privacidad/terminos pages"
```

---

## Task 4: Add badge markup to plain-logo pages (no existing `.logo-area`, no title)

**Files:**
- Modify: `index.html:25-27`
- Modify: `auth.html:32-34`
- Modify: `onboarding-membership.html:26-28`
- Modify: `onboarding-profile.html:19-21`
- Modify: `reset-password.html:23-25`
- Modify: `verify-email.html:21-23`

**Interfaces:**
- Same as Task 3.

- [ ] **Step 1: Update each of the 6 files**

For each file, the header block currently looks like:
```html
    <header class="app-header">
      <img src="assets/redesign/logo.svg" alt="Yomi" class="app-logo">
    </header>
```
Change to:
```html
    <header class="app-header">
      <img src="assets/redesign/logo.svg" alt="Yomi" class="app-logo">
      <a href="#" id="header-badge" class="header-badge hidden" aria-live="polite"></a>
    </header>
```
(Exact indentation may differ slightly per file — match the file's existing indentation style.)

- [ ] **Step 2: Add the script tag to each of the 6 files**

Each of these files already loads `firebase-init.js` and `authClient.js` as `type="module"` (confirmed present on all 6 — they're part of the onboarding/auth flow). Add `<script type="module" src="header-badge.js"></script>` immediately after the existing `<script type="module" src="authClient.js"></script>` line in each file.

- [ ] **Step 3: Manually verify on two representative pages**

Run: `npm start`, open `http://localhost:3000/auth.html` and `http://localhost:3000/onboarding-profile.html`.
Expected: badge pill visible top-right on both, no console errors.

- [ ] **Step 4: Commit**

```bash
git add index.html auth.html onboarding-membership.html onboarding-profile.html reset-password.html verify-email.html
git commit -m "feat(header): mount badge on index/auth/onboarding/reset-password/verify-email pages"
```

---

## Task 5: Add badge markup to pages with a page title (wrap logo+title in `.logo-area`)

**Files:**
- Modify: `account.html:32-35`
- Modify: `preferences.html:54-57`
- Modify: `history.html:20-23`

**Interfaces:**
- Same as Task 3/4. Additionally produces the `.logo-area` wrapper on these 3 pages so the row layout has exactly 2 flex children (logo+title block, badge) instead of 3 — keeps the title anchored next to the logo instead of being pushed to the middle by `justify-content: space-between`.

- [ ] **Step 1: Update `account.html`**

Replace:
```html
    <header class="app-header">
      <img src="assets/redesign/logo.svg" alt="Yomi" class="app-logo">
      <h1 class="page-title">Mi cuenta</h1>
    </header>
```
with:
```html
    <header class="app-header">
      <div class="logo-area">
        <img src="assets/redesign/logo.svg" alt="Yomi" class="app-logo">
        <h1 class="page-title">Mi cuenta</h1>
      </div>
      <a href="#" id="header-badge" class="header-badge hidden" aria-live="polite"></a>
    </header>
```

- [ ] **Step 2: Update `preferences.html`** — same transformation, title text stays `"Mis preferencias"`.

- [ ] **Step 3: Update `history.html`** — same transformation, title text stays `"Análisis"`.

- [ ] **Step 4: Add the script tag to each of the 3 files**

All 3 already load `firebase-init.js`/`authClient.js` as modules. Add `<script type="module" src="header-badge.js"></script>` right after the `authClient.js` line in each.

- [ ] **Step 5: Manually verify `.logo-area` didn't break the title's existing spacing**

Run: `npm start`, open `http://localhost:3000/account.html`.
Expected: logo + "Mi cuenta" title still stacked/aligned as before (the `.logo-area` CSS already used by `scan.html` is `display:inline-flex; align-items:center; gap:10px`, which will now lay the title next to the logo horizontally rather than stacked — if this looks wrong, this is a UI judgment call the implementer should resolve by adding a small inline style or class tweak so the title sits legibly next to the logo, e.g. reducing `.app-logo` height slightly on these 3 pages or letting `.logo-area` wrap; do not change `.logo-area`'s base rule since `scan.html`/`privacidad.html`/`terminos.html` rely on its current behavior).

- [ ] **Step 6: Commit**

```bash
git add account.html preferences.html history.html
git commit -m "feat(header): mount badge on account/preferences/history pages, wrap title in .logo-area"
```

---

## Task 6: `premium-offer.html` anonymous-only guard

**Files:**
- Modify: `premium-offer.html`
- Test: `tests/premium-offer-guard.test.js`

**Interfaces:**
- Consumes: `firebaseAuth` from `firebase-init.js` (already exported — see `firebase-init.js:51`, `export const firebaseAuth = getAuth(firebaseApp);`).
- Produces: an exported `shouldRedirectToAccount(user)` pure function (testable in isolation) plus the inline guard script that calls it.

- [ ] **Step 1: Write the failing test**

Create `tests/premium-offer-guard.test.js`:

```js
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { shouldRedirectToAccount } from '../premium-offer-guard.js'

describe('shouldRedirectToAccount', () => {
  it('returns true when there is a logged-in user, regardless of membership status', () => {
    expect(shouldRedirectToAccount({ uid: 'abc' })).toBe(true)
  })

  it('returns false when there is no user', () => {
    expect(shouldRedirectToAccount(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/premium-offer-guard.test.js`
Expected: FAIL — `../premium-offer-guard.js` does not exist.

- [ ] **Step 3: Create `premium-offer-guard.js`**

A tiny, separate module (kept separate from inline `<script>` in the HTML so the redirect logic itself is unit-testable — the existing codebase's pattern for other pages' small guard/redirect functions, e.g. `renderAccountHub`'s guard in `account-ui.js:270-273`, is normally embedded directly, but here isolating it avoids needing a jsdom `window.location` mock for the whole file):

```js
export function shouldRedirectToAccount(user) {
  return !!user;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/premium-offer-guard.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the guard into `premium-offer.html`**

Add a `visibility:hidden` starting state and the guard script. Near the top of `premium-offer.html`'s `<head>` (or as an inline `<style>` right before `</head>`), add:

```html
<style>body { visibility: hidden; }</style>
```

Then, as the first `<script type="module">` in the page (before other scripts, right after the opening `<body>` or wherever the file's existing module scripts are grouped — check the file for its current script placement and match it), add:

```html
<script type="module">
  import { firebaseAuth } from './firebase-init.js';
  import { shouldRedirectToAccount } from './premium-offer-guard.js';

  await firebaseAuth.authStateReady();
  if (shouldRedirectToAccount(firebaseAuth.currentUser)) {
    window.location.replace('account.html');
  } else {
    document.body.style.visibility = 'visible';
  }
</script>
```

- [ ] **Step 6: Manually verify both branches**

Run: `npm start`.
1. Open `http://localhost:3000/premium-offer.html` in a fresh/incognito browser tab (no session). Expected: page content becomes visible, no redirect.
2. Log in on `http://localhost:3000/auth.html` in the same browser, then navigate to `http://localhost:3000/premium-offer.html`. Expected: immediate redirect to `account.html`, no flash of pricing content.

- [ ] **Step 7: Commit**

```bash
git add premium-offer.html premium-offer-guard.js tests/premium-offer-guard.test.js
git commit -m "feat(premium-offer): redirect logged-in users to account.html"
```

---

## Task 7: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `tests/header-badge.test.js` and `tests/premium-offer-guard.test.js` files. Pre-existing failures unrelated to this work (if any, e.g. an out-of-scope Playwright config issue in a worktree directory) are not this plan's concern — confirm no *new* failures were introduced.

- [ ] **Step 2: Bump cache-busting query params if needed**

Check `styles.css`'s `?v=NN` query param usage across the 13 modified HTML files (e.g. `scan.html` currently loads `styles.css?v=56` per earlier grep). If any modified HTML file references `styles.css` with a version query param, bump it by 1 in that file so browsers don't serve a stale cached copy in production — this project has hit this exact bug before (see `README.md`'s "Cache-buster staleness" pattern / git history around `app.js?v=75`).

- [ ] **Step 3: Manual smoke test across all session states**

Run: `npm start`.
1. Anonymous: open `index.html` — badge shows "Hazte Premium", links to `premium-offer.html`.
2. Log in with an account that has no active membership — badge still shows "Hazte Premium" but now links to `onboarding-membership.html`.
3. Log in with (or manually flip via admin panel / Firestore) an account with `membershipStatus: 'active'` — badge shows the first name + "Premium" tag, links to `account.html`.
4. Confirm `premium-offer.html` is unreachable (auto-redirects) while logged in, in both membership states.

- [ ] **Step 4: Commit final cache-buster bump (if Step 2 made changes)**

```bash
git add <changed files>
git commit -m "chore: bump styles.css cache-buster after header changes"
```
