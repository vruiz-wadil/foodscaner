# SEO/AEO Foundations (Paquete 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the site basic search/AI-crawler discoverability: `robots.txt`, `sitemap.xml`, noindex on private pages, and description/Open-Graph/canonical tags plus a real share image on the 6 public pages.

**Architecture:** Two new static files at repo root (`robots.txt`, `sitemap.xml`), a one-off Node script that renders an SVG to a 1200×630 PNG via the already-installed `sharp` package (script itself is not part of the app, only its output `assets/og-image.png` is committed), and `<head>` edits to 13 existing HTML files — no JS/backend logic changes anywhere.

**Tech Stack:** Static HTML, `sharp` (already in `node_modules`, no new dependency).

## Global Constraints

- Production domain: `https://yomi.mx`.
- Indexable pages (6): `index.html`, `scan.html`, `premium-offer.html`, `terminos.html`, `privacidad.html`, `auth.html`.
- Private/noindex pages (7): `account.html`, `history.html`, `onboarding-membership.html`, `onboarding-profile.html`, `preferences.html`, `reset-password.html`, `verify-email.html`.
- No new npm dependency — `sharp` is already installed.
- Brand colors (from `styles.css`): mint background `#eaf9f6`, teal `#4bc5ab` / `#2dbc9e`.

---

### Task 1: `robots.txt` and `sitemap.xml`

**Files:**
- Create: `robots.txt`
- Create: `sitemap.xml`

**Interfaces:**
- Produces: `https://yomi.mx/robots.txt` referencing `https://yomi.mx/sitemap.xml`; both are static files served as-is (this is a static-file Vercel project — anything at repo root is served at the matching URL path, same as the existing `index.html`).

- [ ] **Step 1: Create `robots.txt`**

Create `robots.txt` at the repo root with this exact content:

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

- [ ] **Step 2: Create `sitemap.xml`**

Create `sitemap.xml` at the repo root with this exact content:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://yomi.mx/index.html</loc></url>
  <url><loc>https://yomi.mx/scan.html</loc></url>
  <url><loc>https://yomi.mx/premium-offer.html</loc></url>
  <url><loc>https://yomi.mx/terminos.html</loc></url>
  <url><loc>https://yomi.mx/privacidad.html</loc></url>
  <url><loc>https://yomi.mx/auth.html</loc></url>
</urlset>
```

- [ ] **Step 3: Verify both files are well-formed**

Run: `node -e "new (require('util').TextDecoder)(); require('fs').readFileSync('sitemap.xml','utf8').includes('</urlset>') || process.exit(1)"`
Expected: no output, exit code 0 (confirms the file at least closes its root tag — this project has no XML linter installed, so this is a minimal sanity check, not full XML validation).

Also visually confirm `robots.txt` has exactly one `Disallow:` per line, no typos in the 7 private page names (compare against the Global Constraints list above).

- [ ] **Step 4: Commit**

```bash
git add robots.txt sitemap.xml
git commit -m "feat(seo): agrega robots.txt y sitemap.xml"
```

---

### Task 2: `noindex` meta tag on the 7 private pages

**Files:**
- Modify: `account.html:7`
- Modify: `history.html:7`
- Modify: `onboarding-membership.html:7`
- Modify: `onboarding-profile.html:7`
- Modify: `preferences.html:7`
- Modify: `reset-password.html:7`
- Modify: `verify-email.html:7`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing consumed by later tasks — independent of Task 1 and Task 3.

Each of these 7 files has its `<title>` tag on line 7 (verified: `<title>Yomi — ...</title>`). In each file, add a `<meta name="robots" content="noindex,nofollow">` line immediately after the `<title>` line.

- [ ] **Step 1: Add noindex to `account.html`**

Find line 7 (`  <title>Yomi — Mi cuenta</title>`) and add immediately after it:

```html
  <meta name="robots" content="noindex,nofollow">
```

- [ ] **Step 2: Add noindex to `history.html`**

Find line 7 (`  <title>Yomi — Análisis</title>`) and add immediately after it:

```html
  <meta name="robots" content="noindex,nofollow">
```

- [ ] **Step 3: Add noindex to `onboarding-membership.html`**

Find line 7 (`  <title>Yomi — Activa tu membresía</title>`) and add immediately after it:

```html
  <meta name="robots" content="noindex,nofollow">
```

- [ ] **Step 4: Add noindex to `onboarding-profile.html`**

Find line 7 (`  <title>Yomi — Completa tu perfil</title>`) and add immediately after it:

```html
  <meta name="robots" content="noindex,nofollow">
```

- [ ] **Step 5: Add noindex to `preferences.html`**

Find line 7 (`  <title>Yomi — Mis preferencias</title>`) and add immediately after it:

```html
  <meta name="robots" content="noindex,nofollow">
```

- [ ] **Step 6: Add noindex to `reset-password.html`**

Find line 7 (`  <title>Yomi — Restablecer contraseña</title>`) and add immediately after it:

```html
  <meta name="robots" content="noindex,nofollow">
```

- [ ] **Step 7: Add noindex to `verify-email.html`**

Find line 7 (`  <title>Yomi — Verificar correo</title>`) and add immediately after it:

```html
  <meta name="robots" content="noindex,nofollow">
```

- [ ] **Step 8: Verify**

Run: `grep -L 'noindex' account.html history.html onboarding-membership.html onboarding-profile.html preferences.html reset-password.html verify-email.html`
Expected: no output (empty — `grep -L` prints files that do NOT match; empty output means all 7 files now contain "noindex").

Run: `grep -l 'noindex' index.html scan.html premium-offer.html terminos.html privacidad.html auth.html`
Expected: no output (the 6 indexable pages must NOT have the noindex tag).

- [ ] **Step 9: Commit**

```bash
git add account.html history.html onboarding-membership.html onboarding-profile.html preferences.html reset-password.html verify-email.html
git commit -m "feat(seo): agrega meta noindex a paginas privadas"
```

---

### Task 3: Generate the Open Graph share image

**Files:**
- Create (temporary, not committed): a one-off script, e.g. `scripts/tmp-generate-og-image.js`
- Create (committed): `assets/og-image.png`

**Interfaces:**
- Produces: `assets/og-image.png`, a 1200×630 PNG, referenced by Task 4's `og:image` tags as `https://yomi.mx/assets/og-image.png`.

- [ ] **Step 1: Write the SVG-to-PNG generator script**

Create `scripts/tmp-generate-og-image.js`:

```js
const sharp = require('sharp');
const path = require('path');

const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#eaf9f6"/>
  <circle cx="1080" cy="90" r="220" fill="#4bc5ab" opacity="0.12"/>
  <circle cx="90" cy="560" r="180" fill="#2dbc9e" opacity="0.12"/>
  <text x="600" y="270" font-family="Arial, sans-serif" font-size="96" font-weight="700" fill="#0b3d33" text-anchor="middle">Yomi</text>
  <text x="600" y="340" font-family="Arial, sans-serif" font-size="34" fill="#2dbc9e" text-anchor="middle" font-weight="600">¿Puedo comerlo?</text>
  <text x="600" y="390" font-family="Arial, sans-serif" font-size="28" fill="#1d6f5e" text-anchor="middle">Escanea y lo sabrás en segundos</text>
</svg>
`;

sharp(Buffer.from(svg))
  .resize(1200, 630)
  .png()
  .toFile(path.join(__dirname, '..', 'assets', 'og-image.png'))
  .then(() => console.log('assets/og-image.png written'))
  .catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run it**

Run: `node scripts/tmp-generate-og-image.js`
Expected: prints `assets/og-image.png written`, and `assets/og-image.png` now exists.

- [ ] **Step 3: Verify size and dimensions**

Run: `node -e "require('sharp')('assets/og-image.png').metadata().then(m => console.log(m.width, m.height, m.size))"`
Expected: prints `1200 630 <some byte count>` — confirm the byte count is well under 300000 (300KB). If it's larger, that's fine as long as it's a reasonable PNG size for a simple graphic (typically well under 100KB for this kind of flat-color image); only re-investigate if it's unexpectedly huge.

- [ ] **Step 4: Delete the one-off script and commit only the image**

```bash
rm scripts/tmp-generate-og-image.js
git add assets/og-image.png
git commit -m "feat(seo): agrega imagen Open Graph para compartir en redes"
```

---

### Task 4: Description, Open Graph, canonical, and twitter:card on the 6 indexable pages

**Files:**
- Modify: `index.html:7`
- Modify: `scan.html:7`
- Modify: `premium-offer.html:7`
- Modify: `terminos.html:6`
- Modify: `privacidad.html:6`
- Modify: `auth.html:7`

**Interfaces:**
- Consumes: `assets/og-image.png` from Task 3 (referenced by URL, not imported — if Task 3 hasn't landed yet, these tags still work once it does; no hard build-time dependency).
- Produces: nothing consumed by later tasks (this is the last task).

For each page, insert the following block immediately after its `<title>` line, with the page-specific values filled in as given below. All 6 blocks share this shape:

```html
  <meta name="description" content="{{description}}">
  <link rel="canonical" href="{{canonical}}">
  <meta property="og:title" content="{{og_title}}">
  <meta property="og:description" content="{{og_description}}">
  <meta property="og:image" content="https://yomi.mx/assets/og-image.png">
  <meta property="og:url" content="{{canonical}}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
```

- [ ] **Step 1: `index.html`** — insert after line 7 (`  <title>Yomi — ¿Puedo comerlo?</title>`):

```html
  <meta name="description" content="Yomi escanea el código de barras o la etiqueta de cualquier alimento y te dice al instante si es apto para ti, según tus alergias, dietas y condiciones de salud.">
  <link rel="canonical" href="https://yomi.mx/index.html">
  <meta property="og:title" content="Yomi — ¿Puedo comerlo?">
  <meta property="og:description" content="Escanea un producto y sabé en segundos si es apto para vos: alergias, dietas y condiciones de salud, todo en una sola app.">
  <meta property="og:image" content="https://yomi.mx/assets/og-image.png">
  <meta property="og:url" content="https://yomi.mx/index.html">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
```

- [ ] **Step 2: `scan.html`** — insert after line 7 (`  <title>Yomi - Identificador Nutricional de Alimentos</title>`):

```html
  <meta name="description" content="Escaneá el código de barras o fotografiá la etiqueta de un alimento y Yomi te muestra al instante sus ingredientes, nutrientes y si es apto para tus alergias o dietas.">
  <link rel="canonical" href="https://yomi.mx/scan.html">
  <meta property="og:title" content="Yomi — Identificador Nutricional de Alimentos">
  <meta property="og:description" content="Escaneá o fotografiá cualquier producto y obtené su análisis nutricional completo en segundos.">
  <meta property="og:image" content="https://yomi.mx/assets/og-image.png">
  <meta property="og:url" content="https://yomi.mx/scan.html">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
```

- [ ] **Step 3: `premium-offer.html`** — insert after line 7 (`  <title>Yomi — Análisis personalizado con Premium</title>`):

```html
  <meta name="description" content="Con Yomi Premium obtenés análisis nutricional personalizado según tus alergias, dietas y condiciones de salud, historial de escaneos y recomendaciones a tu medida.">
  <link rel="canonical" href="https://yomi.mx/premium-offer.html">
  <meta property="og:title" content="Yomi Premium — Análisis nutricional personalizado">
  <meta property="og:description" content="Desbloqueá análisis a tu medida, historial de escaneos y recomendaciones según tus alergias, dietas y condiciones de salud.">
  <meta property="og:image" content="https://yomi.mx/assets/og-image.png">
  <meta property="og:url" content="https://yomi.mx/premium-offer.html">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
```

- [ ] **Step 4: `terminos.html`** — insert after line 6 (`  <title>Yomi — Términos de Uso</title>`):

```html
  <meta name="description" content="Términos y condiciones de uso de la aplicación Yomi, el identificador nutricional de alimentos.">
  <link rel="canonical" href="https://yomi.mx/terminos.html">
  <meta property="og:title" content="Yomi — Términos de Uso">
  <meta property="og:description" content="Términos y condiciones de uso de Yomi.">
  <meta property="og:image" content="https://yomi.mx/assets/og-image.png">
  <meta property="og:url" content="https://yomi.mx/terminos.html">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
```

- [ ] **Step 5: `privacidad.html`** — insert after line 6 (`  <title>Yomi — Aviso de Privacidad</title>`):

```html
  <meta name="description" content="Aviso de privacidad de Yomi: cómo se recopilan, usan y protegen tus datos, incluyendo información de salud, dentro de la aplicación.">
  <link rel="canonical" href="https://yomi.mx/privacidad.html">
  <meta property="og:title" content="Yomi — Aviso de Privacidad">
  <meta property="og:description" content="Cómo Yomi recopila, usa y protege tus datos.">
  <meta property="og:image" content="https://yomi.mx/assets/og-image.png">
  <meta property="og:url" content="https://yomi.mx/privacidad.html">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
```

- [ ] **Step 6: `auth.html`** — insert after line 7 (`  <title>Yomi — Iniciar sesión</title>`):

```html
  <meta name="description" content="Iniciá sesión o creá tu cuenta de Yomi para guardar tu historial de escaneos y tus preferencias de alergias y dietas.">
  <link rel="canonical" href="https://yomi.mx/auth.html">
  <meta property="og:title" content="Yomi — Iniciar sesión">
  <meta property="og:description" content="Iniciá sesión o creá tu cuenta de Yomi.">
  <meta property="og:image" content="https://yomi.mx/assets/og-image.png">
  <meta property="og:url" content="https://yomi.mx/auth.html">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
```

- [ ] **Step 7: Verify each page has a unique description and no page has more than one `<meta name="description">`**

Run: `grep -c 'name="description"' index.html scan.html premium-offer.html terminos.html privacidad.html auth.html`
Expected: `1` for each of the 6 files (no duplicates).

Run: `grep -h 'name="description"' index.html scan.html premium-offer.html terminos.html privacidad.html auth.html | sort | uniq -d`
Expected: no output (confirms no two pages ended up with an identical description string).

- [ ] **Step 8: Manual verification in the browser**

Run: `npm run dev` (or the project's existing local server command — check `package.json` `scripts` for the exact one).
- Open each of the 6 pages, view page source (not DevTools-rendered DOM, actual "View Source") and confirm the new `<meta>`/`<link>` tags are present in the raw HTML `<head>`, right after `<title>`.
- Confirm nothing else in the `<head>` (viewport meta, favicons, existing stylesheet links) was disturbed.
- Confirm the 7 private pages still load normally (noindex doesn't block browser rendering, only search engines).

- [ ] **Step 9: Commit**

```bash
git add index.html scan.html premium-offer.html terminos.html privacidad.html auth.html
git commit -m "feat(seo): agrega meta description, Open Graph y canonical a paginas publicas"
```
