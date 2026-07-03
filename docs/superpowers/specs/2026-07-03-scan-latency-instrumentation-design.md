# Instrumentación de latencia en `/api/product/:barcode`

**Fecha:** 2026-07-03
**Estado:** Aprobado por usuario (brainstorming)
**Contexto:** Primer sub-proyecto derivado del [audit de escalabilidad](../infrastructure/2026-07-03-scalability-rate-limit-audit.md), hallazgo Crítico #3 ("No `maxDuration` set, worst-case scan path plausibly exceeds Vercel's default function timeout"). El audit explícitamente pide medir antes de fijar `maxDuration` o rediseñar el path de resolución externa — este spec es esa medición.

## Objetivo

Capturar la latencia real de cada escaneo (`/api/product/:barcode`) en el `scan_logs` existente, correlacionada con `cacheLevel` (ya capturado desde la integración de ipquery.io), para tener datos reales de qué tan seguido y por cuánto el path de "cache miss total" se acerca al timeout de Vercel — antes de decidir `maxDuration` o cualquier rediseño del path serial de llamadas externas.

## Alcance

1. Backend: capturar `durationMs` (ms desde inicio del handler hasta cada punto de retorno) y guardarlo en el `scan_logs` existente vía extensión de `fireMarkScanSources`.
2. Frontend admin: mostrar la duración en la tarjeta de log (`⏱ 1.2s`) junto a los badges/meta ya existentes.
3. Mismo patrón de escritura ya establecido (una sola escritura fire-and-forget por escaneo) — no se agrega una escritura nueva a Firestore.

**Fuera de alcance:**
- Conteo de instancias Vercel calientes (dato de plataforma — se obtiene del dashboard/`vercel inspect`, no instrumentando código; necesario para el hallazgo Crítico #1 pero no es parte de este sub-proyecto).
- Cualquier cambio a `maxDuration`, `vercel.json`, o al path serial de llamadas externas — eso depende de los datos que este spec produce, es un sub-proyecto posterior.
- Dashboards de percentiles (p50/p95/p99) — el dato queda capturado y consultable manualmente (Firestore console o export); construir una UI de agregación es un sub-proyecto separado si se decide necesario después de ver los datos crudos.
- Instrumentación de otros endpoints (`/api/report`, `/api/ai-query`, etc.) — el audit señaló específicamente `/api/product/:barcode` como el path de riesgo.

## 1. Backend — captura de duración

### 1.1 Punto de inicio

Al inicio de `app.get('/api/product/:barcode', ...)`, junto a la creación de `_scanLogId` (`api/index.js` ~línea 295):

```js
const _reqStart = Date.now();
```

### 1.2 Extender `fireMarkScanSources`

En `api/firestore.js`, la función ya existente (de la integración de ipquery.io) pasa de:

```js
async function fireMarkScanSources(id, sources, cacheLevel = 'none', ingredientSource = '', nutritionSource = '') {
```

a:

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

Nota: Firestore REST API requiere `integerValue` como **string** (`"1234"`, no `1234`) — mismo formato que otros `integerValue` ya usados en el proyecto.

### 1.3 Exponer en `fireListDocs`

Junto a la exposición existente de `cacheLevel`/`ingredientSource`/`nutritionSource` (`api/firestore.js` ~línea 273):

```js
if (parsed && d.fields?._durationMs?.integerValue) parsed.durationMs = parseInt(d.fields._durationMs.integerValue, 10);
```

### 1.4 Actualizar los 9 call sites en `api/index.js`

Cada llamada existente a `fireMarkScanSources(_scanLogId, ...)` (3 en cache-hits, 5 en resolución externa, 1 en not-found) agrega `Date.now() - _reqStart` como último argumento. Ejemplo (cache-hit, `~línea 334`):

```js
// antes
fireMarkScanSources(_scanLogId, [], cacheLevel, '', '');
// después
fireMarkScanSources(_scanLogId, [], cacheLevel, '', '', Date.now() - _reqStart);
```

Y en cada uno de los 5 puntos de resolución externa (ejemplo, `~línea 511`):

```js
// antes
fireMarkScanSources(_scanLogId, sourceResults, 'none', 'db', 'db');
// después
fireMarkScanSources(_scanLogId, sourceResults, 'none', 'db', 'db', Date.now() - _reqStart);
```

Mismo patrón para los 3 restantes de resolución externa y el de not-found.

## 2. Frontend admin — mostrar duración

En `admin/admin.js`, función `renderLogs`, agregar la duración a `metaParts` (junto a cache/OCR):

```js
const durationLabel = d.durationMs != null ? `⏱ ${(d.durationMs / 1000).toFixed(1)}s` : '';
```

Y añadirlo al array `metaParts` existente:

```js
const metaParts = [
  `📍 ${escHtml(loc)}`,
  `🖥 ${escHtml(d.os || '—')}`,
  `💾 ${escHtml(cacheLabel)}`,
  d.ingredientSource ? `🔍 ${ingLabel}` : '',
  d.nutritionSource ? `📊 ${nutLabel}` : '',
  durationLabel
].filter(Boolean);
```

Logs viejos sin `durationMs` simplemente omiten el badge (filter(Boolean) ya lo maneja).

## Manejo de errores

- `durationMs` por defecto `0` si no se pasa (compatibilidad hacia atrás con cualquier llamador que no lo incluya — no debería existir tras este cambio, pero evita `undefined` en el payload de Firestore).
- Igual que el resto de `fireMarkScanSources`: fire-and-forget, `.catch(() => {})` — un fallo de esta escritura nunca afecta la respuesta al usuario.

## Verificación

- **Sintaxis:** `node -e "require('./api/firestore.js'); console.log('ok')"` y `node -e "require('./api/index.js'); console.log('ok')"`.
- **Suite completa:** `npx vitest run` — debe seguir en verde (no se agregan tests nuevos dedicados; mismo patrón que el resto de `fireMarkScanSources`/`fireMarkScanSource`, que tampoco tienen test unitario dedicado, solo se valida vía syntax-check + regresión de la suite).
- **Manual:** escanear un producto real (forzar cache-miss si es posible) y confirmar en el admin panel que la tarjeta del log muestra `⏱ X.Xs` junto a los demás badges.
- **Recolección de datos:** tras deploy, dejar correr en producción un periodo (días) y luego exportar/consultar `scan_logs` (Firestore console o script ad-hoc) para calcular percentiles de `durationMs` agrupado por `cacheLevel` — este es el insumo real para decidir `maxDuration` en el siguiente sub-proyecto, no parte de este.

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `api/firestore.js` | `fireMarkScanSources` acepta `durationMs`, lo escribe como `_durationMs`; expone `durationMs` en `fireListDocs` |
| `api/index.js` | Captura `_reqStart`; agrega `Date.now() - _reqStart` a los 9 call sites existentes de `fireMarkScanSources` |
| `admin/admin.js` | `renderLogs` agrega badge `⏱ X.Xs` a `metaParts` |
