# Rediseño del log de escaneos: tarjetas expandibles + campos mejorados

**Fecha:** 2026-07-02
**Estado:** Aprobado por usuario (brainstorming)

## Objetivo

Reemplazar la tabla de logs de escaneo (que muestra poca información útil y una columna de confianza innecesaria) por tarjetas expandibles que muestren toda la información relevante de cada escaneo: fecha, código/nombre, ubicación, sistema, fuentes consultadas, cache, OCR, y badges de estado.

## Alcance

1. Backend: campos nuevos en scan_log (`_sourcesTried`, `_cacheLevel`, `_ingredientSource`, `_nutritionSource`).
2. Backend: enriquecimiento de scan_logs con nombres de productos (ya existe).
3. Frontend: reemplazar tabla por tarjetas expandibles.
4. Frontend: badges de estado (No encontrado, Ingredientes OCR, Nutrición OCR, Reporte).
5. Frontend: panel de detalle expandido con IP, UA, fuentes, cache, OCR, notas.

**Fuera de alcance:** filtros avanzados, export CSV, agrupación de escaneos, auto-refresh, paginación con scroll infinito (ya existe "Cargar más").

## 1. Backend — campos nuevos

### 1.1 `_sourcesTried`

Array de objetos `{ source: string, found: boolean }`. Se construye desde `sourceResults` que ya existe en el endpoint de escaneo.

**Puntos de captura:** En `app.get('/api/product/:barcode', ...)`, antes de cada `return res.json()`, añadir:
```js
fireMarkScanSources(_scanLogId, sourceResults);
```

`sourceResults` ya se construye en cada escaneo (línea ~407). Contiene `[{ source: "Open Food Facts", found: true/false, ... }]`.

### 1.2 `_cacheLevel`

String: `"L1"` (memoryCache hit), `"L2"` (Firestore hit), o `"none"` (no cache).

**Puntos de captura:**
- L1: cuando `memoryCache[barcode]` tiene entrada fresca (~línea 82)
- L2: cuando `fireGetCache` retorna entrada (~línea 87-89)
- none: cuando no hay cache (resolución externa)

### 1.3 `_ingredientSource` y `_nutritionSource`

String: `"ocr"`, `"db"`, o `"ai"`. Se deriva del contexto del escaneo:
- Si `hasOcr` se marca → `ingredientSource = "ocr"`
- Si el producto viene de DB (USDA/OFF/UpcItemDb) → `ingredientSource = "db"`
- Si el producto es generado por IA → `ingredientSource = "ai"`
- Si no hay datos → `"none"`

### 1.4 Nueva función `fireMarkScanSources`

En `api/firestore.js`, patrón fire-and-forget idéntico a `fireMarkScanConfidence`:

```js
async function fireMarkScanSources(id, sources) {
  const token = await getAccessToken(); if (!token) return;
  const arr = (sources || []).map(s => ({
    mapValue: { fields: {
      source: { stringValue: s.source || '' },
      found: { booleanValue: !!s.found }
    }}
  }));
  fetch(docPath('scan_logs', id) + '?updateMask.fieldPaths=_sourcesTried&updateMask.fieldPaths=_cacheLevel&updateMask.fieldPaths=_ingredientSource&updateMask.fieldPaths=_nutritionSource', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      _sourcesTried: { arrayValue: { values: arr } },
      _cacheLevel: { stringValue: 'none' },
      _ingredientSource: { stringValue: '' },
      _nutritionSource: { stringValue: '' }
    }}),
    signal: AbortSignal.timeout(5000)
  }).catch(() => {});
}
```

Nota: Los valores de `_cacheLevel`, `_ingredientSource`, `_nutritionSource` se pasan como parámetros adicionales. La función real será:
```js
async function fireMarkScanSources(id, sources, cacheLevel = 'none', ingredientSource = '', nutritionSource = '') {
```

### 1.5 Exposición en `fireListDocs`

Junto a la línea que expone `_source`, añadir:
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

## 2. Frontend — tarjetas expandibles

### 2.1 HTML structure

Cada escaneo se renderiza como:
```html
<div class="scan-card" data-id="...">
  <div class="scan-card-summary">
    <div class="scan-card-top">
      <span class="scan-card-date">2 jul 2026 14:32</span>
      <div class="scan-card-badges">
        <!-- badges dinámicos -->
      </div>
    </div>
    <div class="scan-card-barcode">7503024877625</div>
    <div class="scan-card-name">Pan Bimbo Cero</div>
    <div class="scan-card-meta">
      📍 CDMX, MX · 🖥 Android · 💾 L2 · 📷 Ing OCR · 📊 Nut DB
    </div>
  </div>
  <div class="scan-card-detail" hidden>
    <!-- detalle expandido -->
  </div>
</div>
```

### 2.2 Badges

- 🔍 **No encontrado** (si `notFound`) — rojo
- 📷 **Ingredientes OCR** (si `hasOcr`) — azul
- 📊 **Nutrición OCR** (si `hasNutritionOcr`) — azul
- 🚩 **Reporte** (si barcode está en reports) — naranja

### 2.3 Panel de detalle expandido

Al hacer click en la tarjeta, se muestra:
- IP completa
- User-Agent
- Fuentes consultadas: `Open Food Facts ✓ · USDA ✗ · UpcItemDb ✗`
- Nivel de cache: `L1` | `L2` | `none`
- Origen de ingredientes: `ocr` | `db` | `ai` | `—`
- Origen de nutrición: `ocr` | `db` | `ai` | `—`
- Notas de confianza (si existen)
- ID del documento

### 2.4 Comportamiento

- Click en tarjeta → toggle detalle (expande/colapsa)
- Click en link de código → abre `scan.html?barcode=...` en nueva pestaña
- Click en botón ✕ → eliminar (mismo comportamiento actual)
- Filtro por código, nombre, IP, sistema, fuente

## 3. CSS

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
.scan-card-meta { font-size: 0.72rem; color: var(--ink-3); margin-top: 6px; }
.scan-card-detail { border-top: 1px solid var(--border); padding: 12px 14px; font-size: 0.78rem; color: var(--ink); }
.scan-card-detail-row { display: flex; gap: 8px; margin-bottom: 4px; }
.scan-card-detail-label { font-weight: 600; min-width: 100px; }
.scan-card-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
```

## 4. Datos de ejemplo

**Escaneo exitoso con cache L2:**
```json
{
  "ts": 1751497920000,
  "barcode": "7503024877625",
  "ip": "189.203.45.12",
  "country": "MX",
  "region": "CMX",
  "city": "Ciudad de México",
  "os": "Android",
  "sourcesTried": [
    {"source": "Open Food Facts", "found": true},
    {"source": "USDA FoodData Central", "found": false}
  ],
  "cacheLevel": "L2",
  "ingredientSource": "db",
  "nutritionSource": "db",
  "productName": "Pan Bimbo Cero"
}
```

**Escaneo con OCR de ingredientes:**
```json
{
  "ts": 1751498000000,
  "barcode": "7503024877144",
  "hasOcr": true,
  "sourcesTried": [],
  "cacheLevel": "none",
  "ingredientSource": "ocr",
  "nutritionSource": "ocr"
}
```

## Manejo de errores

- Campos nuevos faltantes (logs viejos) → se muestran como "—" o "—"
- `sourcesTried` vacío → se muestra "Sin fuentes"
- `cacheLevel` faltante → se muestra "—"

## Verificación

- **Test vitest** para `computeStats` existente no se modifica (campos nuevos son optativos)
- UI verificada manualmente: login admin → Logs → tarjetas renderizan, expanden, colapsan, filtros funcionan

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `api/firestore.js` | `fireMarkScanSources`, exposición de campos nuevos |
| `api/index.js` | Captura de `_sourcesTried`, `_cacheLevel`, `_ingredientSource`, `_nutritionSource` |
| `admin/admin.js` | Reemplazar `renderLogs` por tarjetas expandibles |
| `admin/index.html` | CSS de tarjetas |
