# Mejorar detección de ubicación con ipquery.io

**Fecha:** 2026-07-03
**Estado:** Aprobado por usuario (brainstorming)

## Objetivo

Reemplazar la detección de ubicación (`country`, `region`, `city`) basada en headers `x-vercel-ip-*` — poco precisa — por una consulta a [ipquery.io](https://ipquery.io/), API gratuita de geolocalización por IP, con cache y fallback a los headers de Vercel ante cualquier fallo.

## Alcance

1. Nuevo módulo `api/geo.js`: función `getGeoData(ip, headers)` que resuelve `{country, region, city}`.
2. Cache en memoria por IP, TTL 1h (mismo patrón que `memoryCache`/`memoryAiCache` existentes).
3. Fallback silencioso a headers Vercel si ipquery.io falla (timeout, red, 429, respuesta no-200, JSON inválido).
4. Integración en **ambos** puntos de logging: `scan_logs` (`/api/product/:barcode`) y `reports` (`/api/report`).
5. Mismo schema de salida (`country`, `region`, `city`) — sin cambios en `firestore.js`, `admin.js`, ni Firestore.

**Fuera de alcance:** campos extra de ipquery.io (ISP, VPN/proxy/Tor, risk score, coordenadas), rate-limiting propio, invalidación de cache más allá de TTL.

## 1. API externa — formato confirmado

`GET https://api.ipquery.io/{ip}?format=json` — sin API key, tier gratis.

Respuesta real (ejemplo `8.8.8.8`):
```json
{
  "ip": "8.8.8.8",
  "isp": { "asn": "AS15169", "org": "Google LLC", "isp": "Google LLC" },
  "location": {
    "country": "United States", "country_code": "US", "city": "Mountain View",
    "state": "California", "zipcode": "94043",
    "latitude": 37.4, "longitude": -122.08,
    "timezone": "America/Los_Angeles", "localtime": "2026-07-03T18:06:59"
  },
  "risk": { "is_mobile": false, "is_vpn": false, "is_tor": false, "is_proxy": false, "is_datacenter": true, "risk_score": 0 }
}
```

Campos usados: `location.country_code` → `country`, `location.state` → `region`, `location.city` → `city`.

**Nota de formato:** `region` pasa de código corto (Vercel: `"CMX"`) a nombre completo (ipquery.io: `"Ciudad de México"`). Mejora de legibilidad, mismo campo Firestore, sin migración de datos viejos necesaria (logs antiguos conservan su formato).

## 2. `api/geo.js` (nuevo módulo)

```js
const geoCache = {}; // ip -> { data, cachedAt }
const GEO_CACHE_TTL = 3600; // 1h en segundos

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

## 3. Integración en `api/index.js`

### Scan log (`/api/product/:barcode`, ~línea 293-307)

Es fire-and-forget hoy (`fireLogScan` sin `await`, comentario explícito "no delay"). Se envuelve la resolución de geo en un IIFE async para no romper esa garantía — el request HTTP no espera por `getGeoData` ni por `fireLogScan`:

```js
const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
(async () => {
  const geo = await getGeoData(ip, req.headers);
  fireLogScan({
    _id: _scanLogId, ts: Date.now(), barcode, ip,
    country: geo.country, region: geo.region, city: geo.city,
    os: detectOS(req.headers['user-agent']), ua: req.headers['user-agent'] || ''
  });
})();
```

### Report log (`/api/report`, ~línea 1213-1231)

Ya es `await fireLogReport(...)` — bloqueante hoy. Se agrega `await getGeoData(...)` antes, acotado por el timeout de 3s (o ~0ms si hay cache hit):

```js
const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
const geo = await getGeoData(ip, req.headers);
const ok = await fireLogReport({
  ts: Date.now(), barcode: barcode || '', productName: productName || '',
  category: category || '', comment: comment || '',
  ...(image ? { image } : {}),
  os: detectOS(ua), ua, ip,
  country: geo.country, region: geo.region, city: geo.city
});
```

## Manejo de errores

- IP vacía (dev local, sin `x-forwarded-for`) → salta la llamada externa, usa fallback de headers directo (probablemente también vacío en local — igual que comportamiento actual).
- Timeout, error de red, respuesta no-200, JSON inválido → fallback silencioso a headers Vercel, sin lanzar error ni afectar el flujo del request.
- Cache en memoria por instancia de servidor (mismo patrón ya usado en `memoryCache`); no persiste entre cold starts de Vercel — comportamiento aceptado, igual que el resto de caches del proyecto.

## Verificación

- **Test unitario** para `getGeoData`: cache hit, cache miss + éxito, fallo de red → fallback, IP vacía → fallback directo (mock de `fetch` global).
- **Manual**: escanear un producto y confirmar en admin panel (Logs) que `country`/`region`/`city` cambian de formato (nombres completos) y siguen mostrando datos correctos.
- **Manual**: enviar un reporte desde `/api/report` y confirmar que no hay demora perceptible en la respuesta.

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `api/geo.js` | Nuevo — `getGeoData(ip, headers)` con cache + fallback |
| `api/index.js` | Reemplaza extracción de headers por `getGeoData` en scan log y report log |
