# Header membership badge — design

## Problem

The app header (`.app-header`, present on 11 static pages) only shows the logo. There's no persistent, always-visible way for a user to see their login/membership state or get to the upgrade flow — the only entry points today are buried inside specific screens (teaser CTA on the scan result, account.html).

## Goal

A pill/badge fixed in the header's top-right corner (opposite the logo) that serves two purposes depending on session state:

- **Not logged in, or logged in without active membership** — acts as an upgrade CTA.
- **Logged in with active membership (`membershipStatus === 'active'`)** — shows the user's first name and a "Premium" indicator, links to `account.html`.

## Approach

A shared ES module, `header-badge.js`, following the existing `nav.js` pattern (a small script imported via `<script type="module">` on every page that has the shared header, rather than duplicating logic per page). It reads session state through the existing `authClient` global (`window.authClient` / `authClient.onAuthChange` / `authClient.getCachedProfile()`) — no new auth plumbing needed.

Rejected alternatives:
- Duplicating the badge markup/logic in each of the 11 pages — violates the project's existing single-shared-module pattern (`nav.js`) and multiplies maintenance risk.
- Server-side rendering the pill — the project has no templating/SSR layer; everything is static HTML hydrated client-side.

## Header layout change

`.app-header` currently:
```css
.app-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 28px 20px 16px;
}
```

Changes to a row layout so the badge sits opposite the logo:
```css
.app-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 28px 20px 16px;
}
```
The existing `.logo-area` (logo + optional tagline) becomes the row's left child; the new badge element is the right child. `.tagline`, where present, keeps wrapping under the logo inside `.logo-area` — untouched.

## Badge markup

Added once per page, inside `<header class="app-header">`, right after the logo:

```html
<a href="#" id="header-badge" class="header-badge hidden" aria-live="polite"></a>
```

Starts `hidden` (a CSS class, `display:none`) so there's no flash of wrong/empty state before `authClient` resolves the session (`firebaseAuth.authStateReady()` already handles this same race for the rest of the app — see `authClient.js`).

## States

| Session state | Content | `href` |
|---|---|---|
| No session | "Hazte Premium" + star/crown icon | `premium-offer.html` |
| Session, `membershipStatus !== 'active'` | "Hazte Premium" + star/crown icon | `onboarding-membership.html` |
| Session, `membershipStatus === 'active'` | First name (first whitespace-delimited token of `profile.displayName`; falls back to the local-part of `email` before `@`; falls back to `"Cuenta"` if neither exists) + "Premium" indicator (crown icon + small "Premium" label) | `account.html` |

`header-badge.js` re-renders on every `authClient.onAuthChange` firing (covers login, logout, and the auto-sync that already runs after any auth state change) and once eagerly on `DOMContentLoaded` using whatever `authClient.getCachedProfile()` already has cached, to avoid waiting on a network round trip if a profile is already cached from a previous sync this session.

## Visibility exceptions per page

- **`premium-offer.html`**: badge always hidden — the whole page is itself the CTA render target.
- **`account.html`**: badge stays visible when logged in with active membership (links to itself — harmless, keeps the pattern uniform across pages rather than special-casing removal).
- All other 9 pages with `.app-header` (`index.html`, `scan.html`, `history.html`, `auth.html`, `onboarding-membership.html`, `onboarding-profile.html`, `preferences.html`, `privacidad.html`, `reset-password.html`, `terminos.html`, `verify-email.html`): badge follows the table above unconditionally.

## `premium-offer.html` access guard

Per the existing README description, `premium-offer.html` is meant only for anonymous (no-session) visitors — logged-in users, regardless of membership status, should never land there; they belong on `account.html` (if already a member, no reason to see pricing again) or `onboarding-membership.html` (if not yet a member, that's the logged-in equivalent).

Add a guard at the top of `premium-offer.html`'s page script:

```js
await firebaseAuth.authStateReady();
if (firebaseAuth.currentUser) {
  window.location.replace('account.html');
}
```

To avoid a flash of pricing content before the redirect fires, the page body starts with `visibility: hidden` (inline style or a class), removed only after the guard determines there's no session to redirect. This mirrors the existing hidden-until-resolved pattern already used for the header badge itself.

## Styling

Reuses existing design tokens (`--ink`, `--paper`, accent colors already defined in `styles.css` for badges/pills — see `.badge`, `.badge-food` for the existing pill visual language). New rules added to `styles.css`:

```css
.header-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
}
.header-badge.hidden { display: none; }

/* CTA variant (no active membership) */
.header-badge.cta {
  background: var(--ink);
  color: var(--paper);
}

/* Premium member variant */
.header-badge.premium {
  background: var(--amber, #C87B0B);
  color: var(--paper);
}
```

Exact color/icon choice is implementation-time judgment within these two variants — no further design decision needed, this is cosmetic polish within an already-established two-state visual system (CTA = high-contrast ink pill, Premium = amber accent pill, consistent with the amber accent already used for warnings/highlights elsewhere per the README's design-system palette).

## Testing

- Unit tests (Vitest, following the existing `tests/*-ui.test.js` pattern that evals extracted frontend functions) for the pure logic pieces of `header-badge.js`: given a profile object (or `null`), what content/href/class does the badge render — covering all 3 states plus the missing-displayName fallback chain.
- A test for the `premium-offer.html` guard: given a logged-in `firebaseAuth.currentUser`, confirms `window.location.replace('account.html')` is called; given no user, confirms it isn't and the page becomes visible.

## Out of scope

- No changes to `onboarding-membership.html` or `account.html` content itself — only new incoming links to them.
- No changes to the existing scan-result teaser CTA or its own membership-gate logic — this badge is an additional, always-visible entry point, not a replacement.
- No i18n — copy is Spanish-only, consistent with the rest of the app.
