# SEO/AEO Paquete 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real semantic content to `index.html` (explanatory copy + FAQ) plus JSON-LD structured data and an `llms.txt` discovery file, so both human visitors and AI crawlers/citation engines can understand and cite Yomi accurately.

**Architecture:** Two new HTML sections inserted into `index.html`'s existing `<main>` (below the current two-column grid, full width), matching CSS added to `home.css` reusing existing design tokens, three `<script type="application/ld+json">` blocks added to `index.html`'s `<head>`, and one new static file `llms.txt` at the repo root.

**Tech Stack:** Static HTML/CSS, no new dependencies. Node's built-in `JSON.parse` used for JSON-LD syntax verification (no linter installed).

**Spec:** `docs/superpowers/specs/2026-08-13-seo-aeo-package2-design.md`

## Global Constraints

- Production domain: `https://yomi.mx`.
- All copy is final (approved via Content Creator agent) — do not rephrase, only fix HTML escaping if needed.
- Existing CSS tokens in `home.css:7-23`: `--bg: #eaf9f6`, `--ink: #0d3d35`, `--ink-muted: #5f7568`, `--teal-soft: #4bc5ab`, `--white: #ffffff`, `--radius: 4px`, `--border: rgba(45,188,158,0.2)`, `--shadow-card: 0 1px 3px rgba(45,188,158,0.07)`.
- `vercel.json`'s static-file glob already includes `.txt` (fixed in Paquete 1) — `llms.txt` needs no config change, only verification.
- FAQ text in the JSON-LD `FAQPage` block must be byte-identical to the visible FAQ HTML text (no hidden/duplicated content for crawlers).

---

### Task 1: "¿Qué es Yomi?" section in `index.html` + CSS

**Files:**
- Modify: `index.html` (insert new `<section class="how-it-works">` inside `<main class="app-main">`, after the closing `</div>` of `home-right` around line 100)
- Modify: `home.css` (append new rules for `.how-it-works`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by later tasks — independent of Tasks 2-4.

- [ ] **Step 1: Insert the section into `index.html`**

Find this closing structure (currently around line 100-102):

```html
      </div>

    </main>
```

Replace it with (adds the new section between `home-right`'s closing `</div>` and `</main>`):

```html
      </div>

      <section class="how-it-works">
        <h2>¿Qué es Yomi?</h2>
        <p>Yomi es una app web que te dice al instante si un alimento es apto para ti. Escaneas el código de barras de cualquier producto y en segundos sabes si puedes comerlo, según tus alergias, dietas y condiciones de salud.</p>

        <p>Así funciona: escaneas el código de barras (o lo ingresas manualmente), Yomi busca la información del producto y genera un análisis con inteligencia artificial que revisa ingredientes, alérgenos y niveles de gluten. El resultado te dice si el producto es apto o no apto para tu perfil, junto con la información nutricional completa.</p>

        <p>Para dar un resultado personalizado, Yomi usa los datos de tu perfil: alergias alimentarias, dietas que sigues (vegana, sin gluten, keto, etc.) y condiciones de salud que hayas registrado. Mientras más completo esté tu perfil, más preciso es el análisis.</p>

        <ul>
          <li>Escaneas o ingresas el código de barras de un alimento.</li>
          <li>Yomi analiza el producto con IA: ingredientes, alérgenos, gluten e información nutricional.</li>
          <li>Comparas el resultado contra tu perfil de alergias, dietas y condiciones de salud.</li>
          <li>Obtienes un veredicto claro: apto o no apto para ti, en segundos.</li>
        </ul>
      </section>

    </main>
```

- [ ] **Step 2: Add CSS for `.how-it-works` to `home.css`**

Append at the end of `home.css`:

```css
/* ── How it works / About section ──────────────────────────────── */
.how-it-works {
  width: 100%;
  padding: 24px 20px 8px;
  color: var(--ink);
}

.how-it-works h2 {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 12px;
}

.how-it-works p {
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-muted);
  margin-bottom: 12px;
}

.how-it-works ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.how-it-works li {
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink);
  padding-left: 20px;
  position: relative;
}

.how-it-works li::before {
  content: "✓";
  position: absolute;
  left: 0;
  color: var(--teal-soft);
  font-weight: 700;
}
```

- [ ] **Step 3: Verify the section was inserted correctly**

Run: `grep -c 'class="how-it-works"' index.html`
Expected: `1`

Run: `grep -c '<li>' index.html`
Expected: `4` or more (4 new bullets — if the page already had `<li>` elsewhere, expect at least 4; if this is the first `<li>` usage, expect exactly 4)

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev` (or the project's existing local server command — check `package.json` `scripts`).
Open `index.html`, confirm the new section renders below the existing two-column grid without breaking the layout, on both desktop width and mobile width (resize browser or use DevTools device toolbar).

- [ ] **Step 5: Commit**

```bash
git add index.html home.css
git commit -m "feat(seo): agrega seccion Que es Yomi con copy explicativo"
```

---

### Task 2: FAQ section in `index.html` + CSS

**Files:**
- Modify: `index.html` (insert new `<section class="faq">` immediately after the `.how-it-works` section closing `</section>` tag from Task 1)
- Modify: `home.css` (append new rules for `.faq`)

**Interfaces:**
- Consumes: nothing from Task 1 at the code level (this task can run independently — the insertion point is textual, "after `.how-it-works`'s closing tag", not a shared variable).
- Produces: FAQ question/answer text that Task 3's `FAQPage` JSON-LD must match exactly (see Global Constraints).

- [ ] **Step 1: Insert the section into `index.html`**

Immediately after the `</section>` that closes `.how-it-works` (added in Task 1) and before `</main>`, insert:

```html
      <section class="faq">
        <h2>Preguntas frecuentes</h2>

        <div class="faq-item">
          <h3>¿Qué es Yomi?</h3>
          <p>Yomi es una app web que escanea el código de barras de alimentos y te dice al instante si son aptos para ti, según tus alergias, dietas y condiciones de salud.</p>
        </div>

        <div class="faq-item">
          <h3>¿Cómo funciona exactamente?</h3>
          <p>Escaneas o ingresas el código de barras del producto. Yomi genera un análisis con inteligencia artificial sobre sus ingredientes, alérgenos, gluten e información nutricional, y lo compara con tu perfil para decirte si es apto o no.</p>
        </div>

        <div class="faq-item">
          <h3>¿Yomi es gratis?</h3>
          <p>Yomi tiene un plan gratuito y uno premium con funciones adicionales.</p>
        </div>

        <div class="faq-item">
          <h3>¿Qué datos usa Yomi para el análisis?</h3>
          <p>Usa la información del producto escaneado (ingredientes, nutrientes, alérgenos) y los datos de tu perfil: alergias, dietas y condiciones de salud que hayas registrado.</p>
        </div>

        <div class="faq-item">
          <h3>¿Qué tan preciso es el análisis? ¿Quién lo genera?</h3>
          <p>El análisis lo genera un sistema de inteligencia artificial a partir de la información del producto y tu perfil. Es una herramienta de apoyo para tomar decisiones informadas, no reemplaza el consejo de un profesional de salud.</p>
        </div>

        <div class="faq-item">
          <h3>¿Cómo protege Yomi mis datos?</h3>
          <p>Yomi trata tus datos de salud y perfil de forma confidencial y solo los usa para generar tus análisis personalizados. Puedes consultar los detalles completos en nuestro <a href="/privacidad.html">aviso de privacidad</a>.</p>
        </div>
      </section>
```

- [ ] **Step 2: Add CSS for `.faq` to `home.css`**

Append at the end of `home.css`:

```css
/* ── FAQ section ────────────────────────────────────────────────── */
.faq {
  width: 100%;
  padding: 8px 20px 24px;
  color: var(--ink);
}

.faq h2 {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 12px;
}

.faq-item {
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-card);
  padding: 14px 16px;
  margin-bottom: 10px;
}

.faq-item h3 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 6px;
}

.faq-item p {
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink-muted);
}

.faq-item a {
  color: var(--teal-soft);
}
```

- [ ] **Step 3: Verify**

Run: `grep -c 'class="faq-item"' index.html`
Expected: `6`

- [ ] **Step 4: Manual verification in the browser**

Reload `index.html` in the dev server, confirm the FAQ renders below the "¿Qué es Yomi?" section, cards are readable on desktop and mobile widths, and the privacy link works.

- [ ] **Step 5: Commit**

```bash
git add index.html home.css
git commit -m "feat(seo): agrega seccion FAQ a index.html"
```

---

### Task 3: JSON-LD structured data in `index.html` `<head>`

**Files:**
- Modify: `index.html` (insert three `<script type="application/ld+json">` blocks in `<head>`, after the existing `<meta name="twitter:card">` line, currently around line 15)

**Interfaces:**
- Consumes: the exact FAQ question/answer text from Task 2 (must match byte-for-byte, ignoring surrounding HTML tags).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Insert the three JSON-LD blocks**

Find this line in `index.html`'s `<head>` (currently line 15):

```html
  <meta name="twitter:card" content="summary_large_image">
```

Insert immediately after it:

```html
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Yomi",
    "url": "https://yomi.mx/",
    "logo": "https://yomi.mx/assets/redesign/logo.svg",
    "sameAs": [
      "https://www.facebook.com/people/Yomimx/61591989440637/",
      "https://www.instagram.com/somos.yomi.mx/"
    ]
  }
  </script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "Yomi",
    "applicationCategory": "HealthApplication",
    "operatingSystem": "Web",
    "url": "https://yomi.mx/",
    "description": "Yomi escanea el código de barras o la etiqueta de cualquier alimento y te dice al instante si es apto para ti, según tus alergias, dietas y condiciones de salud.",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "MXN"
    }
  }
  </script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      { "@type": "Question", "name": "¿Qué es Yomi?", "acceptedAnswer": { "@type": "Answer", "text": "Yomi es una app web que escanea el código de barras de alimentos y te dice al instante si son aptos para ti, según tus alergias, dietas y condiciones de salud." } },
      { "@type": "Question", "name": "¿Cómo funciona exactamente?", "acceptedAnswer": { "@type": "Answer", "text": "Escaneas o ingresas el código de barras del producto. Yomi genera un análisis con inteligencia artificial sobre sus ingredientes, alérgenos, gluten e información nutricional, y lo compara con tu perfil para decirte si es apto o no." } },
      { "@type": "Question", "name": "¿Yomi es gratis?", "acceptedAnswer": { "@type": "Answer", "text": "Yomi tiene un plan gratuito y uno premium con funciones adicionales." } },
      { "@type": "Question", "name": "¿Qué datos usa Yomi para el análisis?", "acceptedAnswer": { "@type": "Answer", "text": "Usa la información del producto escaneado (ingredientes, nutrientes, alérgenos) y los datos de tu perfil: alergias, dietas y condiciones de salud que hayas registrado." } },
      { "@type": "Question", "name": "¿Qué tan preciso es el análisis? ¿Quién lo genera?", "acceptedAnswer": { "@type": "Answer", "text": "El análisis lo genera un sistema de inteligencia artificial a partir de la información del producto y tu perfil. Es una herramienta de apoyo para tomar decisiones informadas, no reemplaza el consejo de un profesional de salud." } },
      { "@type": "Question", "name": "¿Cómo protege Yomi mis datos?", "acceptedAnswer": { "@type": "Answer", "text": "Yomi trata tus datos de salud y perfil de forma confidencial y solo los usa para generar tus análisis personalizados. Puedes consultar los detalles completos en nuestro aviso de privacidad." } }
    ]
  }
  </script>
```

- [ ] **Step 2: Verify all three JSON-LD blocks are syntactically valid JSON**

Run:
```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const matches = [...html.matchAll(/<script type=\"application\/ld\+json\">([\s\S]*?)<\/script>/g)];
if (matches.length !== 3) { console.error('Expected 3 JSON-LD blocks, found ' + matches.length); process.exit(1); }
matches.forEach((m, i) => { JSON.parse(m[1]); console.log('Block ' + i + ' OK: ' + JSON.parse(m[1])['@type']); });
"
```
Expected: no error, prints `Block 0 OK: Organization`, `Block 1 OK: SoftwareApplication`, `Block 2 OK: FAQPage`.

- [ ] **Step 3: Verify FAQPage text matches the visible FAQ HTML from Task 2**

Run:
```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const jsonMatch = [...html.matchAll(/<script type=\"application\/ld\+json\">([\s\S]*?)<\/script>/g)][2][1];
const faq = JSON.parse(jsonMatch);
const visibleQuestions = [...html.matchAll(/<div class=\"faq-item\">\s*<h3>(.*?)<\/h3>/g)].map(m => m[1]);
const jsonQuestions = faq.mainEntity.map(q => q.name);
const match = JSON.stringify(visibleQuestions) === JSON.stringify(jsonQuestions);
console.log(match ? 'MATCH' : 'MISMATCH: ' + JSON.stringify({visibleQuestions, jsonQuestions}));
if (!match) process.exit(1);
"
```
Expected: prints `MATCH`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(seo): agrega JSON-LD Organization, SoftwareApplication y FAQPage"
```

---

### Task 4: `llms.txt`

**Files:**
- Create: `llms.txt`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `https://yomi.mx/llms.txt`, a static file served as-is (same static-file serving as `robots.txt`/`sitemap.xml` from Paquete 1 — `vercel.json`'s glob already covers `.txt`, no config change needed).

- [ ] **Step 1: Create `llms.txt`**

Create `llms.txt` at the repo root with this exact content:

```
# Yomi

> Yomi es una app web que escanea el código de barras de alimentos y dice al instante, con análisis generado por IA, si un producto es apto según las alergias, dietas y condiciones de salud del usuario.

## Producto

- [Inicio](https://yomi.mx/): Presentación de Yomi, qué es y cómo funciona el escaneo de productos.
- [Escanear producto](https://yomi.mx/scan.html): Herramienta para escanear o ingresar el código de barras de un alimento y obtener su análisis.
- [Plan premium](https://yomi.mx/premium-offer.html): Información sobre el plan premium de Yomi y sus funciones adicionales.

## Cuenta

- [Crear cuenta / Iniciar sesión](https://yomi.mx/auth.html): Registro e inicio de sesión para crear tu perfil de alergias, dietas y condiciones de salud.

## Legal

- [Términos y condiciones](https://yomi.mx/terminos.html): Términos de uso del servicio Yomi.
- [Aviso de privacidad](https://yomi.mx/privacidad.html): Política de privacidad y manejo de datos de los usuarios.
```

- [ ] **Step 2: Verify the file exists and is non-empty**

Run: `node -e "const c = require('fs').readFileSync('llms.txt','utf8'); if (!c.startsWith('# Yomi')) process.exit(1); console.log(c.length + ' bytes')"`
Expected: prints a byte count, no error.

- [ ] **Step 3: Confirm `vercel.json` already serves `.txt` files (no change needed, just a check)**

Run: `grep -n '\.txt' vercel.json`
Expected: at least one match showing `.txt` in the static-file glob pattern (added during Paquete 1's final fix wave — if this is missing, stop and flag it, since it means `llms.txt` will 404 in production).

- [ ] **Step 4: Commit**

```bash
git add llms.txt
git commit -m "feat(seo): agrega llms.txt para discovery de agentes IA"
```
