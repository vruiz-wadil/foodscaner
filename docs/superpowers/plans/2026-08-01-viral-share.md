# Compartir Viral (4 de 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing scan-result share more compelling with verdict-specific copy, and add a standalone "invite a friend" CTA to the account page that doesn't require a scanned product.

**Architecture:** Two small changes to `share.js` (classic script, already shared across pages via `window.shareResult`/global functions) plus one new card in `account-ui.js`'s `renderAccountHub()` and one new `<script>` tag in `account.html`. No backend, no new data model.

**Tech Stack:** Vanilla JS, classic (non-module) script for `share.js` — matches its existing pattern.

## Global Constraints

- `buildShareText(name, verdict)` must keep its exact existing signature — `history-ui.js:36` and `app.js:2063` call it indirectly via `shareResult` and must not need changes.
- Verdict-specific copy (exact strings, from spec):
  - `sano`: `` `✅ ${name} está SANO según Yomi. Escanea el tuyo gratis.` ``
  - `regular`: `` `⚠️ ${name}: REGULAR. Yomi te dice por qué en 2 segundos.` ``
  - `evitar`: `` `🚫 ${name} salió EVITAR en Yomi. ¿El tuyo qué dirá?` ``
  - Unknown verdict (defensive fallback, should not happen in production): keep the current generic format using `SHARE_VERDICT_LABELS`.
- New `shareApp(triggerButton)` function reuses existing `copyShareFallback` and `SHARE_BASE_URL` — no duplicated clipboard/Web Share API logic.
- Invite copy (exact, from spec): text `'Yo uso Yomi para saber en 2 segundos si un producto me conviene. Pruébalo tú:'`, URL `` `${SHARE_BASE_URL}/?utm_source=share&utm_medium=invite_friend&utm_campaign=account_invite` ``.
- New account.html card sits between the "Preferencias" card and the "Suscripción" card in `renderAccountHub()`'s template, using the same `.content-card` / `.account-data-label` / `.row-card` classes already used by the surrounding cards (no new CSS needed).
- `account.html` must load `share.js` as a classic script (not a module) — same pattern as `scan.html:676` / `history.html:48` (`<script src="share.js?v=1"></script>`).

---

### Task 1: Verdict-specific share copy in `share.js`

**Files:**
- Modify: `share.js:10-12` (`buildShareText`)
- Test: search for an existing test file covering `share.js` (e.g. `tests/share.test.js`) and add cases there.

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildShareText(name, verdict)` — signature and export (`window.buildShareText`) unchanged, only its internal output changes per verdict.

- [ ] **Step 1: Read the current file**

Read `share.js` in full (56 lines) before editing.

- [ ] **Step 2: Replace `buildShareText`**

Replace `share.js:10-12`:

```js
function buildShareText(name, verdict) {
  return `${name}: ${SHARE_VERDICT_LABELS[verdict]} — descúbrelo tú con Yomi`;
}
```

with:

```js
const SHARE_TEXT_BY_VERDICT = {
  sano: name => `✅ ${name} está SANO según Yomi. Escanea el tuyo gratis.`,
  regular: name => `⚠️ ${name}: REGULAR. Yomi te dice por qué en 2 segundos.`,
  evitar: name => `🚫 ${name} salió EVITAR en Yomi. ¿El tuyo qué dirá?`
};

function buildShareText(name, verdict) {
  const build = SHARE_TEXT_BY_VERDICT[verdict];
  return build ? build(name) : `${name}: ${SHARE_VERDICT_LABELS[verdict] || verdict} — descúbrelo tú con Yomi`;
}
```

- [ ] **Step 3: Search for and extend the existing test file**

Run: `grep -rln "buildShareText\|shareResult" --include=*.test.js tests/`

If found, add 4 cases: `sano`, `regular`, `evitar` each produce the exact new copy above; an unknown/unexpected verdict string falls back to the old generic format without throwing. Follow the existing file's test patterns (this is a classic script, not a module — check how the existing tests load/evaluate it, likely via `new Function` or similar `vm`-style eval, same pattern as `app.test.js`).

If no test file covers `share.js`, do not create a new test framework from scratch — note this as `⚠️ Cannot verify: no existing test infrastructure for share.js` in the report.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all pre-existing tests pass (601 baseline before this task), plus any new cases from Step 3.

- [ ] **Step 5: Commit**

```bash
git add share.js
git commit -m "feat(share): copy especifico por veredicto para compartir resultado"
```

---

### Task 2: "Invita a un amigo" CTA in account.html

**Files:**
- Modify: `share.js` (append `shareApp` function, after `shareResult`/`window.shareResult` at the end of the file)
- Modify: `account-ui.js:274-320` (`renderAccountHub`'s template) and its `wireAccountHubEvents` function
- Modify: `account.html:60-63` (script tags, add `share.js` before the module scripts)
- Test: extend the same test file(s) touched in Task 1 for `shareApp`, and the account-ui test file if one exists (search first) for the new card + button wiring.

**Interfaces:**
- Consumes: `copyShareFallback`, `SHARE_BASE_URL` (both already defined earlier in `share.js`, from Task 1's unchanged surrounding code).
- Produces: `window.shareApp(triggerButton)` — new global, called from `account-ui.js`'s click handler. `#btn-invite-friend` — new button id in the account hub template, consumed only by this task's own wiring code (no other task depends on it).

- [ ] **Step 1: Read the current files for context**

Read `share.js` in full (after Task 1's edit), `account-ui.js:246-330` (`renderAccountHub` and the start of `wireAccountHubEvents`), and `account.html:55-65` (closing script tags).

- [ ] **Step 2: Add `shareApp` to `share.js`**

Append at the end of `share.js`, right after the existing `window.shareResult = shareResult;` line:

```js
const INVITE_TEXT = 'Yo uso Yomi para saber en 2 segundos si un producto me conviene. Pruébalo tú:';
const INVITE_UTM = 'utm_source=share&utm_medium=invite_friend&utm_campaign=account_invite';

async function shareApp(triggerButton) {
  const url = `${SHARE_BASE_URL}/?${INVITE_UTM}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Yomi', text: INVITE_TEXT, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  await copyShareFallback(INVITE_TEXT, url, triggerButton);
}

window.shareApp = shareApp;
```

- [ ] **Step 3: Add the invite card to `renderAccountHub`'s template**

In `account-ui.js`, inside the template literal in `renderAccountHub()` (`account-ui.js:274-320`), insert this new `<div class="content-card">` block immediately after the closing `</div>` of the "Preferencias" card and before the "Suscripción" card's opening `<div class="content-card">`:

```html
    <div class="content-card">
      <div class="account-data-label" style="margin-bottom:10px;">Invita a un amigo</div>
      <div class="row-card">
        <p class="about-text">¿Conoces a alguien a quien le sirva saber qué come? Compártele Yomi.</p>
        <button type="button" id="btn-invite-friend" class="btn btn-secondary">Compartir Yomi</button>
      </div>
    </div>
```

- [ ] **Step 4: Wire the button click**

In `wireAccountHubEvents` (`account-ui.js`, starts at line 325), add:

```js
document.getElementById('btn-invite-friend')?.addEventListener('click', (e) => {
  window.shareApp(e.currentTarget);
});
```

Place it alongside the other button wiring in that function, following its existing style (optional chaining on `getElementById`, same as the rest of the function).

- [ ] **Step 5: Load `share.js` in `account.html`**

In `account.html`, add `<script src="share.js?v=1"></script>` before the `type="module"` script tags (matching the exact placement pattern used in `scan.html:676` and `history.html:48` — classic scripts load before modules in both those files):

```html
  <script src="share.js?v=1"></script>
  <script type="module" src="firebase-init.js"></script>
  <script type="module" src="authClient.js"></script>
  <script type="module" src="account-ui.js"></script>
```

- [ ] **Step 6: Search for and extend existing tests**

Run: `grep -rln "renderAccountHub\|shareApp\|shareResult" --include=*.test.js tests/`

For `share.js`'s test file (from Task 1): add a case verifying `shareApp` calls `navigator.share` with the exact `INVITE_TEXT` and a URL containing `utm_medium=invite_friend`, and falls back to `copyShareFallback` when `navigator.share` is absent (mirror however the existing `shareResult` tests mock `navigator.share`/`navigator.clipboard`).

For an account-ui test file, if one exists: add a case confirming the rendered hub HTML contains `#btn-invite-friend` and that clicking it calls `window.shareApp`.

If no test file covers either target, note this as `⚠️ Cannot verify` in the report, following the established pattern from prior phases in this series.

- [ ] **Step 7: Manual verification**

If a browser/dev server is available: load `account.html` while logged in, confirm the "Invita a un amigo" card renders between Preferencias and Suscripción, click "Compartir Yomi", confirm the share sheet (or clipboard fallback) fires with the invite text. If no browser is available, note this as a concern (same accepted pattern as phases 1-3).

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: all pre-existing tests pass, plus any new cases from Step 6.

- [ ] **Step 9: Commit**

```bash
git add share.js account-ui.js account.html
git commit -m "feat(account): agrega CTA invita a un amigo con compartir generico de la app"
```

---

## Self-Review Notes

- Spec coverage: verdict-specific share copy ✓, `shareApp` reusing existing fallback/URL helpers ✓, new account card in the right position with matching classes ✓, `share.js` load added to `account.html` ✓, no backend/family-account changes ✓.
- No placeholders — full function/HTML bodies given verbatim.
- Type/signature consistency: `buildShareText(name, verdict)` unchanged signature (Task 1) — consumed unchanged by `shareResult` (untouched) and its two existing callers. `shareApp(triggerButton)` (Task 2) is a new, independent entry point, not consumed by Task 1's code.
