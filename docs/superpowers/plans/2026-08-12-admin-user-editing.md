# Admin User Contact/Preferences Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin correct a user's contact info (`profile.displayName/phone/email`) and preferences (`preferences.dietary/allergens/healthConditions`) from the admin panel, without touching Firebase Auth login credentials or consent timestamps.

**Architecture:** Two new admin-only Express handlers in `api/index.js` (mirroring the existing user-facing `putProfileHandler`/`putPreferencesHandler` validation, but scoped to admin and skipping onboarding/consent side effects), plus two new editable sections in `admin/admin.js`'s `renderUserDetail`, wired the same way as the existing "Guardar membresía" button.

**Tech Stack:** Node/Express (`api/index.js`), Firestore REST helpers (`api/firestore.js`), vanilla JS admin panel (`admin/admin.js`), Vitest (`tests/*.test.js`).

## Global Constraints

- Do not modify the top-level `email`/`phoneNumber` fields on the user doc (Firebase Auth login identity) — only `profile.displayName`, `profile.phone`, `profile.email`.
- Do not modify `preferences.consentGivenAt` / `preferences.consentNoticeVersion` when an admin edits preferences.
- Reuse existing validation constants verbatim: `E164_RE`, `EMAIL_RE`, `ALLOWED_DIETARY`, `ALLOWED_HEALTH_CONDITIONS`, `ALLOWED_ALLERGEN_CODES`, `ALLOWED_SEVERITY` (all already defined in `api/index.js`).
- All new admin routes go behind `requireAdmin`, same as the other `/api/admin/users/*` routes.
- `admin/admin.js` is a plain script (no `type="module"` on its `<script>` tag in `admin/index.html:178`) — cannot `import` from `preference-labels.js`; duplicate the three label maps as local constants instead.

---

### Task 1: Backend — `PATCH /api/admin/users/:uid/profile`

**Files:**
- Modify: `api/index.js` (add handler + route near the other admin user handlers, after `adminDeleteAccountHandler`/before line `app.get('/api/admin/users/search', ...)` at `api/index.js:2384`)
- Test: `tests/adminUsers.test.js` (append a new `describe` block)

**Interfaces:**
- Consumes: `fireGetUser(uid)` and `firePatchUserFields(uid, fieldPaths, data)` from `api/firestore.js` (already imported into `api/index.js`); `E164_RE` and `EMAIL_RE` constants already defined in `api/index.js` (lines 1520 and 1643).
- Produces: `adminPatchUserProfileHandler(req, res)` — exported implicitly via `module.exports` the same way other handlers in this file are (check the existing `module.exports` block at the bottom of `api/index.js` and add `adminPatchUserProfileHandler` to it, following the pattern of the other handler names already listed there).

- [ ] **Step 1: Write the failing tests**

Add to `tests/adminUsers.test.js`, right after the closing `})` of the `describe('listUsersHandler', ...)` block:

```js
describe('adminPatchUserProfileHandler', () => {
  beforeEach(() => {
    fireGetUser.mockReset()
    firePatchUserFields.mockReset()
  })

  it('responds 404 when the user document does not exist', async () => {
    fireGetUser.mockResolvedValue(null)
    const req = { params: { uid: 'uid-1' }, body: { displayName: 'Ana' } }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('responds 400 no_fields when the body has none of displayName/phone/email', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { params: { uid: 'uid-2' }, body: {} }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'no_fields' })
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('rejects an empty displayName with 400 invalid_display_name', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { params: { uid: 'uid-3' }, body: { displayName: '   ' } }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_display_name' })
  })

  it('rejects a phone that is not E.164 with 400 invalid_phone', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { params: { uid: 'uid-4' }, body: { phone: '5512345678' } }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_phone' })
  })

  it('rejects a malformed email with 400 invalid_email', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    const req = { params: { uid: 'uid-5' }, body: { email: 'not-an-email' } }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_email' })
  })

  it('patches only the fields present in the body, with an explicit nested updateMask', async () => {
    fireGetUser.mockResolvedValue({ profile: { phone: '+525512345678', displayName: 'Old' } })
    firePatchUserFields.mockResolvedValue(true)
    const req = { params: { uid: 'uid-6' }, body: { displayName: 'Ana Ruiz' } }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    expect(firePatchUserFields).toHaveBeenCalledWith(
      'uid-6',
      expect.arrayContaining(['profile.displayName']),
      expect.objectContaining({ profile: expect.objectContaining({ displayName: 'Ana Ruiz', phone: '+525512345678' }) })
    )
    expect(firePatchUserFields.mock.calls[0][1]).not.toContain('profile.phone')
    expect(res.body).toEqual({ ok: true })
  })

  it('does NOT touch profile.completedAt (admin correction, not onboarding)', async () => {
    fireGetUser.mockResolvedValue({ profile: { displayName: null, phone: null, email: null, completedAt: null } })
    firePatchUserFields.mockResolvedValue(true)
    const req = { params: { uid: 'uid-7' }, body: { displayName: 'Ana', phone: '+525512345678', email: 'a@b.com' } }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    const [, fieldPaths] = firePatchUserFields.mock.calls[0]
    expect(fieldPaths).not.toContain('profile.completedAt')
  })

  it('responds 500 when firePatchUserFields throws', async () => {
    fireGetUser.mockResolvedValue({ profile: {} })
    firePatchUserFields.mockRejectedValue(new Error('boom'))
    const req = { params: { uid: 'uid-8' }, body: { displayName: 'Ana' } }
    const res = makeRes()
    await adminPatchUserProfileHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})
```

Also update the destructuring import line near the top of `tests/adminUsers.test.js` (currently `const { searchUserHandler, patchUserMembershipHandler, setUserDisabledHandler, getUserByUidHandler, listUsersHandler } = await import('../api/index.js')`) to add `adminPatchUserProfileHandler`, and add `firestoreModule.fireGetUser = fireGetUser` plus `const fireGetUser = vi.fn()` alongside the other mock declarations at the top of the file (it isn't mocked there yet — `fireGetUser` is currently only mocked in `putProfile.test.js` and `adminAccountActions.test.js`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/adminUsers.test.js`
Expected: FAIL — `adminPatchUserProfileHandler is not defined` / not exported.

- [ ] **Step 3: Write the implementation**

In `api/index.js`, add this handler right after `adminDeleteAccountHandler` (defined around line 2374-2382) and before the `app.get('/api/admin/users/search', ...)` route registrations:

```js
async function adminPatchUserProfileHandler(req, res) {
  const { uid } = req.params;
  try {
    const user = await fireGetUser(uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    const { displayName, phone, email } = req.body || {};
    const fieldPaths = [];
    const profile = { ...(user.profile || {}) };

    if (displayName !== undefined) {
      const clean = typeof displayName === 'string' ? displayName.trim().slice(0, 100) : '';
      if (!clean) return res.status(400).json({ error: 'invalid_display_name' });
      profile.displayName = clean;
      fieldPaths.push('profile.displayName');
    }
    if (phone !== undefined) {
      if (typeof phone !== 'string' || !E164_RE.test(phone)) return res.status(400).json({ error: 'invalid_phone' });
      profile.phone = phone;
      fieldPaths.push('profile.phone');
    }
    if (email !== undefined) {
      const clean = typeof email === 'string' ? email.trim().slice(0, 200) : '';
      if (!EMAIL_RE.test(clean)) return res.status(400).json({ error: 'invalid_email' });
      profile.email = clean;
      fieldPaths.push('profile.email');
    }
    if (fieldPaths.length === 0) return res.status(400).json({ error: 'no_fields' });

    await firePatchUserFields(uid, fieldPaths, { profile });
    res.json({ ok: true });
  } catch (e) {
    console.warn('[PATCH /api/admin/users/:uid/profile] error, uid:', req.params.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.patch('/api/admin/users/:uid/profile', requireAdmin, adminPatchUserProfileHandler);
```

Then find the `module.exports` block at the bottom of `api/index.js` (search for `patchUserMembershipHandler` inside a `module.exports = {` object) and add `adminPatchUserProfileHandler` to that list, alphabetically near the other admin handlers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adminUsers.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/adminUsers.test.js
git commit -m "feat(admin): agrega endpoint para editar datos de contacto de un usuario"
```

---

### Task 2: Backend — `PATCH /api/admin/users/:uid/preferences`

**Files:**
- Modify: `api/index.js` (add handler + route right after the Task 1 route)
- Test: `tests/adminUsers.test.js` (append another `describe` block)

**Interfaces:**
- Consumes: `firePatchUserFields(uid, fieldPaths, data)` from `api/firestore.js`; `ALLOWED_DIETARY`, `ALLOWED_HEALTH_CONDITIONS`, `ALLOWED_ALLERGEN_CODES`, `ALLOWED_SEVERITY` constants already defined in `api/index.js` (lines 1934-1939).
- Produces: `adminPatchUserPreferencesHandler(req, res)`, added to the same `module.exports` block as Task 1.

- [ ] **Step 1: Write the failing tests**

Append to `tests/adminUsers.test.js`, after the `adminPatchUserProfileHandler` describe block:

```js
describe('adminPatchUserPreferencesHandler', () => {
  beforeEach(() => { firePatchUserFields.mockReset() })

  it('responds 400 invalid_preferences when dietary/allergens/healthConditions are not arrays', async () => {
    const req = { params: { uid: 'uid-1' }, body: { dietary: 'vegan', allergens: [], healthConditions: [] } }
    const res = makeRes()
    await adminPatchUserPreferencesHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_preferences' })
    expect(firePatchUserFields).not.toHaveBeenCalled()
  })

  it('responds 400 invalid_dietary for a code outside the whitelist', async () => {
    const req = { params: { uid: 'uid-2' }, body: { dietary: ['bogus'], allergens: [], healthConditions: [] } }
    const res = makeRes()
    await adminPatchUserPreferencesHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_dietary' })
  })

  it('responds 400 invalid_health_conditions for a code outside the whitelist', async () => {
    const req = { params: { uid: 'uid-3' }, body: { dietary: [], allergens: [], healthConditions: ['bogus'] } }
    const res = makeRes()
    await adminPatchUserPreferencesHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_health_conditions' })
  })

  it('responds 400 invalid_allergens for a bad code or severity', async () => {
    const req = { params: { uid: 'uid-4' }, body: { dietary: [], allergens: [{ code: 'bogus', severity: 'severe' }], healthConditions: [] } }
    const res = makeRes()
    await adminPatchUserPreferencesHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'invalid_allergens' })
  })

  it('patches dietary/allergens/healthConditions without touching consent fields', async () => {
    firePatchUserFields.mockResolvedValue(true)
    const req = {
      params: { uid: 'uid-5' },
      body: {
        dietary: ['vegan', 'glutenFree'],
        allergens: [{ code: 'cacahuate', severity: 'severe' }],
        healthConditions: ['diabet']
      }
    }
    const res = makeRes()
    await adminPatchUserPreferencesHandler(req, res)
    expect(firePatchUserFields).toHaveBeenCalledWith(
      'uid-5',
      ['preferences.dietary', 'preferences.allergens', 'preferences.healthConditions', 'preferences.updatedAt'],
      expect.objectContaining({
        preferences: expect.objectContaining({
          dietary: ['vegan', 'glutenFree'],
          allergens: [{ code: 'cacahuate', severity: 'severe' }],
          healthConditions: ['diabet']
        })
      })
    )
    expect(res.body).toEqual({ ok: true, preferences: expect.any(Object) })
  })

  it('responds 500 when firePatchUserFields throws', async () => {
    firePatchUserFields.mockRejectedValue(new Error('boom'))
    const req = { params: { uid: 'uid-6' }, body: { dietary: [], allergens: [], healthConditions: [] } }
    const res = makeRes()
    await adminPatchUserPreferencesHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})
```

Update the destructuring import line to also include `adminPatchUserPreferencesHandler`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/adminUsers.test.js`
Expected: FAIL — `adminPatchUserPreferencesHandler is not defined`.

- [ ] **Step 3: Write the implementation**

In `api/index.js`, add this handler right after `adminPatchUserProfileHandler`'s route registration from Task 1:

```js
async function adminPatchUserPreferencesHandler(req, res) {
  const { uid } = req.params;
  try {
    const { dietary, allergens, healthConditions } = req.body || {};
    if (!Array.isArray(dietary) || !Array.isArray(allergens) || !Array.isArray(healthConditions)) {
      return res.status(400).json({ error: 'invalid_preferences' });
    }
    if (!dietary.every(d => ALLOWED_DIETARY.includes(d))) {
      return res.status(400).json({ error: 'invalid_dietary' });
    }
    if (!healthConditions.every(h => ALLOWED_HEALTH_CONDITIONS.includes(h))) {
      return res.status(400).json({ error: 'invalid_health_conditions' });
    }
    if (!allergens.every(a => a && ALLOWED_ALLERGEN_CODES.includes(a.code) && ALLOWED_SEVERITY.includes(a.severity))) {
      return res.status(400).json({ error: 'invalid_allergens' });
    }

    const preferences = { dietary, allergens, healthConditions, updatedAt: new Date().toISOString() };
    // A diferencia de PUT /api/me/preferences, no se toca consentGivenAt/consentNoticeVersion:
    // un admin corrigiendo datos no otorga consentimiento en nombre del usuario.
    await firePatchUserFields(uid, [
      'preferences.dietary', 'preferences.allergens', 'preferences.healthConditions', 'preferences.updatedAt'
    ], { preferences });

    res.json({ ok: true, preferences });
  } catch (e) {
    console.warn('[PATCH /api/admin/users/:uid/preferences] error, uid:', req.params.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.patch('/api/admin/users/:uid/preferences', requireAdmin, adminPatchUserPreferencesHandler);
```

Add `adminPatchUserPreferencesHandler` to the `module.exports` block, next to `adminPatchUserProfileHandler`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adminUsers.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/adminUsers.test.js
git commit -m "feat(admin): agrega endpoint para editar preferencias de un usuario"
```

---

### Task 3: Frontend — editable contact info section

**Files:**
- Modify: `admin/admin.js` — `renderUserDetail` function (currently lines 365-405) and the click-delegation block that handles `btn.dataset.action` (the `else if` chain currently ending around line 664, right after `admin-delete-account`)

**Interfaces:**
- Consumes: `PATCH /api/admin/users/:uid/profile` from Task 1 (body `{displayName, phone, email}`, response `{ok: true}` or `{error}`); existing `apiFetch(path, opts)` helper (`admin/admin.js:90`); existing `escHtml` helper; existing `loadUserDetail(uid)` function (referenced at `admin/admin.js:619` etc., re-fetches and re-renders); existing `currentDetailUid` module variable.
- Produces: a new editable block inside the HTML returned by `renderUserDetail`, and a new `btn.dataset.action === 'save-contact'` branch in the click handler.

- [ ] **Step 1: Add the editable inputs to `renderUserDetail`**

In `admin/admin.js`, inside `renderUserDetail` (around line 388, right after the `Estado de cuenta` line and before the membership `<div style="display:flex;gap:8px;...">` block), insert a new section reading from `profile.profile` (the nested contact-info object, distinct from the top-level Auth-sourced `profile.email`/`profile.phoneNumber` already shown above it):

```js
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="user-contact-name" placeholder="Nombre" value="${escHtml((profile.profile && profile.profile.displayName) || '')}" style="flex:1;min-width:140px;">
          <input type="email" id="user-contact-email" placeholder="Correo de contacto" value="${escHtml((profile.profile && profile.profile.email) || '')}" style="flex:1;min-width:180px;">
          <input type="text" id="user-contact-phone" placeholder="Teléfono (+52...)" value="${escHtml((profile.profile && profile.profile.phone) || '')}" style="flex:1;min-width:140px;">
          <button class="btn" data-action="save-contact" data-uid="${escHtml(uid)}">Guardar datos de contacto</button>
        </div>
```

This goes as a new sibling `<div>` immediately before the existing `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">` that holds the membership select (line 390 in the current file).

- [ ] **Step 2: Add the click handler**

In the same file, inside the click-delegation `else if` chain (find `} else if (btn.dataset.action === 'admin-delete-account') {` block, which ends with its own `r.ok`/`else` branch — add the new branch immediately after that block closes, before the chain's final closing):

```js
    } else if (btn.dataset.action === 'save-contact') {
      const uid = btn.dataset.uid;
      const displayName = document.getElementById('user-contact-name').value.trim();
      const email = document.getElementById('user-contact-email').value.trim();
      const phone = document.getElementById('user-contact-phone').value.trim();
      btn.disabled = true;
      btn.textContent = '…';
      const r = await apiFetch('/api/admin/users/' + encodeURIComponent(uid) + '/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName, email, phone })
      });
      if (r.ok) {
        loadUserDetail(currentDetailUid);
      } else {
        alert('Error al guardar los datos de contacto.');
        btn.disabled = false;
        btn.textContent = 'Guardar datos de contacto';
      }
    }
```

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev` (or the project's existing local server command — check `package.json` `scripts` for the exact one) and open `/admin/index.html`.
- Open a user detail (Usuarios tab → search or list → click a user).
- Confirm the three new inputs render, pre-filled from `profile.profile.*` if present, empty otherwise.
- Type a new name, click "Guardar datos de contacto".
- Expected: button shows "…", then the panel reloads and the name input still shows the new value (proves the round-trip saved and `loadUserDetail` re-rendered from the server's current state).
- Try leaving all three fields blank and note the current handler still sends an empty-string `displayName` — clicking Guardar with a blank name should show the alert (matches `invalid_display_name` from Task 1, since `displayName` is sent as `''` which fails the `!clean` check). Confirm the alert appears and the fields keep your input (button re-enables).

- [ ] **Step 4: Commit**

```bash
git add admin/admin.js
git commit -m "feat(admin): permite editar nombre/correo/telefono de contacto de un usuario"
```

---

### Task 4: Frontend — editable preferences section

**Files:**
- Modify: `admin/admin.js` — `renderUserDetail` function and the click-delegation block (same locations as Task 3, applied after it)

**Interfaces:**
- Consumes: `PATCH /api/admin/users/:uid/preferences` from Task 2 (body `{dietary: string[], allergens: {code, severity}[], healthConditions: string[]}`); `profile.preferences` object as returned by `GET /api/admin/users/:uid` (already present in the data passed into `renderUserDetail`, shape `{dietary, allergens, healthConditions, consentGivenAt, consentNoticeVersion, updatedAt}` — may be `undefined` for a user who never set preferences).
- Produces: a new checkbox-based editable block inside `renderUserDetail`, and a new `btn.dataset.action === 'save-preferences'` branch in the click handler.

- [ ] **Step 1: Add local label constants**

In `admin/admin.js`, near the top of the file (right after the `SECTION_TITLES` constant at line 27), add these three constants — copied verbatim from `preference-labels.js` (cannot `import` it since `admin.js` is a plain, non-module script; keep these two files in sync if the source ever changes):

```js
  const DIETARY_LABELS = {
    vegan: 'Vegano', vegetarian: 'Vegetariano', keto: 'Keto', glutenFree: 'Sin gluten',
    caseinFree: 'Sin caseína', organic: 'Orgánico', kosher: 'Kosher', halal: 'Halal',
    nonGmo: 'Sin OGM', noAdditives: 'Sin aditivos', palmOilFree: 'Sin palma', fairTrade: 'C. justo'
  };
  const HEALTH_LABELS = {
    diabet: 'Diabetes', celiac: 'Celiaquía', hipert: 'Hipertensión',
    ninos: 'Niños en casa', fenilc: 'Fenilcetonuria', lactos: 'Intolerancia a lactosa'
  };
  const ALLERGEN_LABELS = {
    cacahuate: 'Cacahuate', lacteos: 'Lácteos', nueces: 'Nueces', trigo: 'Trigo',
    huevo: 'Huevo', pescado: 'Pescado', mariscos: 'Mariscos', soja: 'Soya'
  };
```

- [ ] **Step 2: Add a checkbox-rendering helper**

Right after those constants, add a small helper used to build each checkbox group:

```js
  function renderPrefCheckboxes(name, labelMap, selectedCodes) {
    return Object.entries(labelMap).map(([code, label]) => `
      <label style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-size:0.85rem;">
        <input type="checkbox" name="${escHtml(name)}" value="${escHtml(code)}" ${selectedCodes.includes(code) ? 'checked' : ''}>
        ${escHtml(label)}
      </label>`).join('');
  }
```

- [ ] **Step 3: Add the editable preferences block to `renderUserDetail`**

Insert this new section right after the contact-info block added in Task 3 (before the membership select block):

```js
        <div style="display:flex;flex-direction:column;gap:6px;">
          <div class="doc-meta">Preferencias dietéticas:</div>
          <div id="user-pref-dietary">${renderPrefCheckboxes('pref-dietary', DIETARY_LABELS, (profile.preferences && profile.preferences.dietary) || [])}</div>
          <div class="doc-meta">Condiciones de salud:</div>
          <div id="user-pref-health">${renderPrefCheckboxes('pref-health', HEALTH_LABELS, (profile.preferences && profile.preferences.healthConditions) || [])}</div>
          <div class="doc-meta">Alergias (severidad estricta):</div>
          <div id="user-pref-allergens">${renderPrefCheckboxes('pref-allergens', ALLERGEN_LABELS, ((profile.preferences && profile.preferences.allergens) || []).map(a => a.code))}</div>
          <div>
            <button class="btn" data-action="save-preferences" data-uid="${escHtml(uid)}">Guardar preferencias</button>
          </div>
        </div>
```

Note: allergen severity is simplified to a single checkbox group in the admin UI — checking an allergen saves it with `severity: 'severe'`. This is a deliberate simplification (admin corrections are rare and severity nuance isn't the reported problem); if per-allergen severity editing is needed later, revisit.

- [ ] **Step 4: Add the click handler**

Add this branch to the same `else if` chain, after the `save-contact` branch from Task 3:

```js
    } else if (btn.dataset.action === 'save-preferences') {
      const uid = btn.dataset.uid;
      const dietary = Array.from(document.querySelectorAll('input[name="pref-dietary"]:checked')).map(el => el.value);
      const healthConditions = Array.from(document.querySelectorAll('input[name="pref-health"]:checked')).map(el => el.value);
      const allergens = Array.from(document.querySelectorAll('input[name="pref-allergens"]:checked')).map(el => ({ code: el.value, severity: 'severe' }));
      btn.disabled = true;
      btn.textContent = '…';
      const r = await apiFetch('/api/admin/users/' + encodeURIComponent(uid) + '/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ dietary, allergens, healthConditions })
      });
      if (r.ok) {
        loadUserDetail(currentDetailUid);
      } else {
        alert('Error al guardar las preferencias.');
        btn.disabled = false;
        btn.textContent = 'Guardar preferencias';
      }
    }
```

- [ ] **Step 5: Manually verify in the browser**

With the same local server running from Task 3:
- Open a user detail. Confirm the three checkbox groups render (unchecked if the user has no preferences yet).
- Check a couple of boxes across the three groups, click "Guardar preferencias".
- Expected: button shows "…", panel reloads, the same boxes remain checked (proves the round-trip saved).
- Uncheck everything and save again — expected: all three arrays saved empty, no error (the endpoint accepts empty arrays).

- [ ] **Step 6: Commit**

```bash
git add admin/admin.js
git commit -m "feat(admin): permite editar preferencias dieteticas/salud/alergias de un usuario"
```
