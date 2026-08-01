# Separar Mi cuenta en bloques (Perfil / Preferencias / Suscripción)

## Contexto

`renderAccountHub()` (`account-ui.js:247-315`) hoy renderiza TODO dentro de un único `.content-card`: hero de perfil, banner de verificación, stats, resumen de preferencias, bloque de suscripción/CTA de renovación, datos de cuenta (nombre/teléfono/correo/contraseña) y logout — separados solo por `border-top` de 1px entre filas (`.account-data-row`, `.account-subscription-block`). No hay jerarquía visual entre "esto es tu perfil" vs "esto es tu suscripción" vs "esto son tus preferencias".

## Cambio

`renderAccountHub()` emite 3 bloques (`.content-card` independientes, mismo margen/espaciado que ya provee esa clase — sin CSS nuevo para el layout) más el botón de logout suelto, en vez de un único card:

**Bloque "PERFIL"**: hero-card-dark + `renderEmailVerificationBanner()` + stat-row + `account-data-section` (nombre/teléfono/correo/cambiar contraseña) — todo lo de identidad, tal cual está hoy, solo movido a su propio card.

**Bloque "PREFERENCIAS"**: `.row-card.account-preference-row` (resumen + botón "Editar preferencias") tal cual, en su propio card.

**Bloque "SUSCRIPCIÓN"**: si `isActive`, `renderSubscriptionBlock(profile)`; si no, el CTA de renovación (`.row-card.account-renew`) que hoy vive suelto. Mismo contenido, propio card.

**Logout**: el botón `#btn-logout` sale del último card, queda como elemento suelto después de los 3 bloques (mismo lugar relativo que hoy, al final de la página).

Cada card lleva una etiqueta arriba, reusando el estilo ya existente de `.account-data-label` (uppercase, 0.72rem, `--ink-3`) en vez de introducir una clase nueva — mismo lenguaje tipográfico que ya usa la página para "Suscripción" (`account-data-label` en `renderSubscriptionBlock`, línea 222) y para cada fila de dato.

## Sin cambios

- Ningún dato, texto, lógica de negocio, ni wiring de eventos (`wireAccountHubEvents`) cambia — es puramente reestructurar el HTML/markup de `renderAccountHub`, las funciones `renderSubscriptionBlock`/`renderNameRow`/`renderPhoneRow`/etc. no se tocan.
- CSS: cero reglas nuevas — `.content-card` (home.css:503-508) ya define `margin: 0 20px 16px`, suficiente para separar instancias apiladas sin ajuste adicional.
