# Compartir resultado de escaneo a redes sociales

## Contexto / motivación

El usuario quiere poder compartir el resultado de un escaneo (producto + veredicto SANO/REGULAR/EVITAR) a redes sociales/WhatsApp, tanto desde el resultado recién escaneado (`scan.html`) como desde entradas del historial (`history.html`). No existe ninguna funcionalidad de compartir hoy en el proyecto.

## Alcance

- Botón "Compartir" en `scan.html`, dentro de `#result-success`, justo debajo de `#verdict-banner`.
- Ícono de compartir por cada `row-card` de `history-ui.js` (ambas ramas: historial local gratis y historial cloud premium).
- Formato: texto + link, vía Web Share API nativo del navegador (abre el share sheet del sistema — WhatsApp, Instagram, etc. aparecen solos, sin integraciones por plataforma).
- Fuera de alcance explícito: generar una imagen/tarjeta visual, crear una página pública por escaneo, compartir con razón/motivo detallado (solo producto + veredicto + link).

## Compatibilidad de navegador

`navigator.share()` — soporte completo en Safari iOS (desde 12.2) y macOS desktop (desde 12.1), Chrome Android, Edge (93+). Hueco real: Firefox desktop (deshabilitado por default en todas las versiones) y Chrome desktop viejo (parcial hasta v127, completo desde v128). Dado que Yomi es una PWA de cámara/escaneo de uso mayormente móvil, el hueco afecta poco; se cubre con un fallback de copiar al portapapeles.

## Arquitectura

Módulo nuevo `share.js`, standalone (sin imports de Firebase/backend, sin llamadas de red — Web Share API y Clipboard API son APIs nativas del navegador). Exporta `shareResult({ name, verdict }, triggerButton)`, reusado por `app.js` (scan.html) e `history-ui.js` (history.html). Cero cambios de backend, cero endpoints nuevos, cero entradas de CSP nuevas.

## Texto y link compartido

```js
const VERDICT_LABELS = { sano: 'SANO', regular: 'REGULAR', evitar: 'EVITAR' };
const SHARE_URL = 'https://yomi.mx/?utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result';

function buildShareText(name, verdict) {
  return `${name}: ${VERDICT_LABELS[verdict]} — descúbrelo tú con Yomi`;
}
```

Ejemplo: "Gamesa Emperador: EVITAR — descúbrelo tú con Yomi". El link lleva UTM fijo (`utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result`) para poder medir tráfico proveniente de shares — mismo link genérico para cualquier producto, no hay página pública por escaneo.

La palabra de veredicto (SANO/REGULAR/EVITAR) es un texto plano distinto del texto con emoji que ya usa `#verdict-banner` en pantalla ("✓ Puedes comerlo", etc.) — ese es para la UI, este es para compartir, no se reutiliza el mismo string.

## Componentes

### `share.js` (nuevo)

```js
const VERDICT_LABELS = { sano: 'SANO', regular: 'REGULAR', evitar: 'EVITAR' };
const SHARE_URL = 'https://yomi.mx/?utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result';

export function buildShareText(name, verdict) {
  return `${name}: ${VERDICT_LABELS[verdict]} — descúbrelo tú con Yomi`;
}

async function copyFallback(text, triggerButton) {
  const full = `${text} ${SHARE_URL}`;
  try {
    await navigator.clipboard.writeText(full);
    if (triggerButton) {
      const original = triggerButton.textContent;
      triggerButton.textContent = 'Copiado';
      setTimeout(() => { triggerButton.textContent = original; }, 2000);
    }
  } catch (e) {
    console.warn('[share] clipboard fallback failed:', e.message);
  }
}

export async function shareResult({ name, verdict }, triggerButton) {
  const text = buildShareText(name, verdict);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Yomi', text, url: SHARE_URL });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // usuario canceló el share sheet, no es error
      // cualquier otro fallo de navigator.share cae a clipboard
    }
  }
  await copyFallback(text, triggerButton);
}
```

### `scan.html` / `app.js`

Botón `<button id="btn-share-result" class="btn btn-secondary">Compartir</button>` dentro de `#result-success`, después de `#verdict-banner` y su disclaimer. En `renderProductData(product, barcode)`, después de calcular `verdict`:

```js
const btnShare = document.getElementById('btn-share-result');
if (btnShare) {
  btnShare.onclick = () => shareResult({ name: product.name, verdict }, btnShare);
}
```

`app.js` importa `shareResult` desde `share.js`.

### `history-ui.js`

Un ícono/botón de compartir por `row-card`, en ambas funciones de render:

- `renderLocalHistoryWithUpsell`: `{ name: h.name, verdict: h.rating }`.
- `renderCloudHistory`: `{ name: h.productName, verdict: h.verdict }`.

Se normaliza el nombre de campo en el momento de armar cada `row-card` — no se toca el shape existente de `getHistory()` ni de `/api/me/history`.

## Manejo de errores

| Caso | Comportamiento |
|---|---|
| `navigator.share()` cancelado por el usuario | `AbortError`, silencioso, no hace nada |
| `navigator.share()` falla por otra razón | Cae a clipboard |
| Sin `navigator.share` (Firefox desktop, Chrome desktop viejo) | Va directo a clipboard |
| Clipboard también falla/no existe | `console.warn`, sin UI de error — best-effort, nunca bloquea el flujo de escaneo |

Compartir nunca es parte de una ruta crítica — si todo falla, el usuario simplemente no ve la confirmación "Copiado", pero nada más se rompe.

## Testing

`share.js` es función pura, fácil de testear con mocks de `navigator.share`/`navigator.clipboard.writeText`:

1. Share nativo exitoso → `navigator.share` llamado con `{ title, text, url }` correctos, clipboard nunca se toca.
2. Usuario cancela (`AbortError`) → no cae a clipboard, no hay error visible.
3. `navigator.share` falla por otra razón → cae a clipboard.
4. Sin `navigator.share` → va directo a clipboard.
5. Texto exacto generado por veredicto (`buildShareText` con los 3 valores: sano/regular/evitar).
6. Fallback clipboard actualiza el texto del botón a "Copiado" y lo revierte después.

Se extiende el test existente de `history-ui.js` para cubrir el botón nuevo en ambas ramas (local/cloud), verificando que `shareResult` se llama con los campos normalizados correctos (`name`/`verdict` derivados de `h.name`/`h.rating` o `h.productName`/`h.verdict` según la rama).

## Qué NO cambia

Backend (`api/index.js`, `api/firestore.js`), CSP (ninguna entrada nueva — sin llamadas de red), shape de `getHistory()`/`/api/me/history`, `computeVerdict()`, `#verdict-banner` y su texto con emoji.
