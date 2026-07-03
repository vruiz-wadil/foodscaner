# Yomi Admin — UI/UX Architecture Audit

**Date:** 2026-07-03
**Author:** ArchitectUX (technical architecture / UX review)
**Scope:** `admin/index.html` (inline `<style>` block + markup), `admin/admin.js` (all render/interaction logic), shared `styles.css` (design-token source)
**Method:** Static read of both files in full, cross-referenced against class usage (grep), and against recent feature history (cache admin, scan-log card redesign, duration badge) to separate settled patterns from drift.
**Framing:** This is a working internal tool for one admin, used occasionally. The bar is not "production consumer app polish" — it's "will the next feature land cleanly, and can the admin find what they need in under 10 seconds." Findings are graded against that bar, not a marketing-site standard.

---

## 1. CSS architecture findings

### What's solid

- **Token reuse is correct and should stay.** The admin panel pulls every color, radius, and font from `styles.css`'s `:root` variables (`--paper`, `--ink`, `--border`, `--chile`/`--chile-light`/`--chile-border`, `--surface`, `--text-muted`, `--font-mono`, `--font-display`, `--green`, `--accent-primary`) instead of hardcoding a parallel palette. This is the single most important thing keeping this codebase from fragmenting — do not touch it. Any future admin feature should keep doing this.
- **The `!important` overrides at the top of the admin `<style>` block** (`body { display: block !important; ... }`) are a deliberate, narrow escape hatch to neutralize a body-level flex layout meant for the public app shell. Confined to three properties, on `body` only — this is a defensible, contained override, not architecture rot.
- **The `.tab-btn` / `.btn-view` / `.btn-del` primitives** are consistently reused across every tab's render function — no tab invents its own button styling. This is good discipline.

### What's drifting

- **The single inline `<style>` block (~140 lines, `index.html:10-141`) is at the edge of "still fine," not comfortably inside it.** It currently covers: layout shell, tabs, toolbar, generic doc-list rows, login overlay, generic modal, a *legacy* logs table, scan cards, a *dead* legacy log-expansion table, cache-tab cards, a confidence tooltip, and the entire Resumen/stats dashboard (stat cards, bar chart, breakdown bars). That's eight-plus distinct UI subsystems in one unstructured block with only comment dividers (`/* Logs table */`, `/* Cache tab */`, etc.) holding it together. It's not unmanageable today, but it has already grown by roughly a third in recent sessions (cache tab, scan cards, tooltip all landed in the last few days) — extrapolate one or two more features and comment-divider discipline stops being enough to navigate it.
- **Naming has started to drift from what it describes.** `.log-badge` (`index.html:77-80`) was named when logs rendered as a table; it's now the badge system for scan-log *cards* — the class name still reads fine because "log" still means scan logs, so this one is a non-issue, contrary to the brief's suggestion it might be confusing. The more real drift is `.log-table` (`index.html:68-74`): it's used for the **Reportes table** (`admin.js:199`) *and* the **Top Productos stats table** (`admin.js:70`) — neither of which is a "log" in the scan_logs sense. The class has quietly become "generic data table," which works, but the name actively misleads the next person who greps for "where do logs render" and finds two unrelated views.
- **Confirmed dead CSS** (`index.html:97-101`): `.log-row`, `.log-pname`, `tr.log-detail td`, `.log-detail-grid`. Verified by grep against `admin/admin.js` — zero references. These were the click-to-expand table-row styles from the July 1 "expandable detail rows" feature, superseded by the July 2 card-based rewrite (`.scan-card` / `.scan-card-detail`). The comment above them (`/* Logs expandibles */`) is now actively wrong — it describes a mechanism that no longer exists. Safe to delete outright.
- **Two near-identical "card" treatments exist without being unified.** `.doc-item` (`index.html:38`) and `.scan-card` (`index.html:82`) share the exact same box treatment — `border: 2px solid var(--border); border-radius: var(--radius-sm); background: var(--paper); box-shadow: 2px 2px 0 var(--border)` — repeated verbatim rather than factored into a shared base class. `.scan-card` only adds `cursor: pointer` and a hover border-color transition on top. This isn't a case of "meaningfully different, fine to duplicate" — it's the same design decision written twice, and a future change to the card look (e.g., adjusting the shadow offset) requires remembering to edit it in two places. `.cache-section` (`index.html:103`) is not a third card variant — it's a heading wrapper around a list of ordinary `.doc-item`s, so no drift there.

### Verdict

Foundation is not broken, but it's no longer "one glance and you understand it." The dead-code removal is a five-minute, zero-risk cleanup. The `.doc-item`/`.scan-card` consolidation and the `.log-table` rename are small, mechanical, and worth doing *before* the next tab lands — not urgent enough to block anything today.

---

## 2. Information architecture findings

The six tabs (Resumen, Logs, Reportes, OCR ingredientes, OCR nutrición, Cache) map cleanly onto six genuinely distinct data concerns — this is still the right shape, not a candidate for splitting or merging. Nothing here suggests two tabs are secretly one feature or one tab is secretly two.

The friction is structural, not navigational: **every tab funnels into one shared `#doc-list` div, and `currentCol` (a bare string) is the sole thing distinguishing rendering and loading behavior**, via scattered `if (currentCol === 'resumen')` / `if (currentCol === 'cache')` / `if (currentCol === 'scan_logs')` checks spread across `loadStats`, `loadCollection`, `renderList`, the tab-click handler, and the filter-input handler (`admin.js:127-179, 205-368`). Concretely:

- Whether a tab shows the filter toolbar is a hardcoded `currentCol === 'resumen'` check (`admin.js:134`).
- Whether a tab paginates is implicit in whether its branch in `loadCollection` sets `nextPageToken` (cache and resumen don't; everything else does).
- Which render function runs is a manual if/else chain in `renderList` (`admin.js:354-355`) rather than a lookup.
- What the filter searches is a different hand-written predicate per tab (`admin.js:342-350`), and the cache tab's filter is an entirely separate code path (`renderCacheAll`'s own filtering, `admin.js:207-209`) rather than going through `renderList` at all.

This has worked for six tabs because each new tab's author (recent-session-you) hand-added one more branch each place. It will not degrade gracefully into a seventh — every new tab currently costs a scattered edit in five different functions instead of one declarative registration. This is the single highest-leverage structural change available (see Recommendation #4) and is worth doing before, not after, the next tab is added.

---

## 3. Interaction pattern findings

- **Delete confirmation is genuinely consistent**: every delete path (`doc-item`, `scan-card`, `cache` entries) routes through native `confirm()` with a description of what's being deleted, and every delete button shows a disabled "…" state during the request (`admin.js:401-428`). No tab reinvents this — good, keep it as-is; a custom confirm modal would be over-engineering for a single-operator tool.
- **The filter input is the sharpest real friction point for routine admin use, and it's a data-completeness bug, not a polish issue.** `filterInput` only searches `allItems` — the client-side array of *already-paginated-in* results (`admin.js:339-351`). It does not query the server. For Reportes and OCR tabs (small collections) this is invisible. For `scan_logs` — the collection the earlier SRE audit already flagged as heading into the thousands within weeks-to-months — an admin trying to find "the scan log for barcode X from three days ago" will get **zero results** if that log hasn't been paged in yet, with no indication that the search is scoped to "what happened to be loaded," not "everything." This will misfire in exactly the routine-check scenario this tool exists for (a user reports a bad scan; admin searches by barcode; nothing found; admin doesn't know to distrust the empty result). This is a bigger deal than typical cosmetic filter inconsistency because it can produce a **false negative that looks like a true negative.**
- **The filter placeholder text is static and tab-agnostic** (`"Filtrar por ID / código de barras…"`, `index.html:184`) regardless of which tab is active, but each tab's filter predicate searches different fields — scan_logs matches barcode/IP/OS/product name/cache level/source; reports matches barcode/category/comment; OCR tabs match *only* the document ID; cache matches barcode/name/source or key/displayName/model/barcodes. The placeholder overpromises for the OCR tabs (implies barcode search works there; it doesn't) and underpromises for scan_logs (doesn't mention it also matches OS or cache level). Small, but it's the kind of thing that erodes trust in the search box over repeated use.
- **Expand/collapse only exists on scan-log cards.** Reportes still renders as a plain table with a `Ver` button opening the generic JSON modal, while scan_logs got the richer inline-expand treatment. Given both are "review one record, maybe take a moderation action" workflows, the asymmetry isn't wrong, but it does mean the admin has learned two different interaction habits for adjacent tasks — click-to-expand here, click-Ver-open-modal there — with no signal in the UI for which one a given tab uses until you try it.
- **Pagination is a manual "Cargar más" click with no bulk option** ("load all," "jump to date," page-size control). Fine at current volumes; becomes the more visible half of the filter problem above once `scan_logs` volume grows — an admin who has learned "the search doesn't find things" may start reflexively clicking "load more" repeatedly instead, which does not scale better.

---

## 4. Responsive / accessibility findings

- **The `@media (max-width: 720px)` breakpoint (`index.html:23-30`) correctly handles the sidebar** (collapses to a horizontal scrollable strip) and reduces `.main-area` padding — that part is sufficient for its scope.
- **It does not touch the data tables.** `.log-table` (used for Reportes and for the Resumen "Top productos" table) has `th { white-space: nowrap }` and no horizontal-scroll wrapper anywhere in the markup or CSS. A five-column table (Fecha/Código/Categoría/Comentario/Sistema/action) with no-wrap headers on a 375px-wide phone viewport will overflow the viewport with no way to see the cut-off columns short of pinch-zooming. This is a real gap, not a hypothetical one — Reportes is one of the two tabs (with scan_logs) most likely to be checked from a phone during an ad hoc "did anyone report something" check.
- **`.doc-item` uses `display: flex` with no `flex-wrap`**, so a long Firestore auto-ID next to the View/Delete buttons has no defined narrow-viewport behavior — it will either overflow or squeeze the buttons, depending on content length, rather than wrapping predictably.
- **The confidence tooltip (`.conf-tooltip`, `index.html:111-125`) is `:hover`-only** — no `:focus`/`:focus-within` trigger, no `aria-describedby`, and `pointer-events: none` on the tooltip itself confirms it was never wired for keyboard or touch access. On a primarily-mouse admin desktop tool this is low-severity, but it's worth naming honestly: keyboard-only access to that specific piece of information does not currently exist.
- **The JSON-viewer modal has no `Escape`-to-close binding** — only the explicit close button or an overlay click dismiss it (`admin.js:437-438`). Minor, cheap to add, standard modal expectation.
- **No global outline/focus-ring suppression was found** in `styles.css` (checked for `outline: none` / global resets) — buttons and tabs keep the browser's native focus indicator, which is the correct baseline. The one soft spot: `.tab-btn.active` sets a dark `var(--ink)` background, and the browser's default blue focus ring has weak contrast against a background that dark — worth a visual check, not a rebuild.
- **Badge text is small** (`0.68rem`, ~11px) but every badge pairs an emoji icon with the text (🔍, 📷, 📊, 🚩, 💾), so color is never the sole differentiator — this mitigates the usual small-badge-text contrast concern. Not flagging as an issue.

---

## 5. Scalability of the current pattern

Direct answer: **the "one inline `<style>` + one shared `#doc-list` + per-tab render function, dispatched through string comparisons on `currentCol`" pattern held up for six tabs by accretion, not by design, and the accretion cost is now visible** — three render functions (`renderLogs`, `renderReports`, `renderCacheAll`) plus a default inline path in `renderList`, each independently deciding what a "row" looks like, what the filter matches, and whether pagination applies. It is not a "rebuild the admin panel" situation — the primitives (tokens, `.doc-item`, `.tab-btn`, the modal) are sound and reusable. It's specifically the **dispatch layer** (tab metadata, filter predicates, pagination toggling) that has no home of its own and is expressed as scattered conditionals instead.

The concrete evidence this is close to a real cost, not a theoretical one: the last three shipped features (cache admin, scan-log cards, duration badge) each required touching `loadCollection`, `renderList`, the tab-click handler, *and* the CSS block, in different combinations. A seventh tab — or a second view mode on an existing tab — is the point where "just add one more `if`" stops being cheap per-feature and starts being the place bugs hide (e.g., forgetting to reset `lastCacheData` for a new stateful tab, as already had to be special-cased at `admin.js:137`).

---

## 6. Prioritized recommendations

Framing matches the SRE audit's tiering: **Critical** = actively produces wrong behavior or blocks near-term work; **Important** = correct today but the fuse is lit by known growth (scan_logs volume, tab count); **Minor** = optional polish, do opportunistically.

### Critical

1. **Filter-scoped-to-loaded-items on `scan_logs` can produce a false "not found."** (§3) An admin searching for a specific barcode/log gets an empty result indistinguishable from "genuinely doesn't exist" if the matching record hasn't been paged in yet — and `scan_logs` is the collection already flagged as growing into the thousands within weeks-to-months. *Direction: either move the filter to a server-side query (the backend already has `/api/admin/scan_logs` with pagination — add a query param it can filter on) or, as a cheaper interim fix, surface the scope explicitly in the UI (e.g., "Searching N of M loaded records — load more to search further") so an empty result isn't misread as a true negative.*

2. **Remove confirmed-dead CSS**: `.log-row`, `.log-pname`, `tr.log-detail td`, `.log-detail-grid` (`index.html:97-101`), including the now-inaccurate `/* Logs expandibles */` comment. Zero risk, verified zero references in `admin.js`. Doing this now (before the next feature adds a ninth CSS subsystem to the block) keeps the dead-code count from becoming "some of these five leftover-looking rules are dead and some aren't, better check" — which is a worse failure mode than any single dead rule.

### Important

3. **Consolidate `.doc-item` and `.scan-card`'s shared box treatment into one base class**, with `.scan-card` adding only its delta (cursor, hover transition, nested summary/detail). Currently a visual-language change (shadow offset, border weight) requires editing two declarations and hoping they're kept in sync by memory. *Direction: introduce `.list-card` (or similar) carrying the shared border/radius/background/shadow, have both `.doc-item` and `.scan-card` extend it via multiple classes in the markup.*

4. **Replace the scattered `currentCol === '...'` dispatch with a small declarative tab-config object** (`{ resumen: { hasFilter: false, paginate: false, render: renderStats, ... }, scan_logs: { hasFilter: true, paginate: true, render: renderLogs, filterFields: [...] }, ... }`) consumed by `loadCollection`, `renderList`, and the tab-click handler. This is the change that pays for itself on the *next* tab, not this one — right now, adding a tab means finding and editing five separate conditionals; with a config object it means adding one entry. Not urgent in the sense of fixing a current bug, but it is the one change worth doing *before* the next feature lands rather than after, per the pattern of the last three features each touching the same scattered set of places.

5. **Rename `.log-table` or split its two unrelated uses.** It currently serves the Reportes table and the Resumen "Top productos" stats table — neither is a scan log. *Direction: rename to something scope-neutral (`.data-table`) or split into `.reports-table` / `.stats-table` if their needs diverge later. Either resolves the "grep for logs, find two unrelated tables" trap.*

6. **Wrap `.log-table` in an `overflow-x: auto` container** for narrow viewports, and add `flex-wrap: wrap` (or a stacked layout) to `.doc-item` below the existing 720px breakpoint. Reportes and the Resumen stats view are exactly the tabs likely to get an occasional phone check, and both currently have no defined narrow-viewport behavior for their tabular content.

### Minor

7. **Unify the filter-input placeholder per tab** (or make it generic, e.g. "Filtrar…") rather than a static string that overpromises for OCR tabs and underpromises for scan_logs. Cheap, avoids eroding trust in the search box.

8. **Add `Escape`-to-close on the JSON modal.** One `keydown` listener; matches standard modal expectations; currently only close-button/overlay-click work.

9. **Give the confidence tooltip a keyboard/focus path** (`:focus-within` trigger plus `aria-describedby`, or accept it as mouse-only and note that deliberately). Low severity for a single-admin desktop tool, but currently undocumented as an intentional trade-off versus an oversight.

10. **Consider extending scan-log-style expand/collapse to Reportes** for interaction consistency between the two "review-and-moderate" tabs, once (or if) Reportes volume grows enough that the current table+modal pattern feels slower than the card pattern already validated for scan_logs. Not worth doing speculatively — only once Reportes actually accumulates enough volume that the asymmetry is felt, not just noticed.

---

## Summary table

| # | Finding | Tier | Cost if deferred |
|---|---|---|---|
| 1 | Filter only searches loaded (paged-in) items — false negatives on `scan_logs` | Critical | Gets worse as scan_logs grows into the thousands per the existing SRE timeline |
| 2 | Confirmed dead CSS (4 rules + stale comment) | Critical | Cheap now; ambiguous later once more dead code accumulates near it |
| 3 | `.doc-item`/`.scan-card` box treatment duplicated, not shared | Important | Visual-language changes require remembering two edit sites |
| 4 | Tab dispatch is scattered `currentCol` string checks, not declarative config | Important | Each new tab costs 5 scattered edits instead of 1 registration |
| 5 | `.log-table` naming covers two unrelated tables (Reportes, stats) | Important | Misleads future grep-based navigation of the codebase |
| 6 | No horizontal-scroll handling for tables on narrow viewports | Important | Real overflow on the two tabs most likely checked from a phone |
| 7 | Static filter placeholder doesn't match per-tab filter scope | Minor | Minor trust erosion in the search box |
| 8 | No Escape-to-close on modal | Minor | Standard expectation, cheap to add |
| 9 | Confidence tooltip has no keyboard/focus path | Minor | Low severity for single-admin desktop use |
| 10 | Reportes lacks the expand/collapse pattern scan_logs has | Minor | Only worth it once Reportes volume grows |
