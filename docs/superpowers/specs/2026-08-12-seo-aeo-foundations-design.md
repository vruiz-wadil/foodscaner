# SEO/AEO — Fundamentos de descubrimiento (Paquete 1)

## Problema

Auditoría SEO/AEO (2026-08-12, ver memoria `seo-aeo-audit-2026-08`) encontró: sin `robots.txt`, sin `sitemap.xml`, sin `<meta name="description">` en ninguna página, sin Open Graph/Twitter cards, sin canonical, páginas privadas indexables por default. Este spec cubre el paquete 1 (mecánico, bajo riesgo): descubrimiento básico. Fuera de alcance: copy explicativo extendido, `llms.txt`, JSON-LD, FAQ (paquete 2).

## Clasificación de páginas

**Indexables** (6): `index.html`, `scan.html`, `premium-offer.html`, `terminos.html`, `privacidad.html`, `auth.html`.

**Privadas / noindex** (7): `account.html`, `history.html`, `onboarding-membership.html`, `onboarding-profile.html`, `preferences.html`, `reset-password.html`, `verify-email.html`.

Dominio de producción: `https://yomi.mx`.

## 1. `robots.txt` (nuevo, raíz del repo)

```
User-agent: *
Allow: /
Disallow: /api/
Disallow: /account.html
Disallow: /history.html
Disallow: /onboarding-membership.html
Disallow: /onboarding-profile.html
Disallow: /preferences.html
Disallow: /reset-password.html
Disallow: /verify-email.html

Sitemap: https://yomi.mx/sitemap.xml
```

Sin reglas específicas para GPTBot/ClaudeBot/PerplexityBot/Google-Extended — el `User-agent: *` ya los cubre y no hay razón para bloquearlos.

## 2. `sitemap.xml` (nuevo, raíz del repo)

XML estándar (`urlset` namespace `http://www.sitemaps.org/schemas/sitemap/0.9`) con las 6 URLs indexables sobre `https://yomi.mx/<page>`. Sin `lastmod`/`priority` (no aporta valor real, evitar mantenimiento que se desactualiza).

## 3. Meta `noindex` en páginas privadas

En cada una de las 7 páginas privadas, agregar en `<head>`:

```html
<meta name="robots" content="noindex,nofollow">
```

## 4. Meta description + Open Graph + canonical en páginas indexables

En cada una de las 6 páginas indexables, agregar en `<head>` (después del `<title>` existente):

```html
<meta name="description" content="...">
<link rel="canonical" href="https://yomi.mx/<page>">
<meta property="og:title" content="...">
<meta property="og:description" content="...">
<meta property="og:image" content="https://yomi.mx/assets/og-image.png">
<meta property="og:url" content="https://yomi.mx/<page>">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
```

Descripciones únicas por página (no genéricas), ~150-160 caracteres, en español, reflejando el propósito real de cada página (home = propuesta de valor, scan = la herramienta, premium-offer = la oferta Premium, legales = su contenido).

## 5. Imagen OG (`assets/og-image.png`, 1200×630)

Generada componiendo un SVG con los colores de marca existentes (teal `#4BC5AB`/`#2DBC9E`, fondo menta `#EAF9F6`, logo de `assets/redesign/logo.svg`) + tagline "¿Puedo comerlo? Escanea y lo sabrás en segundos", convertida a PNG con `sharp` (ya en `node_modules`, sin agregar dependencia nueva). Un script one-off (no queda en el repo como parte del build) genera el PNG final, que sí se commitea en `assets/`.

## Testing

- Validar `robots.txt` con sintaxis correcta (un `Disallow:` por línea, sin errores tipográficos en las rutas).
- Validar `sitemap.xml` es XML bien formado (`node -e "require('...').DOMParser"` o simplemente revisión visual — es un archivo estático simple, sin necesidad de parser).
- Confirmar que las 7 páginas privadas tienen el meta noindex y las 6 indexables NO lo tienen.
- Confirmar que las 6 páginas indexables tienen description/OG/canonical únicos (no copy-pasted sin cambiar).
- Confirmar `assets/og-image.png` existe, es 1200×630, y pesa menos de ~300KB (no gigante).
- Verificación manual: abrir cada página modificada en el navegador, confirmar que no rompió el `<head>` existente (viewport, favicons, etc. siguen intactos).
