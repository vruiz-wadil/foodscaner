# SEO/AEO — Paquete 2 (copy, llms.txt, JSON-LD, FAQ)

## Problema

Paquete 1 (mecánico) ya está en prod: `robots.txt`, `sitemap.xml`, noindex en privadas, meta description/OG/canonical en públicas, imagen OG. Este paquete 2 cubre lo que quedó fuera de alcance: contenido semántico real para que humanos y AI crawlers/citation engines (GPTBot, ClaudeBot, PerplexityBot) entiendan y citen a Yomi. Ver auditoría completa en memoria `seo-aeo-audit-2026-08`.

## Alcance

Todo vive en `index.html` salvo `llms.txt` (raíz del repo). No se toca ninguna otra página.

## 1. Sección "¿Qué es Yomi?" (nueva, bajo el hero existente en index.html)

Reemplaza/complementa la `section-about` actual (que es solo una tarjeta corta) agregando una sección nueva `<section class="how-it-works">` con 3 párrafos + lista de 4 bullets. Copy final (generado por agente Content Creator, tono coherente con el resto del sitio):

```html
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
```

Ubicación: dentro de `<main class="app-main">`, después de `home-left`/`home-right` (o donde el implementer determine que no rompe el layout de 2 columnas — usar ancho completo, debajo del grid actual). Requiere CSS mínimo nuevo en `home.css` (heading, párrafos, lista) reusando variables/colores existentes (teal `#4BC5AB`/`#2DBC9E`, fondo menta `#EAF9F6`) — sin librería nueva.

## 2. FAQ (nueva, debajo de la sección anterior, misma página)

6 preguntas, formato `<details>/<summary>` (accesible, sin JS) o `<h3>+<p>` simple — el implementer elige el patrón que mejor calce con el CSS existente, priorizando accesibilidad semántica sobre estética. Copy final:

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

## 3. JSON-LD (index.html `<head>`)

Tres bloques `<script type="application/ld+json">` separados (Organization, SoftwareApplication, FAQPage). FAQPage usa las mismas 6 preguntas/respuestas de la sección FAQ (texto plano, sin HTML embebido en el JSON).

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

Nota: precio "0" en `SoftwareApplication.offers` porque el plan gratuito existe (no se afirma que todo Yomi sea gratis, solo describe la oferta de entrada — es válido según spec de schema.org para apps freemium).

## 4. `llms.txt` (nuevo, raíz del repo)

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

Se sirve estático — `vercel.json` ya incluye `.txt` en el glob desde el fix del paquete 1, no requiere cambio adicional. Confirmar de todas formas en testing.

## Fuera de alcance

`/admin` indexable (nit del review anterior, no es parte de este paquete). Banner de upsell inyectado por JS (`#home-upsell-banner`) sigue sin ser visible a crawlers — no se aborda aquí, es un cambio de arquitectura mayor.

## Testing

- Validar los 3 bloques JSON-LD con un parser JSON (sintaxis válida) y, si es posible, el [Rich Results Test de Google] manualmente (fuera del alcance automatizable, nota para QA manual).
- Confirmar que la sección `how-it-works` y `faq` no rompen el layout de 2 columnas existente (`home-left`/`home-right`) — verificación visual en navegador, desktop y mobile.
- Confirmar `llms.txt` responde 200 en `https://yomi.mx/llms.txt` tras deploy (mismo patrón de verificación curl usado en paquete 1).
- Confirmar que el texto de FAQ en JSON-LD coincide exactamente con el texto visible en el HTML (evitar contenido oculto/duplicado engañoso para crawlers).
