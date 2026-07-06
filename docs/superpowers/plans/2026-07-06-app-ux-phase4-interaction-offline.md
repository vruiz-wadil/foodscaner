# App UX Phase 4 — Interaction & Offline Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace jarring native `alert()`s on camera failure with the app's own styled error state, validate manual barcode entry with the checksum logic the camera path already uses, enlarge camera-HUD tap targets to the 44px minimum, keep the scanner preview usable on short viewports, and self-host the two scanner engine modules (currently loaded from esm.sh/jsdelivr) so the scanner works offline as a PWA.

**Architecture:** Task 1 bundles four small, independent, low-risk changes (B1, B2, C1, C2) — no new files. Task 2 is the higher-risk item (E1): download `barcode-detector@2` and `@undecaf/zbar-wasm@0.11.0` from npm, copy their browser-ready dist files into a new `/vendor/` directory, point `scan.html`'s two `<script type="module">` imports at the local files instead of the CDNs, and add those files to `sw.js`'s precache list.

**Tech Stack:** Vanilla JS/CSS/HTML; Task 2 adds 2 vendored third-party browser modules (no build step, no bundler — files are used as-is from their npm dist output).

## Global Constraints

- `renderError(title, message)` (`app.js:2302`, unchanged this phase) already renders the styled `#result-rejected` panel with a "Nuevo Escaneo" retry button — B1 reuses it as-is, does not modify it.
- `validateBarcode(raw)` (`app.js:131`, unchanged this phase) already does EAN checksum + UPC-E expansion — B2 calls it as-is, does not reimplement checksum logic.
- Vendored files in Task 2 are copied verbatim from the npm package's own browser dist build — no manual editing of their contents. If a package's dist output doesn't match the exact CDN URL's behavior (e.g. `esm.sh`'s `/pure` sub-path strips Node-only code), verify the vendored file exports the same `BarcodeDetector` named export before wiring it in.
- No new automated tests — matches the spec's approach (manual verification: permission-denial flow, invalid manual entry, HUD tap-target sizing, short-viewport layout, and — for Task 2 — an offline reload test that can only be done in a real browser with DevTools' "Offline" network throttling, not verifiable by an agent without a browser).

---

### Task 1: Camera error UX, manual-entry validation, HUD tap targets, short-viewport fix

**Files:**
- Modify: `app.js` (replace 3 `alert()` calls in the camera-init path with `renderError`; add `validateBarcode` call in the manual-submit handler)
- Modify: `styles.css` (`.hud-btn`, `.zoom-btn` sizing; `.scanner-view` min-height)

**Interfaces:**
- Consumes: existing `renderError(title, message)` and `validateBarcode(raw)` — no signature changes.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Replace camera "no devices found" alert**

Find (`app.js`, inside the camera-init function, currently around line 326):

```js
    } else {
      alert("No se encontraron cámaras en este dispositivo.");
      resetCameraButton();
    }
```

Replace with:

```js
    } else {
      renderError("Sin cámara disponible", "No se encontraron cámaras en este dispositivo. Puedes ingresar el código de barras manualmente más abajo.");
      resetCameraButton();
    }
```

- [ ] **Step 2: Replace camera permission-denied alert**

Find (currently around line 330-332, same function, the `catch` block immediately after):

```js
  } catch (error) {
    console.error("Error al iniciar cámara:", error);
    alert("Permiso de cámara denegado o dispositivo ocupado.");
    resetCameraButton();
  }
```

Replace with:

```js
  } catch (error) {
    console.error("Error al iniciar cámara:", error);
    renderError("No se pudo acceder a la cámara", "Permiso de cámara denegado o dispositivo ocupado. Revisa los permisos de cámara en tu navegador, o ingresa el código de barras manualmente más abajo.");
    resetCameraButton();
  }
```

- [ ] **Step 3: Replace "scanner not ready" alert**

Find (currently around line 465-470, start of `startScanningNative`):

```js
async function startScanningNative(cameraId) {
  if (!('BarcodeDetector' in window) && !(window.zbarWasm && typeof window.zbarWasm.scanImageData === 'function')) {
    alert('El escáner aún no está listo. Ingresa el código manualmente.');
    resetCameraButton();
    return;
  }
```

Replace with:

```js
async function startScanningNative(cameraId) {
  if (!('BarcodeDetector' in window) && !(window.zbarWasm && typeof window.zbarWasm.scanImageData === 'function')) {
    renderError("Escáner no disponible todavía", "El escáner aún no está listo (puede tardar unos segundos en cargar). Ingresa el código de barras manualmente más abajo, o espera unos segundos y vuelve a intentar.");
    resetCameraButton();
    return;
  }
```

- [ ] **Step 4: Validate manual barcode entry with checksum before hitting the API**

Find (`app.js`, inside the `barcodeForm` submit handler, currently around line 257-265):

```js
  barcodeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const barcode = barcodeInput.value.trim();
    if (barcode) {
      if (!/^\d+$/.test(barcode)) {
        renderError("Código inválido", "Ingresa solo números (código de barras).");
        barcodeInput.value = "";
        return;
      }
      if (isScanning) {
        stopScanning();
      }
      analyzeBarcode(barcode);
```

Replace with:

```js
  barcodeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const barcode = barcodeInput.value.trim();
    if (barcode) {
      if (!/^\d+$/.test(barcode)) {
        renderError("Código inválido", "Ingresa solo números (código de barras).");
        barcodeInput.value = "";
        return;
      }
      const validation = validateBarcode(barcode);
      if (!validation.valid) {
        renderError("Código inválido", "El código no parece válido (verifica que tenga 8, 12 o 13 dígitos y esté completo). Revisa el número e intenta de nuevo.");
        barcodeInput.value = "";
        return;
      }
      if (isScanning) {
        stopScanning();
      }
      analyzeBarcode(validation.code);
```

(Note: `validation.code` is used instead of the raw `barcode` because `validateBarcode` returns the UPC-E-expanded code when applicable — matching how the camera-detection path already calls `analyzeBarcode`.)

- [ ] **Step 5: Enlarge HUD tap targets in `styles.css`**

Find (`.hud-btn`, currently around line 486):

```css
.hud-btn {
```

Read the full rule block and change its `width`/`height` (or equivalent sizing properties) to `44px` each — preserve every other property in the rule, only the size values change. If the rule uses `padding` instead of fixed `width`/`height`, ensure the computed box is at least 44×44px.

Find (`.zoom-btn`, currently around line 517):

```css
.zoom-btn {
```

Add or adjust `min-height: 36px;` and increase horizontal padding so the tappable area is comfortably larger than the current cramped state — preserve all other existing properties in the rule.

- [ ] **Step 6: Prevent scanner collapse on short viewports**

Find (`.scanner-view`, currently around line 206):

```css
.scanner-view {
```

Read the full rule (it currently computes `max-height: calc(100svh - 360px)` per the audit). Add:

```css
  min-height: 220px;
```

as an additional property inside the same rule block (do not remove the existing `max-height` calc — this only sets a floor).

- [ ] **Step 7: Bump cache-bust**

In `scan.html`: `styles.css?v=44` → `?v=45`, `app.js?v=63` → `?v=64`.

- [ ] **Step 8: Verify syntax**

Run: `node --check app.js`
Expected: no output, exit code 0

- [ ] **Step 9: Manual verification**

You will not have a real camera/browser in an agent context — verify via file inspection instead:
1. Confirm all 3 `alert(` calls identified above are gone from `app.js` (grep for `alert(` should now only match the OCR/nutrition/report error paths, which are out of scope for this phase).
2. Confirm `validateBarcode(barcode)` is called in the submit handler before `analyzeBarcode`.
3. Confirm `.hud-btn` computes to at least 44×44px and `.zoom-btn` has `min-height: 36px`.
4. Confirm `.scanner-view` has both the original `max-height` calc and the new `min-height: 220px`.

If a human tester has access to a real device: deny camera permission and confirm the styled rejected-panel appears (not a native dialog); type an 11-digit (invalid-length) barcode and confirm the styled inline error appears instead of a "not found" API round-trip.

- [ ] **Step 10: Run full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add app.js styles.css scan.html
git commit -m "fix: styled camera error states, manual-entry checksum validation, larger HUD targets, short-viewport scanner floor"
```

---

### Task 2: Self-host scanner engines for offline use

**Files:**
- Create: `vendor/barcode-detector.min.js` (or equivalent dist filename from the package)
- Create: `vendor/zbar-wasm.min.js` + its `.wasm` binary asset
- Modify: `scan.html` (point the two `<script type="module">` imports at `/vendor/...` instead of the CDN URLs)
- Modify: `sw.js` (add the new vendor files to `STATIC_ASSETS`)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing consumed by other tasks — this is the last functional change in the app UX audit series.

- [ ] **Step 1: Download the two packages**

```bash
mkdir -p /tmp/yomi-vendor && cd /tmp/yomi-vendor
npm pack barcode-detector@2
npm pack @undecaf/zbar-wasm@0.11.0
tar -xzf barcode-detector-2.*.tgz
tar -xzf undecaf-zbar-wasm-0.11.0.tgz
```

- [ ] **Step 2: Identify the exact browser-ready entry files**

Inspect `package/dist/` in each extracted package (`ls -la /tmp/yomi-vendor/package/dist/` after each `tar -xzf`, moving the extracted `package/` dir aside between the two so they don't overwrite each other) to find:
- The `barcode-detector` file matching what `esm.sh/barcode-detector@2/pure` currently serves — likely `dist/pure.js` or `dist/es/pure.js` (a build with no Node-only polyfills). Confirm it exports a named `BarcodeDetector`.
- The `@undecaf/zbar-wasm` file matching `dist/zbar-wasm.mjs` from the current jsdelivr URL, plus its companion `.wasm` binary (check for a `zbar.wasm` or similar file referenced by the `.mjs` via a relative fetch/import — it must be copied alongside, at the same relative path, or the wasm module will 404 at runtime).

- [ ] **Step 3: Copy the files into `vendor/`**

```bash
mkdir -p "D:/wadil/OneDrive/JOBS TMP/vigia/food/vendor"
cp /tmp/yomi-vendor/<resolved-barcode-detector-file> "D:/wadil/OneDrive/JOBS TMP/vigia/food/vendor/barcode-detector.js"
cp /tmp/yomi-vendor/<resolved-zbar-wasm-file> "D:/wadil/OneDrive/JOBS TMP/vigia/food/vendor/zbar-wasm.mjs"
cp /tmp/yomi-vendor/<resolved-zbar-wasm-binary> "D:/wadil/OneDrive/JOBS TMP/vigia/food/vendor/<same-binary-filename-the-mjs-expects>"
```

(Exact source paths depend on what Step 2 finds — do not guess; inspect the actual extracted package contents first.)

- [ ] **Step 4: Update `scan.html` imports**

Find:

```html
  <!-- BarcodeDetector ponyfill: activa ZXing-WASM en iOS y escritorio donde el API nativo no existe -->
  <script type="module">
    import { BarcodeDetector } from "https://esm.sh/barcode-detector@2/pure";
    if (!('BarcodeDetector' in window)) window.BarcodeDetector = BarcodeDetector;
  </script>
  <!-- ZBar-WASM: segundo motor en carrera (más robusto en códigos borrosos/curvos) -->
  <script type="module">
    import * as zbarWasm from "https://cdn.jsdelivr.net/npm/@undecaf/zbar-wasm@0.11.0/dist/zbar-wasm.mjs";
    window.zbarWasm = zbarWasm;
  </script>
```

Replace with (adjust the exact filenames to match whatever Step 3 actually produced):

```html
  <!-- BarcodeDetector ponyfill: self-hosted so the scanner works offline as a PWA -->
  <script type="module">
    import { BarcodeDetector } from "/vendor/barcode-detector.js";
    if (!('BarcodeDetector' in window)) window.BarcodeDetector = BarcodeDetector;
  </script>
  <!-- ZBar-WASM: self-hosted so the scanner works offline as a PWA -->
  <script type="module">
    import * as zbarWasm from "/vendor/zbar-wasm.mjs";
    window.zbarWasm = zbarWasm;
  </script>
```

- [ ] **Step 5: Precache the vendor files in `sw.js`**

Find:

```js
const CACHE_NAME = 'yomi-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/scan.html',
  '/home.css',
  '/styles.css',
  '/app.js',
  '/home.js',
  '/manifest.json',
  '/assets/icons/favicon.svg',
  '/assets/icons/icon-192x192.png',
  '/assets/icons/icon-512x512.png',
  '/assets/redesign/logo.svg',
  '/assets/redesign/icon-camera.svg',
  '/assets/redesign/icon-home.svg',
  '/assets/redesign/icon-scan.svg',
  '/assets/redesign/icon-analysis.svg',
  '/assets/redesign/icon-profile.svg',
];
```

Replace with (bump `CACHE_NAME` so the new list actually gets re-installed, and add the vendor files — adjust filenames to match Step 3's actual output):

```js
const CACHE_NAME = 'yomi-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/scan.html',
  '/home.css',
  '/styles.css',
  '/app.js',
  '/home.js',
  '/manifest.json',
  '/assets/icons/favicon.svg',
  '/assets/icons/icon-192x192.png',
  '/assets/icons/icon-512x512.png',
  '/assets/redesign/logo.svg',
  '/assets/redesign/icon-camera.svg',
  '/assets/redesign/icon-home.svg',
  '/assets/redesign/icon-scan.svg',
  '/assets/redesign/icon-analysis.svg',
  '/assets/redesign/icon-profile.svg',
  '/vendor/barcode-detector.js',
  '/vendor/zbar-wasm.mjs',
  '/vendor/<the-wasm-binary-filename-from-step-3>',
];
```

- [ ] **Step 6: Bump cache-bust**

In `scan.html`: `app.js?v=64` → `?v=65` is NOT needed here since Task 2 doesn't touch `app.js` — skip unless Task 1 wasn't yet deployed, in which case confirm the version already reflects Task 1's bump.

- [ ] **Step 7: Serve the new static files**

Confirm the Express static-file server (`api/index.js`, wherever it configures `express.static` or equivalent) already serves any path under the repo root, so `/vendor/*` resolves without additional route configuration. If it only serves an explicit allow-list of directories, add `vendor` to that list.

- [ ] **Step 8: Manual verification**

You will not have a real browser in an agent context — verify via file inspection: confirm `vendor/barcode-detector.js` and `vendor/zbar-wasm.mjs` (+ wasm binary) exist and are non-empty, confirm `scan.html`'s imports point at `/vendor/...`, confirm `sw.js`'s `STATIC_ASSETS` lists them and `CACHE_NAME` was bumped.

If a human tester has access to a real device/browser: load `scan.html` once online (to let the service worker precache), then enable airplane mode / DevTools "Offline" throttling, reload, and confirm the scanner still initializes and can decode a barcode without a network connection.

- [ ] **Step 9: Run full test suite**

Run: `npx vitest run`
Expected: PASS — no existing tests touch `scan.html`'s module imports or `sw.js`.

- [ ] **Step 10: Commit**

```bash
git add vendor scan.html sw.js
git commit -m "feat: self-host barcode-detector and zbar-wasm scanner engines for offline PWA support"
```

---

### Task 3: Deploy

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

Repeat Task 1 Step 9 and Task 2 Step 8's manual checks against `https://www.yomi.mx/scan.html`. For the offline check specifically, this is the first real opportunity to test it in an actual browser — do so if possible, or ask the user to verify since this is the one item in the entire 4-phase audit that fundamentally requires a real device/network-toggle test no agent can perform.
