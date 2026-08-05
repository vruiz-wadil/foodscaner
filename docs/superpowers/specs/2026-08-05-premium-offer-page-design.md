# Pantalla de oferta Premium antes del signup (premium-offer.html)

## Contexto

Fix previo (`commit 83f3e58`) hizo que el CTA del teaser mande a usuarios sin sesión a `auth.html` en vez de directo a pago (que fallaba con 401). Segundo cambio (`commit 300e5ef`) agregó una línea de precio compacta en la tarjeta del teaser de `scan.html` ("$29.90 MXN/mes — cancela cuando quieras") para dar transparencia antes del click.

Sigue faltando explicación completa: la línea de precio es correcta pero mínima — no muestra la tabla comparativa (qué es gratis vs. qué es premium). El usuario pidió una pantalla dedicada, ADEMÁS de la línea ya agregada (no en reemplazo) — dos niveles de información antes de llegar a `auth.html`: primero la línea corta en la tarjeta de resultados, después (al hacer click) la pantalla completa con tabla, antes de pedir crear cuenta.

## Cambio

### 1. Nueva página `premium-offer.html`

Mismo layout/CSS que `onboarding-membership.html` (reusa `home.css`, `styles.css`, mismos estilos inline para `.membership-compare`/`.membership-price`) — misma tabla comparativa de 5 filas y precio, pero:
- Sin checkbox de consentimiento de pago (acá no se paga nada todavía).
- Un solo botón: **"Crear cuenta y continuar"** → navega a `auth.html`.
- Sin botón "Seguir sin membresía" (ese ya vive en `onboarding-membership.html`, después del signup — no se duplica acá).

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self';">
  <title>Yomi — Análisis personalizado con Premium</title>
  <link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#2DBC9E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="home.css?v=15">
  <link rel="stylesheet" href="styles.css?v=15">
  <style>
    .hidden{display:none!important}
    .membership-compare { width: 100%; border-collapse: collapse; margin: 8px 0; }
    .membership-compare th, .membership-compare td { padding: 8px; text-align: center; border-bottom: 1px solid #eee; }
    .membership-compare th:first-child, .membership-compare td:first-child { text-align: left; }
    .membership-price { font-size: 1.25rem; font-weight: 700; text-align: center; margin: 8px 0 16px; }
  </style>
</head>
<body>
  <div class="app-shell">
    <header class="app-header">
      <img src="assets/redesign/logo.svg" alt="Yomi" class="app-logo">
    </header>
    <main class="app-main content-page">
      <section class="section-heading">
        <h1 class="heading-title">Desbloquea tu análisis personalizado</h1>
        <p class="heading-sub">Compara lo que obtienes gratis vs. con Yomi Premium.</p>
      </section>
      <div class="content-card">
        <table class="membership-compare">
          <thead>
            <tr>
              <th scope="col"></th>
              <th scope="col">Gratis</th>
              <th scope="col">Premium</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Escaneo por código de barras</td>
              <td aria-label="Incluido"><span aria-hidden="true">✓</span></td>
              <td aria-label="Incluido"><span aria-hidden="true">✓</span></td>
            </tr>
            <tr>
              <td>Veredicto básico</td>
              <td aria-label="Incluido"><span aria-hidden="true">✓</span></td>
              <td aria-label="Incluido"><span aria-hidden="true">✓</span></td>
            </tr>
            <tr>
              <td>Análisis personalizado</td>
              <td aria-label="No incluido"></td>
              <td aria-label="Incluido"><span aria-hidden="true">✓</span></td>
            </tr>
            <tr>
              <td>Escaneo de ingredientes por foto</td>
              <td aria-label="No incluido"></td>
              <td aria-label="Incluido"><span aria-hidden="true">✓</span></td>
            </tr>
            <tr>
              <td>Historial en la nube</td>
              <td aria-label="No incluido"></td>
              <td aria-label="Incluido"><span aria-hidden="true">✓</span></td>
            </tr>
          </tbody>
        </table>
        <p class="membership-price">$29.90 MXN/mes — cancela cuando quieras</p>
        <a href="auth.html" class="btn btn-primary" id="btn-create-account">Crear cuenta y continuar</a>
      </div>
    </main>
  </div>
  <script src="analytics.js"></script>
</body>
</html>
```

Tabla idéntica (misma copia, mismas 5 filas, mismo orden) a la ya usada en `onboarding-membership.html` — una sola fuente de verdad conceptual sobre qué incluye cada plan, sin inventar contenido nuevo. `id="btn-create-account"` es un `<a>` simple, no requiere JS propio — no hace falta un `-ui.js` para esta página.

### 2. CTA del teaser (`app.js`, `renderTeaserReasons`)

Cambia el destino para usuarios sin sesión de `auth.html` a `premium-offer.html`:

```js
cta.href = isLoggedIn ? 'onboarding-membership.html' : 'premium-offer.html';
```

Único cambio en `app.js` — la línea de precio en la tarjeta (`.teaser-price-line`, ya agregada) se mantiene sin cambios, ambos niveles de información coexisten: línea corta en `scan.html` → tabla completa en `premium-offer.html` → signup en `auth.html` → (perfil → preferencias →) `onboarding-membership.html` con pago real.

## Sin cambios

- `.teaser-price-line` en la tarjeta del teaser (`app.js`, `styles.css`): se mantiene tal cual, no se revierte.
- `onboarding-membership.html`, `onboarding-membership-ui.js`, `auth.html`, flujo de perfil/preferencias/pago: sin cambios — `premium-offer.html` es una pantalla nueva, puramente informativa, que antecede a ese flujo existente sin modificarlo.
- Botón "Seguir sin membresía": sigue viviendo solo en `onboarding-membership.html`, no se duplica en la pantalla nueva.
