# Redirigir a Mi cuenta al guardar preferencias

## Problema

Al editar preferencias alimenticias desde `account.html` → "Editar preferencias" → `preferences.html`, guardar solo muestra un toast y se queda en la misma pantalla. El usuario quiere volver a Mi cuenta automáticamente tras guardar.

## Diseño

### Mecanismo compartido: toast pendiente entre páginas

`toast.js` gana dos funciones nuevas, además de la ya existente `showToast`:

- `setPendingToast(message)` — guarda `message` en `sessionStorage` bajo la key `yomi_pending_toast`.
- `showPendingToast()` — lee esa key; si hay mensaje, lo muestra vía `showToast(message)` y limpia la key; si no hay nada, no hace nada.

Mecanismo genérico (no específico de preferencias), pensado para cualquier flujo futuro de "redirige y confirma en la página destino".

### `preferences-ui.js` — `savePreferences()`

Solo afecta el camino de EDICIÓN (`savePreferences`, usado cuando `!isOnboarding()`). El camino de onboarding (`continueOnboardingPreferences`) no cambia — sigue redirigiendo a `onboarding-membership.html` sin tocar esto.

Tras el `PUT /api/me/preferences` exitoso, en vez de `showToast('Preferencias guardadas.')`:

```js
setPendingToast('Preferencias guardadas.');
window.location.href = 'account.html';
```

### `account-ui.js`

Importa `showPendingToast` de `./toast.js`. La llama dentro del `DOMContentLoaded` existente, junto a `renderAccountHub()`:

```js
document.addEventListener('DOMContentLoaded', async () => {
  await syncUserProfile();
  renderAccountHub();
  showPendingToast();
});
```

## Qué NO cambia

- El flujo de onboarding de preferencias (`continueOnboardingPreferences`, `skipOnboardingPreferences`).
- El manejo de errores de `savePreferences()` (`showError`, sin toast).
- `deletePreferences()` y su `showSuccess()` inline — sin redirect, fuera de alcance.
- El endpoint `PUT /api/me/preferences` — sin cambios de backend.

## Archivos afectados

- Modifica: `toast.js` (nuevas funciones `setPendingToast`, `showPendingToast`).
- Modifica: `preferences-ui.js` (`savePreferences`).
- Modifica: `account-ui.js` (`DOMContentLoaded`).
- Modifica: `tests/preferences-ui.test.js` (reescribe el test de toast de `savePreferences`).
- Modifica: `tests/account-ui.test.js` (nuevo test para `showPendingToast` en carga).
- Modifica: `tests/toast.test.js` (ya existe — agrega tests para `setPendingToast`/`showPendingToast`).
