# Identidad de teléfono independiente del uid — diseño

Fecha: 2026-07-23
Ambiente objetivo: `develop` (Firebase project `foodscaner-dev` para Auth, `foodscaner-cache-v2` para Firestore). Se replica a prod cuando se promueva.

## Contexto

Hoy, para login por teléfono (Twilio Verify + custom tokens, sin Firebase Phone Auth nativo), el uid se deriva determinísticamente del número: `uid = 'phone:' + phone` (`api/index.js`, `phoneVerifyHandler`). Esto significa que el número de teléfono ES la identidad de la cuenta — cambiarlo requeriría migrar todo el doc de Firestore (`users/{uid}`: membresía, preferencias, historial) a un uid nuevo y retirar la cuenta Auth vieja.

Surgió al diseñar la futura feature de "editar mis datos" (nombre/teléfono/correo/contraseña en `account.html`, sesión aparte). Editar teléfono para email/password y Google ya es trivial hoy — Firebase asigna su propio uid opaco independiente del correo, cambiar el correo nunca mueve el uid. Teléfono es el único método donde esto no es cierto. Este spec resuelve esa asimetría de raíz, ANTES de construir la UI de edición — así "cambiar teléfono" en la futura Task B se reduce a actualizar un mapeo, no a migrar una cuenta completa.

Fuera de alcance: la UI de "editar mis datos" en sí (nombre/teléfono/correo/contraseña) — es la Task B mencionada, un spec/plan separado que se construye DESPUÉS de este. Este spec solo cubre el cambio de modelo de identidad.

## Hallazgo clave que simplifica el diseño

`verifyFirebaseIdToken` en `api/auth.js:83` ya deriva `phoneNumber` así:

```js
const derivedPhoneNumber = payload.phone_number || (payload.sub.startsWith('phone:') ? payload.sub.slice(6) : null);
```

Prefiere el claim `payload.phone_number` del ID token, y SOLO si no existe, cae al parseo del uid (`'phone:'+numero`) como compatibilidad. Los custom tokens de Firebase soportan un campo `claims` (claims de desarrollador) que Firebase mezcla al nivel superior del ID token que emite tras el intercambio — así que basta con mandar `{phone_number: phone}` como claim al mintear el custom token para que esta función siga funcionando exactamente igual, **sin tocar `api/auth.js` en absoluto**. El cambio se concentra en `api/phoneAuth.js` (mintado del token) y `api/index.js` (`phoneVerifyHandler`, resolución del uid) + una colección nueva en `api/firestore.js`.

## Modelo de datos — `phoneIndex/{telefono}` (Firestore, nueva colección)

```jsonc
// Documento con id = el teléfono en formato E.164 (ej. "+525512345678")
{ "uid": "a1b2c3d4-..." }  // uid random (crypto.randomUUID()), o el uid legado 'phone:'+telefono si se hizo backfill
```

Decisión: colección aparte de `users/{uid}` (no un campo dentro del doc de usuario) — es un índice de búsqueda unidireccional (teléfono → uid), con su propia clave de documento (el teléfono), consistente con el patrón de colecciones simples ya usado en este archivo (`cache/{barcode}`, `ai_cache/{key}`).

## Flujo `/api/auth/phone/verify` (reescrito)

Reemplaza el bloque entre `if (status !== 'approved') ...` y la creación del custom token (`api/index.js:1396-1420` actual):

```js
if (status !== 'approved') return res.status(401).json({ error: 'invalid_code' });

// Resuelve el uid estable de este teléfono: índice existente -> ese uid
// (usuario recurrente); si no hay índice, doc legado 'phone:'+phone -> lo
// adopta como uid permanente y rellena el índice (backfill perezoso, cero
// migración de datos); si no existe ninguno -> uid nuevo random. Firestore
// ambiguo/inaccesible en cualquier paso -> trata como usuario nuevo
// (fail-safe, MISMO criterio que ya usaba esta función — nunca bloquea la
// respuesta por un problema transitorio de Firestore).
let uid, isNewUser;
try {
  const indexed = await fireGetPhoneIndex(phone);
  if (indexed && indexed.uid) {
    uid = indexed.uid;
    isNewUser = false;
  } else {
    const legacyUid = 'phone:' + phone;
    const legacyUser = await fireGetUser(legacyUid);
    if (legacyUser) {
      uid = legacyUid;
      isNewUser = false;
      await fireSetPhoneIndex(phone, uid);
    } else {
      uid = crypto.randomUUID();
      isNewUser = true;
      await fireSetPhoneIndex(phone, uid);
    }
  }
} catch (e) {
  console.warn('[auth/phone/verify] phone index resolution failed, defaulting to new-user random uid:', e.message);
  uid = crypto.randomUUID();
  isNewUser = true;
}

try {
  const customToken = createFirebaseCustomToken(uid, { phone_number: phone });
  res.json({ customToken, isNewUser });
} catch (e) {
  console.warn('[auth/phone/verify] custom token signing error:', e.message);
  res.status(500).json({ error: 'server_error' });
}
```

`api/index.js:5` ya tiene `const crypto = require('crypto');` — se reusa `crypto.randomUUID()`, sin import nuevo.

### `createFirebaseCustomToken(uid, claims)` — `api/phoneAuth.js`

Agrega un segundo parámetro opcional `claims`, incluido en el payload del custom token bajo la clave `claims` (formato que Firebase espera — developer claims, no se mezclan planos en el custom token mismo, Firebase los promueve al nivel superior del ID TOKEN que emite después):

```js
function createFirebaseCustomToken(uid, claims) {
  const sa = getServiceAccount();
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY no configurada');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email, sub: sa.client_email, aud: CUSTOM_TOKEN_AUD,
    uid, iat: now, exp: now + 3600,
    ...(claims ? { claims } : {})
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(sa.private_key, 'base64url');
  return `${signingInput}.${signature}`;
}
```

Llamada existente sin segundo argumento (si alguna otra ruta la usa sin `claims`) sigue funcionando igual — parámetro opcional, backward-compatible.

## Nuevas funciones en `api/firestore.js`

```js
async function fireGetPhoneIndex(phone) {
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const resp = await fetch(docPath('phoneIndex', phone), {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(5000)
    });
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    const data = await resp.json();
    return fromFirestoreFields(data.fields || {});
  } catch (e) {
    console.warn('[Firestore] getPhoneIndex error:', e.message);
    return null;
  }
}

async function fireSetPhoneIndex(phone, uid) {
  const token = await getAccessToken();
  if (!token) throw new Error('No Firestore access token');
  const resp = await fetch(docPath('phoneIndex', phone), {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields({ uid }) }),
    signal: AbortSignal.timeout(5000)
  });
  if (!resp.ok) throw new Error(`Firestore set phone index failed: ${resp.status}`);
}
```

Ambas exportadas junto a las demás en `module.exports` de `api/firestore.js`.

**Nota de seguridad (misma que ya aplica a `users/{uid}` en el spec de 2026-07-15):** `phoneIndex/{telefono}` usa el número de teléfono como ID de documento — no es un dato de salud, pero sigue siendo PII. Al loguear errores, nunca imprimir el teléfono completo en logs de Vercel más allá de lo que Twilio ya expone en sus propios logs (mismo criterio que el resto del archivo: loguear solo lo mínimo necesario para debug).

## Backward compatibility / migración

**Ninguna migración explícita.** Usuarios phone-login que ya existen (uid legado `'phone:'+telefono`) conservan exactamente ese uid — su membresía, preferencias e historial no se tocan. El índice `phoneIndex/{telefono}` se rellena solo, la primera vez que ese número vuelve a verificarse después de este cambio (rama `legacyUser` del flujo de arriba). Sin downtime, sin script de backfill masivo, sin ventana de "cuentas rotas" durante el despliegue.

## Testing

- `tests/firestore-phoneIndex.test.js` (nuevo) — `fireGetPhoneIndex`/`fireSetPhoneIndex`, mismo patrón de mock de `fetch` que el resto de `tests/firestore-*.test.js`.
- `tests/auth.test.js` o el archivo existente de phone-verify — reescribir/extender casos de `phoneVerifyHandler`:
  - Teléfono con índice existente → usa ese uid, `isNewUser: false`, no toca el doc legado.
  - Teléfono sin índice pero con doc legado `'phone:'+telefono` → adopta ese uid, `isNewUser: false`, y verifica que `fireSetPhoneIndex` se llamó con ese mismo uid (backfill).
  - Teléfono completamente nuevo (sin índice, sin doc legado) → uid random nuevo (verificar que es un uuid válido, no `'phone:'+algo`), `isNewUser: true`, `fireSetPhoneIndex` llamado.
  - Fallo de Firestore en cualquier punto de la resolución → cae a uid random nuevo + `isNewUser: true` (mismo criterio fail-safe), sin lanzar excepción sin manejar.
  - El custom token creado incluye el claim `phone_number` con el teléfono correcto (inspeccionar el payload del JWT decodificado en el test, no solo que no truene).
- `createFirebaseCustomToken(uid, claims)` — test unitario directo verificando que el payload decodificado del token contiene `claims: {phone_number: '+52...'}` cuando se pasa, y que sigue funcionando (sin campo `claims`) cuando se omite.
- Sigue el patrón/convenciones ya existentes en `tests/` (vitest, JWT real firmado con keypair de prueba donde aplique, igual que `tests/ocrQuota.test.js`).

## Preguntas abiertas (no bloquean este spec)

- La Task B ("editar mis datos" en `account.html`) se diseña por separado, después de que esto esté implementado y desplegado. Cambiar teléfono ahí será: verificar el número nuevo por SMS (reusa `/api/auth/phone/send` + `/api/auth/phone/verify` con el mismo uid ya logueado, en vez de mintear uno nuevo) → borrar `phoneIndex/{telefonoViejo}` → crear `phoneIndex/{telefonoNuevo}` apuntando al mismo uid → actualizar `profile.phone`/`phoneNumber` en el doc. No se diseña en detalle aquí.
- Prod (`master`/`www.yomi.mx`) puede ya tener cuentas phone-login reales con uid legado — el backfill perezoso las cubre igual sin acción manual, pero vale la pena confirmar en el smoke test de despliegue a prod que al menos una cuenta legada re-loguea correctamente y conserva sus datos.
