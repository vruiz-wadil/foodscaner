# Borrado de cuenta (derecho al olvido) — Design

## Contexto

Auditoría legal (2026-08-03) encontró que `privacidad.html` promete borrado de cuenta y ejercicio de derechos ARCO, pero solo existe un canal manual por correo (`soporte@wadilworks.com`) — no hay autoservicio real. Riesgo: LFPDPPP no fija plazo estricto, pero a medida que crece la base de usuarios un proceso 100% manual no escala y es un gap frente a estándares de borrado (GDPR-style) si llegan usuarios de otras jurisdicciones.

Esta pieza agrega autoservicio real: el usuario borra su propia cuenta desde la app, y un admin puede hacerlo (o solo cancelar la suscripción) desde el panel admin.

## Alcance

- Borrado **inmediato y definitivo** (no soft-delete/cola de purga diferida) — decisión explícita: simplicidad, sin infraestructura de cron adicional.
- Si hay suscripción Stripe activa, se cancela **ya** (no `cancel_at_period_end`) — coherente con borrar los datos ya, no tiene sentido seguir cobrando a una cuenta que ya no existe.
- Confirmación en UI con palabra tecleada (no solo un modal de click) — fricción intencional para acción irreversible.
- Acción propia (`DELETE /api/me/account`) y acción admin (cancelar-solo, y borrar completo) son independientes del botón "Cancelar suscripción" ya existente (`POST /api/me/membership/cancel`, que solo desactiva auto-renovación y no se toca).

## Backend

### Helper compartido: `deleteUserAccount(uid)`

Vive en `api/index.js` junto a los demás handlers de cuenta. Ambos endpoints (propio y admin) lo llaman — evita duplicar los 6 pasos.

```js
async function deleteUserAccount(uid) {
  const user = await fireGetUser(uid);
  if (!user) return { alreadyGone: true };

  const subscriptionId = user.billing && user.billing.subscriptionId;
  if (subscriptionId) {
    try {
      await stripeCancelSubscriptionNow(subscriptionId);
    } catch (e) {
      console.warn('[deleteUserAccount] Stripe cancel error, uid:', uid, e.message);
      // best-effort: no bloquea el borrado de datos por un fallo de Stripe
    }
  }

  const history = await fireListUserHistory(uid, 1000);
  for (const entry of history) {
    await fireDeleteUserHistoryEntry(uid, entry.id).catch(e =>
      console.warn('[deleteUserAccount] history delete error, uid:', uid, e.message));
  }

  if (user.phoneNumber) {
    await fireDeleteDoc('phoneIndex', user.phoneNumber).catch(e =>
      console.warn('[deleteUserAccount] phoneIndex delete error, uid:', uid, e.message));
  }

  await fireDeleteDoc('users', uid);

  await deleteFirebaseAuthUser(uid).catch(e =>
    console.warn('[deleteUserAccount] Auth delete error, uid:', uid, e.message));

  return { alreadyGone: false };
}
```

Nota de orden: Stripe primero (best-effort, no bloqueante), historial y phoneIndex después, doc de usuario, y **Auth al final** — es el punto de no retorno (invalida el token; si algo antes falla, el usuario/admin puede reintentar porque la cuenta de Auth sigue viva).

### Cancelación Stripe inmediata — `api/stripeClient.js`

```js
async function stripeCancelSubscriptionNow(subscriptionId) {
  return stripeRequest('DELETE', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}
```
Agregar a `module.exports`.

### Fix previo necesario: `fireListUserHistory` no expone `id`, y `fireDeleteDoc` no sirve para subcolecciones

`fireDeleteDoc(col, id)` (línea 413) hace `docPath(col, id)`, que aplica `encodeURIComponent` a `col` completo — si `col` fuera `users/${uid}/history` el `/` quedaría escapado como `%2F` y el path resultante sería inválido. Además, `fireListUserHistory` (línea 684) hoy solo devuelve los campos de cada doc (`fromFirestoreFields(r.document.fields)`), sin el `id` — no hay forma de borrar un doc puntual del historial con lo que existe hoy.

Dos cambios chicos en `api/firestore.js`:

```js
// en fireListUserHistory, agregar el id al objeto devuelto:
return rows.filter(r => r.document).map(r => ({
  id: r.document.name.split('/').pop(),
  ...fromFirestoreFields(r.document.fields || {})
}));

// nueva función, hermana de fireLogUserHistory:
async function fireDeleteUserHistoryEntry(uid, id) {
  const token = await getAccessToken();
  if (!token) return false;
  const resp = await fetch(`${docPath('users', uid)}/history/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000)
  });
  return resp.ok;
}
```
Agregar `fireDeleteUserHistoryEntry` a `module.exports`. Ningún otro caller de `fireListUserHistory` se rompe por el campo `id` extra (`history-ui.js`/`meHistory` solo leen los campos que ya usaban).

### Borrado de usuario de Firebase Auth — `api/firestore.js`

Reutiliza `getAccessToken()`, pero el scope actual (`https://www.googleapis.com/auth/datastore`) no alcanza para Identity Toolkit. Se amplía el scope de la JWT claim a una lista separada por espacio:

```js
scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit'
```

Nueva función:

```js
async function deleteFirebaseAuthUser(uid) {
  const token = await getAccessToken();
  if (!token) throw new Error('No access token');
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${getProjectId()}/accounts:delete`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: uid }),
      signal: AbortSignal.timeout(5000)
    }
  );
  if (!resp.ok) throw new Error(`Identity Toolkit delete error (status ${resp.status})`);
}
```
Agregar a `module.exports`.

### Endpoints — `api/index.js`

```js
app.delete('/api/me/account', requireUser, async (req, res) => {
  try {
    await deleteUserAccount(req.user.uid);
    res.json({ ok: true });
  } catch (e) {
    console.warn('[DELETE /api/me/account] error, uid:', req.user?.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/admin/users/:uid/cancel-subscription', requireAdmin, async (req, res) => {
  const { uid } = req.params;
  try {
    const user = await fireGetUser(uid);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    const subscriptionId = user.billing && user.billing.subscriptionId;
    if (!subscriptionId) return res.status(409).json({ error: 'no_subscription' });
    await stripeCancelSubscriptionNow(subscriptionId);
    await firePatchUserFields(uid, ['autoRenew'], { autoRenew: false });
    res.json({ ok: true });
  } catch (e) {
    console.warn('[POST /api/admin/users/:uid/cancel-subscription] error, uid:', uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.delete('/api/admin/users/:uid', requireAdmin, async (req, res) => {
  try {
    await deleteUserAccount(req.params.uid);
    res.json({ ok: true });
  } catch (e) {
    console.warn('[DELETE /api/admin/users/:uid] error, uid:', req.params.uid, e.message);
    res.status(500).json({ error: 'internal_error' });
  }
});
```

**Importante:** `requireUser` es explícito — NO usar `requireActiveMembership` en `/api/me/account`, debe funcionar para cuentas free.

## Frontend — cuenta propia (`account-ui.js`)

Nueva sección "Zona de peligro" al final del account hub, después de la sección de suscripción existente. Sigue el patrón de `openCancelSubscriptionModal` (modal genérico vía `openModal`/`closeModal`), pero con input de confirmación tecleada:

```js
function openDeleteAccountModal() {
  openModal(`
    <div class="modal-header"><h2>Eliminar tu cuenta</h2><button type="button" class="modal-close" aria-label="Cerrar">×</button></div>
    <p>Esta acción no se puede deshacer. Se borra tu perfil, tu historial de escaneos y tus preferencias. Si tienes membresía activa, se cancela de inmediato.</p>
    <p>Escribe <strong>ELIMINAR</strong> para confirmar:</p>
    <input type="text" id="input-delete-confirm" autocomplete="off">
    <button type="button" id="btn-delete-account-back" class="btn btn-secondary">Volver</button>
    <button type="button" id="btn-delete-account-confirm" class="btn btn-danger" disabled>Eliminar cuenta</button>
    <p id="delete-account-error" class="hidden modal-inline-error" role="alert"></p>
  `);
  document.getElementById('btn-delete-account-back')?.addEventListener('click', closeModal);
  document.getElementById('input-delete-confirm')?.addEventListener('input', (e) => {
    document.getElementById('btn-delete-account-confirm').disabled = e.target.value !== 'ELIMINAR';
  });
  document.getElementById('btn-delete-account-confirm')?.addEventListener('click', () => {
    submitDeleteAccount().catch(() => {});
  });
}

export async function submitDeleteAccount() {
  const token = await getIdToken();
  const res = await fetch('/api/me/account', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    showDeleteAccountError('No se pudo eliminar tu cuenta. Intenta de nuevo.');
    throw new Error('delete_failed');
  }
  window.location.href = 'index.html';
}
```

No se llama a `signOut()` explícitamente — el usuario de Auth ya fue borrado server-side, así que su sesión local queda inválida; el redirect a `index.html` es suficiente (siguiendo el patrón de `handleLogout`).

## Frontend — admin (`admin/admin.js`)

En `renderUserDetail`, junto al botón existente `toggle-disabled`, agregar dos botones nuevos con el mismo patrón `data-action` delegado:

```html
<button class="btn-del" data-action="cancel-subscription" data-uid="${escHtml(uid)}" ${user.billing?.subscriptionId ? '' : 'disabled'}>Cancelar suscripción</button>
<button class="btn-del" data-action="delete-account" data-uid="${escHtml(uid)}">Eliminar cuenta</button>
```

Ambos reusan el mismo modal de confirmación con palabra tecleada que el flujo de cuenta propia (extraer un modal genérico compartido, o duplicar el patrón simple — dado que es un solo archivo `admin.js` separado de `account-ui.js`, se duplica el modal pequeño en vez de compartir código entre bundles distintos).

En el handler de click delegado (junto a `toggle-disabled`):

```js
} else if (btn.dataset.action === 'cancel-subscription') {
  if (!confirmWithTypedWord('Cancelar la suscripción de este usuario ya, sin esperar fin de periodo.')) return;
  btn.disabled = true;
  const r = await apiFetch('/api/admin/users/' + encodeURIComponent(uid) + '/cancel-subscription', { method: 'POST' });
  btn.disabled = false;
  if (r.ok) loadUserDetail(uid);
} else if (btn.dataset.action === 'delete-account') {
  if (!confirmWithTypedWord('Eliminar esta cuenta por completo: perfil, historial, preferencias, suscripción.')) return;
  btn.disabled = true;
  const r = await apiFetch('/api/admin/users/' + encodeURIComponent(uid), { method: 'DELETE' });
  if (r.ok) { /* volver a la lista, la cuenta ya no existe */ showUserList(); }
  else btn.disabled = false;
}
```

`confirmWithTypedWord(message)` es un helper nuevo y pequeño en `admin.js`: usa `window.prompt` (el admin panel es interno, no justifica un modal HTML propio para esto) pidiendo tipear `ELIMINAR`, retorna boolean.

## Testing

- Unit: `deleteUserAccount(uid)` — caso feliz (borra todo, cancela Stripe), caso sin suscripción (salta cancelación), caso Stripe falla (continúa igual y borra el resto), caso usuario no existe (`alreadyGone`).
- Unit: `stripeCancelSubscriptionNow` — verifica método DELETE y path.
- Unit: `deleteFirebaseAuthUser` — verifica llamada a Identity Toolkit con `localId` correcto, y que el scope ampliado se use en la JWT claim.
- Unit: `DELETE /api/me/account` — 200 con uid del token; nunca acepta uid de query/body.
- Unit: `POST /api/admin/users/:uid/cancel-subscription` — 409 si no hay suscripción.
- Unit: `DELETE /api/admin/users/:uid` — requiere `requireAdmin`.
- Frontend: modal no habilita el botón de confirmar hasta que el input diga exactamente "ELIMINAR".

## Fuera de alcance

- No se toca `scan_logs`/`reports` (colecciones de analítica administrativa, no atadas 1:1 al perfil de forma que ARCO las cubra igual — quedan fuera de esta pieza).
- No se agrega exportación de datos (derecho de acceso/portabilidad) — pieza separada si se decide hacerla.
- No se cambia el copy de `privacidad.html` en esta pieza (aunque ahora sí hay autoservicio real, actualizar el texto legal es una edición de copy, no de código — se puede hacer en un paso aparte una vez esto esté en producción).
