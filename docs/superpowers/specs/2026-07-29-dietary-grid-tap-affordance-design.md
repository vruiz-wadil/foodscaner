# Afordancia visual del grid "Tipo de Dieta" — Diseño

## Contexto

El usuario reportó que el texto "Toca un ícono para ver el detalle de cada clasificación." (sección "Tipo de Dieta" en `scan.html`) y el mecanismo de tap-para-expandir no son claros para usuarios poco familiarizados con tecnología (especialmente adultos mayores).

Un walkthrough de persona (adulto mayor con diabetes tipo 2, primera vez usando la sección) confirmó dos causas raíz concretas:
1. El texto de ayuda usa jerga ("ícono", "clasificación") y tiene bajo contraste visual (`0.72rem`, gris `#6b6b6b`) frente al grid de colores saturados que describe — se pierde en el escaneo visual.
2. Ningún botón del grid comunica individualmente que es tocable — el único indicio hoy es un subrayado punteado de `1px` bajo la etiqueta, a `0.65rem`, prácticamente invisible sin acercar el teléfono. La barrera ocurre ANTES de tocar, no en la interacción misma.

Este spec cubre los 3 quick-wins acordados (de una lista de 7 recomendaciones del walkthrough): reescribir el hint, subir su contraste/tamaño, y agregar una señal visual de "toca aquí" en cada botón del grid. Los demás puntos (demo automática la primera vez, etiqueta "IA estimó" visible, reordenar el grid por preferencias del usuario) quedan explícitamente fuera de alcance — no se tocan en este plan.

## Diseño

- **Copy del hint** (`scan.html`, `#dietary-hint`): cambia de `"Toca un ícono para ver el detalle de cada clasificación."` a `"👉 Toca cualquier cuadro de color para saber qué significa"`. Reemplaza "ícono" (jerga de apps del celular) por "cuadro de color" (descripción literal de lo que el usuario ve), y "detalle de cada clasificación" por "qué significa" (registro conversacional, no de ficha técnica). El emoji 👉 apunta hacia abajo, conectando físicamente la instrucción con el grid.
- **Contraste/tamaño del hint** (`styles.css`, regla `.dietary-hint`): sube de `font-size: 0.72rem; color: #6b6b6b;` a un tratamiento más prominente — `font-size: 0.85rem`, `font-weight: 600`, color `var(--ink-3)` o más oscuro (a definir el valor exacto en el plan contra las variables ya existentes en `styles.css`, sin inventar un color nuevo).
- **Badge "toca aquí" por botón** (`app.js`, función `renderDietaryBadges`): cada botón del grid (`.dietary-grid-item`) gana un `<span>` con emoji `👆`, posicionado en la esquina superior izquierda (la derecha ya la ocupa el badge `🤖` cuando el estado es `ai-yes`/`ai-no`). Se agrega a **todos** los botones sin excepción, `aria-hidden="true"` (es puramente visual — el botón ya comunica su función a lectores de pantalla vía `aria-expanded`/`aria-controls`/el `state-text` existente, este badge no debe duplicarse en voz).
- **CSS de soporte** (`styles.css`): la regla base `.dietary-grid-item` gana `position: relative;` (hoy solo las variantes `.ai-yes`/`.ai-no` lo tienen) para que el nuevo badge se posicione correctamente sobre cualquier estado del botón, no solo los de IA. Nueva regla `.dietary-grid-item .tap-badge` (mismo patrón visual que `.ai-badge` ya existente: `position: absolute; font-size: 0.65rem; line-height: 1;`, pero `left: -6px` en vez de `right: -6px`).

## Fuera de alcance

- Demo automática (auto-expandir el primer ítem al entrar a la pantalla).
- Etiqueta de texto "IA estimó" visible en el botón (hoy es textura+emoji).
- Reordenar el grid según las preferencias de dieta ya configuradas por el usuario.
- Cualquier cambio a la leyenda (`allergen-legend dietary-legend`) o a su orden respecto al grid.
- Cualquier cambio al panel de detalle (`#dietary-detail-panel`) o a su contenido.

## Testing

- Confirmado: no hay tests automatizados existentes para `renderDietaryBadges` ni para el markup de esta sección de `scan.html` (`tests/` no tiene ningún archivo que los referencie). Este cambio se verifica manualmente, consistente con el patrón ya usado en otras partes de este proyecto sin cobertura de UI (ej. `admin.js`, `preferences.html`).
- Verificación manual: abrir `scan.html` con un producto escaneado, confirmar visualmente que el hint es más legible, que cada botón del grid muestra el badge 👆 en la esquina superior izquierda (sin chocar con el 🤖 en los botones de IA), y que un lector de pantalla no anuncia el emoji del badge (solo el `aria-label`/`state-text` ya existente).
