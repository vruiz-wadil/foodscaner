# Unified Cache Admin Tab

## Problem

Admin panel has separate `product_cache` and `ai_cache` tabs showing raw Firestore document IDs. User doesn't understand the difference between L1 (memory) and L2 (Firestore) cache, and can't see which layer holds each entry.

## Goal

Single "Cache" tab showing all cached products (L1 + L2 unified by barcode/provider) with clear layer badges and easy delete.

## Architecture

### API Endpoints (api/index.js)

**GET /api/admin/cache-all** (requires admin token)

Returns unified cache view:

```json
{
  "product": [
    {
      "barcode": "5901234567890",
      "source": "off",
      "inL1": true,
      "inL2": true,
      "cachedAt": 1719792000
    }
  ],
  "ai": [
    {
      "key": "Coca-Cola|Coca-Cola FEMSA|Agua, azúcar, ácido...",
      "displayName": "Coca-Cola",
      "model": "Groq: openai/gpt-oss-120b",
      "inL1": true,
      "inL2": false,
      "cachedAt": 1719792000
    }
  ]
}
```

**Note:** AI cache key is NOT barcode-based. Key = `[name|brand|ingredients|sugars|carbs|fiber|isBeverage]`. Same product attributes = same cache entry regardless of barcode. `_model` field in response indicates which provider generated it.

Logic:
- Iterate `Object.keys(memoryCache)` → product L1 entries
- Call `fireListDocs('product_cache')` → product L2 entries
- Merge by barcode: `{barcode, source, inL1, inL2, cachedAt}`
- Same pattern for `memoryAiCache` + `fireListDocs('ai_cache')` → AI entries
- AI key = product attribute composite (not barcode). Extract display name from key (first segment before `|`).
- `response._model` indicates which provider generated the entry

**DELETE /api/admin/cache-all/:type/:key** (requires admin token)

- `:type` = `product` | `ai`
- `:key` = barcode (product) or cache key (ai)
- Query param `?layer=l1|l2|all` (default: `all`)
- `l1` → delete from memory only
- `l2` → delete from Firestore only
- `all` → delete from both (default)

### Admin UI (admin/admin.js + admin/index.html)

**New tab:** "Cache" (replaces `product_cache` and `ai_cache` tabs)

**Two sections:**

1. **📦 Productos** — list of cached products
   - Each row: barcode, source (off/usda), badge `L1` / `L2` / `L1+L2`, cached date, delete button
   - Badge colors: L1 = blue, L2 = green, both = purple

2. **🤖 Análisis IA** — list of cached AI analyses
   - Each row: product name (from key), model/provider (from `_model`), badge `L1` / `L2` / `L1+L2`, cached date, delete button
   - Key truncated to 60 chars in UI (full key shown in modal)

**Delete behavior:**
- Click delete → confirm dialog
- If entry is L1+L2 → delete from both by default
- If entry is L1 only → delete from L1
- If entry is L2 only → delete from L2

**Filter:** same filter input searches across both sections (barcode, provider, source)

### Files Changed

| File | Change |
|------|--------|
| `api/index.js` | Add `GET /api/admin/cache-all`, `DELETE /api/admin/cache-all/:type/:key`. Remove old `product_cache`/`ai_cache` from `validCol` list |
| `admin/index.html` | Replace `product_cache`/`ai_cache` tabs with single "Cache" tab. Add section headers CSS |
| `admin/admin.js` | Add `renderCacheAll()`, handle new tab, delete logic with layer param |

### What Gets Removed

- Tab `product_cache` (replaced by Cache tab)
- Tab `ai_cache` (replaced by Cache tab)
- Old `summaryOf()` won't be used for cache entries (new `renderCacheAll` instead)

## Testing

- `npx vitest run` — existing 61 tests pass (no backend logic changes, only new endpoints)
- Manual: open admin → Cache tab → verify L1/L2 badges → delete entries → verify removed from both layers
