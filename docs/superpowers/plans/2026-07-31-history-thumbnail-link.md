# Thumbnail + link a scan en historial de Análisis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada item del historial en `history.html` (pestaña "Análisis") muestra un thumbnail del producto y navega a `scan.html?barcode=X` al hacer click, en las dos ramas (local para usuarios sin membresía activa, nube para premium).

**Architecture:** Backend acepta y devuelve un campo `image` opcional (string URL) en el historial de Firestore, transparente vía las funciones genéricas `toFirestoreFields`/`fromFirestoreFields` ya existentes. `app.js` empieza a enviar `product.image` al loguear en la nube. `history-ui.js` agrega thumbnail + hace toda la row-card clickeable en ambas ramas de render, reusando el patrón visual de placeholder que ya usa `home.js` (duplicado localmente porque `history.html` no comparte scope de script con `home.js`).

**Tech Stack:** Node/Express (api/index.js), REST Firestore client (api/firestore.js, sin cambios), vanilla JS + Vitest/jsdom (app.js, history-ui.js).

## Global Constraints

- `image` es opcional y cosmético: si falta, es inválido, o excede el límite de longitud, la petición NO se rechaza — el campo simplemente se omite (mismo criterio que el resto del endpoint, pero sin bloquear por esto).
- Límite: `MAX_IMAGE_URL_LEN = 500` caracteres, mismo patrón que `MAX_BARCODE_LEN`/`MAX_PRODUCT_NAME_LEN` en `api/index.js:1895-1896`.
- Sin backfill de imágenes para entradas de historial ya guardadas en Firestore sin `image` — deben caer a placeholder sin romper el render.
- No tocar `home.js` ni el historial de `index.html` — solo sirve de referencia visual.
- No tocar `api/firestore.js` — `fireLogUserHistory`/`fireListUserHistory` ya son genéricos.

---

### Task 1: Backend acepta y persiste `image` opcional en `POST /api/me/history`

**Files:**
- Modify: `api/index.js:1894-1920` (`postHistoryHandler`, constantes `MAX_BARCODE_LEN`/`MAX_PRODUCT_NAME_LEN`)
- Test: `tests/meHistory.test.js`

**Interfaces:**
- Consumes: nada nuevo (usa `fireLogUserHistory(uid, entry)` ya existente, sin cambios de firma).
- Produces: `postHistoryHandler` ahora incluye `image` en el `entry` pasado a `fireLogUserHistory` cuando el body trae un `image` válido. `getHistoryHandler` no cambia (ya retorna todos los campos del doc).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `tests/meHistory.test.js`, dentro del `describe('postHistoryHandler', ...)` existente (después del test actual en línea 30-37):

```javascript
  it('incluye image en el entry cuando el body trae una URL string válida', async () => {
    fireLogUserHistory.mockResolvedValue({ id: 'abc' })
    const req = { user: { uid: 'uid-2' }, body: { barcode: '111', productName: 'A', verdict: 'sano', image: 'https://example.com/p.jpg' } }
    const res = makeRes()
    await postHistoryHandler(req, res)
    expect(fireLogUserHistory).toHaveBeenCalledWith('uid-2', expect.objectContaining({ image: 'https://example.com/p.jpg' }))
  })

  it('omite image silenciosamente si no viene en el body (no rompe el log)', async () => {
    fireLogUserHistory.mockResolvedValue({ id: 'abc' })
    const req = { user: { uid: 'uid-2' }, body: { barcode: '111', productName: 'A', verdict: 'sano' } }
    const res = makeRes()
    await postHistoryHandler(req, res)
    const entry = fireLogUserHistory.mock.calls[0][1]
    expect(entry.image).toBeUndefined()
    expect(res.body).toEqual({ ok: true, id: 'abc' })
  })

  it('omite image silenciosamente si excede MAX_IMAGE_URL_LEN (no rechaza la petición)', async () => {
    fireLogUserHistory.mockResolvedValue({ id: 'abc' })
    const longUrl = 'https://example.com/' + 'a'.repeat(500)
    const req = { user: { uid: 'uid-2' }, body: { barcode: '111', productName: 'A', verdict: 'sano', image: longUrl } }
    const res = makeRes()
    await postHistoryHandler(req, res)
    const entry = fireLogUserHistory.mock.calls[0][1]
    expect(entry.image).toBeUndefined()
    expect(res.body).toEqual({ ok: true, id: 'abc' })
  })

  it('omite image silenciosamente si no es un string', async () => {
    fireLogUserHistory.mockResolvedValue({ id: 'abc' })
    const req = { user: { uid: 'uid-2' }, body: { barcode: '111', productName: 'A', verdict: 'sano', image: 12345 } }
    const res = makeRes()
    await postHistoryHandler(req, res)
    const entry = fireLogUserHistory.mock.calls[0][1]
    expect(entry.image).toBeUndefined()
  })
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/meHistory.test.js`
Expected: los 4 tests nuevos fallan (los 2 primeros porque `image` nunca se pasa a `fireLogUserHistory`; el de "excede el límite" y el de "no es string" en realidad pasan de casualidad porque `entry.image` ya es `undefined` — pero el primero, el de URL válida, falla).

- [ ] **Step 3: Implementación mínima**

En `api/index.js`, junto a las constantes existentes (línea 1895-1896):

```javascript
const MAX_BARCODE_LEN = 32;
const MAX_PRODUCT_NAME_LEN = 200;
const MAX_IMAGE_URL_LEN = 500;
```

Reemplazar `postHistoryHandler` (líneas 1898-1920):

```javascript
async function postHistoryHandler(req, res) {
  try {
    const { barcode, productName, verdict, image } = req.body || {};
    if (!barcode || !productName || !verdict) return res.status(400).json({ error: 'invalid_history_entry' });
    if (typeof barcode !== 'string' || barcode.length > MAX_BARCODE_LEN) {
      return res.status(400).json({ error: 'invalid_barcode' });
    }
    if (typeof productName !== 'string' || productName.length > MAX_PRODUCT_NAME_LEN) {
      return res.status(400).json({ error: 'invalid_product_name' });
    }
    if (!ALLOWED_VERDICTS.includes(verdict)) {
      return res.status(400).json({ error: 'invalid_verdict' });
    }

    const entry = {
      barcode, productName: productName.slice(0, MAX_PRODUCT_NAME_LEN), verdict, scannedAt: new Date().toISOString()
    };
    if (typeof image === 'string' && image.length > 0 && image.length <= MAX_IMAGE_URL_LEN) {
      entry.image = image;
    }

    const { id } = await fireLogUserHistory(req.user.uid, entry);
    res.json({ ok: true, id });
  } catch (e) {
    console.warn('[POST /api/me/history] Firestore error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/meHistory.test.js`
Expected: PASS (6 tests: 2 originales + 4 nuevos)

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/meHistory.test.js
git commit -m "feat(history): backend acepta image opcional en POST /api/me/history"
```

---

### Task 2: `app.js` envía `product.image` al loguear en la nube

**Files:**
- Modify: `app.js:1761-1774` (`logScanToCloudHistory`), `app.js:1836` (call site en `renderProductData`)
- Test: `tests/app.test.js`

**Interfaces:**
- Consumes: ninguno nuevo.
- Produces: `logScanToCloudHistory(barcode, productName, verdict, image)` — nuevo 4to parámetro opcional. `renderProductData` lo llama con `product.image`.

- [ ] **Step 1: Actualizar el test existente y agregar el caso nuevo**

En `tests/app.test.js`, el test `'POSTea a /api/me/history con Bearer token para un usuario premium'` (línea ~688-698) cambia su `body` esperado y su llamada:

```javascript
  it('POSTea a /api/me/history con Bearer token para un usuario premium', async () => {
    window.authClient = {
      getCachedProfile: () => ({ membershipStatus: 'active' }),
      getIdToken: vi.fn().mockResolvedValue('tok-789')
    }
    await logScanToCloudHistory('111', 'Producto A', 'sano', 'https://example.com/p.jpg')
    expect(global.fetch).toHaveBeenCalledWith('/api/me/history', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-789', 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: '111', productName: 'Producto A', verdict: 'sano', image: 'https://example.com/p.jpg' })
    })
  })

  it('POSTea sin campo image cuando no se pasa (producto sin imagen)', async () => {
    window.authClient = {
      getCachedProfile: () => ({ membershipStatus: 'active' }),
      getIdToken: vi.fn().mockResolvedValue('tok-789')
    }
    await logScanToCloudHistory('111', 'Producto A', 'sano')
    expect(global.fetch).toHaveBeenCalledWith('/api/me/history', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-789', 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: '111', productName: 'Producto A', verdict: 'sano' })
    })
  })
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/app.test.js -t "logScanToCloudHistory"`
Expected: el primer test (con imagen) falla porque el body actual no incluye `image`; el segundo (sin imagen) pasa de por sí.

- [ ] **Step 3: Implementación mínima**

En `app.js`, reemplazar `logScanToCloudHistory` (líneas 1761-1774):

```javascript
async function logScanToCloudHistory(barcode, productName, verdict, image) {
  if (typeof window === 'undefined' || !window.authClient) return;
  const profile = window.authClient.getCachedProfile();
  if (!profile || profile.membershipStatus !== 'active') return;

  try {
    const token = await window.authClient.getIdToken();
    const body = { barcode, productName, verdict };
    if (image) body.image = image;
    await fetch('/api/me/history', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
```

(la siguiente línea del `catch` existente no cambia — mantener el resto de la función tal cual está.)

Y el call site en `renderProductData` (línea 1836):

```javascript
  logScanToCloudHistory(barcode, product.name, verdict, product.image);
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/app.test.js`
Expected: PASS (toda la suite de `app.test.js`, no solo `logScanToCloudHistory`)

- [ ] **Step 5: Commit**

```bash
git add app.js tests/app.test.js
git commit -m "feat(history): app.js envia product.image al historial en la nube"
```

---

### Task 3: `history-ui.js` — thumbnail + row-card clickeable en ambas ramas

**Files:**
- Modify: `history-ui.js` (completo — funciones `renderLocalHistoryWithUpsell`, `renderCloudHistory`, agregar helpers `imgHtml`/`placeholderSvg` y wiring de click)
- Test: `tests/history-ui.test.js`

**Interfaces:**
- Consumes: `item.image` (rama local, ya existe en `getLocalHistory()`) y `h.image` (rama nube, nuevo campo que ahora puede venir de `GET /api/me/history` gracias a Task 1).
- Produces: nada consumido por otros archivos — `history-ui.js` es hoja del árbol de imports.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `tests/history-ui.test.js`, después del `describe('renderHistoryScreen — botón de compartir (usuario premium, historial cloud)', ...)` (línea 100):

```javascript
describe('renderHistoryScreen — thumbnail', () => {
  it('muestra la imagen del producto cuando item.image existe (historial local)', async () => {
    window.getLocalHistory.mockReturnValue([
      { barcode: '111', name: 'Producto A', brand: 'Marca', image: 'https://example.com/a.jpg', rating: 'sano' }
    ])
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const img = document.querySelector('#history-root .row-card img')
    expect(img.src).toBe('https://example.com/a.jpg')
  })

  it('muestra un placeholder cuando item.image esta vacio (historial local)', async () => {
    window.getLocalHistory.mockReturnValue([
      { barcode: '111', name: 'Producto A', brand: 'Marca', image: '', rating: 'sano' }
    ])
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const root = document.getElementById('history-root')
    expect(root.querySelector('.row-card img')).toBeNull()
    expect(root.querySelector('.row-card .history-thumb-placeholder')).toBeTruthy()
  })

  it('muestra la imagen del producto cuando el entry de la nube trae image (historial premium)', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'active' })
    getIdToken.mockResolvedValue('tok-1')
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ history: [
        { barcode: '111', productName: 'Producto A', verdict: 'sano', scannedAt: '2026-07-15T10:00:00.000Z', image: 'https://example.com/a.jpg' }
      ] })
    })
    await renderHistoryScreen()
    const img = document.querySelector('#history-root .row-card img')
    expect(img.src).toBe('https://example.com/a.jpg')
  })

  it('muestra un placeholder cuando el entry de la nube no trae image', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'active' })
    getIdToken.mockResolvedValue('tok-1')
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ history: [
        { barcode: '111', productName: 'Producto A', verdict: 'sano', scannedAt: '2026-07-15T10:00:00.000Z' }
      ] })
    })
    await renderHistoryScreen()
    const root = document.getElementById('history-root')
    expect(root.querySelector('.row-card img')).toBeNull()
    expect(root.querySelector('.row-card .history-thumb-placeholder')).toBeTruthy()
  })
})

describe('renderHistoryScreen — click navega a scan.html', () => {
  let originalLocation

  beforeEach(() => {
    originalLocation = window.location
    delete window.location
    window.location = { href: '' }
  })

  afterEach(() => {
    window.location = originalLocation
  })

  it('click en la row-card (historial local) navega a scan.html?barcode=X', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const card = document.querySelector('#history-root .row-card')
    card.click()
    expect(window.location.href).toBe('scan.html?barcode=111')
  })

  it('click en el boton de compartir NO navega (stopPropagation)', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'pending' })
    await renderHistoryScreen()
    const shareBtn = document.querySelector('#history-root .row-card .share-btn')
    shareBtn.click()
    expect(window.location.href).toBe('')
  })

  it('click en la row-card (historial cloud) navega a scan.html?barcode=X', async () => {
    getCachedProfile.mockReturnValue({ membershipStatus: 'active' })
    getIdToken.mockResolvedValue('tok-1')
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ history: [
        { barcode: '222', productName: 'Producto B', verdict: 'evitar', scannedAt: '2026-07-14T10:00:00.000Z' }
      ] })
    })
    await renderHistoryScreen()
    const card = document.querySelector('#history-root .row-card')
    card.click()
    expect(window.location.href).toBe('scan.html?barcode=222')
  })
})
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/history-ui.test.js`
Expected: FAIL en los 8 tests nuevos (no existe `<img>`, `.history-thumb-placeholder`, ni click handler todavía).

- [ ] **Step 3: Implementación mínima**

Reemplazar el contenido completo de `history-ui.js`:

```javascript
import { getIdToken, getCachedProfile } from './authClient.js';

function placeholderSvg() {
  return "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>');
}

function imgHtml(image) {
  if (image) {
    return `<img class="history-thumb" src="${escHtml(image)}" alt="" onerror="this.onerror=null;this.src='${placeholderSvg()}'">`;
  }
  return `<div class="history-thumb-placeholder">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0d3d35" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
    </svg>
  </div>`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function wireRowCards(root) {
  root.querySelectorAll('.row-card').forEach(card => {
    const barcode = card.dataset.barcode;
    const goToScan = () => { window.location.href = 'scan.html?barcode=' + encodeURIComponent(barcode); };
    card.addEventListener('click', goToScan);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToScan(); }
    });
  });
  root.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      window.shareResult({ name: btn.dataset.name, verdict: btn.dataset.verdict, barcode: btn.dataset.barcode }, btn);
    });
  });
}

function renderLocalHistoryWithUpsell(root) {
  const localHistory = window.getLocalHistory ? window.getLocalHistory() : [];
  const itemsHtml = localHistory.map(h => `
    <div class="row-card" data-barcode="${escHtml(h.barcode)}" role="button" tabindex="0">
      ${imgHtml(h.image)}
      <span class="verdict-badge verdict-${h.rating}">${h.rating}</span>
      <p class="history-item-name">${h.name}</p>
      <button type="button" class="share-btn" data-name="${h.name}" data-verdict="${h.rating}" data-barcode="${h.barcode}" aria-label="Compartir">↗</button>
    </div>
  `).join('');

  root.innerHTML = `
    <div class="content-card">
      ${itemsHtml || '<p class="account-empty">Aún no tienes escaneos.</p>'}
      <div class="row-card history-upsell">
        <div class="icon-wrap" style="background:rgba(245,166,35,0.15);">🔓</div>
        <div>
          <p class="about-text">Ya sabemos qué trae este producto. Ahora dinos qué NO puedes comer tú o tu familia,
          y Yomi revisa cada escaneo contra tu perfil antes de que muerdas.</p>
          <a href="preferences.html" class="btn btn-primary">Configurar mis preferencias</a>
        </div>
      </div>
    </div>
  `;
  wireRowCards(root);
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
    <div class="row-card" data-barcode="${escHtml(h.barcode)}" role="button" tabindex="0">
      ${imgHtml(h.image)}
      <span class="verdict-badge verdict-${h.verdict}">${h.verdict}</span>
      <p class="history-item-name">${h.productName}</p>
      <button type="button" class="share-btn" data-name="${h.productName}" data-verdict="${h.verdict}" data-barcode="${h.barcode}" aria-label="Compartir">↗</button>
    </div>
  `).join('') || '<p class="account-empty">Aún no tienes escaneos.</p>';
  root.innerHTML = `<div class="content-card">${itemsHtml}</div>`;
  wireRowCards(root);
}

export async function renderHistoryScreen() {
  const root = document.getElementById('history-root');
  if (!root) return;
  const profile = getCachedProfile();

  if (!profile || profile.membershipStatus !== 'active') {
    renderLocalHistoryWithUpsell(root);
    return;
  }
  await renderCloudHistory(root);
}

document.addEventListener('DOMContentLoaded', renderHistoryScreen);
```

Nota: el `data-barcode` del `.row-card` en la rama local usa `h.barcode` sin `escHtml` en el atributo del botón compartir (igual que el código original, sin cambios ahí) — pero en el `data-barcode` de la `.row-card` sí se aplica `escHtml` porque es un atributo nuevo que agregamos.

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/history-ui.test.js`
Expected: PASS (13 tests: 5 originales + 8 nuevos)

- [ ] **Step 5: Agregar estilos mínimos para el thumbnail**

`.row-card` ya vive en `home.css:671-678` con `display: flex; align-items: center; gap: 10px` — no tocar esa regla. Agregar justo después (línea 678, después de `.row-card:first-child`):

```css
.history-thumb, .history-thumb-placeholder {
  width: 44px; height: 44px; border-radius: 8px; flex-shrink: 0;
  object-fit: cover; background: #f0f0f0;
  display: flex; align-items: center; justify-content: center;
}
```

- [ ] **Step 6: Correr toda la suite para verificar que no rompió nada**

Run: `npx vitest run`
Expected: PASS (toda la suite, incluyendo `tests/history-ui.test.js`, `tests/app.test.js`, `tests/meHistory.test.js`)

- [ ] **Step 7: Commit**

```bash
git add history-ui.js tests/history-ui.test.js home.css
git commit -m "feat(history): thumbnail + click a scan.html en historial de Analisis"
```

---

## Self-Review Notes

- **Cobertura del spec:** Task 1 cubre "Backend" del spec, Task 2 cubre "Cliente — app.js", Task 3 cubre "UI — history-ui.js" (ambas ramas + share button stopPropagation). Compatibilidad con entradas sin `image` cubierta explícitamente en tests de ambas ramas (Task 3).
- **Sin placeholders:** todos los steps tienen código completo, no hay "TBD"/"similar a".
- **Consistencia de tipos:** `logScanToCloudHistory(barcode, productName, verdict, image)` en Task 2 coincide con el call site `logScanToCloudHistory(barcode, product.name, verdict, product.image)`. `entry.image` en Task 1 coincide con el campo que Task 3 lee (`h.image`) vía `GET /api/me/history` (que retorna todos los campos del doc sin transformación).
