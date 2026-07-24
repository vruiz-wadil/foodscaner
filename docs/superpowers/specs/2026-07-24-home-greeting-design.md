# Saludo personalizado en el home ("Hola {nombre},")

## Problema

`index.html` siempre muestra el mismo subtítulo estático ("Escanea y lo sabrás en segundos."), sin importar quién inició sesión, aunque el nombre del usuario ya está disponible en el perfil sincronizado (mismo dato que ya se usa en `account-ui.js`).

## Diseño

En `home.js`, dentro del listener `DOMContentLoaded` existente (línea ~118-122), justo después de `const profile = window.authClient ? await window.authClient.syncUserProfile() : null;`:

- Se extrae `displayName` con la misma lógica que `account-ui.js`: `(profile.profile && profile.profile.displayName) || profile.displayName || ''`.
- Si `displayName` no está vacío, se reemplaza el `textContent` de `.heading-sub` por `"Hola ${displayName}, escanea y lo sabrás en segundos."`. Se usa `textContent` (no `innerHTML`), por lo que no hace falta escapar el nombre — no hay riesgo de inyección de markup.
- Si no hay `displayName` (sin sesión, o perfil recién creado que aún no lo tiene), el subtítulo se queda con el texto original ya presente en `index.html` — no se toca el DOM.
- El título `<h1 class="heading-title">¿Puedo comerlo?</h1>` no cambia en ningún caso.

## Qué NO cambia

- No hay cambios de backend, CSS, ni de otros archivos.
- No afecta el flujo de redirect por onboarding incompleto (`redirectTargetForIncompleteOnboarding`), que sigue usando el mismo `profile` ya obtenido.

## Archivos afectados

- Modifica: `home.js` (dentro del `DOMContentLoaded` existente)
- Modifica: `tests/home.test.js` (nuevo caso de prueba para el saludo con/sin nombre)
