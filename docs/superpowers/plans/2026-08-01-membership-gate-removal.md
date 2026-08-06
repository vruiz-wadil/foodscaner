# Desmontar Gate Forzado de Membresía (1 de 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard paywall in `onboarding-membership.html` with a value/price comparison screen that offers a real "continue without membership" exit, and remove the forced redirect loop in `home.js` that traps unpaid users.

**Architecture:** Pure frontend change across 3 files — no backend/API changes. `onboarding-membership.html` gets a comparison table + explicit price + a new secondary button; `onboarding-membership-ui.js` gets one new click listener; `home.js` drops one line from the onboarding-redirect gate function.

**Tech Stack:** Vanilla JS (ES modules), plain HTML/CSS, no framework.

## Global Constraints

- Price shown: **"$29.90 MXN/mes"** — hardcoded in HTML, not fetched from Stripe (out of scope to make dynamic).
- Comparison table: 5 rows — escaneo por código de barras, veredicto básico, análisis personalizado, escaneo de ingredientes por foto, historial en la nube. First 2 rows checked in both columns; last 3 only in premium column.
- Existing consent checkbox text and `confirmMembershipPayment()` behavior do not change — checkbox only gates the paid button.
- New secondary button "Seguir sin membresía" navigates to `index.html` directly, no checkbox gate.
- `home.js`: keep the incomplete-profile redirect (`onboarding-profile.html`); remove only the `membershipStatus === 'pending'` redirect line.
- `account.html` "Activar membresía" / "Renovar membresía" buttons: no changes (out of scope, already correct per spec).
- `api/index.js` payment handler/webhooks: no changes (out of scope).

---

### Task 1: Comparison table + price + skip button in `onboarding-membership.html`

**Files:**
- Modify: `onboarding-membership.html:26-37` (section-heading + content-card block)
- Modify: `onboarding-membership.html:15-18` (inline `<style>` block, add table styles)

**Interfaces:**
- Produces: `#btn-skip-membership` button id, consumed by Task 2's new listener.
- Produces: table has no id/JS hooks — pure static markup, no other task reads it.

- [ ] **Step 1: Replace the heading/copy and add table + price + skip button**

Replace lines 26-37 with:

```html
      <section class="section-heading">
        <h1 class="heading-title">Activa tu membresía</h1>
        <p class="heading-sub">Compara lo que obtienes gratis vs. con Yomi Premium.</p>
      </section>
      <div class="content-card">
        <table class="membership-compare">
          <thead>
            <tr>
              <th></th>
              <th>Gratis</th>
              <th>Premium</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Escaneo por código de barras</td>
              <td>✓</td>
              <td>✓</td>
            </tr>
            <tr>
              <td>Veredicto básico</td>
              <td>✓</td>
              <td>✓</td>
            </tr>
            <tr>
              <td>Análisis personalizado</td>
              <td></td>
              <td>✓</td>
            </tr>
            <tr>
              <td>Escaneo de ingredientes por foto</td>
              <td></td>
              <td>✓</td>
            </tr>
            <tr>
              <td>Historial en la nube</td>
              <td></td>
              <td>✓</td>
            </tr>
          </tbody>
        </table>
        <p class="membership-price">$29.90 MXN/mes</p>
        <label class="consent-block">
          <input type="checkbox" id="pay-checkbox">
          Acepto pagar la membresía. Se te redirigirá a Stripe para completar el pago de forma segura.
        </label>
        <button type="button" id="btn-confirm-payment" class="btn btn-primary"><img src="assets/redesign/icon-stripe.svg" alt="" class="btn-icon">Suscribirme — $29.90/mes</button>
        <button type="button" id="btn-skip-membership" class="btn btn-secondary">Seguir sin membresía</button>
        <p id="membership-error" class="hidden" role="alert"></p>
      </div>
```

- [ ] **Step 2: Add table CSS to the inline `<style>` block**

Replace lines 15-18 with:

```html
  <style>
    .hidden{display:none!important}
    .consent-block { display: block; border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin: 12px 0; background: #fafafa; }
    .membership-compare { width: 100%; border-collapse: collapse; margin: 8px 0; }
    .membership-compare th, .membership-compare td { padding: 8px; text-align: center; border-bottom: 1px solid #eee; }
    .membership-compare th:first-child, .membership-compare td:first-child { text-align: left; }
    .membership-price { font-size: 1.25rem; font-weight: 700; text-align: center; margin: 8px 0 16px; }
  </style>
```

- [ ] **Step 3: Verify `.btn-secondary` exists in shared styles**

Run: `grep -n "btn-secondary" "home.css" "styles.css"`
Expected: at least one match. If none, add a minimal rule to the inline `<style>` block instead: `.btn-secondary { background: #fff; border: 1px solid #ccc; color: #333; }`

- [ ] **Step 4: Open the page in a browser and visually confirm table, price, and both buttons render**

Run: open `onboarding-membership.html` via local dev server, confirm no console errors.

- [ ] **Step 5: Commit**

```bash
git add onboarding-membership.html
git commit -m "feat(onboarding): show plan comparison, price, and skip option on membership screen"
```

---

### Task 2: Wire "Seguir sin membresía" button in `onboarding-membership-ui.js`

**Files:**
- Modify: `onboarding-membership-ui.js:37-41` (`DOMContentLoaded` listener block)

**Interfaces:**
- Consumes: `#btn-skip-membership` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the skip-button listener**

Replace lines 37-41 with:

```js
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-confirm-payment')?.addEventListener('click', () => {
    confirmMembershipPayment().catch(() => {});
  });
  document.getElementById('btn-skip-membership')?.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
});
```

- [ ] **Step 2: Manually verify in browser**

Click "Seguir sin membresía" on the onboarding-membership screen → confirm navigation to `index.html`, confirm `confirmMembershipPayment()` still fires correctly on the primary button (existing behavior unchanged).

- [ ] **Step 3: Commit**

```bash
git add onboarding-membership-ui.js
git commit -m "feat(onboarding): wire skip-membership button to navigate to index"
```

---

### Task 3: Remove forced membership redirect loop in `home.js`

**Files:**
- Modify: `home.js:83-88` (`redirectTargetForIncompleteOnboarding`)

**Interfaces:**
- Consumes: none new.
- Produces: none new — behavior-only change to an existing function.

- [ ] **Step 1: Remove the membershipStatus redirect line**

Replace lines 83-88:

```js
function redirectTargetForIncompleteOnboarding(profile) {
  if (!profile) return null;
  if (!profile.profile || !profile.profile.completedAt) return 'onboarding-profile.html';
  if (profile.membershipStatus === 'pending') return 'onboarding-membership.html';
  return null;
}
```

with:

```js
function redirectTargetForIncompleteOnboarding(profile) {
  if (!profile) return null;
  if (!profile.profile || !profile.profile.completedAt) return 'onboarding-profile.html';
  return null;
}
```

- [ ] **Step 2: Check for existing tests covering this function**

Run: `grep -rn "redirectTargetForIncompleteOnboarding" --include=*.test.js .`
If a test asserts the old `'pending'` → `'onboarding-membership.html'` redirect, update it to assert `null` is returned for a `pending` profile with a completed base profile.

- [ ] **Step 3: Run the test suite**

Run: `npm test` (or the project's configured test command — check `package.json` scripts)
Expected: PASS, no regressions.

- [ ] **Step 4: Manually verify the loop is gone**

In browser/dev environment: create or use an account with `profile.completedAt` set and `membershipStatus: 'pending'`, load `index.html` directly. Confirm it no longer redirects to `onboarding-membership.html`.

- [ ] **Step 5: Commit**

```bash
git add home.js
git commit -m "fix(home): stop forcing pending-membership users back to paywall screen"
```

---

## Self-Review Notes

- Spec coverage: HTML comparison table ✓ (Task 1), price ✓ (Task 1), skip button + wiring ✓ (Tasks 1-2), home.js redirect removal ✓ (Task 3), account.html/api unchanged ✓ (not touched by any task).
- No placeholders — all steps contain literal code/diffs.
- `#btn-skip-membership` id consistent between Task 1 (produced) and Task 2 (consumed).
