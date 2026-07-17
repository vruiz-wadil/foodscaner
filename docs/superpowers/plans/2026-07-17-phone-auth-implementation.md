# Login por teléfono (Firebase Phone Auth) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Firebase Phone Auth (SMS OTP) as a third login method in `auth.html`, alongside existing email/password and Google, per `docs/superpowers/specs/2026-07-17-phone-auth-design.md`.

**Architecture:** Backend attaches `phoneNumber` (from the Firebase ID token's `phone_number` claim) to `req.user` and persists it on account creation, letting phone-verified users pass the OCR free-tier anti-abuse gate the same way `emailVerified` users do. Frontend adds a 3rd/4th view state (`phone-number` / `phone-code` / `phone-consent`) to the existing `auth-ui.js` login card via an explicit `currentView`/`setView()` state machine, using `RecaptchaVerifier` (invisible) + `signInWithPhoneNumber` from the Firebase SDK. A new `setAutoSyncSuppressed()` escape hatch in `authClient.js` prevents its auto-sync-on-auth-state-change from silently overwriting a not-yet-given consent with a bodiless sync.

**Tech Stack:** Vanilla JS (ES modules, no bundler), Express (CommonJS), Firebase Auth JS SDK v11.6.0 (loaded from `gstatic.com` CDN, single import point in `firebase-init.js`), Firestore REST API (no `firebase-admin`), Vitest + jsdom for tests.

## Global Constraints

- Only branch `develop` — never touch `master`/production without being explicitly asked.
- Single Firebase SDK import point: `firebase-init.js`. No other file imports directly from the CDN.
- **CSP exists in THREE places, not one — all three govern `auth.html` depending on environment, and all three need the `https://www.google.com` addition (found during plan review, not in the original spec):**
  1. `auth.html:6` `<meta http-equiv="Content-Security-Policy">` — always present regardless of environment.
  2. `vercel.json:26-37` — route-level header CSP for `/(.*)`, `"continue": true`. **This is the CSP that actually reaches the browser for `auth.html` in production** (static files are served by Vercel's edge per the `@vercel/static` builds, never touching the Express app) and in `vercel dev`. Browsers enforce the *intersection* of the meta CSP and this header per-directive — updating only the meta tag is cosmetic if this one is left unpatched.
  3. `api/index.js:30-37` — Express middleware CSP header, applies to every response when running `node api/index.js` directly (local dev/test convenience only, per its own code comment — never hit in actual production for static files).
  All three currently have identical CSP strings (missing `https://www.google.com`) — Task 9 updates all three identically, only adding the exact `https://www.google.com` entries needed for reCAPTCHA (`script-src`, `frame-src`, `connect-src`), nothing broader.
- **The OCR free-tier anti-abuse gate change (Task 3) is a silent, unconditional code bypass — there is no env var or feature flag gating it.** It must not reach production without Firebase App Check enabled on the Phone provider (console config, out of scope for this repo — see spec's "Prerequisito de producción"). Treat this as a hard release gate: before promoting Task 3's commit past `develop`, confirm App Check is enabled. This plan implements the code only; enabling App Check is a manual follow-up this plan cannot verify or enforce in code.
- Every new async auth handler wraps its button in the existing `withLoadingState(button, loadingText, fn)` helper — no exceptions (this is exactly what the spec review caught missing in v1).
- Run `npx vitest run <file>` (not the full suite) after each task's own test file to keep iteration fast; run the full `npm test` before the final task's commit.

---

### Task 1: `api/auth.js` — extract the `phone_number` claim

**Files:**
- Modify: `api/auth.js:83` (the `verifyFirebaseIdToken` return statement)
- Test: `tests/auth.test.js`

**Interfaces:**
- Produces: `verifyFirebaseIdToken(idToken, projectId)` now resolves to `{ uid, email, emailVerified, phoneNumber }` (adds `phoneNumber: string | null`). Consumed by Task 2.

- [ ] **Step 1: Update the existing test to expect the new field**

In `tests/auth.test.js`, the test `'accepts a validly signed token and returns {uid, email, emailVerified}'` (line 58) currently asserts an exact 3-key object. Update it:

```js
  it('accepts a validly signed token and returns {uid, email, emailVerified, phoneNumber}', async () => {
    mockJwks()
    const token = signRS256({}, privateKey)
    const result = await verifyFirebaseIdToken(token, PROJECT_ID)
    expect(result).toEqual({ uid: 'user-123', email: 'user@example.com', emailVerified: true, phoneNumber: null })
  })
```

- [ ] **Step 2: Add a new failing test for the phone_number claim**

Add this test right after the one above, inside the same `describe('verifyFirebaseIdToken', ...)` block:

```js
  it('extracts phone_number from a phone-authenticated token', async () => {
    mockJwks()
    const token = signRS256({ email: undefined, email_verified: undefined, phone_number: '+525512345678' }, privateKey)
    const result = await verifyFirebaseIdToken(token, PROJECT_ID)
    expect(result).toEqual({ uid: 'user-123', email: null, emailVerified: false, phoneNumber: '+525512345678' })
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/auth.test.js`
Expected: FAIL — both new/updated assertions get `phoneNumber` missing from the actual result (current code doesn't return that key).

- [ ] **Step 4: Implement**

In `api/auth.js`, change line 83:

```js
  return { uid: payload.sub, email: payload.email || null, emailVerified: !!payload.email_verified, phoneNumber: payload.phone_number || null };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/auth.test.js`
Expected: PASS (all tests in the file, including the two touched above)

- [ ] **Step 6: Commit**

```bash
git add api/auth.js tests/auth.test.js
git commit -m "feat(auth): extract phone_number claim in verifyFirebaseIdToken"
```

---

### Task 2: `api/index.js` — attach `phoneNumber` to `req.user`

**Files:**
- Modify: `api/index.js:55-56` (`requireUser`), `api/index.js:76-77` (`optionalUser`)
- Test: `tests/requireUser.test.js`

**Interfaces:**
- Consumes: `verifyFirebaseIdToken` now resolving `phoneNumber` (Task 1).
- Produces: `req.user` now shaped `{ uid, email, emailVerified, phoneNumber }` everywhere it's assigned. Consumed by Task 3 (OCR gate) and Task 4 (authSyncHandler).

- [ ] **Step 1: Update the existing requireUser test**

In `tests/requireUser.test.js`, update the test at line 46-56:

```js
  it('attaches req.user = {uid, email, emailVerified, phoneNumber} and calls next() on a valid token', async () => {
    verifyFirebaseIdToken.mockResolvedValue({ uid: 'user-123', email: 'user@example.com', emailVerified: true, phoneNumber: null })
    const req = { get: (name) => (name.toLowerCase() === 'authorization' ? 'Bearer valid-token' : undefined) }
    const res = makeRes()
    const next = vi.fn()

    await requireUser(req, res, next)

    expect(req.user).toEqual({ uid: 'user-123', email: 'user@example.com', emailVerified: true, phoneNumber: null })
    expect(next).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 2: Add a new test for the phone-only case**

Add right after it:

```js
  it('attaches phoneNumber for a phone-authenticated token (no email)', async () => {
    verifyFirebaseIdToken.mockResolvedValue({ uid: 'user-9', email: null, emailVerified: false, phoneNumber: '+525512345678' })
    const req = { get: (name) => (name.toLowerCase() === 'authorization' ? 'Bearer valid-token' : undefined) }
    const res = makeRes()
    const next = vi.fn()

    await requireUser(req, res, next)

    expect(req.user).toEqual({ uid: 'user-9', email: null, emailVerified: false, phoneNumber: '+525512345678' })
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/requireUser.test.js`
Expected: FAIL — `req.user` doesn't have `phoneNumber` yet.

- [ ] **Step 4: Implement**

In `api/index.js`, change both occurrences (`requireUser` at ~line 55-56 and `optionalUser` at ~line 76-77):

```js
    const { uid, email, emailVerified, phoneNumber } = await verifyFirebaseIdToken(match[1], projectId);
    req.user = { uid, email, emailVerified, phoneNumber };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/requireUser.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add api/index.js tests/requireUser.test.js
git commit -m "feat(auth): attach phoneNumber to req.user in requireUser/optionalUser"
```

---

### Task 3: OCR free-tier gate accepts a verified phone as proof-of-identity

**Files:**
- Modify: `api/index.js:1123` (the `ocrProcessHandler` anti-abuse check)
- Test: `tests/ocrQuota.test.js`

**Interfaces:**
- Consumes: `req.user.phoneNumber` (Task 2).

- [ ] **Step 1: Write the failing test**

Add this test to `tests/ocrQuota.test.js`, in the `describe('ocrProcessHandler — enforcement de cuota', ...)` block, right after the existing `'usuario free con email no verificado → 403, no llama a Groq'` test:

```js
  it('usuario free con teléfono verificado pero SIN email verificado → NO recibe 403, procesa normal', async () => {
    const token = signRS256({ email: undefined, email_verified: false, phone_number: '+525512345678' }, privateKey)
    let groqCalled = false
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('service_accounts/v1/jwk')) return { ok: true, headers: { get: () => 'public, max-age=21600' }, json: async () => ({ keys: [jwk] }) }
      if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
      if (url.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ fields: toFields({ plan: 'free', usage: { date: '2026-07-15', ocrCount: 1 } }), updateTime: 't' }) }
      }
      if (url.includes('api.groq.com')) { groqCalled = true; return { ok: true, json: async () => ({ choices: [{ message: { content: 'ingredientes: harina' } }] }) } }
      return { ok: true, status: 200 }
    }))
    const req = { get: (n) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), body: { imageData: 'x' } }
    const res = makeRes()
    await runOcrRoute(req, res)
    expect(res.body.status).toBe('ok')
    expect(groqCalled).toBe(true)
  })
```

Note: `signRS256`'s default payload always sets `email`/`email_verified` (line 46 of the test file); passing `email: undefined` in the override does NOT delete the key via spread (`{...payload, email: undefined}` keeps `email` as an explicit `undefined`, which `JSON.stringify` drops entirely when signing — so the resulting token really has no `email` claim, matching a real phone-only Firebase token). This mirrors how Task 1's Step 2 test already relies on the same behavior.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ocrQuota.test.js`
Expected: FAIL with `res.statusCode` 403 / `res.body` `{ error: 'email_not_verified' }` instead of `ok`.

- [ ] **Step 3: Implement**

In `api/index.js`, change line 1123:

```js
      if (plan !== 'premium' && !req.user.emailVerified && !req.user.phoneNumber) {
        return res.status(403).json({ error: 'email_not_verified' });
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/ocrQuota.test.js`
Expected: PASS (all tests in the file — the new one plus the pre-existing 403/429/premium cases still hold since none of them set a `phone_number` claim).

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/ocrQuota.test.js
git commit -m "feat(ocr): accept a verified phone as anti-abuse proof alongside emailVerified

Depende de Firebase App Check estar habilitado antes de producción — ver
docs/superpowers/specs/2026-07-17-phone-auth-design.md, Prerequisito de producción."
```

---

### Task 4: persist `phoneNumber` on account creation

**Files:**
- Modify: `api/index.js:1338` (`authSyncHandler`), `api/firestore.js:481` (`fireUpsertUser` creation block)
- Test: `tests/authSync.test.js`, `tests/firestore-users.test.js`

**Interfaces:**
- Consumes: `req.user.phoneNumber` (Task 2).
- Produces: `users/{uid}` Firestore docs gain a `phoneNumber` field, set once at creation (never updated on later logins — same pattern as `email`/`emailVerified`). Consumed by Task 5 via `GET /api/me` (no code change needed there — `fireGetUser`/`fromFirestoreFields` are already generic over field names).

- [ ] **Step 1: Write the failing test for authSyncHandler**

Add to `tests/authSync.test.js`, inside `describe('authSyncHandler', ...)`:

```js
  it('includes phoneNumber from req.user in the upsert payload', async () => {
    fireUpsertUser.mockResolvedValue({ created: true })
    const req = { user: { uid: 'user-9', email: null, phoneNumber: '+525512345678' }, body: {} }
    const res = makeRes()

    await authSyncHandler(req, res)

    expect(fireUpsertUser).toHaveBeenCalledWith('user-9', expect.objectContaining({
      phoneNumber: '+525512345678'
    }))
  })
```

- [ ] **Step 2: Write the failing test for fireUpsertUser's creation block**

Add to `tests/firestore-users.test.js`, right after the existing `'fireUpsertUser creates a new doc with plan:"free" when none exists'` test:

```js
  it('fireUpsertUser stores phoneNumber on the creation doc', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    const patchCalls = []
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) return { status: 404, ok: false }
      patchCalls.push({ url, body: JSON.parse(options.body) })
      return { ok: true, status: 200 }
    }))

    await fireUpsertUser('uid-phone', { phoneNumber: '+525512345678', providers: [] })

    expect(patchCalls[0].body.fields.phoneNumber.stringValue).toBe('+525512345678')
  })

  it('fireUpsertUser stores phoneNumber:null on creation when not provided (email-only signup)', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    const patchCalls = []
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      if (!options.method) return { status: 404, ok: false }
      patchCalls.push({ url, body: JSON.parse(options.body) })
      return { ok: true, status: 200 }
    }))

    await fireUpsertUser('uid-email-only', { email: 'a@b.com', providers: ['password'] })

    expect(patchCalls[0].body.fields.phoneNumber).toEqual({ nullValue: null })
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/authSync.test.js tests/firestore-users.test.js`
Expected: FAIL — `phoneNumber` absent from the objects/fields asserted above.

- [ ] **Step 4: Implement**

In `api/index.js`, in `authSyncHandler` (~line 1337), add `phoneNumber` to the object passed to `fireUpsertUser`:

```js
async function authSyncHandler(req, res) {
  try {
    await fireUpsertUser(req.user.uid, {
      email: req.user.email,
      phoneNumber: req.user.phoneNumber,
      providers: Array.isArray(req.body?.providers) ? req.body.providers : [],
      displayName: sanitizeDisplayName(req.body?.displayName),
      photoURL: sanitizePhotoURL(req.body?.photoURL),
      termsAccepted: req.body?.termsAccepted === true,
      termsVersion: req.body?.termsVersion,
      ageConfirmed: req.body?.ageConfirmed === true
    });
    res.json({ ok: true });
  } catch (e) {
    console.warn('[auth/sync] Firestore error, uid:', req.user?.uid, e.message);
    res.json({ ok: true, warning: 'sync_deferred' });
  }
}
```

In `api/firestore.js`, in `fireUpsertUser`'s creation block (~line 481), add one line right after `email`:

```js
    const fields = toFirestoreFields({
      email: data.email || null,
      phoneNumber: data.phoneNumber || null,
      emailVerified: !!data.emailVerified,
      displayName: data.displayName || null,
      photoURL: data.photoURL || null,
      providers: data.providers || [],
      createdAt: nowIso,
      lastLoginAt: nowIso,
      disabled: false,
      plan: 'free',
      planUpdatedAt: nowIso,
      termsAcceptedAt: data.termsAccepted ? nowIso : null,
      termsVersion: data.termsAccepted ? (data.termsVersion || 'v1') : null,
      ageConfirmedAt: data.ageConfirmed ? nowIso : null,
      billing: {
        stripeCustomerId: null, subscriptionId: null,
        subscriptionStatus: null, currentPeriodEnd: null,
        isFounderPricing: false, billingCycle: null
      },
      usage: { date: today, ocrCount: 0, cacheRefreshCount: 0, totalScans: 0 }
    });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/authSync.test.js tests/firestore-users.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add api/index.js api/firestore.js tests/authSync.test.js tests/firestore-users.test.js
git commit -m "feat(auth): persist phoneNumber on account creation"
```

---

### Task 5: `account-ui.js` — show phone number when there's no email

**Files:**
- Modify: `account-ui.js:38`
- Test: `tests/account-ui.test.js`

**Interfaces:**
- Consumes: `profile.phoneNumber` from `getCachedProfile()` (flows from `GET /api/me`, already generic per Task 4 — no backend change needed for this task).

- [ ] **Step 1: Write the failing test**

Add to `tests/account-ui.test.js`, inside `describe('renderAccountHub', ...)`, right after the existing badge test:

```js
  it('muestra el número de teléfono en vez de vacío cuando el perfil no tiene email (cuenta creada por SMS)', () => {
    getCachedProfile.mockReturnValue({ phoneNumber: '+525512345678', plan: 'free' })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.account-email').textContent).toBe('+525512345678')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/account-ui.test.js`
Expected: FAIL — `.account-email` is empty (current code only reads `profile.email`).

- [ ] **Step 3: Implement**

In `account-ui.js`, change line 38:

```js
          <p class="account-email">${profile.email || profile.phoneNumber || ''}</p>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/account-ui.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add account-ui.js tests/account-ui.test.js
git commit -m "feat(account): show phone number when the profile has no email"
```

---

### Task 6: `country-codes.js` — country/dial-code data

**Files:**
- Create: `country-codes.js`
- Test: `tests/country-codes.test.js`

**Interfaces:**
- Produces: `export const COUNTRY_CODES: Array<{ name: string, iso2: string, dial: string }>` (México first, rest alphabetical by Spanish name; `dial` includes the leading `+`, e.g. `'+52'`), and `export function flagEmoji(iso2: string): string`. Consumed by Task 10 (`auth-ui.js` populates `#phone-country`).

Flags are derived from `iso2` via Unicode regional-indicator symbols instead of being hand-typed per row — this guarantees every flag is correct by construction instead of trusting ~190 hand-picked emoji, and keeps the data array itself smaller/easier to review.

- [ ] **Step 1: Write the failing test**

Create `tests/country-codes.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { COUNTRY_CODES, flagEmoji } from '../country-codes.js'

describe('COUNTRY_CODES', () => {
  it('has México first', () => {
    expect(COUNTRY_CODES[0]).toEqual({ name: 'México', iso2: 'MX', dial: '+52' })
  })

  it('has at least 180 countries', () => {
    expect(COUNTRY_CODES.length).toBeGreaterThanOrEqual(180)
  })

  it('every entry has a non-empty name, a 2-letter iso2, and a dial code starting with +', () => {
    for (const c of COUNTRY_CODES) {
      expect(c.name.length).toBeGreaterThan(0)
      expect(c.iso2).toMatch(/^[A-Z]{2}$/)
      expect(c.dial).toMatch(/^\+\d{1,4}$/)
    }
  })

  it('has no duplicate iso2 codes', () => {
    const codes = COUNTRY_CODES.map(c => c.iso2)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('rest of the list (after México) is alphabetical by name', () => {
    const rest = COUNTRY_CODES.slice(1).map(c => c.name)
    const sorted = [...rest].sort((a, b) => a.localeCompare(b, 'es'))
    expect(rest).toEqual(sorted)
  })
})

describe('flagEmoji', () => {
  it('converts an ISO2 code into its regional-indicator flag emoji', () => {
    expect(flagEmoji('MX')).toBe('🇲🇽')
    expect(flagEmoji('US')).toBe('🇺🇸')
    expect(flagEmoji('ES')).toBe('🇪🇸')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/country-codes.test.js`
Expected: FAIL — `../country-codes.js` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `country-codes.js`:

```js
// Datos de país/código de marcación para el selector de login por teléfono
// (auth-ui.js). Solo name/iso2/dial se mantienen a mano — la bandera se
// deriva de iso2 vía símbolos Unicode regional-indicator (flagEmoji), así
// no hay ~190 emoji tecleados a mano que puedan estar mal.
export const COUNTRY_CODES = [
  { name: 'México', iso2: 'MX', dial: '+52' },
  { name: 'Afganistán', iso2: 'AF', dial: '+93' },
  { name: 'Albania', iso2: 'AL', dial: '+355' },
  { name: 'Alemania', iso2: 'DE', dial: '+49' },
  { name: 'Andorra', iso2: 'AD', dial: '+376' },
  { name: 'Angola', iso2: 'AO', dial: '+244' },
  { name: 'Antigua y Barbuda', iso2: 'AG', dial: '+1268' },
  { name: 'Arabia Saudita', iso2: 'SA', dial: '+966' },
  { name: 'Argelia', iso2: 'DZ', dial: '+213' },
  { name: 'Argentina', iso2: 'AR', dial: '+54' },
  { name: 'Armenia', iso2: 'AM', dial: '+374' },
  { name: 'Australia', iso2: 'AU', dial: '+61' },
  { name: 'Austria', iso2: 'AT', dial: '+43' },
  { name: 'Azerbaiyán', iso2: 'AZ', dial: '+994' },
  { name: 'Bahamas', iso2: 'BS', dial: '+1242' },
  { name: 'Bangladés', iso2: 'BD', dial: '+880' },
  { name: 'Barbados', iso2: 'BB', dial: '+1246' },
  { name: 'Baréin', iso2: 'BH', dial: '+973' },
  { name: 'Bélgica', iso2: 'BE', dial: '+32' },
  { name: 'Belice', iso2: 'BZ', dial: '+501' },
  { name: 'Benín', iso2: 'BJ', dial: '+229' },
  { name: 'Bielorrusia', iso2: 'BY', dial: '+375' },
  { name: 'Birmania (Myanmar)', iso2: 'MM', dial: '+95' },
  { name: 'Bolivia', iso2: 'BO', dial: '+591' },
  { name: 'Bosnia y Herzegovina', iso2: 'BA', dial: '+387' },
  { name: 'Botsuana', iso2: 'BW', dial: '+267' },
  { name: 'Brasil', iso2: 'BR', dial: '+55' },
  { name: 'Brunéi', iso2: 'BN', dial: '+673' },
  { name: 'Bulgaria', iso2: 'BG', dial: '+359' },
  { name: 'Burkina Faso', iso2: 'BF', dial: '+226' },
  { name: 'Burundi', iso2: 'BI', dial: '+257' },
  { name: 'Bután', iso2: 'BT', dial: '+975' },
  { name: 'Cabo Verde', iso2: 'CV', dial: '+238' },
  { name: 'Camboya', iso2: 'KH', dial: '+855' },
  { name: 'Camerún', iso2: 'CM', dial: '+237' },
  { name: 'Canadá', iso2: 'CA', dial: '+1' },
  { name: 'Catar', iso2: 'QA', dial: '+974' },
  { name: 'Chad', iso2: 'TD', dial: '+235' },
  { name: 'Chile', iso2: 'CL', dial: '+56' },
  { name: 'China', iso2: 'CN', dial: '+86' },
  { name: 'Chipre', iso2: 'CY', dial: '+357' },
  { name: 'Ciudad del Vaticano', iso2: 'VA', dial: '+379' },
  { name: 'Colombia', iso2: 'CO', dial: '+57' },
  { name: 'Comoras', iso2: 'KM', dial: '+269' },
  { name: 'Corea del Norte', iso2: 'KP', dial: '+850' },
  { name: 'Corea del Sur', iso2: 'KR', dial: '+82' },
  { name: 'Costa de Marfil', iso2: 'CI', dial: '+225' },
  { name: 'Costa Rica', iso2: 'CR', dial: '+506' },
  { name: 'Croacia', iso2: 'HR', dial: '+385' },
  { name: 'Cuba', iso2: 'CU', dial: '+53' },
  { name: 'Dinamarca', iso2: 'DK', dial: '+45' },
  { name: 'Dominica', iso2: 'DM', dial: '+1767' },
  { name: 'Ecuador', iso2: 'EC', dial: '+593' },
  { name: 'Egipto', iso2: 'EG', dial: '+20' },
  { name: 'El Salvador', iso2: 'SV', dial: '+503' },
  { name: 'Emiratos Árabes Unidos', iso2: 'AE', dial: '+971' },
  { name: 'Eritrea', iso2: 'ER', dial: '+291' },
  { name: 'Eslovaquia', iso2: 'SK', dial: '+421' },
  { name: 'Eslovenia', iso2: 'SI', dial: '+386' },
  { name: 'España', iso2: 'ES', dial: '+34' },
  { name: 'Estados Unidos', iso2: 'US', dial: '+1' },
  { name: 'Estonia', iso2: 'EE', dial: '+372' },
  { name: 'Esuatini (Suazilandia)', iso2: 'SZ', dial: '+268' },
  { name: 'Etiopía', iso2: 'ET', dial: '+251' },
  { name: 'Filipinas', iso2: 'PH', dial: '+63' },
  { name: 'Finlandia', iso2: 'FI', dial: '+358' },
  { name: 'Fiyi', iso2: 'FJ', dial: '+679' },
  { name: 'Francia', iso2: 'FR', dial: '+33' },
  { name: 'Gabón', iso2: 'GA', dial: '+241' },
  { name: 'Gambia', iso2: 'GM', dial: '+220' },
  { name: 'Georgia', iso2: 'GE', dial: '+995' },
  { name: 'Ghana', iso2: 'GH', dial: '+233' },
  { name: 'Granada', iso2: 'GD', dial: '+1473' },
  { name: 'Grecia', iso2: 'GR', dial: '+30' },
  { name: 'Guatemala', iso2: 'GT', dial: '+502' },
  { name: 'Guinea', iso2: 'GN', dial: '+224' },
  { name: 'Guinea Ecuatorial', iso2: 'GQ', dial: '+240' },
  { name: 'Guinea-Bisáu', iso2: 'GW', dial: '+245' },
  { name: 'Guyana', iso2: 'GY', dial: '+592' },
  { name: 'Haití', iso2: 'HT', dial: '+509' },
  { name: 'Honduras', iso2: 'HN', dial: '+504' },
  { name: 'Hungría', iso2: 'HU', dial: '+36' },
  { name: 'India', iso2: 'IN', dial: '+91' },
  { name: 'Indonesia', iso2: 'ID', dial: '+62' },
  { name: 'Irak', iso2: 'IQ', dial: '+964' },
  { name: 'Irán', iso2: 'IR', dial: '+98' },
  { name: 'Irlanda', iso2: 'IE', dial: '+353' },
  { name: 'Islandia', iso2: 'IS', dial: '+354' },
  { name: 'Islas Marshall', iso2: 'MH', dial: '+692' },
  { name: 'Islas Salomón', iso2: 'SB', dial: '+677' },
  { name: 'Israel', iso2: 'IL', dial: '+972' },
  { name: 'Italia', iso2: 'IT', dial: '+39' },
  { name: 'Jamaica', iso2: 'JM', dial: '+1876' },
  { name: 'Japón', iso2: 'JP', dial: '+81' },
  { name: 'Jordania', iso2: 'JO', dial: '+962' },
  { name: 'Kazajistán', iso2: 'KZ', dial: '+7' },
  { name: 'Kenia', iso2: 'KE', dial: '+254' },
  { name: 'Kirguistán', iso2: 'KG', dial: '+996' },
  { name: 'Kiribati', iso2: 'KI', dial: '+686' },
  { name: 'Kuwait', iso2: 'KW', dial: '+965' },
  { name: 'Laos', iso2: 'LA', dial: '+856' },
  { name: 'Lesoto', iso2: 'LS', dial: '+266' },
  { name: 'Letonia', iso2: 'LV', dial: '+371' },
  { name: 'Líbano', iso2: 'LB', dial: '+961' },
  { name: 'Liberia', iso2: 'LR', dial: '+231' },
  { name: 'Libia', iso2: 'LY', dial: '+218' },
  { name: 'Liechtenstein', iso2: 'LI', dial: '+423' },
  { name: 'Lituania', iso2: 'LT', dial: '+370' },
  { name: 'Luxemburgo', iso2: 'LU', dial: '+352' },
  { name: 'Macedonia del Norte', iso2: 'MK', dial: '+389' },
  { name: 'Madagascar', iso2: 'MG', dial: '+261' },
  { name: 'Malasia', iso2: 'MY', dial: '+60' },
  { name: 'Malaui', iso2: 'MW', dial: '+265' },
  { name: 'Maldivas', iso2: 'MV', dial: '+960' },
  { name: 'Malí', iso2: 'ML', dial: '+223' },
  { name: 'Malta', iso2: 'MT', dial: '+356' },
  { name: 'Marruecos', iso2: 'MA', dial: '+212' },
  { name: 'Mauricio', iso2: 'MU', dial: '+230' },
  { name: 'Mauritania', iso2: 'MR', dial: '+222' },
  { name: 'Micronesia', iso2: 'FM', dial: '+691' },
  { name: 'Moldavia', iso2: 'MD', dial: '+373' },
  { name: 'Mónaco', iso2: 'MC', dial: '+377' },
  { name: 'Mongolia', iso2: 'MN', dial: '+976' },
  { name: 'Montenegro', iso2: 'ME', dial: '+382' },
  { name: 'Mozambique', iso2: 'MZ', dial: '+258' },
  { name: 'Namibia', iso2: 'NA', dial: '+264' },
  { name: 'Nauru', iso2: 'NR', dial: '+674' },
  { name: 'Nepal', iso2: 'NP', dial: '+977' },
  { name: 'Nicaragua', iso2: 'NI', dial: '+505' },
  { name: 'Níger', iso2: 'NE', dial: '+227' },
  { name: 'Nigeria', iso2: 'NG', dial: '+234' },
  { name: 'Noruega', iso2: 'NO', dial: '+47' },
  { name: 'Nueva Zelanda', iso2: 'NZ', dial: '+64' },
  { name: 'Omán', iso2: 'OM', dial: '+968' },
  { name: 'Países Bajos', iso2: 'NL', dial: '+31' },
  { name: 'Pakistán', iso2: 'PK', dial: '+92' },
  { name: 'Palaos', iso2: 'PW', dial: '+680' },
  { name: 'Palestina', iso2: 'PS', dial: '+970' },
  { name: 'Panamá', iso2: 'PA', dial: '+507' },
  { name: 'Papúa Nueva Guinea', iso2: 'PG', dial: '+675' },
  { name: 'Paraguay', iso2: 'PY', dial: '+595' },
  { name: 'Perú', iso2: 'PE', dial: '+51' },
  { name: 'Polonia', iso2: 'PL', dial: '+48' },
  { name: 'Portugal', iso2: 'PT', dial: '+351' },
  { name: 'Reino Unido', iso2: 'GB', dial: '+44' },
  { name: 'República Centroafricana', iso2: 'CF', dial: '+236' },
  { name: 'República Checa', iso2: 'CZ', dial: '+420' },
  { name: 'República del Congo', iso2: 'CG', dial: '+242' },
  { name: 'República Democrática del Congo', iso2: 'CD', dial: '+243' },
  { name: 'República Dominicana', iso2: 'DO', dial: '+1809' },
  { name: 'Ruanda', iso2: 'RW', dial: '+250' },
  { name: 'Rumania', iso2: 'RO', dial: '+40' },
  { name: 'Rusia', iso2: 'RU', dial: '+7' },
  { name: 'Samoa', iso2: 'WS', dial: '+685' },
  { name: 'San Cristóbal y Nieves', iso2: 'KN', dial: '+1869' },
  { name: 'San Marino', iso2: 'SM', dial: '+378' },
  { name: 'San Vicente y las Granadinas', iso2: 'VC', dial: '+1784' },
  { name: 'Santa Lucía', iso2: 'LC', dial: '+1758' },
  { name: 'Santo Tomé y Príncipe', iso2: 'ST', dial: '+239' },
  { name: 'Senegal', iso2: 'SN', dial: '+221' },
  { name: 'Serbia', iso2: 'RS', dial: '+381' },
  { name: 'Seychelles', iso2: 'SC', dial: '+248' },
  { name: 'Sierra Leona', iso2: 'SL', dial: '+232' },
  { name: 'Singapur', iso2: 'SG', dial: '+65' },
  { name: 'Siria', iso2: 'SY', dial: '+963' },
  { name: 'Somalia', iso2: 'SO', dial: '+252' },
  { name: 'Sri Lanka', iso2: 'LK', dial: '+94' },
  { name: 'Sudáfrica', iso2: 'ZA', dial: '+27' },
  { name: 'Sudán', iso2: 'SD', dial: '+249' },
  { name: 'Sudán del Sur', iso2: 'SS', dial: '+211' },
  { name: 'Suecia', iso2: 'SE', dial: '+46' },
  { name: 'Suiza', iso2: 'CH', dial: '+41' },
  { name: 'Surinam', iso2: 'SR', dial: '+597' },
  { name: 'Tailandia', iso2: 'TH', dial: '+66' },
  { name: 'Tanzania', iso2: 'TZ', dial: '+255' },
  { name: 'Tayikistán', iso2: 'TJ', dial: '+992' },
  { name: 'Timor Oriental', iso2: 'TL', dial: '+670' },
  { name: 'Togo', iso2: 'TG', dial: '+228' },
  { name: 'Tonga', iso2: 'TO', dial: '+676' },
  { name: 'Trinidad y Tobago', iso2: 'TT', dial: '+1868' },
  { name: 'Túnez', iso2: 'TN', dial: '+216' },
  { name: 'Turkmenistán', iso2: 'TM', dial: '+993' },
  { name: 'Turquía', iso2: 'TR', dial: '+90' },
  { name: 'Tuvalu', iso2: 'TV', dial: '+688' },
  { name: 'Ucrania', iso2: 'UA', dial: '+380' },
  { name: 'Uganda', iso2: 'UG', dial: '+256' },
  { name: 'Uruguay', iso2: 'UY', dial: '+598' },
  { name: 'Uzbekistán', iso2: 'UZ', dial: '+998' },
  { name: 'Vanuatu', iso2: 'VU', dial: '+678' },
  { name: 'Venezuela', iso2: 'VE', dial: '+58' },
  { name: 'Vietnam', iso2: 'VN', dial: '+84' },
  { name: 'Yemen', iso2: 'YE', dial: '+967' },
  { name: 'Yibuti', iso2: 'DJ', dial: '+253' },
  { name: 'Zambia', iso2: 'ZM', dial: '+260' },
  { name: 'Zimbabue', iso2: 'ZW', dial: '+263' }
];

export function flagEmoji(iso2) {
  return String.fromCodePoint(...[...iso2.toUpperCase()].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/country-codes.test.js`
Expected: PASS. If the alphabetical-order test fails, it means a locale-collation edge case (e.g. `ñ`/accented letters) put one row out of place — reorder that one row rather than changing the test.

- [ ] **Step 5: Commit**

```bash
git add country-codes.js tests/country-codes.test.js
git commit -m "feat(auth): add country/dial-code data for phone login"
```

---

### Task 7: `firebase-init.js` — export the Phone Auth SDK functions

**Files:**
- Modify: `firebase-init.js`
- Test: `tests/firebase-init.test.js` (this file DOES already exist and DOES test this exact file — it mocks the SDK's CDN URL directly and asserts on `firebase-init.js`'s re-exports)

**Interfaces:**
- Produces: `RecaptchaVerifier`, `signInWithPhoneNumber`, `getAdditionalUserInfo` re-exported from the single SDK import point. Consumed by Task 10.

- [ ] **Step 1: Update the test file's mocks**

In `tests/firebase-init.test.js`, add the new mocks alongside the existing ones (lines 19-28):

```js
const mockApp = { name: '[DEFAULT]' }
const mockAuthInstance = { currentUser: null }
const initializeApp = vi.fn(() => mockApp)
const getAuth = vi.fn(() => mockAuthInstance)
const onAuthStateChanged = vi.fn()
const signInWithEmailAndPassword = vi.fn()
const createUserWithEmailAndPassword = vi.fn()
const signInWithPopup = vi.fn()
const signOut = vi.fn()
class GoogleAuthProvider {}
class RecaptchaVerifier {}
const signInWithPhoneNumber = vi.fn()
const getAdditionalUserInfo = vi.fn()

vi.mock(APP_URL, () => ({ initializeApp }))
vi.mock(AUTH_URL, () => ({
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  getAdditionalUserInfo
}))
```

- [ ] **Step 2: Write the failing tests**

Extend the existing `'re-exports the auth SDK functions...'` test (line 66-73):

```js
  it('re-exports the auth SDK functions Task 11/12/phone-auth depend on', async () => {
    const mod = await import('../firebase-init.js')
    expect(mod.onAuthStateChanged).toBe(onAuthStateChanged)
    expect(mod.signInWithEmailAndPassword).toBe(signInWithEmailAndPassword)
    expect(mod.createUserWithEmailAndPassword).toBe(createUserWithEmailAndPassword)
    expect(mod.signInWithPopup).toBe(signInWithPopup)
    expect(mod.GoogleAuthProvider).toBe(GoogleAuthProvider)
    expect(mod.RecaptchaVerifier).toBe(RecaptchaVerifier)
    expect(mod.signInWithPhoneNumber).toBe(signInWithPhoneNumber)
    expect(mod.getAdditionalUserInfo).toBe(getAdditionalUserInfo)
  })
```

Add a new `describe('auth.html wiring', ...)` block, mirroring the existing `describe('index.html wiring', ...)` block (lines 76-92) — **this is new coverage the plan review found missing: no existing test reads `auth.html`'s CSP at all, only `index.html`'s.** Add this after the `index.html wiring` block:

```js
describe('auth.html wiring', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'auth.html'), 'utf8')

  it('CSP allows loading the Firebase SDK and reCAPTCHA (google.com) for phone login', () => {
    const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)
    expect(cspMatch).not.toBeNull()
    const csp = cspMatch[1]
    expect(csp).toMatch(/script-src[^;]*https:\/\/www\.gstatic\.com/)
    expect(csp).toMatch(/connect-src[^;]*https:\/\/identitytoolkit\.googleapis\.com/)
    expect(csp).toMatch(/frame-src[^;]*firebaseapp\.com/)
    expect(csp).toMatch(/script-src[^;]*https:\/\/www\.google\.com/)
    expect(csp).toMatch(/connect-src[^;]*https:\/\/www\.google\.com/)
    expect(csp).toMatch(/frame-src[^;]*https:\/\/www\.google\.com/)
  })

  it('loads firebase-init.js and auth-ui.js as module scripts', () => {
    expect(html).toMatch(/<script[^>]+type="module"[^>]+src="firebase-init\.js"/)
    expect(html).toMatch(/<script[^>]+type="module"[^>]+src="auth-ui\.js"/)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/firebase-init.test.js`
Expected: FAIL — `mod.RecaptchaVerifier` etc. are `undefined`, and `auth.html`'s CSP doesn't have `www.google.com` yet (Task 9 hasn't run yet either — see note below).

Note on task order: this test's `auth.html wiring` assertions won't fully pass until Task 9 (CSP update) also lands. If executing tasks in order 1→10, this is expected — re-run this file's tests again after Task 9 to confirm full green; don't treat a failing `auth.html wiring` CSP assertion as a Task 7 bug if Task 9 hasn't run yet.

- [ ] **Step 4: Implement**

In `firebase-init.js`, add to the import from `firebase-auth.js` (line 6-14):

```js
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  getAdditionalUserInfo
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
```

And add to the re-export list at the bottom (line 31-38):

```js
export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  getAdditionalUserInfo
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/firebase-init.test.js`
Expected: the SDK re-export assertions PASS now; the `auth.html wiring` CSP assertions remain failing until Task 9 lands (expected per the note above — this is not a regression).

- [ ] **Step 6: Commit**

```bash
git add firebase-init.js tests/firebase-init.test.js
git commit -m "feat(auth): export Phone Auth SDK functions from firebase-init.js"
```

---

### Task 8: `authClient.js` — `setAutoSyncSuppressed()` escape hatch

**Files:**
- Modify: `authClient.js`
- Test: `tests/authClient.test.js`

**Interfaces:**
- Produces: `export function setAutoSyncSuppressed(value: boolean): void`. When `true`, the module's own `onAuthChange` auto-sync (currently unconditional on any signed-in user) is skipped. Default `false` (today's behavior, unchanged). Consumed by Task 10 (`auth-ui.js` calls this before `confirmationResult.confirm(code)`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/authClient.test.js`, inside `describe('auto-sync on auth state change', ...)`, right after the two existing tests in that block:

```js
  it('no llama a syncUserProfile cuando setAutoSyncSuppressed(true) está activo, aunque haya usuario', async () => {
    setAutoSyncSuppressed(true)
    mockAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('tok-suppressed') }
    const internalCallback = onAuthStateChanged.mock.calls[0][1]
    await internalCallback({ uid: 'u1' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('vuelve a auto-sincronizar normalmente después de setAutoSyncSuppressed(false)', async () => {
    setAutoSyncSuppressed(true)
    setAutoSyncSuppressed(false)
    mockAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('tok-resumed') }
    global.fetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: 'free' }) })
    const internalCallback = onAuthStateChanged.mock.calls[0][1]
    await internalCallback({ uid: 'u1' })
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/auth/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-resumed' }
    })
  })
```

Add `setAutoSyncSuppressed` to the destructured imports in `beforeEach` (line 22-26):

```js
  const mod = await import('../authClient.js')
  getIdToken = mod.getIdToken
  onAuthChange = mod.onAuthChange
  syncUserProfile = mod.syncUserProfile
  getCachedProfile = mod.getCachedProfile
  setAutoSyncSuppressed = mod.setAutoSyncSuppressed
```

And declare it alongside the other `let` bindings at the top of the file (line 14):

```js
let getIdToken, onAuthChange, syncUserProfile, getCachedProfile, setAutoSyncSuppressed
```

Also update the pre-existing `window.authClient` test (currently asserting 4 functions) — it needs to assert the 5th too, or it won't actually verify `setAutoSyncSuppressed` reached `window.authClient`:

```js
describe('window.authClient', () => {
  it('exposes the five functions for non-module scripts', async () => {
    expect(window.authClient.getIdToken).toBe(getIdToken)
    expect(window.authClient.onAuthChange).toBe(onAuthChange)
    expect(window.authClient.syncUserProfile).toBe(syncUserProfile)
    expect(window.authClient.getCachedProfile).toBe(getCachedProfile)
    expect(window.authClient.setAutoSyncSuppressed).toBe(setAutoSyncSuppressed)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/authClient.test.js`
Expected: FAIL — `setAutoSyncSuppressed` is `undefined`, calling it throws.

- [ ] **Step 3: Implement**

In `authClient.js`, add the flag/setter and gate the existing auto-sync listener (lines 51-68):

```js
let autoSyncSuppressed = false;

// Escape hatch para auth.html: motivado por el flujo de teléfono
// (confirmationResult.confirm() dispara este listener ANTES de que el
// usuario nuevo vea el paso de consentimiento de Términos/edad — sin
// suprimir, el auto-sync sin body de abajo crea el doc de Firestore con
// termsAccepted ausente, y la sync explícita con consentimiento real que
// llega después cae en la rama de "usuario ya existe" de fireUpsertUser, que
// nunca escribe termsAccepted*), pero auth-ui.js lo usa para TODA la página,
// no solo teléfono — ver el comentario junto a su import en auth-ui.js.
export function setAutoSyncSuppressed(value) {
  autoSyncSuppressed = value;
}

onAuthChange((user) => {
  if (user && !autoSyncSuppressed) return syncUserProfile();
});

window.authClient = { getIdToken, onAuthChange, syncUserProfile, getCachedProfile, setAutoSyncSuppressed };
```

(Only the `onAuthChange((user) => {...})` callback body and the final `window.authClient` object change — the flag/setter are new code added right before the existing comment block that precedes `onAuthChange((user) => {`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/authClient.test.js`
Expected: PASS (all tests in the file, including the updated `window.authClient` test from Step 1).

- [ ] **Step 5: Commit**

```bash
git add authClient.js tests/authClient.test.js
git commit -m "feat(auth): add setAutoSyncSuppressed to prevent losing phone-signup consent"
```

---

### Task 9: `auth.html` — markup, and CSP in all 3 places that declare it

**Files:**
- Modify: `auth.html`, `vercel.json`, `api/index.js`
- Test: `tests/firebase-init.test.js` (the `auth.html wiring` CSP assertions added in Task 7 — this task is what actually turns them green), new `tests/vercel-csp.test.js`

**Interfaces:**
- Produces: DOM ids `login-view`, `btn-phone`, `phone-step`, `phone-country`, `phone-number`, `btn-send-code`, `btn-phone-cancel`, `phone-code-step`, `phone-code`, `btn-verify-code`, `btn-resend-code`, `btn-phone-code-back`, `btn-phone-consent-confirm`, `recaptcha-container`. Consumed by Task 10 (`auth-ui.js` wiring).

**Why 3 files, not 1** (found during plan review): `auth.html`'s `<meta>` CSP tag is NOT the only CSP that governs it.
- `vercel.json:26-37` sets a route-level header CSP for `/(.*)` with `"continue": true` — since `auth.html` is a static file served by Vercel's edge (`@vercel/static` build) in production, **this is the CSP that actually reaches the browser in production**, not the meta tag alone. Browsers intersect multiple CSP sources per-directive (most restrictive wins), so leaving this one unpatched would still block reCAPTCHA in production regardless of the meta tag fix.
- `api/index.js:30-37` sets the same header via Express middleware, which (per its own code comment) only applies to static files when running `node api/index.js` directly — local dev/test convenience, never hit for static assets in actual production, but still worth keeping in sync so local testing behaves like production.
- All three currently have byte-identical CSP strings. This task updates all three identically.

- [ ] **Step 1: Write the failing test for `vercel.json`'s CSP**

Create `tests/vercel-csp.test.js`:

```js
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'))
const csp = vercelConfig.routes.find(r => r.headers && r.headers['Content-Security-Policy']).headers['Content-Security-Policy']

describe('vercel.json route-level CSP (governs static files like auth.html in production)', () => {
  it('allows reCAPTCHA (google.com) alongside the existing Firebase entries', () => {
    expect(csp).toMatch(/script-src[^;]*https:\/\/www\.gstatic\.com/)
    expect(csp).toMatch(/script-src[^;]*https:\/\/www\.google\.com/)
    expect(csp).toMatch(/connect-src[^;]*https:\/\/www\.google\.com/)
    expect(csp).toMatch(/frame-src[^;]*https:\/\/www\.google\.com/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/vercel-csp.test.js tests/firebase-init.test.js`
Expected: FAIL — neither `vercel.json` nor `auth.html` has `www.google.com` yet (the `auth.html wiring` test from Task 7 is also still red at this point, as noted there).

- [ ] **Step 3: Update the CSP meta tag in `auth.html`**

In `auth.html:6`, add `https://www.google.com` to `script-src`, `frame-src`, and `connect-src`:

```html
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.gstatic.com https://apis.google.com https://www.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://images.openfoodfacts.org https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.gstatic.com https://apis.google.com https://www.googleapis.com https://www.google.com; frame-src https://*.firebaseapp.com https://apis.google.com https://accounts.google.com https://www.google.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self';">
```

- [ ] **Step 4: Update the CSP header in `vercel.json`**

In `vercel.json:34`, apply the identical `https://www.google.com` additions:

```json
        "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.gstatic.com https://apis.google.com https://www.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://images.openfoodfacts.org https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.gstatic.com https://apis.google.com https://www.googleapis.com https://www.google.com; frame-src https://*.firebaseapp.com https://apis.google.com https://accounts.google.com https://www.google.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self';"
```

- [ ] **Step 5: Update the CSP header in `api/index.js`**

In `api/index.js:35`, apply the same additions (this one has fewer existing entries than the other two — only add the 3 `www.google.com` entries, don't add the Firebase-specific entries this file never had, since that would be scope creep unrelated to this task):

```js
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://images.openfoodfacts.org https://www.google.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self';");
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/vercel-csp.test.js tests/firebase-init.test.js`
Expected: PASS — both the new `vercel.json` test and Task 7's `auth.html wiring` CSP test are now green.

- [ ] **Step 7: Wrap the existing login content in `#login-view`, add the phone button**

Replace lines 41-83 (the `.content-card` block) with:

```html
      <div class="content-card">
        <div id="login-view">
          <button type="button" id="btn-google" class="btn btn-google">Continuar con Google</button>
          <button type="button" id="btn-phone" class="btn btn-secondary">Continuar con teléfono</button>
          <div class="auth-divider">o con tu correo</div>

          <form id="login-form" novalidate>
            <div class="form-field">
              <label for="login-email">Correo electrónico</label>
              <input id="login-email" class="form-input" type="email" required autocomplete="email" placeholder="tucorreo@ejemplo.com">
            </div>

            <div class="form-field">
              <label for="login-password">Contraseña</label>
              <div class="password-field-wrap">
                <input id="login-password" class="form-input" type="password" required minlength="6" autocomplete="current-password" placeholder="Mínimo 6 caracteres">
                <button type="button" id="btn-toggle-password" class="btn-toggle-password" aria-label="Mostrar contraseña">Ver</button>
              </div>
            </div>

            <button type="submit" id="btn-login" class="btn btn-primary">Iniciar sesión</button>
            <button type="button" id="btn-back-to-login" class="link-button hidden">¿Ya tienes cuenta? Inicia sesión</button>
            <button type="button" id="btn-signup" class="btn btn-secondary">Crear cuenta nueva</button>
          </form>
        </div>

        <div id="phone-step" class="hidden">
          <div class="form-field">
            <label for="phone-country">País</label>
            <select id="phone-country"></select>
          </div>
          <div class="form-field">
            <label for="phone-number">Número de teléfono</label>
            <input id="phone-number" class="form-input" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="10 dígitos">
          </div>
          <button type="button" id="btn-send-code" class="btn btn-primary">Enviar código</button>
          <button type="button" id="btn-phone-cancel" class="link-button">Cancelar</button>
        </div>

        <div id="phone-code-step" class="hidden">
          <div class="form-field">
            <label for="phone-code">Código de verificación</label>
            <input id="phone-code" class="form-input" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
          </div>
          <button type="button" id="btn-verify-code" class="btn btn-primary">Verificar</button>
          <button type="button" id="btn-resend-code" class="link-button">Reenviar código</button>
          <button type="button" id="btn-phone-code-back" class="link-button">Cambiar número</button>
        </div>

        <!-- Compartido entre signup por correo (2do clic de #btn-signup) y
             signup por teléfono (#btn-phone-consent-confirm) — mismo gate legal,
             sin duplicar markup. Ver setView() en auth-ui.js. -->
        <div id="signup-only" class="hidden">
          <label class="consent-block">
            <input type="checkbox" id="terms-checkbox">
            Acepto los <a href="/terminos.html" target="_blank" rel="noopener">Términos y Condiciones</a>
            y el <a href="/privacidad.html" target="_blank" rel="noopener">Aviso de Privacidad</a>.
          </label>
          <label class="consent-block">
            <input type="checkbox" id="age-checkbox">
            Confirmo que soy mayor de 18 años.
          </label>
          <button type="button" id="btn-phone-consent-confirm" class="btn btn-primary hidden">Confirmar y continuar</button>
        </div>

        <p id="auth-error" class="hidden" role="alert"></p>
        <div id="recaptcha-container"></div>
      </div>
```

Note: `#signup-only` moved out from inside `<form id="login-form">` to be a sibling of `#login-view`/`#phone-step`/`#phone-code-step` (it's now shared by two different flows, one of which — phone — has no enclosing `<form>`). `#btn-phone-consent-confirm` starts `hidden` alongside the rest of `#signup-only` when reused for the email-signup path (where `#btn-signup` itself is the submit action, per the existing 2-click semantics) — `auth-ui.js`'s `setView('phone-consent')` is the only place that un-hides it.

- [ ] **Step 8: Manual check (no automated test for markup)**

Open `auth.html` in a browser (or run the app locally) and confirm: the page still renders identically to before (Google button, divider, email form) with the new "Continuar con teléfono" button visible above the divider, and nothing else visually broken. This is a markup-only step — Task 10's tests are what actually exercise this DOM's behavior.

- [ ] **Step 9: Commit**

```bash
git add auth.html vercel.json api/index.js tests/vercel-csp.test.js tests/firebase-init.test.js
git commit -m "feat(auth): add phone login markup, CSP entries for reCAPTCHA in all 3 places it's declared"
```

---

### Task 10: `auth-ui.js` — phone login flow logic

**Files:**
- Modify: `auth-ui.js`
- Test: `tests/auth-ui.test.js`

**Interfaces:**
- Consumes: `RecaptchaVerifier`, `signInWithPhoneNumber`, `getAdditionalUserInfo` (Task 7), `COUNTRY_CODES`/`flagEmoji` (Task 6), `setAutoSyncSuppressed` (Task 8), the DOM ids from Task 9.
- Produces: the complete phone login/signup flow, wired into the existing `DOMContentLoaded` listener.

- [ ] **Step 1: Update the test fixture's mocks and DOM**

In `tests/auth-ui.test.js`, update the `vi.mock('../firebase-init.js', ...)` block (lines 6-18) to add the new exports:

```js
const mockAuth = { currentUser: null }
const signInWithEmailAndPassword = vi.fn()
const createUserWithEmailAndPassword = vi.fn()
const signInWithPopup = vi.fn()
const signInWithPhoneNumber = vi.fn()
const getAdditionalUserInfo = vi.fn()
class GoogleAuthProvider {}
class RecaptchaVerifier {
  constructor() {}
  clear() {}
}

vi.mock('../firebase-init.js', () => ({
  firebaseAuth: mockAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  getAdditionalUserInfo
}))

const setAutoSyncSuppressed = vi.fn()
vi.mock('../authClient.js', () => ({ setAutoSyncSuppressed }))

vi.mock('../country-codes.js', () => ({
  COUNTRY_CODES: [{ name: 'México', iso2: 'MX', dial: '+52' }, { name: 'Argentina', iso2: 'AR', dial: '+54' }],
  flagEmoji: () => '🏳️'
}))
```

Update the `document.body.innerHTML` fixture (lines 26-42) to match Task 9's new markup (trimmed to what the tests touch):

```js
  document.body.innerHTML = `
    <h1 id="auth-heading-title">Inicia sesión</h1>
    <div id="login-view">
      <button id="btn-google">Continuar con Google</button>
      <button type="button" id="btn-phone">Continuar con teléfono</button>
      <form id="login-form" novalidate>
        <input id="login-email" type="email" required>
        <input id="login-password" type="password" required minlength="6">
        <button type="button" id="btn-toggle-password" aria-label="Mostrar contraseña">Ver</button>
        <button type="submit" id="btn-login">Iniciar sesión</button>
        <button type="button" id="btn-back-to-login" class="hidden">¿Ya tienes cuenta? Inicia sesión</button>
        <button type="button" id="btn-signup">Crear cuenta</button>
      </form>
    </div>
    <div id="phone-step" class="hidden">
      <select id="phone-country"></select>
      <input id="phone-number" type="tel">
      <button type="button" id="btn-send-code">Enviar código</button>
      <button type="button" id="btn-phone-cancel">Cancelar</button>
    </div>
    <div id="phone-code-step" class="hidden">
      <input id="phone-code" type="text" maxlength="6">
      <button type="button" id="btn-verify-code">Verificar</button>
      <button type="button" id="btn-resend-code">Reenviar código</button>
      <button type="button" id="btn-phone-code-back">Cambiar número</button>
    </div>
    <div id="signup-only" class="hidden">
      <input type="checkbox" id="terms-checkbox">
      <input type="checkbox" id="age-checkbox">
      <button type="button" id="btn-phone-consent-confirm" class="hidden">Confirmar y continuar</button>
    </div>
    <p id="auth-error" class="hidden" role="alert"></p>
    <div id="recaptcha-container"></div>
  `
```

Update the imports pulled from the module (lines 43-47):

```js
  const mod = await import('../auth-ui.js')
  mapAuthError = mod.mapAuthError
  handleLogin = mod.handleLogin
  handleSignup = mod.handleSignup
  handleGoogleSignIn = mod.handleGoogleSignIn
  handleSendCode = mod.handleSendCode
  handleVerifyCode = mod.handleVerifyCode
  handlePhoneSignupConsent = mod.handlePhoneSignupConsent
  setView = mod.setView
```

(add `let handleSendCode, handleVerifyCode, handlePhoneSignupConsent, setView` to the `let` declaration at line 20)

- [ ] **Step 2: Write the failing tests**

Add these new `describe` blocks to `tests/auth-ui.test.js`, after the existing `describe('handleGoogleSignIn', ...)` block:

```js
describe('mapAuthError — phone codes', () => {
  it('maps the new phone-specific error codes', () => {
    expect(mapAuthError('auth/invalid-phone-number')).toBe('Número de teléfono inválido.')
    expect(mapAuthError('auth/missing-phone-number')).toBe('Ingresa un número de teléfono.')
    expect(mapAuthError('auth/invalid-verification-code')).toBe('Código incorrecto. Verifica e intenta de nuevo.')
    expect(mapAuthError('auth/code-expired')).toBe('El código expiró. Solicita uno nuevo.')
    expect(mapAuthError('auth/quota-exceeded')).toBe('Demasiados SMS solicitados. Intenta más tarde.')
    expect(mapAuthError('auth/captcha-check-failed')).toBe('Verificación de seguridad falló. Intenta de nuevo.')
    expect(mapAuthError('auth/invalid-app-credential')).toBe('Verificación de seguridad falló. Intenta de nuevo.')
  })
})

describe('setView', () => {
  it('shows only #login-view by default', () => {
    setView('login')
    expect(document.getElementById('login-view').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('phone-code-step').classList.contains('hidden')).toBe(true)
  })

  it('shows only #phone-step for "phone-number"', () => {
    setView('phone-number')
    expect(document.getElementById('login-view').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('phone-code-step').classList.contains('hidden')).toBe(true)
  })

  it('shows only #phone-code-step for "phone-code"', () => {
    setView('phone-code')
    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(true)
    expect(document.getElementById('phone-code-step').classList.contains('hidden')).toBe(false)
  })

  it('shows #signup-only for "phone-consent"', () => {
    setView('phone-consent')
    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('login-view').classList.contains('hidden')).toBe(true)
  })
})

describe('handleSendCode', () => {
  it('calls signInWithPhoneNumber with the concatenated dial code + digits, and moves to phone-code view', async () => {
    signInWithPhoneNumber.mockResolvedValueOnce({ confirm: vi.fn() })
    await handleSendCode('+52', '55 1234 5678')
    expect(signInWithPhoneNumber).toHaveBeenCalledWith(mockAuth, '+525512345678', expect.any(RecaptchaVerifier))
    expect(document.getElementById('phone-code-step').classList.contains('hidden')).toBe(false)
  })

  it('shows a mapped error and clears the recaptcha verifier on failure', async () => {
    signInWithPhoneNumber.mockRejectedValueOnce({ code: 'auth/invalid-phone-number' })
    await expect(handleSendCode('+52', 'abc')).rejects.toBeTruthy()
    expect(document.getElementById('auth-error').textContent).toBe('Número de teléfono inválido.')
  })
})

describe('module load — auto-sync suppression', () => {
  it('suprime el auto-sync genérico de authClient.js apenas se carga el módulo, para TODOS los flujos de esta página (hallazgo de revisión del plan: importar authClient.js activaba su listener por primera vez en auth.html)', () => {
    expect(setAutoSyncSuppressed).toHaveBeenCalledWith(true)
  })
})

describe('handleVerifyCode', () => {
  it('does not open the consent step for an existing user', async () => {
    const confirm = vi.fn().mockResolvedValue({ user: { uid: 'existing-1' } })
    signInWithPhoneNumber.mockResolvedValueOnce({ confirm })
    getAdditionalUserInfo.mockReturnValueOnce({ isNewUser: false })
    await handleSendCode('+52', '5512345678')

    await handleVerifyCode('123456')

    expect(confirm).toHaveBeenCalledWith('123456')
    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(true)
  })

  it('shows the consent step (does not redirect yet) for a new user', async () => {
    const confirm = vi.fn().mockResolvedValue({ user: { uid: 'new-1', getIdToken: vi.fn() } })
    signInWithPhoneNumber.mockResolvedValueOnce({ confirm })
    getAdditionalUserInfo.mockReturnValueOnce({ isNewUser: true })
    await handleSendCode('+52', '5512345678')

    await handleVerifyCode('123456')

    expect(document.getElementById('signup-only').classList.contains('hidden')).toBe(false)
  })

  it('shows a mapped error when the code is wrong', async () => {
    const confirm = vi.fn().mockRejectedValue({ code: 'auth/invalid-verification-code' })
    signInWithPhoneNumber.mockResolvedValueOnce({ confirm })
    await handleSendCode('+52', '5512345678')

    await expect(handleVerifyCode('000000')).rejects.toBeTruthy()
    expect(document.getElementById('auth-error').textContent).toBe('Código incorrecto. Verifica e intenta de nuevo.')
  })
})

describe('handlePhoneSignupConsent', () => {
  async function arriveAtConsentStep() {
    const getIdToken = vi.fn().mockResolvedValue('tok-phone-new')
    const confirm = vi.fn().mockResolvedValue({ user: { uid: 'new-1', getIdToken } })
    signInWithPhoneNumber.mockResolvedValueOnce({ confirm })
    getAdditionalUserInfo.mockReturnValueOnce({ isNewUser: true })
    await handleSendCode('+52', '5512345678')
    await handleVerifyCode('123456')
    return getIdToken
  }

  it('rechaza si los checkboxes no están marcados', async () => {
    await arriveAtConsentStep()
    document.getElementById('terms-checkbox').checked = false
    document.getElementById('age-checkbox').checked = false
    await handlePhoneSignupConsent()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/auth/sync', expect.anything())
  })

  it('sincroniza con termsAccepted/ageConfirmed y redirige cuando ambos checkboxes están marcados', async () => {
    const getIdToken = await arriveAtConsentStep()
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true

    await handlePhoneSignupConsent()

    expect(getIdToken).toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-phone-new', 'Content-Type': 'application/json' },
      body: JSON.stringify({ termsAccepted: true, ageConfirmed: true, termsVersion: 'v1' })
    })
  })

  it('deshabilita el botón de confirmar mientras la petición está en curso', async () => {
    await arriveAtConsentStep()
    document.getElementById('terms-checkbox').checked = true
    document.getElementById('age-checkbox').checked = true
    let resolveFetch
    global.fetch = vi.fn().mockReturnValueOnce(new Promise(r => { resolveFetch = r }))
    const btn = document.getElementById('btn-phone-consent-confirm')
    const promise = handlePhoneSignupConsent()
    expect(btn.disabled).toBe(true)
    resolveFetch({ ok: true })
    await promise
    expect(btn.disabled).toBe(false)
  })
})

describe('phone-step wiring (DOMContentLoaded)', () => {
  beforeEach(() => {
    document.dispatchEvent(new Event('DOMContentLoaded'))
  })

  it('populates #phone-country from COUNTRY_CODES with México first/selected', () => {
    const select = document.getElementById('phone-country')
    expect(select.options.length).toBe(2)
    expect(select.options[0].value).toBe('+52')
    expect(select.value).toBe('+52')
  })

  it('#btn-phone switches to the phone-number view', () => {
    document.getElementById('btn-phone').click()
    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(false)
  })

  it('#btn-phone-cancel returns to the login view', () => {
    document.getElementById('btn-phone').click()
    document.getElementById('btn-phone-cancel').click()
    expect(document.getElementById('login-view').classList.contains('hidden')).toBe(false)
    expect(document.getElementById('phone-step').classList.contains('hidden')).toBe(true)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/auth-ui.test.js`
Expected: FAIL — `handleSendCode`/`handleVerifyCode`/`handlePhoneSignupConsent`/`setView` are `undefined`; the DOM wiring tests find no listeners attached.

- [ ] **Step 4: Implement**

In `auth-ui.js`, add the new imports (top of file, alongside the existing ones from `firebase-init.js`):

```js
import {
  firebaseAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  getAdditionalUserInfo
} from './firebase-init.js';
import { setAutoSyncSuppressed } from './authClient.js';
import { COUNTRY_CODES, flagEmoji } from './country-codes.js';

// hallazgo de revisión del plan: auth-ui.js NUNCA había importado
// authClient.js antes de este cambio — el simple hecho de importarlo activa
// su listener de auto-sync module-level (onAuthChange, auth-ui.html nunca lo
// había cargado). Si solo se suprimiera dentro de handleVerifyCode (como
// decía una versión anterior de este plan), ese listener quedaría ACTIVO por
// primera vez para handleLogin/handleSignup/handleGoogleSignIn también —
// exponiendo la MISMA race de consentimiento perdido (spec, sección 4) en el
// signup por correo ya existente, que nunca la tuvo porque authClient.js
// nunca corría en esta página. auth.html no necesita el auto-sync genérico en
// NINGÚN flujo: cada uno (login, signup, Google, teléfono) ya hace su propio
// sync explícito y redirige de inmediato — así que se suprime una sola vez,
// aquí, a nivel de módulo, para toda la vida de esta página.
setAutoSyncSuppressed(true);
```

Extend `AUTH_ERROR_MESSAGES` (after the existing entries, before the closing `};`):

```js
  'auth/invalid-phone-number': 'Número de teléfono inválido.',
  'auth/missing-phone-number': 'Ingresa un número de teléfono.',
  'auth/invalid-verification-code': 'Código incorrecto. Verifica e intenta de nuevo.',
  'auth/code-expired': 'El código expiró. Solicita uno nuevo.',
  'auth/quota-exceeded': 'Demasiados SMS solicitados. Intenta más tarde.',
  'auth/captcha-check-failed': 'Verificación de seguridad falló. Intenta de nuevo.',
  'auth/invalid-app-credential': 'Verificación de seguridad falló. Intenta de nuevo.'
```

Add the state machine and phone-flow module state (top-level, alongside `const googleProvider = new GoogleAuthProvider();`). **Important:** `isSignupMode` used to be declared with `let isSignupMode = false;` INSIDE the `DOMContentLoaded` callback (it's read/written only by `enterSignupMode()`/`exitSignupMode()`, also declared in there). `setView` needs to read it too, and `setView` must be callable before `DOMContentLoaded` fires (the tests call it directly right after import) — so this declaration moves to module top-level, and the `let isSignupMode = false;` line INSIDE `DOMContentLoaded` is deleted (do not leave a second, shadowing declaration there — `enterSignupMode`/`exitSignupMode` keep their bodies unchanged, they'll now assign the module-level variable instead of a closure-local one):

```js
let recaptchaVerifier = null;
let confirmationResult = null;
let pendingPhoneCredentialResult = null;
let isSignupMode = false; // movido aquí desde dentro de DOMContentLoaded — ver nota arriba

const VIEWS = ['login', 'phone-number', 'phone-code', 'phone-consent'];
let currentView = 'login';

export function setView(view) {
  currentView = view;
  document.getElementById('login-view')?.classList.toggle('hidden', view !== 'login');
  document.getElementById('phone-step')?.classList.toggle('hidden', view !== 'phone-number');
  document.getElementById('phone-code-step')?.classList.toggle('hidden', view !== 'phone-code');
  // signup-only es compartido: visible si estamos en consentimiento de teléfono
  // O si el signup por correo (isSignupMode, controlado por enterSignupMode/
  // exitSignupMode más abajo) ya lo mostró — ninguno de los dos caminos debe
  // pisar al otro.
  document.getElementById('signup-only')?.classList.toggle('hidden', view !== 'phone-consent' && !isSignupMode);
  // btn-phone-consent-confirm SOLO es para el camino de teléfono — el signup
  // por correo usa btn-signup (su semántica de doble-clic existente), nunca
  // este botón.
  document.getElementById('btn-phone-consent-confirm')?.classList.toggle('hidden', view !== 'phone-consent');
}

function getRecaptchaVerifier() {
  if (!recaptchaVerifier) {
    recaptchaVerifier = new RecaptchaVerifier(firebaseAuth, 'recaptcha-container', { size: 'invisible' });
  }
  return recaptchaVerifier;
}

function clearPhoneFlowState() {
  confirmationResult = null;
  pendingPhoneCredentialResult = null;
}
```

Add the three handlers (after `handleGoogleSignIn`):

```js
export async function handleSendCode(dialCode, localNumber) {
  clearError();
  const btn = document.getElementById('btn-send-code');
  return withLoadingState(btn, 'Enviando código…', async () => {
    try {
      const phoneNumber = dialCode + localNumber.replace(/\D/g, '');
      confirmationResult = await signInWithPhoneNumber(firebaseAuth, phoneNumber, getRecaptchaVerifier());
      setView('phone-code');
    } catch (err) {
      showError(mapAuthError(err.code));
      recaptchaVerifier?.clear();
      recaptchaVerifier = null;
      throw err;
    }
  });
}

export async function handleVerifyCode(code) {
  clearError();
  // No hace falta suprimir aquí — ya se suprimió a nivel de módulo arriba,
  // para toda la página (ver comentario junto al import de setAutoSyncSuppressed).
  const btn = document.getElementById('btn-verify-code');
  return withLoadingState(btn, 'Verificando…', async () => {
    try {
      const result = await confirmationResult.confirm(code);
      const isNewUser = getAdditionalUserInfo(result)?.isNewUser;
      if (isNewUser) {
        pendingPhoneCredentialResult = result;
        setView('phone-consent');
        return result;
      }
      window.location.href = 'index.html';
      return result;
    } catch (err) {
      showError(mapAuthError(err.code));
      throw err;
    }
  });
}

export async function handlePhoneSignupConsent() {
  const termsChecked = document.getElementById('terms-checkbox')?.checked;
  const ageChecked = document.getElementById('age-checkbox')?.checked;
  if (!termsChecked || !ageChecked) {
    showError('Debes aceptar los Términos y confirmar tu edad para crear tu cuenta.');
    return;
  }
  const btn = document.getElementById('btn-phone-consent-confirm');
  return withLoadingState(btn, 'Guardando…', async () => {
    const token = await pendingPhoneCredentialResult.user.getIdToken();
    await fetch('/api/auth/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ termsAccepted: true, ageConfirmed: true, termsVersion: TERMS_VERSION })
    });
    window.location.href = 'index.html';
  });
}
```

Inside the existing `document.addEventListener('DOMContentLoaded', () => { ... })` block, delete the line `let isSignupMode = false;` (it now lives at module top-level, added above) — leave `enterSignupMode()`/`exitSignupMode()` and everything else in that block untouched, they keep assigning `isSignupMode` by the same name, now hitting the module-level variable instead.

Then add the DOM wiring inside that same `DOMContentLoaded` block, after the existing `btnGoogle` listener:

```js
  const btnPhone = document.getElementById('btn-phone');
  const phoneCountrySelect = document.getElementById('phone-country');
  const btnSendCode = document.getElementById('btn-send-code');
  const btnPhoneCancel = document.getElementById('btn-phone-cancel');
  const btnVerifyCode = document.getElementById('btn-verify-code');
  const btnResendCode = document.getElementById('btn-resend-code');
  const btnPhoneCodeBack = document.getElementById('btn-phone-code-back');
  const btnPhoneConsentConfirm = document.getElementById('btn-phone-consent-confirm');

  if (phoneCountrySelect) {
    phoneCountrySelect.innerHTML = COUNTRY_CODES.map(c =>
      `<option value="${c.dial}">${flagEmoji(c.iso2)} ${c.name} (${c.dial})</option>`
    ).join('');
  }

  if (btnPhone) {
    btnPhone.addEventListener('click', () => setView('phone-number'));
  }
  if (btnSendCode) {
    btnSendCode.addEventListener('click', () => {
      const dialCode = phoneCountrySelect.value;
      const localNumber = document.getElementById('phone-number').value;
      handleSendCode(dialCode, localNumber);
    });
  }
  if (btnPhoneCancel) {
    btnPhoneCancel.addEventListener('click', () => {
      clearPhoneFlowState();
      recaptchaVerifier?.clear();
      recaptchaVerifier = null;
      setView('login');
    });
  }
  if (btnVerifyCode) {
    btnVerifyCode.addEventListener('click', () => {
      const code = document.getElementById('phone-code').value;
      handleVerifyCode(code);
    });
  }
  if (btnResendCode) {
    btnResendCode.addEventListener('click', () => {
      recaptchaVerifier?.clear();
      recaptchaVerifier = null;
      const dialCode = phoneCountrySelect.value;
      const localNumber = document.getElementById('phone-number').value;
      handleSendCode(dialCode, localNumber);
    });
  }
  if (btnPhoneCodeBack) {
    btnPhoneCodeBack.addEventListener('click', () => {
      confirmationResult = null;
      setView('phone-number');
    });
  }
  if (btnPhoneConsentConfirm) {
    btnPhoneConsentConfirm.addEventListener('click', () => handlePhoneSignupConsent());
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/auth-ui.test.js`
Expected: PASS (all tests in the file, old and new).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — no regressions in any other test file.

- [ ] **Step 7: Commit**

```bash
git add auth-ui.js tests/auth-ui.test.js
git commit -m "feat(auth): wire up phone login/signup flow in auth-ui.js"
```

---

## Manual verification (not covered by automated tests)

After all tasks are complete, this needs a human/Playwright pass against a real `develop` preview deployment (per the spec's "Fuera de alcance" — no real SMS in CI):

1. Enter a real phone number, receive the SMS, verify the code, confirm redirect to `index.html`.
2. Repeat with a brand-new phone number, confirm the consent step appears, confirm both checkboxes are required, confirm `GET /api/me` afterward shows `termsAcceptedAt` non-null (this is the exact race Task 4/8 fix — worth confirming for real, not just via the unit-test fixture).
3. Confirm `account.html` shows the phone number for a phone-only account.
4. Confirm the OCR scan flow works (not blocked by the `email_not_verified` gate) for a free-tier phone-only account.
5. Before enabling this in production: complete the Firebase App Check setup described in the spec's "Prerequisito de producción" section.
