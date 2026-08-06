# Teaser de análisis personalizado para usuarios free (2 de 4)

## Contexto

`renderPersonalizedReasons()` (`app.js:1852-1891`) pinta la tarjeta `#verdict-reasons` ("Cumple con tu perfil" / "Tu perfil vs. este producto") solo cuando `userPreferences` no es null — es decir, solo para usuarios premium con `membershipStatus === 'active'` y preferencias configuradas. Para todos los demás (free, no logueados, o premium sin preferencias) `computeVerdictReasons(product, null)` retorna `[]` (`app.js:1712`) y la función esconde la tarjeta (`card.classList.add('hidden')`, `app.js:1857`).

Resultado: un usuario free escanea un producto, ve el veredicto básico (SANO/REGULAR/EVITAR) y nada más — cero mención de que existe un análisis más profundo. Es el momento de mayor interés del usuario (justo escaneó, quiere saber si el producto le conviene) y hoy no hay ningún gancho hacia la membresía ahí. Señalado como punto #2 del plan comercial, después de la fase 1 (`2026-07-31-membership-gate-removal-design.md`).

## Cambio

### 1. `app.js` — rama teaser en `renderPersonalizedReasons`

Nueva condición al inicio de la función: si `!userPreferences` (free, no logueado, o premium sin preferencias configuradas) Y el producto no es "sin datos" (`hasNoRealData`, reutiliza el check ya usado para el ícono del banner en `app.js:1978`), pinta la tarjeta en modo teaser en vez de esconderla. Si `userPreferences` existe, comportamiento actual sin cambios (rama premium real).

Modo teaser:
- `card.classList.add('reason-card--teaser')` (nueva clase, para el blur/estilo).
- Título fijo: **"Desbloquea tu análisis personalizado"**.
- Summary fijo: **"Alergias, dietas y condiciones de salud — verificado contra tu perfil"**.
- Lista: 3 filas placeholder genéricas (no datos reales del producto — no hay preferencias que evaluar), con clase `reason-row--teaser` que aplica blur vía CSS a `.reason-text`:
  - `🥜` "Alergias" / "Verificación automática"
  - `🍽️` "Dieta" / "Compatibilidad con tu estilo de alimentación"
  - `⚕️` "Condiciones de salud" / "Alertas relevantes para ti"
- Botón nuevo al final de la tarjeta: `<a href="onboarding-membership.html" class="btn btn-primary btn-teaser-cta">Ver mi análisis — $29.90/mes</a>`.
- `card.classList.remove('hidden')` igual que la rama premium — misma animación de entrada (`verdict-reasons-reveal`), sin cambios ahí.

Cuando SÍ hay `userPreferences` pero `computeVerdictReasons` retorna `[]` (premium sin restricciones configuradas — caso ya documentado en el comentario de `app.js:1848`), la tarjeta se sigue escondiendo igual que hoy — ese caso no es "free", es premium activo, no aplica el teaser.

`hasNoRealData(product)` ya existe en `app.js` (usado en `app.js:1978`) — si el producto no tiene datos reales, ni el teaser ni la tarjeta premium tienen sentido; se sigue ocultando la tarjeta en ese caso, en ambas ramas.

### 2. `scan.html` — sin cambios estructurales

El contenedor `#verdict-reasons` (`scan.html:229-233`) ya tiene `id="verdict-reasons-title"`, `id="verdict-reasons-summary"`, `id="verdict-reasons-list"` — el modo teaser reutiliza los mismos elementos, solo cambia el contenido vía JS. No se agrega markup nuevo al HTML.

### 3. CSS — nuevas reglas para el modo teaser

Agregar a la hoja de estilos donde vive `.reason-card` (buscar en `styles.css` o `home.css`, seguir el patrón existente):
- `.reason-card--teaser .reason-text` → `filter: blur(3px); user-select: none;` (blur visual, no hay dato real que proteger pero comunica "esto está bloqueado").
- `.btn-teaser-cta` → mismo estilo que `.btn-primary` ya usado en el resto de la app (reutilizar clase existente, sin CSS nuevo si `.btn.btn-primary` ya cubre el caso — confirmar en implementación).

## Sin cambios

- `computeVerdictReasons`, `computeVerdict`, `getUserPreferencesForVerdict`: sin cambios — el teaser es puramente de presentación, no altera el cálculo del veredicto ni gatea nada del lado de datos.
- `renderPersonalizedDisclaimer`: sin cambios — el disclaimer médico no depende de si se muestra el teaser.
- `onboarding-membership.html` (fase 1): sin cambios — el CTA del teaser apunta ahí, reutiliza la pantalla ya rediseñada en la fase 1.
- Lógica de historial en la nube, contador de escaneos: sin cambios.
