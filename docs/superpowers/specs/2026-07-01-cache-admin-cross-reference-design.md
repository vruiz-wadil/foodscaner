# Cache Admin: Name/Barcode Cross-Reference

Follow-up to [2026-06-30-unified-cache-admin-design.md](2026-06-30-unified-cache-admin-design.md).

## Problem

The unified Cache tab shows Productos rows with only the barcode, and
Análisis IA rows with only the product name. Neither list shows both
pieces of identifying info, making it hard to tell if a product's cache
and its AI analysis cache are the same item.

## Goal

- Productos rows: also show the product name.
- Análisis IA rows: also show the barcode(s), resolved best-effort by
  matching name+brand against the currently cached products. AI cache
  stays keyed by name+brand (not barcode) — this is a display
  enrichment only, not a schema change.

## Design

### Backend (`api/index.js`, `GET /api/admin/cache-all`)

1. While building the `product` list, also read `name`/`brand` off each
   entry's cached response (`entry.response.product` for L1,
   `item.data.response.product` for L2). Support both field shapes:
   OFF (`product_name`, `brands`) and local sources (`name`, `brand`).
   Add `name` to each product item in the response.
2. Build an in-memory lookup:
   `normalize(name) + "|" + normalize(brand) -> [barcode, ...]`
   from the product list just built. `normalize = s => (s||'').toLowerCase().trim()`.
3. While building the `ai` list, split each entry's `key` on `|` to get
   `[name, brand, ...]` (same order the key was built with — no new
   parsing logic, key format is unchanged). Look up in the map from
   step 2 and attach `barcodes: string[]` (empty array if no match).

No schema change, no new collection, no change to how AI cache keys are
generated or matched for cache hits — this only adds fields to the existing
`GET /api/admin/cache-all` response.

### Frontend (`admin/admin.js`, `renderCacheAll`)

- Productos row: add a second line under the barcode showing `item.name`
  (fall back to nothing if empty, same as today's missing fields).
- Análisis IA row: add a line showing `item.barcodes.join(', ')` or `—`
  if empty.
- Filter input: extend the `ai` filter predicate to also match against
  `item.barcodes` (joined string), so typing a barcode finds its AI
  analysis too.

## Testing

- Manual: open admin → Cache tab → verify Productos rows show name,
  Análisis IA rows show barcode when a matching product is cached,
  `—` when not. Filter by barcode and confirm it surfaces both the
  product row and its matching AI row.
- No automated tests exist for the admin panel today; none added
  (matches existing coverage for this file).

## Files Changed

| File | Change |
|------|--------|
| `api/index.js` | `GET /api/admin/cache-all`: add `name` to product items, add `barcodes` to ai items via name+brand lookup |
| `admin/admin.js` | `renderCacheAll()`: show name on product rows, show barcode(s) on ai rows, extend filter |
