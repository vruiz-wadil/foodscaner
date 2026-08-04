# Instrumentación de analytics de funnel (Vercel Analytics)

## Contexto

Yomi no tiene ninguna instrumentación de analytics hoy — cero visibilidad de cuántos usuarios escanean, cuántos pegan con el paywall de personalización, cuántos inician checkout, y cuántos convierten. Este es el segundo sub-proyecto del backlog "gate de monetización + analytics" (el primero, cierre del gate, ya se mergeó a `develop`).

El sitio es HTML/JS estático servido directo (12 páginas `.html`, sin bundler — `vercel-build` solo inyecta config de Firebase, no hace build de JS). Esto descarta el paquete npm `@vercel/analytics` (pensado para apps con build step tipo Next/Vite) a favor del snippet oficial de script tag que Vercel expone para sitios estáticos.

## Herramienta

Vercel Analytics + Speed Insights, vía script tags nativos:
- `/_vercel/insights/script.js` (pageviews + eventos custom)
- `/_vercel/speed-insights/script.js` (Core Web Vitals)

Ambos scripts los sirve Vercel automáticamente una vez habilitado Analytics/Speed Insights en la configuración del proyecto (paso manual en el dashboard de Vercel, fuera de este repo — se lo aviso al usuario al terminar, igual que branch protection en el sub-proyecto de CI).

## Archivo nuevo: `analytics.js`

Módulo compartido, sin dependencias externas, cargado en las 12 páginas HTML existentes:

```js
// analytics.js — Vercel Analytics + Speed Insights (sitio estático, sin bundler)
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };

(function loadScript(src) {
  const s = document.createElement('script');
  s.defer = true;
  s.src = src;
  document.head.appendChild(s);
})('/_vercel/insights/script.js');

(function loadScript(src) {
  const s = document.createElement('script');
  s.defer = true;
  s.src = src;
  document.head.appendChild(s);
})('/_vercel/speed-insights/script.js');

window.track = function (eventName, props) {
  window.va('event', { name: eventName, data: props || {} });
};
```

Incluido en cada una de las 12 páginas con `<script src="analytics.js"></script>`, antes de los scripts específicos de cada página que llaman a `track()` (`app.js`, `account-ui.js`, `onboarding-membership-ui.js`), para garantizar que `window.track` exista cuando esos scripts corren.

Páginas: `account.html`, `auth.html`, `history.html`, `index.html`, `onboarding-membership.html`, `onboarding-profile.html`, `preferences.html`, `privacidad.html`, `reset-password.html`, `scan.html`, `terminos.html`, `verify-email.html`.

## Eventos custom

### 1. `Scan Completado`

`app.js`, función `renderProductData`, línea 2036, justo después de `computeVerdict()`:

```js
const verdict = computeVerdict(product, userPreferences);
window.track('Scan Completado', { verdict });
```

Props: únicamente `{ verdict }` (`'sano' | 'regular' | 'evitar'`). Sin `barcode` — alta cardinalidad (miles de productos distintos), consumiría cuota de propiedades del plan free de Vercel Analytics sin aportar al funnel que queremos medir.

### 2. `Paywall Hit`

`app.js`, función `renderPersonalizedReasons`, línea 1868, en la rama que renderiza el teaser de upsell (usuario sin membresía activa viendo la tarjeta de personalización bloqueada):

```js
if (isActiveMember || hasNoRealData(product)) {
  card.classList.add('hidden');
  return;
}
window.track('Paywall Hit', { context: 'personalized-reasons' });
renderTeaserReasons(card);
```

Prop `context` fijo en `'personalized-reasons'` — deja la puerta abierta a diferenciar otros paywalls (ej. historial) sin cambiar el nombre del evento, si se agregan más adelante. Fuera de alcance de este spec agregar esos otros puntos ahora.

### 3. `Checkout Iniciado`

`onboarding-membership-ui.js`, función `confirmMembershipPayment`, línea 115, justo antes del redirect a Stripe:

```js
const data = await res.json();
window.track('Checkout Iniciado');
window.location.href = data.checkoutUrl;
```

Sin props — el evento en sí ya marca el paso del funnel.

### 4. `Checkout Completado`

`account-ui.js`, función `handleStripeReturn`, línea 855, junto al toast de confirmación de pago exitoso:

```js
if (res.ok) {
  await flushPendingPreferences(token);
  window.track('Checkout Completado');
  showToast('¡Pago confirmado! Tu membresía está activa.');
}
```

Sin props. Solo se dispara en la rama de éxito (`res.ok`), no en la rama de reintento/error que sigue debajo.

## Testing

- Tests unitarios existentes que ejercitan `renderProductData`, `renderPersonalizedReasons`, `confirmMembershipPayment`, y `handleStripeReturn` (si existen y tocan estas funciones) se actualizan para stubear `window.track` (`vi.fn()`) antes de cada test y verificar que se llama con el nombre de evento y props exactos en el punto correcto, sin romper las aserciones existentes sobre el resto del comportamiento de esas funciones.
- No se agrega ningún test end-to-end nuevo para Analytics en sí (el script de Vercel es un servicio externo, no verificable en Playwright/Vitest de forma significativa) — el testing se limita a confirmar que `window.track` se invoca con los argumentos correctos en cada uno de los 4 puntos.

## Fuera de alcance

- Dashboards, reportes, o cualquier consumo de los datos de Analytics — eso vive en el dashboard de Vercel, no en este repo.
- Habilitar Analytics/Speed Insights en la configuración del proyecto de Vercel — paso manual fuera de este repo, se avisa al usuario al finalizar la implementación.
- Otros puntos de paywall (historial, preferencias) — solo se instrumenta el paywall de personalización (`renderPersonalizedReasons`), el único mencionado en el diseño aprobado.
- Cualquier evento adicional no listado en las 4 secciones de arriba (ej. signup, login, share) — decisión explícita de mantener el alcance mínimo acordado.
