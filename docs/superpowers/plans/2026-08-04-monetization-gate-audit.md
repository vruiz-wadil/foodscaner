# Monetization Gate Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix an inconsistent membership gate on `/api/ocr/process` (freemium OCR should be free for everyone, but it currently blocks logged-in non-members while letting anonymous users through) and add a dedicated, stricter rate limit to the three endpoints that call paid vision/AI APIs.

**Architecture:** Two independent, small changes to `api/index.js`. No new files, no schema changes, no new dependencies (`express-rate-limit` is already used for the global limiter).

**Tech Stack:** Express, `express-rate-limit`, Vitest.

## Global Constraints

- Freemium model confirmed: scanning/lookup/OCR/AI stay free for all users, anonymous included. No new paywall logic.
- Rate limit for expensive endpoints: exactly `20` requests per `60000`ms (1 minute) window, per IP.
- The three gated-by-rate-limit endpoints are exactly: `POST /api/ocr/process`, `POST /api/nutrition/process`, `POST /api/ai-query`. No other routes get the new limiter.
- `/api/products/ocr` and `/api/products/nutrition` are explicitly out of scope (they don't call paid APIs).

---

### Task 1: Remove inconsistent membership gate from `/api/ocr/process`

**Files:**
- Modify: `api/index.js:1239-1271` (`ocrProcessHandler`)
- Modify: `tests/ocrQuota.test.js` — remove the two tests asserting 402 for logged-in non-members; keep/adjust the anonymous-pass-through test

**Interfaces:**
- Consumes: nothing new
- Produces: `ocrProcessHandler` behaves identically for anonymous and logged-in requests (no membership check). No signature change — still `async function ocrProcessHandler(req, res)`.

- [ ] **Step 1: Read current handler to confirm exact block to remove**

Run: view `api/index.js` lines 1239-1271. Confirm the block to delete is exactly:

```js
    if (req.user) {
      // Fail-closed: si el perfil todavía no se sincronizó (fireGetUser === null),
      // se trata como membresía no activa — NUNCA se salta el gate por falta de doc.
      const profile = await fireGetUser(req.user.uid);
      const membershipStatus = profile ? profile.membershipStatus : 'pending';
      if (membershipStatus !== 'active') {
        return res.status(402).json({ error: membershipStatus === 'expired' ? 'membership_expired' : 'membership_required' });
      }
    }
```

- [ ] **Step 2: Write the failing test — logged-in user without active membership now succeeds**

In `tests/ocrQuota.test.js`, replace the two tests `'usuario logueado con membershipStatus "pending" → 402 membership_required, no llama a Gemini'` and `'usuario logueado con membershipStatus "expired" → 402 membership_expired, no llama a Gemini'` with a single test:

```js
  it('usuario logueado sin membresía activa procesa OCR igual (freemium, no bloquea por membresía)', async () => {
    const token = signRS256({}, privateKey)
    let groqCalled = false
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ membershipStatus: 'pending' }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) { groqCalled = true; return { ok: true, json: async () => ({ choices: [{ message: { content: 'ingredientes: harina' } }] }) } }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(groqCalled).toBe(true)
  })
```

Leave the existing `'usuario no logueado pasa sin restricción...'` and `'usuario logueado con membershipStatus "active" → procesa normal, sin límite'` tests as-is — both already assert the free-for-everyone behavior and remain valid.

- [ ] **Step 3: Run the new test to verify it fails against current code**

Run: `npx vitest run tests/ocrQuota.test.js -t "sin membresía activa procesa OCR igual"`
Expected: FAIL with `res.statusCode` being `402`, not `200` (the old gate is still in place).

- [ ] **Step 4: Remove the membership check block from `ocrProcessHandler`**

In `api/index.js`, delete the `if (req.user) { ... }` block identified in Step 1, so the handler becomes:

```js
async function ocrProcessHandler(req, res) {
  try {
    const { imageData } = req.body;
    if (!imageData) return res.status(400).json({ error: 'Missing imageData' });

    const prompt = `Extrae el texto de ingredientes de esta imagen de etiqueta alimentaria.
Devuelve el texto tal como aparece, incluyendo ingredientes y cualquier declaración de alérgenos como "Contiene:", "Puede contener:", "Trazas de:" u otras advertencias similares.
Corrige errores obvios de lectura pero no inventes texto ni omitas secciones.
Si no puedes leer los ingredientes, responde con texto vacío.
Responde con UNA SOLA transcripción — no repitas ni vuelvas a transcribir el mismo texto dos veces.`;

    const result = await callVisionLLM(imageData, prompt);
    if (!result?.content) throw new Error("No response from vision LLM");

    const cleanedText = result.content.trim();
    console.log('[OCR Vision] Extracted:', cleanedText.substring(0, 100));

    res.json({ status: 'ok', cleanedText });
  } catch (error) {
    console.error('[OCR Vision] Error:', error);
    res.status(500).json({ error: 'Error al procesar OCR: ' + (error?.message || error) });
  }
}
```

Leave the route registration `app.post('/api/ocr/process', optionalUser, ocrProcessHandler);` untouched — `optionalUser` still runs (harmless, no longer used by the handler, but removing it is out of scope for this task and could affect other future consumers of `req.user`).

- [ ] **Step 5: Run the full `ocrQuota.test.js` file**

Run: `npx vitest run tests/ocrQuota.test.js`
Expected: The renamed/new test passes. Note: this file has 4 pre-existing, unrelated failing tests (Groq→Gemini fallback response body issues, tracked separately, not part of this plan's scope) — those may still fail after this change; that's expected and not a regression to fix here. Confirm no *new* failures beyond that known set.

- [ ] **Step 6: Commit**

```bash
git add api/index.js tests/ocrQuota.test.js
git commit -m "fix(ocr): remove inconsistent membership gate on /api/ocr/process

Freemium model means OCR should be free for everyone. The gate only
fired when req.user was set, so logged-in non-members got 402 while
anonymous requests passed through unrestricted — backwards. Removed
the check entirely, matching the already-ungated /api/nutrition/process."
```

---

### Task 2: Add dedicated rate limit to expensive AI/OCR endpoints

**Files:**
- Modify: `api/index.js` — add `expensiveLimiter` near the existing `limiter` definition (~line 116), apply it to 3 routes
- Test: `tests/expensiveRateLimit.test.js` (new file)

**Interfaces:**
- Consumes: `express-rate-limit`'s `rateLimit()` (already imported in `api/index.js` as `rateLimit` — see line 6: `const rateLimit = require('express-rate-limit');`)
- Produces: `expensiveLimiter` — an Express middleware, applied to `/api/ocr/process`, `/api/nutrition/process`, `/api/ai-query`. Not exported (route-local, same pattern as the existing global `limiter`).

- [ ] **Step 1: Write the failing test**

`supertest` is not a project dependency (confirmed via `package.json` devDependencies: `@playwright/test`, `jsdom`, `serve`, `sharp`, `vercel`, `vitest` — no `supertest`), so the test drives the rate-limit middleware function directly instead of spinning up an HTTP server, matching this project's existing test style (see `tests/deleteAccount.test.js`'s `makeRes()` pattern).

Create `tests/expensiveRateLimit.test.js`:

```js
import { describe, it, expect } from 'vitest'
import rateLimit from 'express-rate-limit'

function makeReqRes() {
  const req = { ip: '127.0.0.1', headers: {} }
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
    setHeader() {}, getHeader() {}, end() {}
  }
  return { req, res }
}

describe('expensiveLimiter (rate limit shape for costly AI/OCR endpoints)', () => {
  it('allows requests under the limit, blocks with 429 once exceeded', async () => {
    const limiter = rateLimit({ windowMs: 60000, max: 3, message: { error: 'Demasiadas solicitudes. Intenta de nuevo en 1 minuto.' } })
    for (let i = 0; i < 3; i++) {
      const { req, res } = makeReqRes()
      await new Promise((resolve) => limiter(req, res, resolve))
      expect(res.statusCode).toBe(200)
    }
    const { req, res } = makeReqRes()
    await new Promise((resolve) => limiter(req, res, resolve))
    expect(res.statusCode).toBe(429)
    expect(res.body.error).toBe('Demasiadas solicitudes. Intenta de nuevo en 1 minuto.')
  })
})

describe('expensiveLimiter wiring on real routes', () => {
  it('api/index.js defines expensiveLimiter with max:20, windowMs:60000, applied to ocr/process, nutrition/process, ai-query', async () => {
    const fs = await import('fs')
    const source = fs.readFileSync(new URL('../api/index.js', import.meta.url), 'utf8')
    expect(source).toMatch(/expensiveLimiter\s*=\s*rateLimit\(\{[^}]*windowMs:\s*60000[^}]*max:\s*20/s)
    expect(source).toMatch(/app\.post\('\/api\/ocr\/process',\s*expensiveLimiter/)
    expect(source).toMatch(/app\.post\('\/api\/nutrition\/process',\s*expensiveLimiter/)
    expect(source).toMatch(/app\.post\('\/api\/ai-query',\s*expensiveLimiter/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/expensiveRateLimit.test.js`
Expected: FAIL on the second `describe` block (`expensiveLimiter` doesn't exist yet in `api/index.js`); first block should already pass since it only exercises `express-rate-limit` directly.

- [ ] **Step 3: Add `expensiveLimiter` and apply it to the 3 routes**

In `api/index.js`, right after the existing global limiter definition (~line 116-117):

```js
const limiter = rateLimit({ windowMs: 60000, max: 60, message: { error: "Demasiadas solicitudes. Intenta de nuevo en 1 minuto." } });
app.use('/api/', limiter);
```

add:

```js
const expensiveLimiter = rateLimit({ windowMs: 60000, max: 20, message: { error: "Demasiadas solicitudes. Intenta de nuevo en 1 minuto." } });
```

Then update the three route registrations to include `expensiveLimiter` as the first middleware after the path:

```js
app.post('/api/ai-query', expensiveLimiter, async (req, res) => {
```

(at line 1086 — keep everything else about that route identical)

```js
app.post('/api/ocr/process', expensiveLimiter, optionalUser, ocrProcessHandler);
```

(at line 1273, replacing the line touched in Task 1)

```js
app.post('/api/nutrition/process', expensiveLimiter, async (req, res) => {
```

(at line 1276 — keep everything else about that route identical)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/expensiveRateLimit.test.js`
Expected: PASS, both describe blocks.

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: same pass/fail counts as before this task except the new file passing — specifically confirm no existing test in `tests/ocrQuota.test.js`, `tests/aiQuery*.test.js` (if it exists), or any nutrition-processing test starts failing due to routes now requiring the new middleware. If any test calls these handlers directly (bypassing Express route registration, like `runOcrRoute` in `tests/ocrQuota.test.js` does via `optionalUser`/`ocrProcessHandler` directly), it is unaffected — the rate limiter only runs as Express middleware attached to the route, not inside the handler function itself.

- [ ] **Step 6: Commit**

```bash
git add api/index.js tests/expensiveRateLimit.test.js
git commit -m "feat(security): add 20/min rate limit to paid AI/OCR endpoints

/api/ocr/process, /api/nutrition/process, and /api/ai-query call paid
Groq vision/AI APIs and are free under the freemium model, so they had
no cost-abuse protection beyond the generic 60/min global limit. Added
a dedicated, stricter limiter (20/min per IP) stacked on top of it."
```

---

## Self-Review Notes

- Spec coverage: Cambio 1 → Task 1. Cambio 2 → Task 2. Testing section → covered inline in both tasks' test steps. Fuera de alcance items are not touched by either task.
- Both tasks are independently testable and independently revertable.
- Task 2's Step 1 has a conditional branch (supertest present or not) because the plan author doesn't have live access to confirm `package.json` at plan-writing time — the implementer resolves it with one command before writing the file, not a TBD.
