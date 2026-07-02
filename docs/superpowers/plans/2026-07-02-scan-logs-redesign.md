# Scan Logs Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar tabla de logs de escaneo por tarjetas expandibles con badges de estado, fuentes consultadas, cache level, y origen de OCR.

**Architecture:** Backend captura `_sourcesTried` (array), `_cacheLevel`, `_ingredientSource`, `_nutritionSource` en cada escaneo vía `fireMarkScanSources`. Frontend reemplaza `renderLogs` por tarjetas expandibles con badges y panel de detalle.

**Tech Stack:** Node/Express CommonJS, Firestore REST API, vanilla JS/CSS.

## Global Constraints

- UI en español, estética Yomi existente (variables `--paper`, `--ink`, `--border`, `--chile`, `--font-mono`).
- Backend CommonJS (`require`/`module.exports`).
- Auth admin: middleware `requireAdmin` existente (header `x-admin-token`).
- Fire-and-forget pattern para escrituras a Firestore (mismo patrón que `fireMarkScanConfidence`).

---

### Task 1: `fireMarkScanSources` + exposición de campos nuevos

**Files:**
- Modify: `api/firestore.js`

**Interfaces:**
- Produces: `fireMarkScanSources(id, sources, cacheLevel, ingredientSource, nutritionSource)` → void (fire-and-forget); campos nuevos expuestos en `fireListDocs` como `data.sourcesTried`, `data.cacheLevel`, `data.ingredientSource`, `data.nutritionSource`.

- [ ] **Step 1: Add `fireMarkScanSources` after `fireMarkScanConfidence` (después de línea ~350)**

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

- [ ] **Step 2: Expose new fields in `fireListDocs` (junto a línea ~268 donde se expone `_source`)**

Agregar después de la línea que expone `_source`:

```js
    if (parsed && d.fields?._sourcesTried?.arrayValue?.values) {
      parsed.sourcesTried = d.fields._sourcesTried.arrayValue.values.map(v => ({
        source: v.mapValue?.fields?.source?.stringValue || '',
        found: v.mapValue?.fields?.found?.booleanValue || false
      }));
    }
    if (parsed && d.fields?._cacheLevel?.stringValue) parsed.cacheLevel = d.fields._cacheLevel.stringValue;
    if (parsed && d.fields?._ingredientSource?.stringValue) parsed.ingredientSource = d.fields._ingredientSource.stringValue;
    if (parsed && d.fields?._nutritionSource?.stringValue) parsed.nutritionSource = d.fields._nutritionSource.stringValue;
```

- [ ] **Step 3: Export `fireMarkScanSources`**

En `module.exports` (línea ~376), añadir `fireMarkScanSources` a la lista.

- [ ] **Step 4: Verify syntax**

Run: `node -e "require('./api/firestore.js'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add api/firestore.js
git commit -m "feat: fireMarkScanSources and expose new scan log fields"
```

---

### Task 2: Backend — capturar campos en endpoint de escaneo

**Files:**
- Modify: `api/index.js`

**Interfaces:**
- Consumes: `fireMarkScanSources` (Task 1), `sourceResults` (ya existe línea ~407), `memoryCache` (ya existe línea ~75).
- Produce: scan_logs con `_sourcesTried`, `_cacheLevel`, `_ingredientSource`, `_nutritionSource`.

- [ ] **Step 1: Import `fireMarkScanSources`**

En línea 6 de `api/index.js`, añadir `fireMarkScanSources` al destructuring del require de `./firestore`.

- [ ] **Step 2: Capture cache level in `getCacheEntry` return**

Modificar `getCacheEntry` (línea ~80) para indicar si el hit fue L1 o L2. El valor se infiere: si `memoryCache[barcode]` tiene entrada fresca → L1; si viene de Firestore → L2. No modificamos `getCacheEntry` directamente — en su lugar, determinamos el nivel en el punto de uso.

En el bloque `if (cached)` (~línea 320), justo después de `cached.response._fromCache = true;`, añadir:

```js
    const cacheLevel = memoryCache[cachedBarcode] && (Math.floor(Date.now() / 1000) - memoryCache[cachedBarcode].cachedAt) <= CACHE_MAX_AGE ? 'L1' : 'L2';
```

- [ ] **Step 3: Replace `fireMarkScanSource` calls in cache hits with `fireMarkScanSources`**

Hay 3 puntos donde se llama `fireMarkScanSource(_scanLogId, 'cache')` (~líneas 333, 342, 349). Reemplazar cada uno por:

```js
        fireMarkScanSources(_scanLogId, [], cacheLevel, '', '');
```

(Los caches no tienen `sourceResults` porque no se consultaron fuentes externas.)

- [ ] **Step 4: Capture sources + cache level at full query return**

En el bloque de resolución externa, después de `const sourceResults = [];` (~línea 407), añadir variable para tracking:

```js
    let _cacheLevel = 'none';
```

Después de cada `return res.json(respData)` en resolución externa (~líneas 506, 799, 829, 855), añadir ANTES del return:

```js
        // Determinar ingredientSource y nutritionSource del respData
        const _ingSrc = respData.product?.ingredients_ocr ? 'ocr' : (bestSource || '').includes('Groq') ? 'ai' : 'db';
        const _nutSrc = respData.product?.nutritionData?.source === 'ocr' ? 'ocr' : (bestSource || '').includes('Groq') ? 'ai' : 'db';
        fireMarkScanSources(_scanLogId, sourceResults, _cacheLevel, _ingSrc, _nutSrc);
```

Para el caso not-found (~línea 860), ya existe `fireMarkScanNotFound` — añadir antes del return:

```js
        fireMarkScanSources(_scanLogId, sourceResults, _cacheLevel, '', '');
```

- [ ] **Step 5: Verify syntax**

Run: `node -e "require('./api/index.js'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add api/index.js
git commit -m "feat: capture sourcesTried, cacheLevel, ingredientSource, nutritionSource in scan logs"
```

---

### Task 3: Frontend — CSS de tarjetas expandibles

**Files:**
- Modify: `admin/index.html` (CSS)

**Interfaces:**
- Produces: clases `.scan-card`, `.scan-card-summary`, `.scan-card-top`, `.scan-card-date`, `.scan-card-badges`, `.scan-card-barcode`, `.scan-card-name`, `.scan-card-meta`, `.scan-card-detail`, `.scan-card-detail-row`, `.scan-card-actions`.

- [ ] **Step 1: Replace log table CSS with card CSS**

En el `<style>` de `admin/index.html`, **eliminar** las reglas `.log-row`, `.log-pname`, `tr.log-detail td`, `.log-detail-grid` y **añadir**:

```css
    /* Scan cards */
    .scan-card { border: 2px solid var(--border); border-radius: var(--radius-sm); background: var(--paper); box-shadow: 2px 2px 0 var(--border); cursor: pointer; transition: border-color 0.15s; }
    .scan-card:hover { border-color: var(--ink); }
    .scan-card-summary { padding: 12px 14px; }
    .scan-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .scan-card-date { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted); }
    .scan-card-badges { display: flex; gap: 4px; flex-wrap: wrap; }
    .scan-card-barcode { font-family: var(--font-mono); font-size: 0.85rem; font-weight: 500; color: var(--ink); }
    .scan-card-name { font-size: 0.78rem; color: var(--text-muted); margin-top: 2px; }
    .scan-card-meta { font-size: 0.72rem; color: var(--ink-3); margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .scan-card-meta span { white-space: nowrap; }
    .scan-card-detail { border-top: 1px solid var(--border); padding: 12px 14px; font-size: 0.78rem; color: var(--ink); }
    .scan-card-detail-row { display: flex; gap: 8px; margin-bottom: 4px; }
    .scan-card-detail-label { font-weight: 600; min-width: 100px; flex-shrink: 0; }
    .scan-card-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
```

- [ ] **Step 2: Commit**

```bash
git add admin/index.html
git commit -m "feat: scan card CSS for expandible log entries"
```

---

### Task 4: Frontend — reemplazar `renderLogs` por tarjetas expandibles

**Files:**
- Modify: `admin/admin.js`

**Interfaces:**
- Consumes: `item.data.sourcesTried`, `item.data.cacheLevel`, `item.data.ingredientSource`, `item.data.nutritionSource` (Task 2); CSS classes (Task 3); `reportBarcodes`, `escHtml`, `docList` click handler existentes.

- [ ] **Step 1: Replace `renderLogs` function (líneas ~269-320)**

Reemplazar la función completa por:

```js
  const CACHE_LABELS = { L1: '💾 L1', L2: '💾 L2', none: '—' };
  const ING_LABELS = { ocr: '📷 OCR', db: '🌐 DB', ai: '🤖 IA', none: '—' };
  const NUT_LABELS = { ocr: '📊 OCR', db: '🌐 DB', ai: '🤖 IA', none: '—' };

  function renderLogs(items) {
    if (!items.length) { docList.innerHTML = '<div class="empty-msg">Sin logs todavía.</div>'; return; }
    docList.innerHTML = items.map(item => {
      const d = item.data || {};
      const fecha = d.ts ? new Date(d.ts).toLocaleString('es-MX') : '—';
      const loc = [d.city, d.region, d.country].filter(Boolean).join(', ') || '—';
      const bc = d.barcode || '';
      const badges = [
        d.notFound       ? '<span class="log-badge log-badge-red">🔍 No encontrado</span>'    : '',
        d.hasOcr         ? '<span class="log-badge log-badge-blue">📷 Ing OCR</span>'          : '',
        d.hasNutritionOcr? '<span class="log-badge log-badge-blue">📊 Nut OCR</span>'          : '',
        reportBarcodes?.has(bc) ? '<span class="log-badge log-badge-orange">🚩 Reporte</span>' : ''
      ].filter(Boolean).join(' ');
      const cacheLabel = CACHE_LABELS[d.cacheLevel] || '—';
      const ingLabel = ING_LABELS[d.ingredientSource] || '—';
      const nutLabel = NUT_LABELS[d.nutritionSource] || '—';
      const sourcesLabel = (d.sourcesTried && d.sourcesTried.length)
        ? d.sourcesTried.map(s => s.source + (s.found ? ' ✓' : ' ✗')).join(' · ')
        : '—';
      const metaParts = [
        `📍 ${escHtml(loc)}`,
        `🖥 ${escHtml(d.os || '—')}`,
        `💾 ${escHtml(cacheLabel)}`,
        d.ingredientSource ? `🔍 ${ingLabel}` : '',
        d.nutritionSource ? `📊 ${nutLabel}` : ''
      ].filter(Boolean);
      const detailParts = [
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">IP:</span><span>${escHtml(d.ip || '—')}</span></div>`,
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">User-Agent:</span><span>${escHtml(d.ua || '—')}</span></div>`,
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">Fuentes:</span><span>${escHtml(sourcesLabel)}</span></div>`,
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">Cache:</span><span>${escHtml(cacheLabel)}</span></div>`,
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">Ingredientes:</span><span>${ingLabel}</span></div>`,
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">Nutrición:</span><span>${nutLabel}</span></div>`,
        d.confidenceNotes ? `<div class="scan-card-detail-row"><span class="scan-card-detail-label">Notas:</span><span>${escHtml(d.confidenceNotes)}</span></div>` : '',
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">ID:</span><span>${escHtml(item.id)}</span></div>`
      ].filter(Boolean).join('');
      return `<div class="scan-card" data-id="${escHtml(item.id)}">
        <div class="scan-card-summary">
          <div class="scan-card-top">
            <span class="scan-card-date">${escHtml(fecha)}</span>
            <div class="scan-card-badges">${badges}</div>
          </div>
          ${bc ? `<a href="https://www.yomi.mx/scan.html?barcode=${encodeURIComponent(bc)}" target="_blank" rel="noopener" class="scan-card-barcode">${escHtml(bc)}</a>` : ''}
          ${d.productName ? `<div class="scan-card-name">${escHtml(d.productName)}</div>` : ''}
          <div class="scan-card-meta">${metaParts.map(p => `<span>${p}</span>`).join('')}</div>
        </div>
        <div class="scan-card-detail" hidden>${detailParts}
          <div class="scan-card-actions">
            <button class="btn-del" data-action="del" data-id="${escHtml(item.id)}">Eliminar</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }
```

- [ ] **Step 2: Update docList click handler to support card toggle + delete**

Reemplazar el listener `docList.addEventListener('click', ...)` (línea ~345) por:

```js
  docList.addEventListener('click', async e => {
    // Toggle card expand/collapse
    const card = e.target.closest('.scan-card');
    if (card && !e.target.closest('[data-action]') && !e.target.closest('a')) {
      const detail = card.querySelector('.scan-card-detail');
      if (detail) detail.hidden = !detail.hidden;
      return;
    }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;

    if (btn.dataset.action === 'del') {
      if (!confirm('¿Eliminar escaneo "' + id + '"?')) return;
      btn.disabled = true;
      btn.textContent = '…';
      const r = await apiFetch('/api/admin/scan_logs/' + encodeURIComponent(id), { method: 'DELETE' });
      if (r.ok) {
        allItems = allItems.filter(i => i.id !== id);
        renderList();
      } else {
        alert('Error al eliminar.');
        btn.disabled = false;
        btn.textContent = 'Eliminar';
      }
    } else if (btn.dataset.action === 'del-cache') {
      const type = btn.dataset.type;
      const key = btn.dataset.key;
      const layer = btn.dataset.layer;
      if (!confirm('¿Eliminar "' + key.substring(0, 40) + '" del cache?')) return;
      btn.disabled = true;
      btn.textContent = '…';
      const r = await apiFetch('/api/admin/cache-all/' + type + '/' + encodeURIComponent(key) + '?layer=' + layer, { method: 'DELETE' });
      if (r.ok) {
        loadCollection();
      } else {
        alert('Error al eliminar.');
        btn.disabled = false;
        btn.textContent = '✕';
      }
    } else if (btn.dataset.action === 'view-cache') {
      const key = btn.dataset.key;
      modalTitle.textContent = key;
      modalContent.textContent = key;
      modalOverlay.classList.add('open');
    }
  });
```

- [ ] **Step 3: Update filter to match new card fields**

En `renderList` (línea ~315), el filtro para `scan_logs` debe buscar en `productName`, `sourcesTried`, y `cacheLevel` además de los campos actuales:

```js
      if (currentCol === 'scan_logs') {
        const d = i.data || {};
        return i.id.includes(q) || (d.barcode||'').includes(q) || (d.ip||'').toLowerCase().includes(q) || (d.os||'').toLowerCase().includes(q) || (d.productName||'').toLowerCase().includes(q) || (d.cacheLevel||'').toLowerCase().includes(q) || (d.sourcesTried||[]).some(s => (s.source||'').toLowerCase().includes(q));
      }
```

- [ ] **Step 4: Verify visually**

Run: `node api/index.js`, abrir `http://localhost:3000/admin/`, login, ir a Logs.
Expected: tarjetas por escaneo con fecha, código, nombre, badges, meta info. Click en tarjeta expande detalle con IP, UA, fuentes, cache, OCR. Click de nuevo colapsa. Botón eliminar funciona. Filtro busca en nombre, código, fuente, cache.

- [ ] **Step 5: Commit**

```bash
git add admin/admin.js
git commit -m "feat: scan logs redesigned as expandible cards with badges and detail panel"
```

---

### Task 5: Deploy + verificación

**Files:**
- Ninguno nuevo.

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 2: Push**

```bash
git push origin master
```

- [ ] **Step 3: Deploy production**

```bash
vercel --prod
```

- [ ] **Step 4: Verify in production**

Abrir `https://www.yomi.mx/admin/`, login, Logs:
1. Tarjetas renderizan con badges de estado
2. Click expande/cierra detalle
3. Fuentes muestran ✓/✗
4. Cache level visible
5. OCR source visible
6. Eliminar funciona
7. Logs viejos (sin campos nuevos) muestran "—" donde aplica
