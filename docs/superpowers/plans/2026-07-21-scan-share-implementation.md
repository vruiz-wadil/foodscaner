# Compartir resultado de escaneo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un botón "Compartir" en el resultado de escaneo (`scan.html`) y en cada entrada del historial (`history.html`), usando Web Share API nativo con fallback a portapapeles.

**Architecture:** Módulo nuevo `share.js` (script clásico, sin `import`/`export` — `app.js` que lo consume en `scan.html` también es clásico, no ES module) expone `window.shareResult`/`window.buildShareText`, mismo patrón que ya usa `app.js` para exponerle `window.getLocalHistory` a `history-ui.js` (un ES module). Cero cambios de backend, cero CSP nuevo.

**Tech Stack:** Vanilla JS (sin frameworks, consistente con el resto del proyecto), Web Share API + Clipboard API (nativas del navegador), Vitest.

## Global Constraints

- `share.js` es un **script clásico** (sin `import`/`export`) — se carga con `<script src="share.js"></script>` normal (sin `type="module"`, sin `defer`), colocado ANTES de `app.js`/`history-ui.js` en cada página, para que `window.shareResult` exista cuando esos scripts corran.
- Texto compartido: `"{nombre}: {SANO|REGULAR|EVITAR} — descúbrelo tú con Yomi"`. Veredicto en mayúsculas planas, NO el texto con emoji de `#verdict-banner` (son cosas distintas).
- Link fijo: `https://yomi.mx/?utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result` — mismo link para cualquier producto, no hay página pública por escaneo.
- `AbortError` de `navigator.share()` (usuario canceló el share sheet) es silencioso — nunca cae a clipboard ni muestra error.
- Cualquier otro fallo de `navigator.share()`, o su ausencia, cae a `navigator.clipboard.writeText()` + cambio temporal (~2s) del texto del botón a "Copiado".
- Si `navigator.clipboard` tampoco existe: `console.warn`, sin UI de error — compartir es siempre best-effort, nunca bloquea el flujo de escaneo.
- No se toca el shape de `getHistory()` (local) ni de `/api/me/history` (cloud) — la normalización de campos (`name`/`rating` vs `productName`/`verdict`) ocurre en `history-ui.js` al armar cada `row-card`, no en el backend.

---

### Task 1: `share.js` — lógica de compartir

**Files:**
- Create: `share.js`
- Test: `tests/share.test.js`

**Interfaces:**
- Produces: `buildShareText(name: string, verdict: 'sano'|'regular'|'evitar'): string`, `shareResult({ name, verdict }: { name: string, verdict: string }, triggerButton?: HTMLElement): Promise<void>`. Ambas expuestas como `window.buildShareText`/`window.shareResult` (efecto secundario del script clásico) y como bindings locales (para que el test las extraiga vía `new Function`, mismo patrón que `tests/app.test.js` usa con `app.js`).
- Consumes: nada de otros archivos del proyecto (módulo autocontenido, solo APIs nativas del navegador).

- [ ] **Step 1: Escribe el test completo**

Crea `tests/share.test.js`:

```js
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const shareCode = fs.readFileSync(path.join(__dirname, '..', 'share.js'), 'utf8')

let buildShareText, shareResult

beforeAll(() => {
  const fn = new Function(shareCode + '\nreturn { buildShareText, shareResult }')
  const exports = fn()
  buildShareText = exports.buildShareText
  shareResult = exports.shareResult
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildShareText', () => {
  it('formats the product name and verdict in plain caps, distinct from the emoji verdict-banner text', () => {
    expect(buildShareText('Gamesa Emperador', 'evitar')).toBe('Gamesa Emperador: EVITAR — descúbrelo tú con Yomi')
    expect(buildShareText('Yogurt Natural', 'sano')).toBe('Yogurt Natural: SANO — descúbrelo tú con Yomi')
    expect(buildShareText('Cereal X', 'regular')).toBe('Cereal X: REGULAR — descúbrelo tú con Yomi')
  })
})

describe('shareResult — navigator.share available', () => {
  it('calls navigator.share with title/text/url and never touches the clipboard', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { share, clipboard: { writeText } })

    await shareResult({ name: 'Gamesa Emperador', verdict: 'evitar' })

    expect(share).toHaveBeenCalledWith({
      title: 'Yomi',
      text: 'Gamesa Emperador: EVITAR — descúbrelo tú con Yomi',
      url: 'https://yomi.mx/?utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result'
    })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('does nothing (no clipboard fallback, no error) when the user cancels the native share sheet', async () => {
    const abortError = new Error('cancelled')
    abortError.name = 'AbortError'
    const share = vi.fn().mockRejectedValue(abortError)
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { share, clipboard: { writeText } })

    await expect(shareResult({ name: 'Gamesa Emperador', verdict: 'evitar' })).resolves.toBeUndefined()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to clipboard when navigator.share fails for a reason other than AbortError', async () => {
    const share = vi.fn().mockRejectedValue(new Error('some other failure'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share, clipboard: { writeText } })

    await shareResult({ name: 'Gamesa Emperador', verdict: 'evitar' })

    expect(writeText).toHaveBeenCalledWith('Gamesa Emperador: EVITAR — descúbrelo tú con Yomi https://yomi.mx/?utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result')
  })
})

describe('shareResult — no navigator.share (Firefox desktop, old Chrome desktop)', () => {
  it('goes straight to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await shareResult({ name: 'Gamesa Emperador', verdict: 'evitar' })

    expect(writeText).toHaveBeenCalledWith('Gamesa Emperador: EVITAR — descúbrelo tú con Yomi https://yomi.mx/?utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result')
  })

  it('updates the trigger button text to "Copiado" and reverts it after 2s', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const button = document.createElement('button')
    button.textContent = 'Compartir'

    await shareResult({ name: 'Gamesa Emperador', verdict: 'evitar' }, button)

    expect(button.textContent).toBe('Copiado')
    vi.advanceTimersByTime(2000)
    expect(button.textContent).toBe('Compartir')
    vi.useRealTimers()
  })

  it('warns to console and does not throw when clipboard is also unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(shareResult({ name: 'Gamesa Emperador', verdict: 'evitar' })).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Corre el test y verifica que falla**

Run: `npx vitest run tests/share.test.js`
Expected: FAIL — `Cannot read properties of undefined` / `share.js` no existe todavía.

- [ ] **Step 3: Implementa `share.js`**

```js
// Compartir resultado de escaneo — script clásico (no ES module) a propósito:
// app.js (consumidor en scan.html) tampoco es un módulo, así que se expone vía
// window.shareResult, mismo patrón que app.js ya usa para exponerle
// window.getLocalHistory a history-ui.js (un ES module que sí puede leer
// globals de window sin problema).
const SHARE_VERDICT_LABELS = { sano: 'SANO', regular: 'REGULAR', evitar: 'EVITAR' };
const SHARE_URL = 'https://yomi.mx/?utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result';

function buildShareText(name, verdict) {
  return `${name}: ${SHARE_VERDICT_LABELS[verdict]} — descúbrelo tú con Yomi`;
}

async function copyShareFallback(text, triggerButton) {
  const full = `${text} ${SHARE_URL}`;
  try {
    await navigator.clipboard.writeText(full);
    if (triggerButton) {
      const original = triggerButton.textContent;
      triggerButton.textContent = 'Copiado';
      setTimeout(() => { triggerButton.textContent = original; }, 2000);
    }
  } catch (e) {
    console.warn('[share] clipboard fallback failed:', e.message);
  }
}

async function shareResult({ name, verdict }, triggerButton) {
  const text = buildShareText(name, verdict);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Yomi', text, url: SHARE_URL });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // usuario canceló el share sheet, no es error
      // cualquier otro fallo de navigator.share cae a clipboard
    }
  }
  await copyShareFallback(text, triggerButton);
}

window.buildShareText = buildShareText;
window.shareResult = shareResult;
```

- [ ] **Step 4: Corre el test y verifica que pasa**

Run: `npx vitest run tests/share.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add share.js tests/share.test.js
git commit -m "feat(share): add shareResult/buildShareText for Web Share API + clipboard fallback"
```

---

### Task 2: botón "Compartir" en `scan.html`

**Files:**
- Modify: `scan.html:213-216` (agrega el botón, agrega el `<script>` de `share.js` antes de `app.js`)
- Modify: `app.js` (wire del click dentro de `renderProductData`)

**Interfaces:**
- Consumes: `window.shareResult` de `share.js` (Task 1).
- Produces: ninguna interfaz nueva — solo wiring de UI.

- [ ] **Step 1: Agrega el botón en `scan.html`**

En `scan.html`, reemplaza (líneas 212-216):

```html
          <!-- 0. VEREDICTO -->
          <div id="verdict-banner" class="verdict-banner" role="status"></div>
          <p class="verdict-disclaimer">Estimación automatizada con IA, con fines informativos — no es un diagnóstico ni sustituye el consejo de un profesional de salud.</p>
          <p id="personalized-disclaimer" class="hidden" style="font-size:12px;color:#6b6b6b;margin-top:8px;"></p>
          <p id="report-ack" class="report-ack hidden" role="status">Reportaste un problema con este producto anteriormente — gracias por ayudarnos a mejorarlo.</p>
```

por:

```html
          <!-- 0. VEREDICTO -->
          <div id="verdict-banner" class="verdict-banner" role="status"></div>
          <p class="verdict-disclaimer">Estimación automatizada con IA, con fines informativos — no es un diagnóstico ni sustituye el consejo de un profesional de salud.</p>
          <p id="personalized-disclaimer" class="hidden" style="font-size:12px;color:#6b6b6b;margin-top:8px;"></p>
          <p id="report-ack" class="report-ack hidden" role="status">Reportaste un problema con este producto anteriormente — gracias por ayudarnos a mejorarlo.</p>
          <button type="button" id="btn-share-result" class="btn btn-secondary">Compartir</button>
```

- [ ] **Step 2: Carga `share.js` antes de `app.js`**

En `scan.html`, reemplaza la línea 657:

```html
  <script src="app.js?v=74" defer></script>
```

por:

```html
  <script src="share.js?v=1"></script>
  <script src="app.js?v=74" defer></script>
```

(Sin `defer` en `share.js`: corre síncrono en cuanto el parser llega a esa línea, garantizando que `window.shareResult` ya existe cuando `app.js` — diferido, corre después de terminar de parsear el documento — se ejecute.)

- [ ] **Step 3: Wire del click en `app.js`**

En `app.js`, dentro de `renderProductData(product, barcode)` (busca la línea con `const verdictBanner = document.getElementById('verdict-banner');`, alrededor de la línea 1786), agrega inmediatamente después del bloque `if (verdictBanner) { ... }` (después de la línea 1800, antes de `cardAllergens.classList.add("hidden");`):

```js
  const btnShareResult = document.getElementById('btn-share-result');
  if (btnShareResult) {
    btnShareResult.onclick = () => window.shareResult({ name: product.name, verdict }, btnShareResult);
  }
```

Nota: `renderProductData` ya no está en la lista de funciones extraídas por `tests/app.test.js` (es el orquestador principal, no se testea de forma aislada ahí — mismo patrón que el resto del wiring de esa función, ej. `verdictBanner.textContent = verdictText`, tampoco tiene test unitario dedicado). No agregues un test nuevo para este wiring de 3 líneas; la cobertura real de `shareResult`/`buildShareText` ya vive en `tests/share.test.js` (Task 1).

- [ ] **Step 4: Verifica manualmente que `share.js` se carga antes de `app.js` y el botón existe**

Run: `grep -n "share.js\|btn-share-result" scan.html`
Expected: 3 líneas — el `<script src="share.js?v=1">` antes del de `app.js`, y el botón `#btn-share-result` en el markup.

- [ ] **Step 5: Corre toda la suite para descartar regresiones**

Run: `npx vitest run`
Expected: mismos archivos/tests que antes + los nuevos de Task 1, todos PASS (salvo el fallo pre-existente no relacionado de `tests/e2e/scan-cycle.spec.js`, config de Playwright).

- [ ] **Step 6: Commit**

```bash
git add scan.html app.js
git commit -m "feat(scan): add share button to scan result, wired to shareResult"
```

---

### Task 3: ícono de compartir en `history.html`

**Files:**
- Modify: `history.html` (agrega el `<script>` de `share.js` antes de `app.js`/`history-ui.js`)
- Modify: `history-ui.js` (agrega botón de compartir por `row-card`, ambas ramas)
- Modify: `home.css` (mini regla para que el nombre del producto ocupe el espacio disponible y el botón de compartir quede alineado a la derecha)
- Test: `tests/history-ui.test.js`

**Interfaces:**
- Consumes: `window.shareResult` de `share.js` (Task 1).
- Produces: ninguna interfaz nueva.

- [ ] **Step 1: Actualiza el test**

En `tests/history-ui.test.js`, agrega `window.shareResult = vi.fn()` al `beforeEach` (línea 17, junto a `window.getLocalHistory`):

```js
  window.getLocalHistory = vi.fn().mockReturnValue([
    { barcode: '111', name: 'Producto A', brand: 'Marca', image: '', rating: 'sano' }
  ])
  window.shareResult = vi.fn()
```

Agrega estos 2 tests nuevos al final del archivo (antes del último `})` de cierre del archivo, como 2 nuevos `describe` blocks):

```js
describe('renderHistoryScreen — botón de compartir (usuario free, historial local)', () => {
  it('cada row-card tiene un botón de compartir que llama a window.shareResult con name/verdict normalizados desde rating', async () => {
    getCachedProfile.mockReturnValue({ plan: 'free' })
    await renderHistoryScreen()
    const root = document.getElementById('history-root')
    const shareBtn = root.querySelector('.row-card .share-btn')
    expect(shareBtn).toBeTruthy()
    shareBtn.click()
    expect(window.shareResult).toHaveBeenCalledWith({ name: 'Producto A', verdict: 'sano' }, shareBtn)
  })
})

describe('renderHistoryScreen — botón de compartir (usuario premium, historial cloud)', () => {
  it('cada row-card tiene un botón de compartir que llama a window.shareResult con name/verdict normalizados desde productName/verdict', async () => {
    getCachedProfile.mockReturnValue({ plan: 'premium' })
    getIdToken.mockResolvedValue('tok-1')
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ history: [
        { barcode: '111', productName: 'Producto A', verdict: 'sano', scannedAt: '2026-07-15T10:00:00.000Z' }
      ] })
    })

    await renderHistoryScreen()

    const root = document.getElementById('history-root')
    const shareBtn = root.querySelector('.row-card .share-btn')
    expect(shareBtn).toBeTruthy()
    shareBtn.click()
    expect(window.shareResult).toHaveBeenCalledWith({ name: 'Producto A', verdict: 'sano' }, shareBtn)
  })
})
```

- [ ] **Step 2: Corre el test y verifica que falla**

Run: `npx vitest run tests/history-ui.test.js`
Expected: FAIL — `root.querySelector('.row-card .share-btn')` es `null` (el botón no existe todavía).

- [ ] **Step 3: Implementa el botón en `history-ui.js`**

En `history-ui.js`, reemplaza `renderLocalHistoryWithUpsell` (líneas 3-25):

```js
function renderLocalHistoryWithUpsell(root) {
  const localHistory = window.getLocalHistory ? window.getLocalHistory() : [];
  const itemsHtml = localHistory.map(h => `
    <div class="row-card">
      <span class="verdict-badge verdict-${h.rating}">${h.rating}</span>
      <p class="history-item-name">${h.name}</p>
      <button type="button" class="share-btn" data-name="${h.name}" data-verdict="${h.rating}" aria-label="Compartir">↗</button>
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
  wireShareButtons(root);
}
```

Reemplaza `renderCloudHistory` (líneas 27-42):

```js
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
      <p class="history-item-name">${h.productName}</p>
      <button type="button" class="share-btn" data-name="${h.productName}" data-verdict="${h.verdict}" aria-label="Compartir">↗</button>
    </div>
  `).join('') || '<p class="account-empty">Aún no tienes escaneos.</p>';
  root.innerHTML = `<div class="content-card">${itemsHtml}</div>`;
  wireShareButtons(root);
}
```

Agrega esta función nueva antes de `renderLocalHistoryWithUpsell` (al inicio del archivo, después del `import`):

```js
function wireShareButtons(root) {
  root.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.shareResult({ name: btn.dataset.name, verdict: btn.dataset.verdict }, btn);
    });
  });
}
```

- [ ] **Step 4: Agrega la regla CSS mínima en `home.css`**

En `home.css`, justo después de la regla `.row-card:first-child { border-top: none; padding-top: 0; }` (línea 627), agrega:

```css
/* El nombre del producto ocupa el espacio disponible para que el botón de
   compartir quede alineado al borde derecho de la row-card (hallazgo:
   sin flex:1 aquí, .share-btn queda pegado al texto en vez de al borde). */
.history-item-name { flex: 1; margin: 0; }
.share-btn {
  flex-shrink: 0;
  background: none;
  border: none;
  font-size: 1.1rem;
  color: var(--ink, #0d3d35);
  padding: 4px 8px;
  cursor: pointer;
}
```

- [ ] **Step 5: Carga `share.js` antes de `app.js`/`history-ui.js` en `history.html`**

En `history.html`, reemplaza la línea 48:

```html
  <script src="app.js?v=74"></script>
```

por:

```html
  <script src="share.js?v=1"></script>
  <script src="app.js?v=74"></script>
```

(`history-ui.js` ya se carga después, línea 51 sin cambios — `share.js` corre primero, síncrono, garantizando `window.shareResult` antes de que cualquiera de los dos lo necesite.)

- [ ] **Step 6: Corre el test y verifica que pasa**

Run: `npx vitest run tests/history-ui.test.js`
Expected: PASS (7 tests — 5 existentes + 2 nuevos)

- [ ] **Step 7: Corre toda la suite para descartar regresiones**

Run: `npx vitest run`
Expected: todos los archivos PASS salvo el fallo pre-existente no relacionado de `tests/e2e/scan-cycle.spec.js`.

- [ ] **Step 8: Commit**

```bash
git add history.html history-ui.js home.css tests/history-ui.test.js
git commit -m "feat(history): add share button to each history row-card (local + cloud)"
```

---

## Después de completar todas las tareas

1. Corre la suite completa una vez más: `npx vitest run` — debe seguir en verde salvo el fallo pre-existente de Playwright.
2. Revisión final de rama completa (whole-branch review).
3. Smoke-test manual recomendado (no bloqueante, no cubierto por estos tests): abrir `scan.html` en un celular real, escanear un producto, tocar "Compartir", confirmar que abre el share sheet nativo con el texto/link correctos; repetir en `history.html`.
