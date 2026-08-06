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
| No session | "Hazte Premium" + outline crown icon | `premium-offer.html` |
| Session, `membershipStatus !== 'active'` | "Hazte Premium" + outline crown icon | `onboarding-membership.html` |
| Session, `membershipStatus === 'active'` | First name (first whitespace-delimited token of `profile.displayName`; falls back to the local-part of `email` before `@`; falls back to `"Cuenta"` if neither exists) + filled/gold crown icon + small "Premium" label | `account.html` |

**Copy & icon rationale (reviewed by copywriting + UI design):** "Hazte Premium" is a direct, ownable action rather than hype-speak ("Upgrade Now"), matching Yomi's trust-first tone — appropriate for a safety tool where celiac/allergy users want confidence, not sales pressure. The Premium-state pill stays minimal (name + icon + label, no exclamation marks or extra flourish) to read as status/belonging rather than another sell. The CTA state uses an **outline** crown and the Premium state uses a **filled/gold** crown — using the same icon filled vs. outline (rather than two different icons) keeps visual continuity between the two states while avoiding the CTA looking like the user is already a member.

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

Reviewed against the actual tokens in `styles.css` (`--ink:#0d3d35` dark teal, `--paper:#eaf9f6` mint, `--chile:#dc2626` red, `--amber:#eab308` gold — these differ from the palette the README describes; the README is stale on this point, `styles.css` is the source of truth). The initial flat-fill draft failed two things the review caught: it didn't match the app's existing flat-sticker card language (2px solid border + offset drop shadow, seen on `.badge-food`, `.dietary-grid-item`), and plain paper-on-amber text fails WCAG AA contrast since amber is itself a light/mid-value color.

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
  box-shadow: 3px 3px 0 var(--ink);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.header-badge:hover,
.header-badge:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 var(--ink);
}
.header-badge.hidden { display: none; }

/* CTA variant (no active membership) — borrows the app's existing
   "act now" warning-red association for urgency */
.header-badge.cta {
  background: var(--chile);
  color: var(--paper);
  border-color: var(--ink);
}

/* Premium member variant — ink-on-amber (not paper-on-amber) fixes the
   contrast failure and reads as a badge/medal, the reward cue an active
   member should get */
.header-badge.premium {
  background: var(--amber);
  color: var(--ink);
  border-color: var(--ink);
}
```

The press-down hover/active state (shadow collapses as the pill translates toward the ink border) mirrors the tappable-button affordance already used elsewhere in the app, so the badge doesn't read as a static label.

## Testing

- Unit tests (Vitest, following the existing `tests/*-ui.test.js` pattern that evals extracted frontend functions) for the pure logic pieces of `header-badge.js`: given a profile object (or `null`), what content/href/class does the badge render — covering all 3 states plus the missing-displayName fallback chain.
- A test for the `premium-offer.html` guard: given a logged-in `firebaseAuth.currentUser`, confirms `window.location.replace('account.html')` is called; given no user, confirms it isn't and the page becomes visible.

## Out of scope

- No changes to `onboarding-membership.html` or `account.html` content itself — only new incoming links to them.
- No changes to the existing scan-result teaser CTA or its own membership-gate logic — this badge is an additional, always-visible entry point, not a replacement.
- No i18n — copy is Spanish-only, consistent with the rest of the app.
