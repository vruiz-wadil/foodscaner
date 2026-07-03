# ipquery.io Geo Location Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `x-vercel-ip-*` header-based location detection with an ipquery.io lookup (cached, with header fallback) in scan logs and reports.

**Architecture:** New standalone module `api/geo.js` exports `getGeoData(ip, headers)`, which checks an in-memory IP cache (1h TTL), calls `https://api.ipquery.io/{ip}?format=json` on a miss, and falls back to Vercel geo headers on any failure. `api/index.js` calls this helper at both logging call sites, replacing the duplicated header-extraction logic.

**Tech Stack:** Node/Express CommonJS, native `fetch`, Vitest.

## Global Constraints

- No API key for ipquery.io; endpoint is `https://api.ipquery.io/{ip}?format=json`.
- Output schema stays `{country, region, city}` — no changes to Firestore, `firestore.js`, or `admin.js`.
- `country` = `location.country_code`, `region` = `location.state`, `city` = `location.city` (per confirmed API response shape).
- Scan log call site must remain fire-and-forget (no `await` on the outer call — never delays `/api/product/:barcode` response).
- Report log call site may `await` (already blocking today).
- Any ipquery.io failure (timeout, non-200, network error, invalid JSON) falls back silently to `x-vercel-ip-*` headers — never throws, never blocks the request.
- Cache TTL: 3600 seconds (1h), per-IP, in-memory (same pattern as existing `memoryCache`/`memoryAiCache` — no persistence across cold starts).
- Timeout on the external call: `AbortSignal.timeout(3000)`.

---

### Task 1: `api/geo.js` — `getGeoData` with cache and fallback

**Files:**
- Create: `api/geo.js`
- Test: `tests/geo.test.js`

**Interfaces:**
- Produces: `getGeoData(ip: string, headers: object) => Promise<{country: string, region: string, city: string}>` — the only export later tasks depend on.

- [ ] **Step 1: Write the failing tests**

Create `tests/geo.test.js`:

```js
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const { getGeoData } = await import('../api/geo.js')

const headers = {
  'x-vercel-ip-country': 'MX',
  'x-vercel-ip-country-region': 'CMX',
  'x-vercel-ip-city': encodeURIComponent('Ciudad de México')
}

describe('getGeoData', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('returns header fallback when ip is empty', async () => {
    const result = await getGeoData('', headers)
    expect(result).toEqual({ country: 'MX', region: 'CMX', city: 'Ciudad de México' })
  })

  it('calls ipquery.io and maps location fields on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        location: { country_code: 'US', state: 'California', city: 'Mountain View' }
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await getGeoData('8.8.8.8', headers)

    expect(result).toEqual({ country: 'US', region: 'California', city: 'Mountain View' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.ipquery.io/8.8.8.8?format=json', expect.any(Object))
  })

  it('falls back to headers when fetch resolves non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    const result = await getGeoData('1.2.3.4', headers)

    expect(result).toEqual({ country: 'MX', region: 'CMX', city: 'Ciudad de México' })
  })

  it('falls back to headers when fetch throws (network error/timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))

    const result = await getGeoData('1.2.3.4', headers)

    expect(result).toEqual({ country: 'MX', region: 'CMX', city: 'Ciudad de México' })
  })

  it('caches successful lookups for the same ip and does not re-fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ location: { country_code: 'US', state: 'California', city: 'Mountain View' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await getGeoData('9.9.9.9', headers)
    await getGeoData('9.9.9.9', headers)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/geo.test.js`
Expected: FAIL — `Cannot find module '../api/geo.js'` (file doesn't exist yet)

- [ ] **Step 3: Implement `api/geo.js`**

```js
const geoCache = {}; // ip -> { data, cachedAt }
const GEO_CACHE_TTL = 3600; // 1h, seconds

function headerFallback(headers) {
  const decCity = c => { try { return decodeURIComponent(c || ''); } catch { return c || ''; } };
  return {
    country: headers['x-vercel-ip-country'] || '',
    region:  headers['x-vercel-ip-country-region'] || '',
    city:    decCity(headers['x-vercel-ip-city'])
  };
}

async function getGeoData(ip, headers) {
  if (!ip) return headerFallback(headers);

  const now = Math.floor(Date.now() / 1000);
  const cached = geoCache[ip];
  if (cached && (now - cached.cachedAt) <= GEO_CACHE_TTL) return cached.data;

  try {
    const resp = await fetch(`https://api.ipquery.io/${ip}?format=json`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) throw new Error('ipquery non-200');
    const json = await resp.json();
    const data = {
      country: json.location?.country_code || '',
      region:  json.location?.state || '',
      city:    json.location?.city || ''
    };
    geoCache[ip] = { data, cachedAt: now };
    return data;
  } catch {
    return headerFallback(headers);
  }
}

module.exports = { getGeoData };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/geo.test.js`
Expected: PASS — 5/5 tests passing

- [ ] **Step 5: Commit**

```bash
git add api/geo.js tests/geo.test.js
git commit -m "feat: add getGeoData helper with ipquery.io lookup, cache, and header fallback"
```

---

### Task 2: Integrate `getGeoData` in scan log and report endpoints

**Files:**
- Modify: `api/index.js`

**Interfaces:**
- Consumes: `getGeoData(ip, headers)` (Task 1) — replaces inline header extraction at both call sites.

- [ ] **Step 1: Import `getGeoData`**

At the top of `api/index.js`, near the other `require` statements (line 6, after the `./firestore` require), add:

```js
const { getGeoData } = require('./geo');
```

- [ ] **Step 2: Replace scan log geo extraction (fire-and-forget, ~lines 293-307)**

Find this block:

```js
    // Fire-and-forget scan log (no await — never delays the response)
    const _decCity = c => { try { return decodeURIComponent(c || ''); } catch { return c || ''; } };
    const _scanLogId = String(1e16 - Date.now()).padStart(16, '0') + '_' + Math.random().toString(36).slice(2, 8);
    res.setHeader('X-Scan-Log-Id', _scanLogId);
    fireLogScan({
      _id: _scanLogId,
      ts: Date.now(),
      barcode,
      ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '',
      country: req.headers['x-vercel-ip-country'] || '',
      region:  req.headers['x-vercel-ip-country-region'] || '',
      city:    _decCity(req.headers['x-vercel-ip-city']),
      os:      detectOS(req.headers['user-agent']),
      ua:      req.headers['user-agent'] || ''
    });
```

Replace it with:

```js
    // Fire-and-forget scan log (no await — never delays the response)
    const _scanLogId = String(1e16 - Date.now()).padStart(16, '0') + '_' + Math.random().toString(36).slice(2, 8);
    res.setHeader('X-Scan-Log-Id', _scanLogId);
    const _scanIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
    (async () => {
      const geo = await getGeoData(_scanIp, req.headers);
      fireLogScan({
        _id: _scanLogId,
        ts: Date.now(),
        barcode,
        ip: _scanIp,
        country: geo.country,
        region:  geo.region,
        city:    geo.city,
        os:      detectOS(req.headers['user-agent']),
        ua:      req.headers['user-agent'] || ''
      });
    })();
```

- [ ] **Step 3: Replace report log geo extraction (~lines 1213-1231)**

Find this block:

```js
app.post('/api/report', async (req, res) => {
  const { barcode, productName, category, comment, image } = req.body || {};
  if (!category && !comment) return res.status(400).json({ error: 'Se requiere categoría o comentario' });
  if (image && image.length > 700000) return res.status(413).json({ error: 'Imagen demasiado grande (máx ~700 KB)' });
  const ua = req.headers['user-agent'] || '';
  const decCity = c => { try { return decodeURIComponent(c || ''); } catch { return c || ''; } };
  const ok = await fireLogReport({
    ts: Date.now(), barcode: barcode || '', productName: productName || '',
    category: category || '', comment: comment || '',
    ...(image ? { image } : {}),
    os: detectOS(ua), ua,
    ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '',
    country: req.headers['x-vercel-ip-country'] || '',
    region: req.headers['x-vercel-ip-country-region'] || '',
    city: decCity(req.headers['x-vercel-ip-city'])
  });
  if (!ok) return res.status(500).json({ error: 'No se pudo guardar el reporte' });
  res.json({ ok: true });
});
```

Replace it with:

```js
app.post('/api/report', async (req, res) => {
  const { barcode, productName, category, comment, image } = req.body || {};
  if (!category && !comment) return res.status(400).json({ error: 'Se requiere categoría o comentario' });
  if (image && image.length > 700000) return res.status(413).json({ error: 'Imagen demasiado grande (máx ~700 KB)' });
  const ua = req.headers['user-agent'] || '';
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
  const geo = await getGeoData(ip, req.headers);
  const ok = await fireLogReport({
    ts: Date.now(), barcode: barcode || '', productName: productName || '',
    category: category || '', comment: comment || '',
    ...(image ? { image } : {}),
    os: detectOS(ua), ua, ip,
    country: geo.country,
    region: geo.region,
    city: geo.city
  });
  if (!ok) return res.status(500).json({ error: 'No se pudo guardar el reporte' });
  res.json({ ok: true });
});
```

- [ ] **Step 4: Verify syntax**

Run: `node -e "require('./api/index.js'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: PASS — all tests green (existing suite + `tests/geo.test.js`)

- [ ] **Step 6: Commit**

```bash
git add api/index.js
git commit -m "feat: use ipquery.io for scan log and report geo location"
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

1. Escanear un producto real en `https://www.yomi.mx` desde un dispositivo con IP pública (no localhost).
2. Abrir `https://www.yomi.mx/admin/` → Logs → confirmar que la tarjeta más reciente muestra `region` como nombre completo (p. ej. "Ciudad de México") en vez de código corto (p. ej. "CMX").
3. Enviar un reporte desde la app (botón de reporte en `scan.html`) y confirmar que la respuesta no tiene demora perceptible y que aparece en la colección `reports` del admin con ubicación resuelta.
4. Revisar logs de Vercel (`vercel logs <url>`) por errores relacionados a `ipquery.io` o `geo.js` — no debe haber excepciones no capturadas.
