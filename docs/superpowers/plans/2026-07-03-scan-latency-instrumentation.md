# Scan Latency Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture scan latency (`durationMs`) in `scan_logs` for every `/api/product/:barcode` request, correlated with the already-captured `cacheLevel`, to inform a future `maxDuration`/timeout decision.

**Architecture:** Extend the existing `fireMarkScanSources` (added for the ipquery.io geo integration) with a 6th parameter `durationMs`, written as one more field in the same Firestore PATCH — no new write, no new function. `api/index.js` captures a `_reqStart` timestamp at request start and passes `Date.now() - _reqStart` at each of the 9 existing call sites. `admin/admin.js` renders the value as a badge on the existing scan-log card.

**Tech Stack:** Node/Express CommonJS, Firestore REST API, vanilla JS/CSS, Vitest.

## Global Constraints

- Reuse the existing `fireMarkScanSources` function — do not create a second Firestore write per scan.
- Firestore REST `integerValue` must be passed as a **string** (e.g. `"1234"`), not a JS number.
- `durationMs` defaults to `0` if omitted (backward-compat safety net — no caller should omit it after this plan, but the default avoids `undefined` reaching the Firestore payload).
- Old `scan_logs` docs without `durationMs` must not break the admin UI — the duration badge is omitted for those, not shown as `0s` or `NaN`.
- No new dependencies. No `maxDuration`/`vercel.json` changes — those are explicitly out of scope for this plan (spec: `docs/superpowers/specs/2026-07-03-scan-latency-instrumentation-design.md`).
- No dedicated unit test for `fireMarkScanSources` — matches the existing convention for this function and its siblings (`fireMarkScanSource`, `fireMarkScanConfidence`), which are validated via syntax-check + full-suite regression only, not per-function unit tests.

---

### Task 1: Backend — capture and persist `durationMs`

**Files:**
- Modify: `api/firestore.js` (`fireMarkScanSources` function, `fireListDocs` field exposure)
- Modify: `api/index.js` (request-start capture, 9 call sites)

**Interfaces:**
- Produces: `fireMarkScanSources(id, sources, cacheLevel, ingredientSource, nutritionSource, durationMs = 0)` — 6th parameter added, backward-compatible (existing 5-arg calls still work since `durationMs` defaults to `0`). `fireListDocs` results expose `data.durationMs` (integer, `undefined` if the underlying doc predates this change).
- Consumes (Task 2 depends on this): `item.data.durationMs` — `number | undefined`, milliseconds.

- [ ] **Step 1: Extend `fireMarkScanSources` in `api/firestore.js`**

Find the current function (added in the ipquery.io integration):

```js
async function fireMarkScanSources(id, sources, cacheLevel = 'none', ingredientSource = '', nutritionSource = '') {
  const token = await getAccessToken(); if (!token) return;
  const arr = (sources || []).map(s => ({
    mapValue: { fields: {
      source: { stringValue: s.source || '' },
      found: { booleanValue: !!s.found }
    }}
  }));
  const fields = {
    _sourcesTried: { arrayValue: { values: arr } },
    _cacheLevel: { stringValue: cacheLevel },
    _ingredientSource: { stringValue: ingredientSource },
    _nutritionSource: { stringValue: nutritionSource }
  };
  const mask = '?updateMask.fieldPaths=_sourcesTried&updateMask.fieldPaths=_cacheLevel&updateMask.fieldPaths=_ingredientSource&updateMask.fieldPaths=_nutritionSource';
  fetch(docPath('scan_logs', id) + mask, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(5000)
  }).catch(() => {});
}
```

Replace it with:

```js
async function fireMarkScanSources(id, sources, cacheLevel = 'none', ingredientSource = '', nutritionSource = '', durationMs = 0) {
  const token = await getAccessToken(); if (!token) return;
  const arr = (sources || []).map(s => ({
    mapValue: { fields: {
      source: { stringValue: s.source || '' },
      found: { booleanValue: !!s.found }
    }}
  }));
  const fields = {
    _sourcesTried: { arrayValue: { values: arr } },
    _cacheLevel: { stringValue: cacheLevel },
    _ingredientSource: { stringValue: ingredientSource },
    _nutritionSource: { stringValue: nutritionSource },
    _durationMs: { integerValue: String(durationMs) }
  };
  const mask = '?updateMask.fieldPaths=_sourcesTried&updateMask.fieldPaths=_cacheLevel&updateMask.fieldPaths=_ingredientSource&updateMask.fieldPaths=_nutritionSource&updateMask.fieldPaths=_durationMs';
  fetch(docPath('scan_logs', id) + mask, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(5000)
  }).catch(() => {});
}
```

- [ ] **Step 2: Expose `durationMs` in `fireListDocs`**

Find the block that exposes `cacheLevel`/`ingredientSource`/`nutritionSource` (added in the ipquery.io integration, near where `sourcesTried` is parsed):

```js
    if (parsed && d.fields?._cacheLevel?.stringValue) parsed.cacheLevel = d.fields._cacheLevel.stringValue;
    if (parsed && d.fields?._ingredientSource?.stringValue) parsed.ingredientSource = d.fields._ingredientSource.stringValue;
    if (parsed && d.fields?._nutritionSource?.stringValue) parsed.nutritionSource = d.fields._nutritionSource.stringValue;
```

Add immediately after it:

```js
    if (parsed && d.fields?._durationMs?.integerValue) parsed.durationMs = parseInt(d.fields._durationMs.integerValue, 10);
```

- [ ] **Step 3: Capture `_reqStart` in `api/index.js`**

Find where `_scanLogId` is created inside `app.get('/api/product/:barcode', ...)`:

```js
    const _scanLogId = String(1e16 - Date.now()).padStart(16, '0') + '_' + Math.random().toString(36).slice(2, 8);
```

Add immediately before it:

```js
    const _reqStart = Date.now();
```

- [ ] **Step 4: Update all 9 `fireMarkScanSources` call sites in `api/index.js`**

Each call site gets `Date.now() - _reqStart` appended as the final argument. The current call sites (verify each still matches this exact text before replacing — if any differs, stop and report rather than guessing):

```js
// site 1 (cache hit, fresh OFF)
fireMarkScanSources(_scanLogId, [], cacheLevel, '', '');
// becomes
fireMarkScanSources(_scanLogId, [], cacheLevel, '', '', Date.now() - _reqStart);
```

```js
// site 2 (cache hit, OFF unchanged after freshness check)
fireMarkScanSources(_scanLogId, [], cacheLevel, '', '');
// becomes
fireMarkScanSources(_scanLogId, [], cacheLevel, '', '', Date.now() - _reqStart);
```

```js
// site 3 (cache hit, non-OFF fallback TTL)
fireMarkScanSources(_scanLogId, [], cacheLevel, '', '');
// becomes
fireMarkScanSources(_scanLogId, [], cacheLevel, '', '', Date.now() - _reqStart);
```

(Sites 1-3 are textually identical — `replace_all` is not safe here since each is a distinct call in a distinct code block; edit each occurrence individually in its surrounding context.)

```js
// site 4 (USDA direct hit)
fireMarkScanSources(_scanLogId, sourceResults, 'none', 'db', 'db');
// becomes
fireMarkScanSources(_scanLogId, sourceResults, 'none', 'db', 'db', Date.now() - _reqStart);
```

```js
// site 5 (bestResult: OFF/USDA/UpcItemDb with OCR enrichment)
fireMarkScanSources(_scanLogId, sourceResults, 'none', _ingSrc, _nutSrc);
// becomes
fireMarkScanSources(_scanLogId, sourceResults, 'none', _ingSrc, _nutSrc, Date.now() - _reqStart);
```

```js
// site 6 (fallbackResult: UpcItemDb)
fireMarkScanSources(_scanLogId, sourceResults, 'none', _ingSrc2, _nutSrc2);
// becomes
fireMarkScanSources(_scanLogId, sourceResults, 'none', _ingSrc2, _nutSrc2, Date.now() - _reqStart);
```

```js
// site 7 (Groq+USDA AI hit)
fireMarkScanSources(_scanLogId, sourceResults, 'none', _ingSrc3, _nutSrc3);
// becomes
fireMarkScanSources(_scanLogId, sourceResults, 'none', _ingSrc3, _nutSrc3, Date.now() - _reqStart);
```

```js
// site 8 (OCR-only result)
fireMarkScanSources(_scanLogId, sourceResults, 'none', _ingSrc4, _nutSrc4);
// becomes
fireMarkScanSources(_scanLogId, sourceResults, 'none', _ingSrc4, _nutSrc4, Date.now() - _reqStart);
```

```js
// site 9 (not-found)
fireMarkScanSources(_scanLogId, sourceResults, 'none', '', '');
// becomes
fireMarkScanSources(_scanLogId, sourceResults, 'none', '', '', Date.now() - _reqStart);
```

- [ ] **Step 5: Verify syntax**

Run: `node -e "require('./api/firestore.js'); console.log('firestore ok')"`
Expected: `firestore ok`

Run: `node -e "require('./api/index.js'); console.log('index ok')"`
Expected: `index ok`

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: PASS — all existing tests still green (no new tests added per Global Constraints)

- [ ] **Step 7: Commit**

```bash
git add api/firestore.js api/index.js
git commit -m "feat: capture scan latency (durationMs) in scan_logs"
```

---

### Task 2: Admin panel — display duration badge

**Files:**
- Modify: `admin/admin.js` (`renderLogs` function)

**Interfaces:**
- Consumes: `item.data.durationMs` (Task 1) — `number | undefined`.

- [ ] **Step 1: Add the duration label and include it in `metaParts`**

Find the `metaParts` construction inside `renderLogs` (in `admin/admin.js`):

```js
      const metaParts = [
        `📍 ${escHtml(loc)}`,
        `🖥 ${escHtml(d.os || '—')}`,
        `💾 ${escHtml(cacheLabel)}`,
        d.ingredientSource ? `🔍 ${ingLabel}` : '',
        d.nutritionSource ? `📊 ${nutLabel}` : ''
      ].filter(Boolean);
```

Replace it with:

```js
      const durationLabel = d.durationMs != null ? `⏱ ${(d.durationMs / 1000).toFixed(1)}s` : '';
      const metaParts = [
        `📍 ${escHtml(loc)}`,
        `🖥 ${escHtml(d.os || '—')}`,
        `💾 ${escHtml(cacheLabel)}`,
        d.ingredientSource ? `🔍 ${ingLabel}` : '',
        d.nutritionSource ? `📊 ${nutLabel}` : '',
        durationLabel
      ].filter(Boolean);
```

- [ ] **Step 2: Verify manually**

Run: `node api/index.js`, open `http://localhost:3000/admin/`, log in, go to Logs.
Expected: recent scan-log cards (created after Task 1's deploy) show a `⏱ X.Xs` badge in the meta row; older cards (predating the deploy, if any exist locally) show no duration badge and no visual glitch (no `⏱ 0.0s` or `⏱ NaNs`).

- [ ] **Step 3: Commit**

```bash
git add admin/admin.js
git commit -m "feat: show scan duration badge in admin log cards"
```

---

### Task 3: Deploy and verify

**Files:**
- None new.

- [ ] **Step 1: Push**

```bash
git push origin master
```

- [ ] **Step 2: Deploy production**

```bash
vercel --prod
```

- [ ] **Step 3: Verify in production**

1. Escanear un producto real en `https://www.yomi.mx` (idealmente uno no cacheado, para capturar el path de resolución externa completo).
2. Abrir `https://www.yomi.mx/admin/` → Logs → confirmar que la tarjeta más reciente muestra `⏱ X.Xs`.
3. Confirmar que la duración es coherente con `cacheLevel`: un hit `L1`/`L2` debe mostrar una duración baja (cientos de ms); un escaneo sin cache (`cacheLevel: none`) debe mostrar una duración más alta, reflejando las llamadas externas seriales.
4. Dejar correr en producción unos días antes de decidir el siguiente sub-proyecto (`maxDuration` / rediseño del path serial) — ese análisis usa los datos que este plan captura, no es parte de este plan.
