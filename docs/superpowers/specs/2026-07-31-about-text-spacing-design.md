# Espacio entre `.about-text` y el botón que le sigue

## Contexto

`.about-text { margin: 0 }` (home.css:183-188) — sin margen inferior. Se reusa en 4 lugares seguido de un `<a class="btn">`/`<button class="btn">` sin margen propio: el upsell "Configurar mis preferencias" en `history-ui.js:60-62`, el CTA de renovar/activar membresía en `account-ui.js:313`, y el aviso de correo sin verificar en `account-ui.js:35` (seguido de un botón de reenvío). En los 3, el botón queda pegado al texto.

## Cambio

`.about-text` gana `margin: 0 0 10px;` (home.css:183-188) — fix global, no por-instancia. `10px` porque es el gap ya usado en varios `.row-card`/spacing de esta misma hoja (consistente con el resto del ritmo vertical de la página).

## Fuera de alcance

- `index.html:63` también usa `.about-text` pero sin botón inmediatamente después — el margen extra no le afecta negativamente, no requiere cambio aparte.
