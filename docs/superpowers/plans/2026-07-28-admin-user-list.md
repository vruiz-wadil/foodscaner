# Lista de usuarios en la tab "Usuarios" — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un listado paginado (más reciente primero) de todos los usuarios a la tab "Usuarios" del panel admin, navegable desde el buscador ya existente, con detalle completo (perfil + editar membresía + desactivar/reactivar) al hacer click en cualquier fila.

**Architecture:** Nueva función `fireListUsers(pageToken)` en `api/firestore.js` (Firestore `runQuery` con `orderBy createdAt DESC` + cursor `startAt`), nuevo endpoint `GET /api/admin/users/list` en `api/index.js`. Se extrae `buildUserDetail(uid)` de `searchUserHandler` para reusarla desde un nuevo `GET /api/admin/users/:uid` (detalle por uid, usado al hacer click en una fila de la lista). El frontend reemplaza el mensaje estático de la tab por una lista paginada (mismo patrón visual `.list-card`/"Cargar más" que las demás tabs), y unifica el refresh de la card de detalle (hoy dependiente de `lastUserSearch`) para que funcione sin importar si se llegó por búsqueda o por click en la lista.

**Tech Stack:** Express (backend), Firestore REST API (`runQuery`), vanilla JS (frontend admin), vitest.

## Global Constraints

- Ver `docs/superpowers/specs/2026-07-28-admin-user-list-design.md` para el diseño completo y las razones detrás de no reusar el visor genérico de colecciones.
- `ADMIN_COLLECTIONS` (en `api/firestore.js`) NO se modifica — `users` no se agrega ahí.
- Orden de la lista: `createdAt DESC` únicamente. Sin filtro por membresía ni otros campos (diferido, YAGNI).
- Tamaño de página: 50 (mismo valor que `fireListDocs`/`fireListUserHistory`).
- Click en fila de la lista abre la MISMA card de detalle que ya usa el buscador (perfil + editar membresía + desactivar/reactivar), no una vista de solo lectura.
- El refresh de la card de detalle tras guardar membresía o (des)activar cuenta debe funcionar igual sin importar si la card se abrió por búsqueda o por click en la lista.

---

### Task 1: `fireListUsers` en `api/firestore.js`

**Files:**
- Modify: `api/firestore.js` (agrega la función después de `findUserByEmail`, ~línea 748, antes del `module.exports`; agrega `fireListUsers` al `module.exports`)
- Test: `tests/firestore-users.test.js` (ya existe — se le agrega el import y 6 tests nuevos)

**Interfaces:**
- Consumes: `getAccessToken()`, `getProjectId()`, `BASE`, `fromFirestoreFields()` — todos ya definidos en `api/firestore.js`.
- Produces: `fireListUsers(pageToken: string|null): Promise<{items: Array<{uid, email, phoneNumber, displayName, membershipStatus, createdAt}>, nextPageToken: string|null}>`. Exportado desde `api/firestore.js`.

- [ ] **Step 1: Escribir los tests que fallan**

Cambia la línea 4 de `tests/firestore-users.test.js` (agrega `fireListUsers` al import ya existente):

```js
const { fireGetUser, fireUpsertUser, firePatchUserFields, findUserByEmail, fireListUsers } = await import('../api/firestore.js')
```

Agrega estos 6 tests dentro del `describe('users/{uid} data layer', ...)` ya existente (reusa `buildFetchMock`/`fakeServiceAccountKey`, ya definidos arriba en el mismo archivo), justo antes del cierre `})` final del describe:

```js
  it('fireListUsers arma la structuredQuery con orderBy createdAt DESC y limit 50, sin startAt cuando no hay pageToken', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      capturedBody = JSON.parse(options.body)
      return { ok: true, status: 200, json: async () => ([]) }
    }))

    await fireListUsers(null)

    expect(capturedBody.structuredQuery.from).toEqual([{ collectionId: 'users' }])
    expect(capturedBody.structuredQuery.orderBy).toEqual([{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }])
    expect(capturedBody.structuredQuery.limit).toBe(50)
    expect(capturedBody.structuredQuery.startAt).toBeUndefined()
  })

  it('fireListUsers agrega startAt (before:false) cuando se pasa pageToken', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    let capturedBody
    vi.stubGlobal('fetch', buildFetchMock(async (url, options) => {
      capturedBody = JSON.parse(options.body)
      return { ok: true, status: 200, json: async () => ([]) }
    }))

    await fireListUsers('2026-07-20T10:00:00.000Z')

    expect(capturedBody.structuredQuery.startAt).toEqual({ values: [{ stringValue: '2026-07-20T10:00:00.000Z' }], before: false })
  })

  it('fireListUsers mapea cada documento a la fila liviana {uid, email, phoneNumber, displayName, membershipStatus, createdAt}', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({
      ok: true,
      status: 200,
      json: async () => ([
        { document: {
          name: 'projects/foodscaner-test/databases/(default)/documents/users/uid-1',
          fields: {
            email: { stringValue: 'a@b.com' },
            phoneNumber: { stringValue: '+525512345678' },
            displayName: { stringValue: 'Ana' },
            membershipStatus: { stringValue: 'active' },
            createdAt: { stringValue: '2026-07-21T09:00:00.000Z' }
          }
        } }
      ])
    })))

    const result = await fireListUsers(null)

    expect(result.items).toEqual([{
      uid: 'uid-1', email: 'a@b.com', phoneNumber: '+525512345678',
      displayName: 'Ana', membershipStatus: 'active', createdAt: '2026-07-21T09:00:00.000Z'
    }])
  })

  it('fireListUsers devuelve nextPageToken:null cuando la página trae menos de 50 items', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({
      ok: true,
      status: 200,
      json: async () => ([
        { document: { name: 'projects/foodscaner-test/databases/(default)/documents/users/uid-1', fields: { createdAt: { stringValue: '2026-07-21T09:00:00.000Z' } } } }
      ])
    })))

    const result = await fireListUsers(null)

    expect(result.nextPageToken).toBeNull()
  })

  it('fireListUsers devuelve nextPageToken = createdAt del último item cuando la página trae exactamente 50', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    const rows = Array.from({ length: 50 }, (_, i) => ({
      document: {
        name: `projects/foodscaner-test/databases/(default)/documents/users/uid-${i}`,
        fields: { createdAt: { stringValue: `2026-07-21T00:${String(i).padStart(2, '0')}:00.000Z` } }
      }
    }))
    vi.stubGlobal('fetch', buildFetchMock(async () => ({ ok: true, status: 200, json: async () => rows })))

    const result = await fireListUsers(null)

    expect(result.items.length).toBe(50)
    expect(result.nextPageToken).toBe(rows[49].document.fields.createdAt.stringValue)
  })

  it('fireListUsers lanza cuando Firestore responde error', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = fakeServiceAccountKey()
    vi.stubGlobal('fetch', buildFetchMock(async () => ({ ok: false, status: 500 })))

    await expect(fireListUsers(null)).rejects.toThrow('list users failed: 500')
  })
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/firestore-users.test.js -t "fireListUsers"`
Expected: FAIL — `fireListUsers is not a function`

- [ ] **Step 3: Implementar en `api/firestore.js`**

Agrega esta función después de `findUserByEmail` (justo antes de `module.exports`, ~línea 748):

```js
// --- users: listado paginado, más reciente primero (para la tab Usuarios del panel admin) ---
async function fireListUsers(pageToken) {
  const token = await getAccessToken();
  if (!token) throw new Error('No Firestore access token');
  const PAGE_SIZE = 50;
  const structuredQuery = {
    from: [{ collectionId: 'users' }],
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    limit: PAGE_SIZE
  };
  if (pageToken) structuredQuery.startAt = { values: [{ stringValue: pageToken }], before: false };
  const resp = await fetch(`${BASE}/projects/${getProjectId()}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
    signal: AbortSignal.timeout(5000)
  });
  if (!resp.ok) throw new Error(`Firestore list users failed: ${resp.status}`);
  const rows = await resp.json();
  const items = rows.filter(r => r.document).map(r => {
    const uid = r.document.name.split('/').pop();
    const f = fromFirestoreFields(r.document.fields || {});
    return {
      uid,
      email: f.email || null,
      phoneNumber: f.phoneNumber || null,
      displayName: f.displayName || null,
      membershipStatus: f.membershipStatus || null,
      createdAt: f.createdAt || null
    };
  });
  const nextPageToken = items.length === PAGE_SIZE ? items[items.length - 1].createdAt : null;
  return { items, nextPageToken };
}
```

Y agrega `fireListUsers` al `module.exports` al final del archivo (línea con `fireGetPhoneIndex, fireSetPhoneIndex, findUserByEmail`):

```js
  fireGetPhoneIndex, fireSetPhoneIndex, findUserByEmail, fireListUsers
};
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/firestore-users.test.js`
Expected: PASS (todos los tests del archivo, incluyendo los 6 nuevos)

- [ ] **Step 5: Commit**

```bash
git add api/firestore.js tests/firestore-users.test.js
git commit -m "feat(admin): agrega fireListUsers para el listado paginado de la tab Usuarios"
```

---

### Task 2: `GET /api/admin/users/list` y `GET /api/admin/users/:uid` en `api/index.js`

**Files:**
- Modify: `api/index.js` (import línea 7; refactor de `searchUserHandler` para extraer `buildUserDetail`; 2 handlers nuevos; 2 rutas nuevas; 2 exports nuevos)
- Test: `tests/adminUsers.test.js` (ya existe — se le agrega el import de `fireListUsers`/los 2 handlers nuevos y 6 tests nuevos)

**Interfaces:**
- Consumes: `fireListUsers` (Task 1, de `api/firestore.js`); `fireGetUserRaw`, `lookupAuthAccount` (ya existentes, ya usados por `searchUserHandler`).
- Produces: `getUserByUidHandler(req, res)`, `listUsersHandler(req, res)` — exportados desde `api/index.js` para poder probarse directamente (mismo patrón que `searchUserHandler`).

- [ ] **Step 1: Escribir los tests que fallan**

Cambia las líneas 8-20 de `tests/adminUsers.test.js` (agrega `fireListUsers` al mock de `firestoreModule`):

```js
const findUserByEmail = vi.fn()
const fireGetPhoneIndex = vi.fn()
const fireGetUserRaw = vi.fn()
const firePatchUserFields = vi.fn()
const fireListUsers = vi.fn()
firestoreModule.findUserByEmail = findUserByEmail
firestoreModule.fireGetPhoneIndex = fireGetPhoneIndex
firestoreModule.fireGetUserRaw = fireGetUserRaw
firestoreModule.firePatchUserFields = firePatchUserFields
firestoreModule.fireListUsers = fireListUsers

const lookupAuthAccount = vi.fn()
const setUserDisabled = vi.fn()
phoneAuthModule.lookupAuthAccount = lookupAuthAccount
phoneAuthModule.setUserDisabled = setUserDisabled
```

Cambia la línea 22 (agrega los 2 handlers nuevos al import):

```js
const { searchUserHandler, patchUserMembershipHandler, setUserDisabledHandler, getUserByUidHandler, listUsersHandler } = await import('../api/index.js')
```

Agrega estos 2 `describe` nuevos al final del archivo (después del `describe('setUserDisabledHandler', ...)` ya existente):

```js
describe('getUserByUidHandler', () => {
  beforeEach(() => {
    fireGetUserRaw.mockReset()
    lookupAuthAccount.mockReset()
  })

  it('returns {uid, profile, auth} when the user doc exists', async () => {
    fireGetUserRaw.mockResolvedValue({ fields: { email: 'a@b.com', membershipStatus: 'active' }, updateTime: 't' })
    lookupAuthAccount.mockResolvedValue({ disabled: false, emailVerified: true })
    const req = { params: { uid: 'uid-1' } }
    const res = makeRes()

    await getUserByUidHandler(req, res)

    expect(fireGetUserRaw).toHaveBeenCalledWith('uid-1')
    expect(res.body).toEqual({
      uid: 'uid-1',
      profile: { email: 'a@b.com', membershipStatus: 'active' },
      auth: { disabled: false, emailVerified: true }
    })
  })

  it('responds 404 when the user doc does not exist', async () => {
    fireGetUserRaw.mockResolvedValue(null)
    const req = { params: { uid: 'uid-missing' } }
    const res = makeRes()
    await getUserByUidHandler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('responds 500 when a dependency throws', async () => {
    fireGetUserRaw.mockRejectedValue(new Error('boom'))
    const req = { params: { uid: 'uid-1' } }
    const res = makeRes()
    await getUserByUidHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})

describe('listUsersHandler', () => {
  beforeEach(() => { fireListUsers.mockReset() })

  it('returns items and nextPageToken from fireListUsers', async () => {
    fireListUsers.mockResolvedValue({ items: [{ uid: 'uid-1', email: 'a@b.com' }], nextPageToken: '2026-07-20T00:00:00.000Z' })
    const req = { query: {} }
    const res = makeRes()

    await listUsersHandler(req, res)

    expect(fireListUsers).toHaveBeenCalledWith(null)
    expect(res.body).toEqual({ items: [{ uid: 'uid-1', email: 'a@b.com' }], nextPageToken: '2026-07-20T00:00:00.000Z' })
  })

  it('passes req.query.pageToken through to fireListUsers', async () => {
    fireListUsers.mockResolvedValue({ items: [], nextPageToken: null })
    const req = { query: { pageToken: '2026-07-15T00:00:00.000Z' } }
    const res = makeRes()

    await listUsersHandler(req, res)

    expect(fireListUsers).toHaveBeenCalledWith('2026-07-15T00:00:00.000Z')
  })

  it('responds 500 when fireListUsers throws', async () => {
    fireListUsers.mockRejectedValue(new Error('boom'))
    const req = { query: {} }
    const res = makeRes()
    await listUsersHandler(req, res)
    expect(res.statusCode).toBe(500)
  })
})
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/adminUsers.test.js`
Expected: FAIL — `getUserByUidHandler`/`listUsersHandler` no exportadas desde `../api/index.js`

- [ ] **Step 3: Implementar en `api/index.js`**

Cambia la línea 7 (agrega `fireListUsers` al destructure ya existente):

```js
const { getAccessToken, fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache, fireGetOcrData, fireSetOcrData, fireGetNutritionOcr, fireSetNutritionOcr, fireListDocs, fireListAll, fireDeleteDoc, fireLogScan, fireMarkScanNotFound, fireMarkScanHasOcr, fireMarkScanHasNutrition, fireMarkScanConfidence, fireMarkScanSource, fireMarkScanSources, fireLogReport, ADMIN_COLLECTIONS, fireUpsertUser, fireGetUser, firePatchUserFields, fireIncrementUsageCounter, fireRecordMembershipPayment, fireLogUserHistory, fireListUserHistory, fireGetPhoneIndex, fireSetPhoneIndex, fireGetUserRaw, findUserByEmail, fireListUsers } = require('./firestore');
```

Reemplaza el bloque completo `searchUserHandler`...`setUserDisabledHandler` + registro de rutas (desde `async function searchUserHandler(req, res) {` hasta la línea `app.post('/api/admin/users/:uid/disabled', requireAdmin, setUserDisabledHandler);` inclusive) por:

```js
async function buildUserDetail(uid) {
  const userDoc = await fireGetUserRaw(uid);
  if (!userDoc) return null;
  const authAccount = await lookupAuthAccount(uid);
  return { uid, profile: userDoc.fields, auth: authAccount };
}

async function searchUserHandler(req, res) {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'missing_query' });
  try {
    let uid;
    if (q.includes('@')) {
      uid = await findUserByEmail(q.toLowerCase());
    } else {
      const idx = await fireGetPhoneIndex(q);
      uid = idx ? idx.uid : null;
    }
    if (!uid) return res.status(404).json({ error: 'not_found' });

    const detail = await buildUserDetail(uid);
    if (!detail) return res.status(404).json({ error: 'not_found' });
    res.json(detail);
  } catch (e) {
    console.warn('[GET /api/admin/users/search] error, q:', req.query.q, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

async function getUserByUidHandler(req, res) {
  const { uid } = req.params;
  try {
    const detail = await buildUserDetail(uid);
    if (!detail) return res.status(404).json({ error: 'not_found' });
    res.json(detail);
  } catch (e) {
    console.warn('[GET /api/admin/users/:uid] error, uid:', req.params.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

async function listUsersHandler(req, res) {
  try {
    const result = await fireListUsers(req.query.pageToken || null);
    res.json(result);
  } catch (e) {
    console.warn('[GET /api/admin/users/list] error:', e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

async function patchUserMembershipHandler(req, res) {
  const { uid } = req.params;
  const { membershipStatus, membershipExpiresAt } = req.body || {};
  if (!['pending', 'active', 'expired'].includes(membershipStatus)) {
    return res.status(400).json({ error: 'invalid_membership_status' });
  }
  try {
    await firePatchUserFields(uid, ['membershipStatus', 'membershipExpiresAt'], {
      membershipStatus, membershipExpiresAt: membershipExpiresAt || null
    });
    res.json({ ok: true });
  } catch (e) {
    console.warn('[PATCH /api/admin/users/:uid/membership] error, uid:', req.params.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

async function setUserDisabledHandler(req, res) {
  const { uid } = req.params;
  const { disabled } = req.body || {};
  if (typeof disabled !== 'boolean') return res.status(400).json({ error: 'invalid_disabled' });
  try {
    await setUserDisabled(uid, disabled);
    res.json({ ok: true, disabled });
  } catch (e) {
    console.warn('[POST /api/admin/users/:uid/disabled] error, uid:', req.params.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.get('/api/admin/users/search', requireAdmin, searchUserHandler);
app.get('/api/admin/users/list', requireAdmin, listUsersHandler);
app.patch('/api/admin/users/:uid/membership', requireAdmin, patchUserMembershipHandler);
app.post('/api/admin/users/:uid/disabled', requireAdmin, setUserDisabledHandler);
app.get('/api/admin/users/:uid', requireAdmin, getUserByUidHandler);
```

**Importante sobre el orden de rutas**: `app.get('/api/admin/users/:uid', ...)` debe registrarse DESPUÉS de `app.get('/api/admin/users/search', ...)` y `app.get('/api/admin/users/list', ...)` — Express prueba las rutas en el orden en que se registran, no por especificidad. Si `:uid` se registrara antes, capturaría las peticiones a `/search` y `/list` como si `uid` fuera literalmente `"search"` o `"list"`.

Agrega estas 2 líneas junto a los demás `module.exports.XHandler = ...` al final del archivo (después de `module.exports.setUserDisabledHandler = setUserDisabledHandler;`):

```js
module.exports.getUserByUidHandler = getUserByUidHandler;
module.exports.listUsersHandler = listUsersHandler;
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/adminUsers.test.js`
Expected: PASS (todos los tests del archivo, incluyendo los 6 nuevos — los tests ya existentes de `searchUserHandler` deben seguir pasando sin cambios, ya que `buildUserDetail` reproduce exactamente el mismo comportamiento que tenía inline)

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/adminUsers.test.js
git commit -m "feat(admin): agrega GET /api/admin/users/list y GET /api/admin/users/:uid"
```

---

### Task 3: Lista paginada en la tab "Usuarios" (`admin/admin.js`)

**Files:**
- Modify: `admin/admin.js`

**Interfaces:**
- Consumes: `GET /api/admin/users/list?pageToken=`, `GET /api/admin/users/:uid` (Task 2).
- Produces: nada consumido por otras tasks — es la última.

Nota: `admin.js` no tiene tests automatizados (patrón ya establecido en el repo — ver `docs/superpowers/plans/2026-07-27-admin-user-management.md`). Este task se verifica manualmente.

- [ ] **Step 1: Reemplazar `lastUserSearch` por `currentDetailUid`**

Cambia la línea 25 de `admin/admin.js`:

```js
  let lastUserSearch = null;
```

por:

```js
  let currentDetailUid = null;
```

(`lastUserSearch` queda obsoleto: el refresh de la card de detalle pasa a hacerse por uid, sin importar si se llegó por búsqueda o por click en la lista — ver Steps 3-4.)

- [ ] **Step 2: Rama `users` de `loadCollection()` carga la lista en vez del mensaje estático**

Cambia (líneas 167-173):

```js
  async function loadCollection(append = false) {
    if (currentCol === 'users') {
      docList.innerHTML = '<div class="empty-msg">Busca un usuario por correo o teléfono.</div>';
      statsBar.textContent = '';
      loadMoreEl.innerHTML = '';
      return;
    }
```

a:

```js
  async function loadCollection(append = false) {
    if (currentCol === 'users') { await loadUserList(); return; }
```

- [ ] **Step 3: Agregar `loadUserList`, `renderUserList` y `loadUserDetail`**

Agrega estas 3 funciones nuevas justo antes de `async function searchUser(q) {` (~línea 308):

```js
  const MEMBERSHIP_LABELS = { pending: 'Pendiente', active: 'Activa', expired: 'Expirada' };

  async function loadUserList(append = false) {
    if (!append) { allItems = []; nextPageToken = null; docList.innerHTML = '<div class="empty-msg">Cargando…</div>'; loadMoreEl.innerHTML = ''; }
    const url = '/api/admin/users/list' + (nextPageToken ? '?pageToken=' + encodeURIComponent(nextPageToken) : '');
    const r = await apiFetch(url);
    if (!r.ok) { docList.innerHTML = '<div class="empty-msg">Error al cargar.</div>'; return; }
    const data = await r.json();
    allItems = allItems.concat(data.items || []);
    nextPageToken = data.nextPageToken || null;
    renderUserList(allItems);
    statsBar.textContent = allItems.length + ' usuario' + (allItems.length !== 1 ? 's' : '');
    loadMoreEl.innerHTML = nextPageToken
      ? '<button class="btn" id="btn-load-more" style="font-size:0.85rem;">Cargar más</button>'
      : '';
    if (nextPageToken) document.getElementById('btn-load-more').addEventListener('click', () => loadUserList(true));
  }

  function renderUserList(items) {
    if (!items.length) { docList.innerHTML = '<div class="empty-msg">Sin usuarios.</div>'; return; }
    docList.innerHTML = items.map(item => `
      <div class="list-card doc-item" data-action="view-user" data-uid="${escHtml(item.uid)}" style="cursor:pointer;">
        <div>
          <div class="doc-id">${escHtml(item.displayName || item.email || item.phoneNumber || item.uid)}</div>
          <div class="doc-meta">${escHtml(item.email || item.phoneNumber || '—')} · ${escHtml(MEMBERSHIP_LABELS[item.membershipStatus] || item.membershipStatus || '—')} · ${item.createdAt ? escHtml(new Date(item.createdAt).toLocaleString('es-MX')) : '—'}</div>
        </div>
      </div>`).join('');
  }

  async function loadUserDetail(uid) {
    docList.innerHTML = '<div class="empty-msg">Cargando…</div>';
    const r = await apiFetch('/api/admin/users/' + encodeURIComponent(uid));
    if (r.status === 404) { docList.innerHTML = '<div class="empty-msg">Usuario no encontrado.</div>'; return; }
    if (!r.ok) { docList.innerHTML = '<div class="empty-msg">Error al cargar.</div>'; return; }
    try {
      renderUserDetail(await r.json());
    } catch (e) {
      docList.innerHTML = '<div class="empty-msg">Error al mostrar el perfil del usuario.</div>';
    }
  }
```

- [ ] **Step 4: `searchUser` ya no rastrea `lastUserSearch`**

Cambia (dentro de `async function searchUser(q) { ... }`):

```js
    if (!r.ok) { docList.innerHTML = '<div class="empty-msg">Error al buscar.</div>'; return; }
    lastUserSearch = q;
    try {
```

a:

```js
    if (!r.ok) { docList.innerHTML = '<div class="empty-msg">Error al buscar.</div>'; return; }
    try {
```

- [ ] **Step 5: `renderUserDetail` guarda `currentDetailUid` y agrega botón "Volver a la lista"**

Cambia el inicio de `renderUserDetail`:

```js
  function renderUserDetail(data) {
    const { uid, profile, auth } = data;
    const hasAuth = !!auth;
```

a:

```js
  function renderUserDetail(data) {
    const { uid, profile, auth } = data;
    currentDetailUid = uid;
    const hasAuth = !!auth;
```

Y agrega el botón "Volver a la lista" como primer hijo del `docList.innerHTML` (antes del `<div class="doc-id">...`):

```js
    docList.innerHTML = `
      <div class="list-card doc-item" style="flex-direction:column;align-items:stretch;gap:10px;">
        <div>
          <button class="btn" data-action="back-to-user-list" style="font-size:0.85rem;">← Volver a la lista</button>
        </div>
        <div>
          <div class="doc-id">${escHtml(profile.displayName || profile.email || profile.phoneNumber || uid)}</div>
```

(el resto del template de `renderUserDetail` queda igual, solo se agregó el bloque del botón antes del `<div class="doc-id">`.)

- [ ] **Step 6: Refresh por uid + 2 acciones nuevas en el click handler delegado**

Dentro del listener `docList.addEventListener('click', async e => { ... })` ya existente, cambia las 2 líneas de refresh (una en la rama `save-membership`, otra en `toggle-disabled`):

```js
      if (r.ok) {
        searchUser(lastUserSearch);
      } else {
        alert('Error al guardar la membresía.');
```

a:

```js
      if (r.ok) {
        loadUserDetail(currentDetailUid);
      } else {
        alert('Error al guardar la membresía.');
```

y:

```js
      if (r.ok) {
        searchUser(lastUserSearch);
      } else {
        alert('Error al cambiar el estado de la cuenta.');
```

a:

```js
      if (r.ok) {
        loadUserDetail(currentDetailUid);
      } else {
        alert('Error al cambiar el estado de la cuenta.');
```

Agrega estas 2 ramas nuevas justo antes del cierre `}` que termina la rama `toggle-disabled` (después de su bloque `if (r.ok) {...} else {...}`, antes del `}` final del `else if (btn.dataset.action === 'toggle-disabled')`):

```js
    } else if (btn.dataset.action === 'view-user') {
      loadUserDetail(btn.dataset.uid);
    } else if (btn.dataset.action === 'back-to-user-list') {
      loadUserList();
```

(Estas 2 ramas van al mismo nivel que las demás `else if (btn.dataset.action === '...')` del mismo listener — mira `else if (btn.dataset.action === 'view-cache')` como referencia de formato.)

- [ ] **Step 7: Verificar sintaxis**

Run: `node --check admin/admin.js`
Expected: sin salida (sin errores de sintaxis)

- [ ] **Step 8: Commit**

```bash
git add admin/admin.js
git commit -m "feat(admin): agrega lista paginada de usuarios en la tab Usuarios"
```

- [ ] **Step 9: Verificación manual**

No hay test automatizado para `admin.js`. Verificar manualmente contra el backend ya implementado en Tasks 1-2 (agrega estos puntos al checklist manual ya pendiente de `docs/superpowers/plans/2026-07-27-admin-user-management.md`):

1. Abrir la tab "👤 Usuarios" — debe cargar sola una lista paginada (más reciente primero), sin necesidad de buscar.
2. Si hay más de 50 usuarios, click en "Cargar más" — debe traer la siguiente página sin duplicar filas.
3. Click en una fila de la lista — debe abrir la misma card de detalle que el buscador (perfil + editar membresía + desactivar/reactivar).
4. Desde esa card, click "← Volver a la lista" — debe regresar a la lista (desde la página 1).
5. Editar membresía o desactivar/reactivar cuenta desde una card abierta por click-en-lista — debe refrescar la misma card (no regresar a la lista).
6. Buscar un usuario por correo/teléfono (como antes) — debe seguir funcionando; editar membresía o desactivar/reactivar desde ahí también debe refrescar correctamente.
7. Cambiar de tab y volver a "Usuarios" — la lista debe recargarse desde la página 1 (no quedar en el detalle anterior).

---

## Verificación final (tras las 3 tasks)

Correr la suite completa: `npx vitest run` — debe dar el mismo resultado base ya conocido en este repo (todos los tests de vitest en verde; el único archivo que falla es `tests/e2e/scan-cycle.spec.js`, un problema de configuración de Playwright preexistente y no relacionado). Completar la verificación manual del Task 3 Step 9 (y la del plan anterior, todavía pendiente) antes de dar el feature por terminado.
