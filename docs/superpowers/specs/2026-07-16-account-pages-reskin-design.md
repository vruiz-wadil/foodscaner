# Reskin de páginas de cuenta (auth/preferences/account/history) — Design Spec

**Fecha:** 2026-07-16
**Estado:** Aprobado, listo para plan de implementación

## Contexto

Las 4 páginas del feature de cuentas de usuario (`auth.html`, `preferences.html`, `account.html`, `history.html`, shippeadas en la sesión anterior) usan un sistema visual genérico (`.content-card`, checkboxes/selects nativos, cards planas sin ícono) que no corresponde al look and feel establecido de `index.html`/`scan.html`. El usuario lo describe como "se siente formulario, no app".

Validado con mockups en el visual companion (2 rondas, aprobado): la dirección es un reskin completo que reusa componentes visuales YA EXISTENTES en `scan.html`/`styles.css`, no una librería de componentes nueva.

## Objetivo

Unificar el look and feel de las 4 páginas de cuenta con el resto de la app, reusando el sistema de diseño existente (`.glass-card`, `.dietary-grid-item`/`.allergen-grid-item`, tokens de color/tipografía de `styles.css`), agregando solo las piezas que genuinamente no existen todavía (card de identidad oscura, stat tiles, segmented toggle de severidad).

## Alcance

Páginas: `auth.html`, `preferences.html`, `account.html`, `history.html`. No incluye: checkout/pago real (sigue sin existir, fuera de alcance — ver Nota de negocio), plan Familiar, ni cambios a `index.html`/`scan.html` mismos (son la referencia, no el objetivo).

## Arquitectura visual

**Panel blanco dominante.** Cada página envuelve TODO su contenido en un único panel estilo `.glass-card` (fondo `var(--card)` blanco, `border-radius`, `padding:20px`, `box-shadow: var(--shadow-card)` — mismos tokens que ya usa `scan.html`), no en cards sueltas flotando sobre el fondo menta (`var(--paper)`/`var(--bg)`). Header con logo (`assets/redesign/logo.svg`) + `<h1>` consistente en las 4.

**Componentes reusados tal cual (sin modificar su CSS existente en `styles.css`):**
- `.dietary-icon-grid` + `.dietary-grid-item` (grid 4 columnas, tile con emoji+label) — para dietas en `preferences.html`.
- `.allergen-icon-grid` + `.allergen-grid-item` — para alergias en `preferences.html`.
- `.verdict-sano`/`.verdict-regular`/`.verdict-evitar` — para los badges de veredicto en `history.html`.
- Emoji mapping ya existente: dietas desde `renderDietaryBadges` en `app.js` (🌱 vegano, 🥦 vegetariano, 🥑 keto, 🌾 sin gluten — subconjunto de los 11 ítems existentes, solo se usan los 4 que aplican a `preferences.html`); alergias desde `COMMON_ALLERGENS` (🥜 Cacahuate, 🥛 Lácteos).

**Componentes nuevos (no existen en ningún lado del app todavía):**
- `.hero-card-dark` — card de identidad oscura (fondo `var(--ink)`), usada en `account.html` para email + badge de plan.
- `.stat-tile` — tile de stat (número grande + label), grid 2-up, dentro del panel blanco de `account.html`.
- `.chosen` — modificador de estado persistente ("el usuario declaró esto") sobre `.dietary-grid-item`/`.allergen-grid-item`, distinto semánticamente de `.selected` (que en `scan.html` significa "detalle expandido momentáneamente", no usado en estas páginas nuevas — sin conflicto). Fondo sólido verde (mismo tratamiento que `.db-yes`) + `outline` para contraste doble (color + forma, no solo color).
- `.severity-toggle` — segmentado de 2 botones (Aviso/Estricto), aparece pegado a un alérgeno cuando está `.chosen`.

## Cambios por página

### `account.html` (Perfil)
- Header con logo + "Mi cuenta".
- Panel blanco único conteniendo, en orden: `.hero-card-dark` (icono perfil + email + badge FREE/PREMIUM), fila de 2 `.stat-tile` (Escaneos / Alertas activas), card de upsell (icono 🔔 + texto + botón "Configurar mis preferencias", solo si no-premium), botón "Cerrar sesión".
- **Escaneos**: número real, ver sección Backend.
- **Alertas activas**: derivado del perfil ya cacheado, sin backend nuevo — `(preferences?.allergens?.length || 0) + (preferences?.healthConditions?.length || 0) + (preferences?.dietary?.length || 0)`. Para free (sin `preferences`) siempre 0.

### `preferences.html`
- Header + panel blanco único.
- Disclaimer médico (ya existe) al inicio del panel.
- "Dietas" → `.dietary-icon-grid` con 4 tiles (vegan/vegetarian/keto/glutenFree), click togglea `.chosen`. Reemplaza los 4 `<input type="checkbox">` de dietary.
- "Alergias" → `.allergen-icon-grid` con 2 tiles (cacahuate/lácteos), click togglea `.chosen`; al quedar `.chosen`, aparece debajo un `.severity-toggle` (Aviso/Estricto) para ese alérgeno. Reemplaza checkbox+`<select>` nativo.
- "Condiciones de salud" → mismo patrón de tile+`.chosen` que dietas (4 tiles: diabetes/celiaquía/hipertensión/niños en casa) — sin ícono establecido en el resto del app para estos, se usan emoji genéricos nuevos (a definir en el plan de implementación, ej. 💉🌾❤️👶 — no está en `COMMON_ALLERGENS` ni en `renderDietaryBadges`, es contenido nuevo).
- Bloque de consentimiento LFPDPPP: se queda como está (ya tiene tratamiento visual distinto intencional, requisito legal) — solo homologar radios/bordes al token set.
- Guardar/Borrar: sin cambios funcionales, solo dentro del panel blanco único.
- `buildPreferencesPayload()` en `preferences-ui.js` deja de leer `:checked`/`.value` de inputs nativos y pasa a leer la clase `.chosen`/`data-severity` de los tiles.
- `loadPreferencesIntoForm()` deja de setear `.checked`/`.value` y pasa a agregar/quitar `.chosen` y el estado del `.severity-toggle` según el perfil cacheado.

### `history.html` (Análisis)
- Header + panel blanco único.
- Cada entrada (local o nube): `.row-card` con badge de veredicto real (`.verdict-sano`/`.verdict-regular`/`.verdict-evitar`, mismas clases que `scan.html`).
- Bloque de upsell para free: mismo tratamiento de card que en `account.html` (icono+texto+botón), dentro del panel, ya no el `.history-locked-block` standalone de la ronda anterior.

### `auth.html`
- Header + panel blanco único envolviendo el form completo (ya casi lo tenía desde la ronda de UX previa) — homologar bordes/radios/tipografía a los mismos tokens que las otras 3. Sin hero oscuro ni stats (no hay sesión todavía).

## Backend: contador real de escaneos

- Nuevo campo `usage.totalScans` (número, nunca resetea — distinto de `usage.ocrCount`/`usage.date` que sí resetean diario) en `users/{uid}`.
- Nuevo endpoint `POST /api/me/scan`, montado con `requireUser` (SIN gate premium — a diferencia de `/api/me/history`, este contador debe reflejar el total real para cualquier plan). Reusa `fireIncrementUsageCounter(uid, field)` (Task 8, ya genérico por nombre de campo, con concurrencia optimista y retry).
- Wiring: se llama desde `app.js`, en el mismo punto donde ya se llama `logScanToCloudHistory` (después de calcular el veredicto) — a diferencia de esa función (premium-only, fire-and-forget hacia Firestore), este incremento corre para cualquier usuario logueado, free o premium.

## Testing

- Backend: test para `POST /api/me/scan` (incrementa `totalScans`, funciona en free y premium, 401 si no hay sesión) — mismo patrón de test que `tests/firestore-usage.test.js`/`tests/ocrQuota.test.js`.
- Frontend:
  - `preferences-ui.js`: tests actualizados para `buildPreferencesPayload()`/`loadPreferencesIntoForm()` leyendo/escribiendo `.chosen`/`data-severity` en vez de `:checked`/`.value`.
  - `account-ui.js`: test para el cálculo de "Alertas activas" y el render de `.stat-tile` con el número real de `totalScans` desde el perfil cacheado. Confirmado: `getMeHandler` (`api/index.js:1359`) ya hace spread de todo `user` excepto `preferences` (`const { preferences, ...rest } = user`), así que `usage.totalScans` viaja automático en `GET /api/me` para cualquier plan sin tocar el endpoint.
- Visual: sin regresión automatizada. Verificación manual con Playwright en preview deploy, mismo patrón usado toda la sesión anterior (screenshot + `getBoundingClientRect` para overlaps/scroll).

## Nota de negocio (fuera de alcance, no se resuelve aquí)

No existe checkout/pago real en el codebase — este reskin no lo agrega. Los CTAs "Configurar mis preferencias" (ya con copy honesta desde la ronda de UX anterior) siguen llevando a `preferences.html`, no a un flujo de pago.

## Preguntas abiertas para el plan de implementación

1. Emoji/íconos para "Condiciones de salud" (diabetes/celiaquía/hipertensión/niños en casa) — no existen en el vocabulario visual actual del app, hay que definirlos.
2. Accesibilidad de los tiles `.dietary-grid-item`/`.allergen-grid-item` como controles de selección persistente (en `scan.html` son de solo lectura/expansión momentánea, no un control de formulario) — necesitan `role="button"`/`aria-pressed` ya que reemplazan checkboxes nativos y pierden la semántica de formulario gratis que dan esos elementos.
