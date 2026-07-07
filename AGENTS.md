# Yomi — Food Scanner PWA

## Project Overview
Food barcode scanner web app. Scans barcodes → fetches nutritional data from OFF/USDA → displays ingredients, gluten, allergens, calories, and 7 AI provider analyses.

## Stack
- **Frontend**: Vanilla JS, CSS, HTML (no framework)
- **Backend**: Vercel Serverless (Node.js)
- **Database**: Firebase Firestore (L2 cache)
- **AI Providers**: Groq, OpenRouter (GPT-4o-mini, Gemini), local analysis
- **Barcode Detection**: BarcodeDetector API + ZBar WASM (4 decoders parallel)

## URLs
- Production: `https://www.yomi.mx`
- GitHub: `https://github.com/vruiz-wadil/foodscaner`
- Vercel Project: `wadil-ai-studio-s-projects/foodscaner`

## Environment Variables
- `GROQ_API_KEY` — Groq (GPT-OSS 120B, GPT-OSS 20B)
- `OPENROUTER_API_KEY` — OpenRouter (GPT-4o-mini, Gemini)
- `GEMINI_API_KEY` — Google Gemini
- `USDA_API_KEY` — USDA FoodData Central
- `FIREBASE_SERVICE_ACCOUNT_KEY` — Firebase service account JSON

## Architecture

### Key Files
```
api/index.js          — Main API: product lookup, AI analysis, cache (L1 memory + L2 Firestore)
api/firestore.js      — Firestore REST API (JWT assertion, no gRPC)
app.js                — Scanner engine: 4 decoders, preprocessImage, motion detection, traffic-light UX
scan.html             — Scanner UI (no SW registration to avoid WASM conflicts)
index.html            — Home page + SW registration
home.js               — Home page logic (recent products, navigation)
styles.css            — Scanner styles (traffic-light states, scan-frame overlay)
home.css              — Home page styles
sw.js                 — Service worker (cache-first static, network-first API)
manifest.json         — PWA manifest
assets/icons/         — Favicon SVG + PNGs (generated via sharp)
```

### Scanner (app.js)
- **4 decoders in parallel**: BarcodeDetector×2 (1200px + 500px) + ZBar×2 (1200px + 500px)
- **preprocessImage()**: Grayscale + histogram stretching for contrast
- **Motion detection**: <2% frame change → skip (disabled first 3s warm-up)
- **Throttle**: Process every 2nd frame
- **AudioContext**: Reused (not created per beep)
- **Traffic-light UX**: `setScanState('scanning'|'detecting'|'failed'|null)`
  - Scanning: amber pulse (border + scan-frame corners)
  - Detected: green flash 300ms
  - Failed: red flash 500ms
- **Dynamic timeout**: 15s → "Ingresa manualmente"; 3 failures → "Código dañado"
- **ZBar retry**: Every 5s (Safari iOS WASM fails with "aborted")

### API (api/index.js)
- `GET /api/product/:barcode` — Product lookup (OFF → USDA → GTINHub fallback)
- `GET /api/ai-query?barcode=XXX&provider=groq|openrouter|gemini` — AI analysis
- `DELETE /api/cache/:barcode` — Clear L1+L2 cache
- `GET /api/admin/cache-all` — Unified cache view (L1+L2 merged by barcode)
- `DELETE /api/admin/cache-all/:type/:key?layer=l1|l2|all` — Delete cache entry
- **Rate limit**: 30 req/min/IP (express-rate-limit)
- **Barcode validation**: 8-14 digits only
- **Provider chain**: Sequential (tryProvider recursive), returns `{ content, model }`
- **XSS sanitization**: `esc()` helper on all AI output
- **detectGluten()**: Trusts "sin gluten" claims in product name before keyword matching

### Cache
- **L1**: `memoryCache` / `memoryAiCache` (in-memory objects, ephemeral per Vercel instance)
- **L2**: Firestore (`product_cache` / `ai_cache` collections, nam5 region)
- **TTLs**: OFF 1h/24h, no-OFF 7d, AI cache 24h
- **Cache badge**: 📦 status + 🔄 refresh button (frontend)

### AI Providers
Each returns `{ content, model }`:
1. Groq (GPT-OSS 120B, GPT-OSS 20B)
2. OpenRouter (GPT-4o-mini)
3. OpenRouter (Gemini 2.0 Flash)
4. Gemini (gemini-2.0-flash)

### Tests
- 61 tests (11 API + 50 frontend) via vitest
- Run: `npx vitest run`

## Design Decisions
- ZBar only as fallback (BarcodeDetector native on iOS 16.4+)
- No multi-frame confirmation (caused Edge to never accept)
- Motion detection disabled first 3s (camera warm-up)
- Dual scale (1200+500px) for tiny barcodes
- Allergens: only from explicit ingredients, not brand names
- SW not registered on scan.html (WASM interference)
- `renderNotRecommended()` global function (reused from multiple places)
- Provider model calculated from `req.query` for cache hits
- `detectGluten()` trusts "sin gluten" claims in product name before keyword matching
- Gluten `classification: "declared"` shows as `db-yes` (confirmed) not `ai-yes` (possible)

## Git
- Branch: `master`
- Last commit: `633fd35` (gluten classification 'declared' shows as db-yes)
- Previous: `11806b1` (GTINHub sin gluten classification), `7d4fe7f` (name-based detection)

## PWA
- favicon.svg (teal rounded square + barcode + checkmark)
- 5 PNG icons (16, 32, 192, 512, apple-touch) generated via sharp
- manifest.json (standalone, portrait, #2DBC9E theme)
- sw.js: cache-first static, network-first API
- Service worker only on index.html (not scan.html)

## Pending / Ideas
- Yomi+ subscription ($29/mo) — promo card shown, button disabled
- Analysis and Profile tabs — shown as disabled in nav
- OCR integration — mentioned in Yomi+ promo
- User auth — not yet implemented
