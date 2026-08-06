# Reskin de páginas de cuenta (auth/preferences/account/history) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar el look and feel de `account.html`, `preferences.html` y `history.html` con `index.html`/`scan.html`, reusando componentes visuales ya existentes (`.content-card`, `.dietary-grid-item`/`.allergen-grid-item` de `scan.html`) en vez de checkboxes/selects nativos y cards planas sin ícono, más un contador real de escaneos totales.

**Architecture:** Un solo panel blanco (`.content-card`, ya existente) envuelve todo el contenido de cada página, con piezas nuevas (card de identidad oscura, stat tiles, toggle de severidad) viviendo adentro. Los selectores de dietas/alergias/condiciones de salud pasan de `<input type="checkbox">`/`<select>` nativos a botones-tile con emoji (mismo formato visual que `scan.html`), togglando una clase `.chosen` por click en vez de depender de `:checked`. Nuevo contador `usage.totalScans` (lifetime, nunca resetea) vía un endpoint sin gate premium.

**Tech Stack:** Vanilla JS/HTML/CSS, Express, Firestore REST API, Vitest+jsdom.

## Global Constraints

- Nunca modificar `master`/producción — todo en `develop`.
- Cero dependencias nuevas.
- `usage.totalScans` es de por vida, NUNCA resetea diario (a diferencia de `ocrCount`/`cacheRefreshCount`).
- `POST /api/me/scan` NO tiene gate premium — a diferencia de `/api/me/history`, debe funcionar para cualquier plan.
- Reusar clases/tokens ya existentes en `styles.css`/`home.css` (`.content-card`, `.btn`/`.btn-primary`/`.btn-secondary`, `var(--ink)`/`var(--border)`/`var(--card)`/`var(--ink-3)`) — no reinventar un sistema de diseño paralelo.
- `.chosen` (estado "elegido" persistente en los tiles) es semánticamente distinto de `.selected` (usado en `scan.html` para "detalle expandido momentáneamente") — ambos pueden coexistir en el CSS global sin conflicto porque `.selected` no se usa en las páginas nuevas.
- Tiles de selección son `<button type="button">` reales (no `<div>` con `role="button"` inventado) — semántica y teclado gratis; se agrega `aria-pressed` reflejando `.chosen`.

---

### Task 1: Contador real de escaneos — `usage.totalScans` en `api/firestore.js`

**Files:**
- Modify: `api/firestore.js:503` (creación en `fireUpsertUser`), `api/firestore.js:577-606` (`fireIncrementUsageCounter`)
- Test: `tests/firestore-usage.test.js` (actualizar 2 asserts existentes de `toEqual`, agregar 2 tests nuevos)

**Interfaces:**
- Consumes: `fireGetUserRaw`, `firePatchUserFieldsWithPrecondition` (ya existentes, sin cambios de firma).
- Produces: `fireIncrementUsageCounter(uid, 'totalScans')` — mismo patrón de concurrencia optimista que `'ocrCount'`/`'cacheRefreshCount'`, pero `totalScans` NUNCA se resetea por cambio de día (a diferencia de los otros 2 campos). Consumido por Task 2.

**Corrección importante (encontrada al leer el código real, no asumida en el spec):** `fireIncrementUsageCounter` hoy reconstruye el objeto `usage` completo en cada llamada (`newUsage = {date, ocrCount, cacheRefreshCount}`) y lo reemplaza vía `updateMask.fieldPaths=usage` (reemplaza el map entero, no hace merge de sub-campos). Si se agrega `totalScans` sin incluirlo en `newUsage` en TODAS las llamadas, se borraría cada vez que se incrementa `ocrCount`/`cacheRefreshCount`. Este task corrige eso incluyendo `totalScans` en el objeto reconstruido siempre, preservando/incrementando su valor sin importar qué campo se esté incrementando.

- [ ] **Step 1: Escribe los tests que fallan**

Reemplazar en `tests/firestore-usage.test.js` las 2 aserciones `toEqual` existentes (líneas 63 y 85) para incluir `totalScans`, y agregar 2 tests nuevos al final del `describe('fireIncrementUsageCounter', ...)`:

```js
  it('resets counters to 0 before incrementing when usage.date is not today (UTC)', async () => {
    let patchBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-14' }, ocrCount: { integerValue: '5' }, cacheRefreshCount: { integerValue: '1' }, totalScans: { integerValue: '20' }
            } } } },
            updateTime: '2026-07-14T23:00:00.000000Z'
          })
        }
      }
      patchBody = JSON.parse(options.body)
      return { ok: true, status: 200 }
    }))

    const result = await fireIncrementUsageCounter('uid-1', 'ocrCount')

    expect(result).toEqual({ date: '2026-07-15', ocrCount: 1, cacheRefreshCount: 0, totalScans: 20 })
    expect(patchBody.currentDocument.updateTime).toBe('2026-07-14T23:00:00.000000Z')
  })

  it('increments the existing counter when usage.date is already today', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-15' }, ocrCount: { integerValue: '2' }, cacheRefreshCount: { integerValue: '0' }, totalScans: { integerValue: '20' }
            } } } },
            updateTime: '2026-07-15T10:00:00.000000Z'
          })
        }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireIncrementUsageCounter('uid-1', 'ocrCount')

    expect(result).toEqual({ date: '2026-07-15', ocrCount: 3, cacheRefreshCount: 0, totalScans: 20 })
  })
```

Nuevos tests, al final del `describe`, antes del `})` de cierre:

```js

  it('incrementa totalScans sin resetearlo aunque usage.date no sea hoy (a diferencia de ocrCount/cacheRefreshCount, es de por vida)', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-14' }, ocrCount: { integerValue: '5' }, cacheRefreshCount: { integerValue: '1' }, totalScans: { integerValue: '20' }
            } } } },
            updateTime: '2026-07-14T23:00:00.000000Z'
          })
        }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireIncrementUsageCounter('uid-1', 'totalScans')

    expect(result).toEqual({ date: '2026-07-15', ocrCount: 0, cacheRefreshCount: 0, totalScans: 21 })
  })

  it('trata totalScans ausente como 0 (perfil creado antes de este campo)', async () => {
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) {
        return {
          ok: true, status: 200,
          json: async () => ({
            fields: { usage: { mapValue: { fields: {
              date: { stringValue: '2026-07-15' }, ocrCount: { integerValue: '0' }, cacheRefreshCount: { integerValue: '0' }
            } } } },
            updateTime: '2026-07-15T10:00:00.000000Z'
          })
        }
      }
      return { ok: true, status: 200 }
    }))

    const result = await fireIncrementUsageCounter('uid-1', 'totalScans')

    expect(result).toEqual({ date: '2026-07-15', ocrCount: 0, cacheRefreshCount: 0, totalScans: 1 })
  })
```

- [ ] **Step 2: Corre los tests, verifica que fallan**

Run: `npx vitest run tests/firestore-usage.test.js`
Expected: los 2 tests existentes fallan (`toEqual` con `totalScans` faltante en el resultado real), los 2 nuevos fallan con `Campo de uso inválido: totalScans`.

- [ ] **Step 3: Implementación mínima**

Reemplazar `api/firestore.js:577-606` (`fireIncrementUsageCounter` completo):

```js
async function fireIncrementUsageCounter(uid, field) {
  if (!['ocrCount', 'cacheRefreshCount', 'totalScans'].includes(field)) {
    throw new Error('Campo de uso inválido: ' + field);
  }
  const today = new Date().toISOString().slice(0, 10); // UTC, a propósito (ver spec)
  const MAX_ATTEMPTS = 3;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const doc = await fireGetUserRaw(uid);
    if (!doc) throw new Error('Usuario no encontrado: ' + uid);

    const currentUsage = doc.fields.usage || { date: today, ocrCount: 0, cacheRefreshCount: 0, totalScans: 0 };
    const isNewDay = currentUsage.date !== today;
    const newUsage = {
      date: today,
      ocrCount: isNewDay ? (field === 'ocrCount' ? 1 : 0) : currentUsage.ocrCount + (field === 'ocrCount' ? 1 : 0),
      cacheRefreshCount: isNewDay ? (field === 'cacheRefreshCount' ? 1 : 0) : currentUsage.cacheRefreshCount + (field === 'cacheRefreshCount' ? 1 : 0),
      // totalScans NUNCA se resetea por cambio de día (a diferencia de los otros
      // 2 campos) — es un contador de por vida, no una cuota diaria.
      totalScans: (currentUsage.totalScans || 0) + (field === 'totalScans' ? 1 : 0)
    };

    const resp = await firePatchUserFieldsWithPrecondition(uid, ['usage'], { usage: newUsage }, doc.updateTime);
    if (resp.ok) return newUsage;
    if (resp.status === 409) {
      const backoffMs = 10 + Math.floor(Math.random() * 40); // 10-50ms
      await sleep(backoffMs);
      continue;
    }
    throw new Error(`Firestore increment usage failed: ${resp.status}`);
  }
  throw new Error('No se pudo incrementar usage tras reintentos por conflictos de concurrencia');
}
```

En `api/firestore.js:503` (dentro de `fireUpsertUser`, rama de creación), cambiar:

```js
      usage: { date: today, ocrCount: 0, cacheRefreshCount: 0 }
```

por:

```js
      usage: { date: today, ocrCount: 0, cacheRefreshCount: 0, totalScans: 0 }
```

- [ ] **Step 4: Corre los tests, verifica que pasan**

Run: `npx vitest run tests/firestore-usage.test.js`
Expected: `Test Files 1 passed (1)`, `Tests 6 passed (6)`

- [ ] **Step 5: Commit**

```bash
git add api/firestore.js tests/firestore-usage.test.js
git commit -m "feat(usage): add lifetime totalScans counter alongside daily ocrCount/cacheRefreshCount"
```

---

### Task 2: `POST /api/me/scan` — endpoint sin gate premium

**Files:**
- Modify: `api/index.js` (nueva sección junto a `postHistoryHandler`/`getHistoryHandler`, ~línea 1497), `api/index.js` (module.exports al final)
- Test: `tests/meScan.test.js` (nuevo)

**Interfaces:**
- Consumes: `requireUser` (ya existente), `fireIncrementUsageCounter(uid, 'totalScans')` (Task 1).
- Produces: `postScanHandler(req, res)` montado en `POST /api/me/scan`. Consumido por Task 3 (`app.js`).

- [ ] **Step 1: Escribe el test que falla**

```js
// tests/meScan.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

// createRequire + mutación de propiedades del objeto real de module.exports
// de firestore.js en vez de vi.mock (no intercepta el require anidado
// dentro de api/index.js) — mismo patrón que tests/deletePreferences.test.js
// y tests/authSync.test.js. No se restaura al final: cada archivo de test
// corre en su propio contexto de módulos aislado por vitest.
const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const fireIncrementUsageCounter = vi.fn()
firestoreModule.fireIncrementUsageCounter = fireIncrementUsageCounter

const { postScanHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('postScanHandler', () => {
  beforeEach(() => { fireIncrementUsageCounter.mockReset() })

  it('incrementa totalScans para un usuario free (sin gate premium)', async () => {
    fireIncrementUsageCounter.mockResolvedValue({ date: '2026-07-16', ocrCount: 0, cacheRefreshCount: 0, totalScans: 5 })
    const req = { user: { uid: 'uid-free' } }
    const res = makeRes()

    await postScanHandler(req, res)

    expect(fireIncrementUsageCounter).toHaveBeenCalledWith('uid-free', 'totalScans')
    expect(res.body).toEqual({ ok: true })
  })

  it('incrementa totalScans igual para un usuario premium', async () => {
    fireIncrementUsageCounter.mockResolvedValue({ date: '2026-07-16', ocrCount: 0, cacheRefreshCount: 0, totalScans: 40 })
    const req = { user: { uid: 'uid-premium' } }
    const res = makeRes()

    await postScanHandler(req, res)

    expect(fireIncrementUsageCounter).toHaveBeenCalledWith('uid-premium', 'totalScans')
    expect(res.body).toEqual({ ok: true })
  })

  it('responde 500 si Firestore falla, sin lanzar', async () => {
    fireIncrementUsageCounter.mockRejectedValue(new Error('firestore down'))
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await postScanHandler(req, res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'internal_error' })
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/meScan.test.js`
Expected: `TypeError: postScanHandler is not a function`

- [ ] **Step 3: Implementación mínima**

Agregar en `api/index.js`, justo después de `app.get('/api/me/history', requireUser, getHistoryHandler);` (~línea 1498):

```js
// Contador de escaneos totales — a diferencia de /api/me/history, SIN gate
// premium: el stat "Escaneos" de account.html debe reflejar el total real
// para cualquier plan, no solo premium.
async function postScanHandler(req, res) {
  try {
    await fireIncrementUsageCounter(req.user.uid, 'totalScans');
    res.json({ ok: true });
  } catch (e) {
    console.warn('[POST /api/me/scan] Firestore error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.post('/api/me/scan', requireUser, postScanHandler);
```

Al final del archivo, junto a los demás `module.exports`:

```js
module.exports.postScanHandler = postScanHandler;
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/meScan.test.js`
Expected: `Test Files 1 passed (1)`, `Tests 3 passed (3)`

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/meScan.test.js
git commit -m "feat(usage): add POST /api/me/scan to increment totalScans for any plan"
```

---

### Task 3: Wiring en `app.js` — `incrementScanCounter()`

**Files:**
- Modify: `app.js:1730` (nueva función junto a `logScanToCloudHistory`), `app.js:1763-1766` (extiende el bloque de llamada)
- Test: `tests/app.test.js` (nuevo `describe`, extender `beforeAll`)

**Interfaces:**
- Consumes: `window.authClient.getIdToken()` (ya existente).
- Produces: `incrementScanCounter()` — función interna de `app.js`, fire-and-forget, corre para CUALQUIER usuario logueado (a diferencia de `logScanToCloudHistory`, que es premium-only).

- [ ] **Step 1: Escribe el test que falla**

Agregar `incrementScanCounter` al `let`/`beforeAll` de `tests/app.test.js` (línea 13 y 16-28):

```js
let parseApiProduct, isGlutenRelated, extractDietaryFromLabels, eanChecksum, expandUpcE, validateBarcode, computeVerdict, hasNoRealData, getUserPreferencesForVerdict, renderPersonalizedDisclaimer, logScanToCloudHistory, incrementScanCounter

beforeAll(() => {
  const fn = new Function(appCode + '\nreturn { parseApiProduct, isGlutenRelated, extractDietaryFromLabels, eanChecksum, expandUpcE, validateBarcode, computeVerdict, hasNoRealData, getUserPreferencesForVerdict, renderPersonalizedDisclaimer, logScanToCloudHistory, incrementScanCounter }')
  const exports = fn()
  parseApiProduct = exports.parseApiProduct
  isGlutenRelated = exports.isGlutenRelated
  extractDietaryFromLabels = exports.extractDietaryFromLabels
  eanChecksum = exports.eanChecksum
  expandUpcE = exports.expandUpcE
  validateBarcode = exports.validateBarcode
  computeVerdict = exports.computeVerdict
  hasNoRealData = exports.hasNoRealData
  getUserPreferencesForVerdict = exports.getUserPreferencesForVerdict
  renderPersonalizedDisclaimer = exports.renderPersonalizedDisclaimer
  logScanToCloudHistory = exports.logScanToCloudHistory
  incrementScanCounter = exports.incrementScanCounter
})
```

Nuevo `describe` al final de `tests/app.test.js`:

```js

// ─── incrementScanCounter (contador real de escaneos, cualquier plan) ───

describe('incrementScanCounter', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  })

  afterEach(() => {
    global.fetch = originalFetch
    delete window.authClient
  })

  it('no llama a fetch si no hay sesión (window.authClient no existe)', async () => {
    await incrementScanCounter()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('POSTea a /api/me/scan con Bearer token para CUALQUIER plan (a diferencia de logScanToCloudHistory, no filtra por premium)', async () => {
    window.authClient = { getIdToken: vi.fn().mockResolvedValue('tok-free') }
    await incrementScanCounter()
    expect(global.fetch).toHaveBeenCalledWith('/api/me/scan', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-free' }
    })
  })

  it('no lanza si fetch falla (fire-and-forget)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    window.authClient = { getIdToken: vi.fn().mockResolvedValue('tok') }
    await expect(incrementScanCounter()).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/app.test.js`
Expected: `incrementScanCounter is not a function`

- [ ] **Step 3: Implementación mínima**

Agregar en `app.js`, justo después de la función `logScanToCloudHistory` (después de su `}` de cierre, ~línea 1748):

```js

// Incrementa el contador de escaneos totales — a diferencia de
// logScanToCloudHistory (premium-only), corre para CUALQUIER usuario
// logueado: el stat "Escaneos" de account.html debe reflejar el uso real
// del usuario sin importar su plan. Fire-and-forget, mismo motivo que la
// función anterior.
async function incrementScanCounter() {
  if (typeof window === 'undefined' || !window.authClient) return;
  try {
    const token = await window.authClient.getIdToken();
    await fetch('/api/me/scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (e) {
    console.warn('[usage] no se pudo incrementar el contador de escaneos:', e.message);
  }
}
```

Cambiar `app.js:1763-1766` (extiende el bloque, no lo reemplaza):

```js
  const userPreferences = getUserPreferencesForVerdict();
  const verdict = computeVerdict(product, userPreferences);
  renderPersonalizedDisclaimer(userPreferences);
  logScanToCloudHistory(barcode, product.name, verdict);
  incrementScanCounter();
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/app.test.js`
Expected: todos los tests pasan, incluyendo los 3 nuevos.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/app.test.js
git commit -m "feat(usage): wire incrementScanCounter at render time for any logged-in user"
```

---

### Task 4: CSS compartido del reskin en `home.css`

**Files:**
- Modify: `home.css` (nueva sección al final del archivo)

**Interfaces:**
- Consumes: tokens ya existentes en `:root` de `styles.css` (`--ink`, `--ink-3`, `--card`, `--border`, `--radius-sm`) y las clases `.dietary-grid-item`/`.allergen-grid-item` ya definidas en `styles.css` (no se tocan, solo se les agrega el modificador `.chosen`).
- Produces: `.row-card`, `.icon-wrap`, `.hero-card-dark`, `.stat-row`/`.stat-tile`, `.severity-toggle`, `.dietary-grid-item.chosen`/`.allergen-grid-item.chosen`. Consumidos por Tasks 5-7.

Esta tarea es puramente CSS (sin lógica nueva) — no hay un test que falle primero; el criterio de "pasa" es que la suite completa siga en verde (regresión) más una verificación visual manual en Task 5-7 cuando el CSS ya tenga markup real que lo consuma.

- [ ] **Step 1: Agrega el CSS**

Al final de `home.css` (después de la media query de `prefers-reduced-motion` ya existente):

```css

/* ── Reskin de páginas de cuenta (auth/preferences/account/history) ──────
   Reusa vocabulario visual existente: un panel único (.content-card, ya
   definido arriba) envuelve todo el contenido; adentro, filas sin card
   propia (.row-card, divisor sutil) en vez de cards flotando sueltas. El
   estado "elegido" persistente sobre los tiles de scan.html (.dietary-
   grid-item/.allergen-grid-item, definidos en styles.css) es .chosen —
   DISTINTO de .selected (ahí es "detalle expandido momentáneamente", no se
   usa en estas páginas nuevas, sin conflicto). */
.row-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--border);
}
.row-card:first-child { border-top: none; padding-top: 0; }

.icon-wrap {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(126,189,172,0.2);
}

.hero-card-dark {
  background: var(--ink);
  border-radius: 8px;
  padding: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.hero-card-dark .icon-wrap { background: rgba(75,197,171,0.2); }
.hero-card-dark .account-email { color: #fff; margin: 0; font-weight: 600; font-size: 0.9rem; }

.stat-row { display: flex; gap: 10px; margin-bottom: 14px; }
.stat-tile {
  flex: 1;
  text-align: center;
  background: #f4faf8;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 6px;
}
.stat-tile .stat-num { font-size: 20px; font-weight: 800; color: var(--ink); }
.stat-tile .stat-label { font-size: 10px; color: var(--ink-3); }

/* Estado "elegido" persistente (dietas/condiciones/alergias en preferences.html) */
.dietary-grid-item.chosen,
.allergen-grid-item.chosen {
  background: #117f3a;
  border-color: #117f3a;
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
.dietary-grid-item.chosen .label,
.allergen-grid-item.chosen .label { color: #fff; }

.severity-toggle { display: flex; gap: 4px; margin: -4px 0 14px; }
.severity-toggle button {
  flex: 1;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 6px 4px;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--border);
  background: var(--card);
  color: var(--ink-3);
  cursor: pointer;
}
.severity-toggle button.active {
  background: var(--ink);
  color: #fff;
  border-color: var(--ink);
}
```

- [ ] **Step 2: Verifica que no rompe nada**

Run: `npx vitest run --exclude tests/e2e`
Expected: mismo conteo de tests en verde que antes de este cambio (CSS puro, ningún test de JS debería verse afectado).

- [ ] **Step 3: Commit**

```bash
git add home.css
git commit -m "feat(reskin): add shared CSS for account pages reskin (hero card, stat tiles, chosen state, severity toggle)"
```

---

### Task 5: `account.html`/`account-ui.js` — panel único con stats reales

**Files:**
- Modify: `account.html` (simplifica el `<style>` inline, un solo `.content-card`), `account-ui.js` (reescribe `renderAccountHub`)
- Test: `tests/account-ui.test.js` (extiende, la mayoría de los tests existentes NO deberían romperse — mismos selectores `.account-plan-free`/`.account-plan-premium`/`a[href="preferences.html"]`/`#btn-logout`)

**Interfaces:**
- Consumes: `getCachedProfile()` (Task 12 de la sesión anterior, ya incluye `usage.totalScans` en el payload porque `getMeHandler` en `api/index.js:1359` hace spread de todo `user` excepto `preferences` — confirmado leyendo el código real, no se toca ese endpoint).
- Produces: `computeAlertsActive(preferences)` — exportada para test directo. `renderAccountHub()` sin cambio de firma.

- [ ] **Step 1: Escribe los tests que fallan**

Agregar `computeAlertsActive` al import del test (línea 25 área) y 2 tests nuevos en `tests/account-ui.test.js`, dentro de `describe('renderAccountHub', ...)`, después del test de "siempre incluye el botón de cerrar sesión":

```js

  it('muestra el total de escaneos y alertas activas reales del perfil cacheado', () => {
    getCachedProfile.mockReturnValue({
      email: 'a@b.com', plan: 'premium',
      usage: { date: '2026-07-16', ocrCount: 1, cacheRefreshCount: 0, totalScans: 12 },
      preferences: { dietary: ['vegan'], allergens: [{ code: 'cacahuate', severity: 'severe' }], healthConditions: [] }
    })
    renderAccountHub()
    const root = document.getElementById('account-root')
    const nums = Array.from(root.querySelectorAll('.stat-num')).map(el => el.textContent)
    expect(nums).toEqual(['12', '2'])
  })

  it('el total de escaneos y alertas activas es 0 si el perfil no tiene usage/preferences todavía (recién creado)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', plan: 'free' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    const nums = Array.from(root.querySelectorAll('.stat-num')).map(el => el.textContent)
    expect(nums).toEqual(['0', '0'])
  })

  it('envuelve todo el contenido en un único .content-card, no en cards sueltas (hallazgo de reskin visual)', () => {
    getCachedProfile.mockReturnValue({ email: 'a@b.com', plan: 'free' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelectorAll(':scope > .content-card').length).toBe(1)
  })
```

- [ ] **Step 2: Corre los tests, verifica que fallan**

Run: `npx vitest run tests/account-ui.test.js`
Expected: los 3 nuevos tests fallan (`.stat-num` no existe todavía, `.content-card` no existe todavía).

- [ ] **Step 3: Implementación mínima**

Reemplazar `account-ui.js` completo:

```js
import { firebaseAuth, signOut } from './firebase-init.js';
import { getCachedProfile, syncUserProfile } from './authClient.js';

// Suma de ítems declarados por el usuario — sin backend nuevo, se deriva
// del perfil ya cacheado. Para free (sin preferences) siempre 0.
export function computeAlertsActive(prefs) {
  if (!prefs) return 0;
  return (prefs.dietary || []).length + (prefs.allergens || []).length + (prefs.healthConditions || []).length;
}

const PROFILE_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d="M17.4167 19.25V17.4167C17.4167 16.4442 17.0304 15.5116 16.3428 14.8239C15.6551 14.1363 14.7225 13.75 13.75 13.75H8.25004C7.27758 13.75 6.34495 14.1363 5.65732 14.8239C4.96968 15.5116 4.58337 16.4442 4.58337 17.4167V19.25" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 10.0833C13.0251 10.0833 14.6667 8.44171 14.6667 6.41667C14.6667 4.39162 13.0251 2.75 11 2.75C8.975 2.75 7.33337 4.39162 7.33337 6.41667C7.33337 8.44171 8.975 10.0833 11 10.0833Z" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function renderAccountHub() {
  const profile = getCachedProfile();
  const root = document.getElementById('account-root');
  if (!root) return;

  if (!profile) {
    window.location.href = 'auth.html';
    return;
  }

  const isPremium = profile.plan === 'premium';
  const prefs = profile.preferences;
  const hasPrefs = prefs && ((prefs.dietary || []).length || (prefs.allergens || []).length || (prefs.healthConditions || []).length);
  const totalScans = (profile.usage && profile.usage.totalScans) || 0;
  const alertsActive = computeAlertsActive(prefs);

  const summaryHtml = hasPrefs
    ? `<p class="account-summary">Tu perfil: ${[...(prefs.dietary || []), ...(prefs.allergens || []).map(a => a.code), ...(prefs.healthConditions || [])].join(', ')}</p>`
    : '<p class="account-empty">Aún no configuraste tus preferencias.</p>';

  root.innerHTML = `
    <div class="content-card">
      <div class="hero-card-dark">
        <div class="icon-wrap">${PROFILE_ICON_SVG}</div>
        <div>
          <p class="account-email">${profile.email || ''}</p>
          <span class="account-plan-badge account-plan-${profile.plan}">${isPremium ? 'Premium' : 'Free'}</span>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat-tile"><div class="stat-num">${totalScans}</div><div class="stat-label">Escaneos</div></div>
        <div class="stat-tile"><div class="stat-num">${alertsActive}</div><div class="stat-label">Alertas activas</div></div>
      </div>
      <div class="row-card">
        ${summaryHtml}
        ${isPremium ? '<a href="preferences.html" class="btn btn-secondary">Editar preferencias</a>' : ''}
      </div>
      ${!isPremium ? `
        <div class="row-card account-upsell">
          <div class="icon-wrap" style="background:rgba(245,166,35,0.15);">🔔</div>
          <div>
            <p class="about-text">Activa alertas cuando un producto no es apto para tu perfil.</p>
            <a href="preferences.html" class="btn btn-primary">Configurar mis preferencias</a>
          </div>
        </div>` : ''}
      <button type="button" id="btn-logout" class="btn btn-secondary">Cerrar sesión</button>
    </div>
  `;

  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
}

export async function handleLogout() {
  await signOut(firebaseAuth);
  window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', async () => {
  await syncUserProfile();
  renderAccountHub();
});
```

Reemplazar el `<style>` inline de `account.html` (simplifica — ya no hace falta el layout de grid de `.about-card`s sueltas):

```html
  <style>
    .hidden{display:none!important}
    .account-plan-badge{padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;display:inline-block;margin-top:4px}
    .account-plan-free{background:rgba(255,255,255,0.15);color:#fff}
    .account-plan-premium{background:#f5a623;color:#fff}
  </style>
```

- [ ] **Step 4: Corre los tests, verifica que pasan**

Run: `npx vitest run tests/account-ui.test.js`
Expected: `Test Files 1 passed (1)`, todos los tests (los 5 originales + 3 nuevos) pasan.

- [ ] **Step 5: Commit**

```bash
git add account.html account-ui.js tests/account-ui.test.js
git commit -m "feat(reskin): account.html single-panel reskin with real Escaneos/Alertas activas stats"
```

---

### Task 6: `preferences.html`/`preferences-ui.js` — tiles de Dietas y Condiciones de salud

**Files:**
- Modify: `preferences.html` (reemplaza checkboxes de Dietas/Condiciones de salud por tiles), `preferences-ui.js` (reescribe `loadPreferencesIntoForm`/`buildPreferencesPayload` para dietary/healthConditions, agrega wiring de click)
- Test: `tests/preferences-ui.test.js` (actualiza el fixture HTML y las aserciones de dietary/healthConditions — alergias se quedan nativas hasta Task 7)

**Interfaces:**
- Consumes: `.dietary-grid-item`/`.chosen` (Task 4).
- Produces: `setupPreferenceTiles()` — función interna de `preferences-ui.js`, wired en `DOMContentLoaded`.

**Nota de alcance:** este task convierte SOLO Dietas y Condiciones de salud (toggle simple, sin severidad) — Alergias (con su segmentado de severidad) se hace en Task 7 porque es una pieza de interacción claramente distinta y más compleja; dividir así deja cada task revisable de forma independiente.

- [ ] **Step 1: Escribe el test que falla**

Reemplazar el fixture `document.body.innerHTML` en `tests/preferences-ui.test.js` (líneas 18-34):

```js
  document.body.innerHTML = `
    <form id="preferences-form">
      <div id="dietary-tiles">
        <button type="button" data-dietary="vegan">Vegano</button>
        <button type="button" data-dietary="glutenFree">Sin gluten</button>
      </div>
      <div id="health-tiles">
        <button type="button" data-health="diabet">Diabetes</button>
      </div>
      <input type="checkbox" id="allergen-cacahuate" name="allergen" value="cacahuate">
      <select id="severity-cacahuate"><option value="mild">Leve</option><option value="severe">Severa</option></select>
      <div class="consent-block">
        <input type="checkbox" id="consent-checkbox" required>
        <p id="consent-error" class="hidden" role="alert"></p>
      </div>
      <button type="submit" id="btn-save-preferences">Guardar</button>
    </form>
    <button id="btn-delete-preferences">Borrar mis preferencias</button>
    <p id="preferences-error" class="hidden" role="alert"></p>
    <p id="preferences-success" class="hidden" role="status"></p>
  `
```

Reemplazar el test `'marca los checkboxes según el perfil cacheado'` (líneas 42-53) y el de `'no marca nada...'` (líneas 55-59):

```js
  it('marca los tiles de dietary/healthConditions con .chosen según el perfil cacheado', () => {
    getCachedProfile.mockReturnValue({
      plan: 'premium',
      preferences: { dietary: ['vegan'], allergens: [{ code: 'cacahuate', severity: 'severe' }], healthConditions: ['diabet'] }
    })
    loadPreferencesIntoForm()
    expect(document.querySelector('[data-dietary="vegan"]').classList.contains('chosen')).toBe(true)
    expect(document.querySelector('[data-dietary="glutenFree"]').classList.contains('chosen')).toBe(false)
    expect(document.querySelector('[data-health="diabet"]').classList.contains('chosen')).toBe(true)
    expect(document.getElementById('allergen-cacahuate').checked).toBe(true)
    expect(document.getElementById('severity-cacahuate').value).toBe('severe')
  })

  it('no marca nada si no hay preferences aún (usuario premium sin configurar)', () => {
    getCachedProfile.mockReturnValue({ plan: 'premium' })
    loadPreferencesIntoForm()
    expect(document.querySelector('[data-dietary="vegan"]').classList.contains('chosen')).toBe(false)
  })
```

Reemplazar la construcción del body esperado en el test `'llama PUT /api/me/preferences...'` (líneas 70-92) — cambiar cómo se marca "elegido" antes de guardar:

```js
  it('llama PUT /api/me/preferences con Bearer token, consent:true y el body construido del form, si hay consentimiento (hallazgo legal/seguridad: el servidor ahora exige consent explícito, no solo el cliente)', async () => {
    document.getElementById('consent-checkbox').checked = true
    document.querySelector('[data-dietary="vegan"]').classList.add('chosen')
    document.getElementById('allergen-cacahuate').checked = true
    document.getElementById('severity-cacahuate').value = 'severe'
    document.querySelector('[data-health="diabet"]').classList.add('chosen')
    getIdToken.mockResolvedValue('tok-123')
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    await savePreferences()

    expect(global.fetch).toHaveBeenCalledWith('/api/me/preferences', {
      method: 'PUT',
      headers: { Authorization: 'Bearer tok-123', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dietary: ['vegan'],
        allergens: [{ code: 'cacahuate', severity: 'severe' }],
        healthConditions: ['diabet'],
        consent: true,
        consentNoticeVersion: 'v1'
      })
    })
  })
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/preferences-ui.test.js`
Expected: falla porque `loadPreferencesIntoForm`/`buildPreferencesPayload` todavía leen `:checked`/`[name="dietary"]`, no `.chosen`/`[data-dietary]`.

- [ ] **Step 3: Implementación mínima**

En `preferences.html`, reemplazar los 2 primeros `<fieldset>` (Dietas y Condiciones de salud, líneas 61-67 y 81-87):

```html
        <fieldset>
          <legend>Dietas</legend>
          <div class="dietary-icon-grid" id="dietary-tiles">
            <button type="button" class="dietary-grid-item" data-dietary="vegan" aria-pressed="false"><span class="emoji">🌱</span><span class="label">Vegano</span></button>
            <button type="button" class="dietary-grid-item" data-dietary="vegetarian" aria-pressed="false"><span class="emoji">🥦</span><span class="label">Vegetariano</span></button>
            <button type="button" class="dietary-grid-item" data-dietary="keto" aria-pressed="false"><span class="emoji">🥑</span><span class="label">Keto</span></button>
            <button type="button" class="dietary-grid-item" data-dietary="glutenFree" aria-pressed="false"><span class="emoji">🌾</span><span class="label">Sin gluten</span></button>
          </div>
        </fieldset>
```

(...Alergias se queda igual por ahora, se toca en Task 7...)

```html
        <fieldset>
          <legend>Condiciones de salud</legend>
          <div class="dietary-icon-grid" id="health-tiles">
            <button type="button" class="dietary-grid-item" data-health="diabet" aria-pressed="false"><span class="emoji">🩸</span><span class="label">Diabetes</span></button>
            <button type="button" class="dietary-grid-item" data-health="celiac" aria-pressed="false"><span class="emoji">🌾</span><span class="label">Celiaquía</span></button>
            <button type="button" class="dietary-grid-item" data-health="hipert" aria-pressed="false"><span class="emoji">❤️</span><span class="label">Hipertensión</span></button>
            <button type="button" class="dietary-grid-item" data-health="ninos" aria-pressed="false"><span class="emoji">👶</span><span class="label">Niños en casa</span></button>
          </div>
        </fieldset>
```

En `preferences.html`, quitar del `<style>` inline la regla `#preferences-form label { display: block; ... }` (ya no aplica, los tiles no son `<label>`) y agregar:

```css
    #dietary-tiles, #health-tiles { margin-bottom: 4px; }
```

En `preferences-ui.js`, reemplazar `loadPreferencesIntoForm` y `buildPreferencesPayload`:

```js
export function loadPreferencesIntoForm() {
  const profile = getCachedProfile();
  const prefs = profile && profile.preferences;
  if (!prefs) return;

  (prefs.dietary || []).forEach(key => {
    const el = document.querySelector(`#dietary-tiles [data-dietary="${key}"]`);
    if (el) { el.classList.add('chosen'); el.setAttribute('aria-pressed', 'true'); }
  });
  (prefs.healthConditions || []).forEach(key => {
    const el = document.querySelector(`#health-tiles [data-health="${key}"]`);
    if (el) { el.classList.add('chosen'); el.setAttribute('aria-pressed', 'true'); }
  });
  (prefs.allergens || []).forEach(({ code, severity }) => {
    const checkbox = document.getElementById(`allergen-${code}`);
    const severitySelect = document.getElementById(`severity-${code}`);
    if (checkbox) checkbox.checked = true;
    if (severitySelect) severitySelect.value = severity;
  });
}

function buildPreferencesPayload() {
  const dietary = Array.from(document.querySelectorAll('#dietary-tiles [data-dietary].chosen')).map(el => el.dataset.dietary);
  const healthConditions = Array.from(document.querySelectorAll('#health-tiles [data-health].chosen')).map(el => el.dataset.health);
  const allergens = ALLERGEN_CODES
    .filter(code => document.getElementById(`allergen-${code}`)?.checked)
    .map(code => ({ code, severity: document.getElementById(`severity-${code}`).value }));
  return { dietary, allergens, healthConditions };
}

// Wiring de click para los tiles de toggle simple (dietas/condiciones de
// salud) — cada click alterna .chosen y aria-pressed. Alergias tiene su
// propio wiring en Task 7 (necesita mostrar/ocultar el toggle de severidad).
function setupPreferenceTiles() {
  document.querySelectorAll('#dietary-tiles [data-dietary], #health-tiles [data-health]').forEach(tile => {
    tile.addEventListener('click', () => {
      const chosen = tile.classList.toggle('chosen');
      tile.setAttribute('aria-pressed', String(chosen));
    });
  });
}
```

Agregar la llamada a `setupPreferenceTiles()` dentro del `DOMContentLoaded` existente, justo después de `loadPreferencesIntoForm();`:

```js
  loadPreferencesIntoForm();
  setupPreferenceTiles();
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/preferences-ui.test.js`
Expected: todos los tests pasan (los de guardado/borrado no tocados en este task siguen intactos porque solo cambia cómo se lee dietary/healthConditions, no la estructura general).

- [ ] **Step 5: Commit**

```bash
git add preferences.html preferences-ui.js tests/preferences-ui.test.js
git commit -m "feat(reskin): convert dietary/healthConditions checkboxes to icon-tile toggles in preferences.html"
```

---

### Task 7: `preferences.html`/`preferences-ui.js` — tiles de Alergias + severidad segmentada

**Files:**
- Modify: `preferences.html` (reemplaza checkbox+select de Alergias por tile+segmentado), `preferences-ui.js` (reescribe la parte de alergias en `loadPreferencesIntoForm`/`buildPreferencesPayload`, extiende `setupPreferenceTiles`)
- Test: `tests/preferences-ui.test.js` (actualiza el fixture y las aserciones de alergias)

**Interfaces:**
- Consumes: `.allergen-grid-item`/`.chosen`, `.severity-toggle` (Task 4).
- Produces: ninguna interfaz nueva hacia otros tasks — cierra `preferences.html`.

- [ ] **Step 1: Escribe el test que falla**

Actualizar el fixture (agregado en Task 6) para reemplazar las líneas de alergia por el nuevo markup:

```js
  document.body.innerHTML = `
    <form id="preferences-form">
      <div id="dietary-tiles">
        <button type="button" data-dietary="vegan">Vegano</button>
        <button type="button" data-dietary="glutenFree">Sin gluten</button>
      </div>
      <div id="health-tiles">
        <button type="button" data-health="diabet">Diabetes</button>
      </div>
      <div id="allergen-tiles">
        <button type="button" id="allergen-cacahuate" data-allergen="cacahuate">Cacahuate</button>
      </div>
      <div class="severity-toggle hidden" id="severity-cacahuate">
        <button type="button" data-severity="mild">Aviso</button>
        <button type="button" data-severity="severe">Estricto</button>
      </div>
      <div class="consent-block">
        <input type="checkbox" id="consent-checkbox" required>
        <p id="consent-error" class="hidden" role="alert"></p>
      </div>
      <button type="submit" id="btn-save-preferences">Guardar</button>
    </form>
    <button id="btn-delete-preferences">Borrar mis preferencias</button>
    <p id="preferences-error" class="hidden" role="alert"></p>
    <p id="preferences-success" class="hidden" role="status"></p>
  `
```

Reemplazar el test de `loadPreferencesIntoForm` (de Task 6) para verificar también el tile de alergia:

```js
  it('marca los tiles de dietary/healthConditions/allergens con .chosen y activa la severidad correcta según el perfil cacheado', () => {
    getCachedProfile.mockReturnValue({
      plan: 'premium',
      preferences: { dietary: ['vegan'], allergens: [{ code: 'cacahuate', severity: 'severe' }], healthConditions: ['diabet'] }
    })
    loadPreferencesIntoForm()
    expect(document.querySelector('[data-dietary="vegan"]').classList.contains('chosen')).toBe(true)
    expect(document.querySelector('[data-health="diabet"]').classList.contains('chosen')).toBe(true)
    expect(document.getElementById('allergen-cacahuate').classList.contains('chosen')).toBe(true)
    const toggle = document.getElementById('severity-cacahuate')
    expect(toggle.classList.contains('hidden')).toBe(false)
    expect(toggle.querySelector('[data-severity="severe"]').classList.contains('active')).toBe(true)
    expect(toggle.querySelector('[data-severity="mild"]').classList.contains('active')).toBe(false)
  })
```

Actualizar el test de guardado (de Task 6) para marcar el tile de alergia en vez del checkbox nativo:

```js
  it('llama PUT /api/me/preferences con Bearer token, consent:true y el body construido del form, si hay consentimiento (hallazgo legal/seguridad: el servidor ahora exige consent explícito, no solo el cliente)', async () => {
    document.getElementById('consent-checkbox').checked = true
    document.querySelector('[data-dietary="vegan"]').classList.add('chosen')
    document.getElementById('allergen-cacahuate').classList.add('chosen')
    document.getElementById('severity-cacahuate').querySelector('[data-severity="severe"]').classList.add('active')
    document.querySelector('[data-health="diabet"]').classList.add('chosen')
    getIdToken.mockResolvedValue('tok-123')
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    await savePreferences()

    expect(global.fetch).toHaveBeenCalledWith('/api/me/preferences', {
      method: 'PUT',
      headers: { Authorization: 'Bearer tok-123', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dietary: ['vegan'],
        allergens: [{ code: 'cacahuate', severity: 'severe' }],
        healthConditions: ['diabet'],
        consent: true,
        consentNoticeVersion: 'v1'
      })
    })
  })
```

Agregar un test nuevo de interacción de click (nuevo `describe`, al final del archivo):

```js

describe('setupPreferenceTiles — interacción de alergias', () => {
  it('togglear un tile de alergeno muestra/oculta su toggle de severidad, con "Aviso" activo por default', async () => {
    // setupPreferenceTiles corre en DOMContentLoaded, que jsdom ya disparó
    // antes de este test (el módulo se importó en beforeEach) — se dispara
    // el evento a mano para asegurar el wiring en este entorno de test.
    document.dispatchEvent(new Event('DOMContentLoaded'))
    const tile = document.getElementById('allergen-cacahuate')
    const toggle = document.getElementById('severity-cacahuate')

    tile.click()
    expect(tile.classList.contains('chosen')).toBe(true)
    expect(toggle.classList.contains('hidden')).toBe(false)
    expect(toggle.querySelector('[data-severity="mild"]').classList.contains('active')).toBe(true)

    tile.click()
    expect(tile.classList.contains('chosen')).toBe(false)
    expect(toggle.classList.contains('hidden')).toBe(true)
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/preferences-ui.test.js`
Expected: falla porque `loadPreferencesIntoForm`/`buildPreferencesPayload` todavía leen el checkbox/select nativo para alergias.

- [ ] **Step 3: Implementación mínima**

En `preferences.html`, reemplazar el `<fieldset>` de Alergias:

```html
        <fieldset>
          <legend>Alergias</legend>
          <div class="allergen-icon-grid" id="allergen-tiles">
            <button type="button" class="allergen-grid-item" id="allergen-cacahuate" data-allergen="cacahuate" aria-pressed="false"><span class="emoji">🥜</span><span class="label">Cacahuate</span></button>
            <button type="button" class="allergen-grid-item" id="allergen-lacteos" data-allergen="lacteos" aria-pressed="false"><span class="emoji">🥛</span><span class="label">Lácteos</span></button>
          </div>
          <div class="severity-toggle hidden" id="severity-cacahuate">
            <button type="button" data-severity="mild">Aviso</button>
            <button type="button" data-severity="severe">Estricto</button>
          </div>
          <div class="severity-toggle hidden" id="severity-lacteos">
            <button type="button" data-severity="mild">Aviso</button>
            <button type="button" data-severity="severe">Estricto</button>
          </div>
        </fieldset>
```

En `preferences.html`, quitar del `<style>` inline la regla `.allergen-row { ... }` (ya no aplica, sin `<div>` de fila nativa).

En `preferences-ui.js`, reemplazar `loadPreferencesIntoForm` y `buildPreferencesPayload` (última vez, versión final):

```js
export function loadPreferencesIntoForm() {
  const profile = getCachedProfile();
  const prefs = profile && profile.preferences;
  if (!prefs) return;

  (prefs.dietary || []).forEach(key => {
    const el = document.querySelector(`#dietary-tiles [data-dietary="${key}"]`);
    if (el) { el.classList.add('chosen'); el.setAttribute('aria-pressed', 'true'); }
  });
  (prefs.healthConditions || []).forEach(key => {
    const el = document.querySelector(`#health-tiles [data-health="${key}"]`);
    if (el) { el.classList.add('chosen'); el.setAttribute('aria-pressed', 'true'); }
  });
  (prefs.allergens || []).forEach(({ code, severity }) => {
    const tile = document.getElementById(`allergen-${code}`);
    const toggle = document.getElementById(`severity-${code}`);
    if (tile) { tile.classList.add('chosen'); tile.setAttribute('aria-pressed', 'true'); }
    if (toggle) {
      toggle.classList.remove('hidden');
      toggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.severity === severity));
    }
  });
}

function buildPreferencesPayload() {
  const dietary = Array.from(document.querySelectorAll('#dietary-tiles [data-dietary].chosen')).map(el => el.dataset.dietary);
  const healthConditions = Array.from(document.querySelectorAll('#health-tiles [data-health].chosen')).map(el => el.dataset.health);
  const allergens = ALLERGEN_CODES
    .filter(code => document.getElementById(`allergen-${code}`)?.classList.contains('chosen'))
    .map(code => ({
      code,
      severity: document.querySelector(`#severity-${code} button.active`)?.dataset.severity || 'mild'
    }));
  return { dietary, allergens, healthConditions };
}

function setupPreferenceTiles() {
  document.querySelectorAll('#dietary-tiles [data-dietary], #health-tiles [data-health]').forEach(tile => {
    tile.addEventListener('click', () => {
      const chosen = tile.classList.toggle('chosen');
      tile.setAttribute('aria-pressed', String(chosen));
    });
  });

  ALLERGEN_CODES.forEach(code => {
    const tile = document.getElementById(`allergen-${code}`);
    const toggle = document.getElementById(`severity-${code}`);
    if (!tile || !toggle) return;

    tile.addEventListener('click', () => {
      const chosen = tile.classList.toggle('chosen');
      tile.setAttribute('aria-pressed', String(chosen));
      toggle.classList.toggle('hidden', !chosen);
      if (chosen && !toggle.querySelector('button.active')) {
        toggle.querySelector('[data-severity="mild"]').classList.add('active');
      }
    });

    toggle.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        toggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  });
}
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/preferences-ui.test.js`
Expected: `Test Files 1 passed (1)`, todos los tests pasan.

- [ ] **Step 5: Commit**

```bash
git add preferences.html preferences-ui.js tests/preferences-ui.test.js
git commit -m "feat(reskin): convert allergen checkbox+select to icon-tile + segmented severity toggle"
```

---

### Task 8: `history.html`/`history-ui.js` — panel único con cards de veredicto real

**Files:**
- Modify: `history.html` (simplifica `<style>` inline), `history-ui.js` (envuelve el contenido en un `.content-card`, usa `.row-card` para cada entrada)
- Test: `tests/history-ui.test.js` (los 2 tests existentes NO deberían romperse — mismos selectores `.history-locked-block`/`root.textContent`; se agrega 1 test nuevo)

**Interfaces:**
- Consumes: `.row-card`, `.verdict-sano`/`.verdict-regular`/`.verdict-evitar` (ya existentes en `styles.css`, usadas por `scan.html`).
- Produces: ninguna interfaz nueva — cierra el reskin.

- [ ] **Step 1: Escribe el test que falla**

Agregar un test nuevo al final de `tests/history-ui.test.js`:

```js

describe('renderHistoryScreen — estructura visual', () => {
  it('envuelve el contenido en un único .content-card, no en cards sueltas (hallazgo de reskin visual)', async () => {
    getCachedProfile.mockReturnValue({ plan: 'free' })
    await renderHistoryScreen()
    const root = document.getElementById('history-root')
    expect(root.querySelectorAll(':scope > .content-card').length).toBe(1)
  })
})
```

- [ ] **Step 2: Corre el test, verifica que falla**

Run: `npx vitest run tests/history-ui.test.js`
Expected: falla, `root.querySelectorAll(':scope > .content-card').length` es `0` (el markup actual no tiene `.content-card`).

- [ ] **Step 3: Implementación mínima**

Reemplazar `history-ui.js` completo:

```js
import { getIdToken, getCachedProfile } from './authClient.js';

function renderLocalHistoryWithUpsell(root) {
  const localHistory = window.getLocalHistory ? window.getLocalHistory() : [];
  const itemsHtml = localHistory.map(h => `
    <div class="row-card">
      <span class="verdict-badge verdict-${h.rating}">${h.rating}</span>
      <p>${h.name}</p>
    </div>
  `).join('');

  root.innerHTML = `
    <div class="content-card">
      ${itemsHtml || '<p class="account-empty">Aún no tienes escaneos.</p>'}
      <div class="history-locked-block">
        <div class="history-locked-overlay">
          <p>Ya sabemos qué trae este producto. Ahora dinos qué NO puedes comer tú o tu familia,
          y Yomi revisa cada escaneo contra tu perfil antes de que muerdas.</p>
          <a href="preferences.html" class="btn btn-primary">Configurar mis preferencias</a>
        </div>
      </div>
    </div>
  `;
}

async function renderCloudHistory(root) {
  const token = await getIdToken();
  const res = await fetch('/api/me/history', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    root.innerHTML = '<div class="content-card"><p class="account-empty">No se pudo cargar tu historial. Intenta de nuevo.</p></div>';
    return;
  }
  const { history } = await res.json();
  const itemsHtml = history.map(h => `
    <div class="row-card">
      <span class="verdict-badge verdict-${h.verdict}">${h.verdict}</span>
      <p>${h.productName}</p>
    </div>
  `).join('') || '<p class="account-empty">Aún no tienes escaneos.</p>';
  root.innerHTML = `<div class="content-card">${itemsHtml}</div>`;
}

export async function renderHistoryScreen() {
  const root = document.getElementById('history-root');
  if (!root) return;
  const profile = getCachedProfile();

  if (!profile || profile.plan !== 'premium') {
    renderLocalHistoryWithUpsell(root);
    return;
  }
  await renderCloudHistory(root);
}

document.addEventListener('DOMContentLoaded', renderHistoryScreen);
```

Reemplazar el `<style>` inline de `history.html` (ya no hace falta el override de layout de `#history-root`, el `.content-card` de adentro maneja su propio ancho/margen):

```html
  <style>
    .hidden{display:none!important}
    /* Card teaser simple, sin blur (hallazgo visual previo: un filter:blur en
       el padre no se puede "cancelar" con filter:none en el hijo). No hay
       datos reales que ocultar aquí, solo un mensaje de upsell. */
    .history-locked-block{padding:20px;border-radius:12px;background:var(--paper);border:1.5px solid var(--border);margin-top:12px;text-align:center}
    .history-locked-overlay{display:flex;flex-direction:column;align-items:center;gap:10px}
  </style>
```

- [ ] **Step 4: Corre el test, verifica que pasa**

Run: `npx vitest run tests/history-ui.test.js`
Expected: `Test Files 1 passed (1)`, los 2 tests originales + el nuevo pasan.

- [ ] **Step 5: Commit**

```bash
git add history.html history-ui.js tests/history-ui.test.js
git commit -m "feat(reskin): history.html single-panel reskin with row-card entries"
```

---

## Notas para quien ejecute el plan

- `auth.html` NO requiere cambios en este plan — ya usa `.content-card`/`.form-field`/`.form-input` desde la ronda de UX anterior, y ya satisface "un solo panel blanco dominante" (no tiene múltiples cards sueltas como tenían `account.html`/`history.html`). Sin hero oscuro ni stats porque no aplica sin sesión.
- Verificación visual manual obligatoria al final de los 8 tasks: deploy a preview de Vercel + Playwright, mismo patrón usado toda la sesión anterior (screenshot + `getBoundingClientRect` para overlaps, probar el flujo signup → Perfil → Preferencias → Análisis completo).
- Emoji elegidos para "Condiciones de salud" (🩸 diabetes, 🌾 celiaquía, ❤️ hipertensión, 👶 niños en casa) son nuevos — no existían en el vocabulario visual del app (`COMMON_ALLERGENS`/`renderDietaryBadges` no los cubren, son campos de salud, no alérgenos/dietas de producto). 🌾 se reusa intencionalmente entre "Sin gluten" (dieta) y "Celiaquía" (condición) — están relacionados semánticamente y viven en fieldsets distintos, no hay confusión visual real.
- El campo `usage.totalScans` empieza en `0` solo para usuarios CREADOS después de este plan (`fireUpsertUser`). Usuarios ya existentes (creados en la sesión anterior) no tienen ese campo hasta su primer incremento — `fireIncrementUsageCounter` ya lo trata como `0` si está ausente (Task 1, test "trata totalScans ausente como 0"), así que no hace falta una migración de datos.
