# Compartir viral (4 de 4 — alcance reducido, sin cuentas familiares)

## Contexto

Ya existe infraestructura de compartir (`share.js`): `window.shareResult({name, verdict, barcode}, triggerButton)` usa `navigator.share` (Web Share API) con fallback a clipboard, arma un link profundo a `scan.html?barcode=X` con UTM (`utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result`), y ya está wireado en dos lugares: `#btn-share-result` en `scan.html` (`app.js:2061-2064`) y en las cards de historial (`history-ui.js:36`).

Dos huecos identificados, ambos de bajo esfuerzo (sin backend, sin nuevo modelo de datos):

1. **Copy genérico del share**: `buildShareText` (`share.js:10-12`) produce `"${name}: ${verdict} — descúbrelo tú con Yomi"` para los 3 veredictos por igual — no aprovecha que "EVITAR" y "SANO" son ganchos emocionales muy distintos (alerta vs. validación).
2. **Sin invitación fuera del contexto de un producto**: hoy solo se puede compartir *después* de escanear algo. No hay forma de invitar a un amigo a probar la app en general (ej. desde "Mi cuenta") — se pierde el caso "le quiero recomendar Yomi a alguien" sin tener un producto a mano.

Cuentas familiares/billing compartido quedan explícitamente fuera de este spec (decisión tomada — ver conversación: cambio de backend demasiado grande para este ciclo, necesita su propio brainstorming).

## Cambio

### 1. `share.js` — copy por veredicto

Reemplaza `buildShareText` (`share.js:10-12`):

```js
const SHARE_TEXT_BY_VERDICT = {
  sano: name => `✅ ${name} está SANO según Yomi. Escanea el tuyo gratis.`,
  regular: name => `⚠️ ${name}: REGULAR. Yomi te dice por qué en 2 segundos.`,
  evitar: name => `🚫 ${name} salió EVITAR en Yomi. ¿El tuyo qué dirá?`
};

function buildShareText(name, verdict) {
  const build = SHARE_TEXT_BY_VERDICT[verdict];
  return build ? build(name) : `${name}: ${SHARE_VERDICT_LABELS[verdict] || verdict} — descúbrelo tú con Yomi`;
}
```

`SHARE_VERDICT_LABELS` (`share.js:6`) se mantiene sin cambios — sigue siendo el fallback para un verdict desconocido (no debería pasar en producción, mismo criterio de "nunca revienta" que ya usa `buildShareUrl` para barcode ausente).

### 2. `account-ui.js` + `account.html` — CTA "Invita a un amigo"

Nueva función en `share.js`, generalizando el mecanismo existente para compartir la app sin un producto de por medio:

```js
const INVITE_TEXT = 'Yo uso Yomi para saber en 2 segundos si un producto me conviene. Pruébalo tú:';
const INVITE_UTM = 'utm_source=share&utm_medium=invite_friend&utm_campaign=account_invite';

async function shareApp(triggerButton) {
  const url = `${SHARE_BASE_URL}/?${INVITE_UTM}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Yomi', text: INVITE_TEXT, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  await copyShareFallback(INVITE_TEXT, url, triggerButton);
}

window.shareApp = shareApp;
```

Reutiliza `copyShareFallback` y `SHARE_BASE_URL` ya definidos en el mismo archivo — sin duplicar lógica de clipboard/Web Share API.

En `account-ui.js`, nueva tarjeta agregada a `renderAccountHub()` (`account-ui.js:274-320`), entre la card de "Preferencias" y la de "Suscripción" (mismo patrón `.content-card` que las demás):

```html
<div class="content-card">
  <div class="account-data-label" style="margin-bottom:10px;">Invita a un amigo</div>
  <div class="row-card">
    <p class="about-text">¿Conoces a alguien a quien le sirva saber qué come? Compártele Yomi.</p>
    <button type="button" id="btn-invite-friend" class="btn btn-secondary">Compartir Yomi</button>
  </div>
</div>
```

Wiring en `wireAccountHubEvents` (`account-ui.js:325+`, mismo patrón que los demás botones de esa función):

```js
document.getElementById('btn-invite-friend')?.addEventListener('click', (e) => {
  window.shareApp(e.currentTarget);
});
```

`account.html` carga `share.js` como script clásico (mismo patrón que `scan.html` — confirmar en implementación si ya está cargado o hace falta agregar el `<script src="share.js"></script>`).

## Sin cambios

- Mecánica de `navigator.share`/clipboard fallback, deep-link a `scan.html?barcode=`, UTMs de los shares existentes (`scan_result` campaign): sin cambios.
- `history-ui.js`: sin cambios, sigue usando `shareResult` con el copy nuevo automáticamente (mismo `buildShareText`, sin tocar el call site).
- Cuentas familiares, invitaciones con recompensa/referido, billing compartido: fuera de alcance — requiere backend nuevo, decisión explícita de dejarlo para otro ciclo.
- `api/index.js`: sin cambios — todo el share sigue siendo client-side puro, como ya lo es hoy.
