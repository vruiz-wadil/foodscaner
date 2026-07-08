# Plan: Favicon + PWA Completa

## Objetivo
Agregar favicon, manifest.json, service worker y meta tags PWA para que Yomi funcione como app instalable con cache offline.

## Archivos a crear

### 1. `assets/icons/favicon.svg`
Favicon SVG simplificado basado en el logo actual (checkmark + 3 líneas de barcode, colores #2DBC9E y #F5A623).

### 2. `assets/icons/generate-icons.js`
Script Node.js que genera PNGs desde el SVG usando `sharp`:
- `favicon-16x16.png`
- `favicon-32x32.png`
- `apple-touch-icon.png` (180x180)
- `icon-192x192.png`
- `icon-512x512.png`

Se ejecuta una vez (`node assets/icons/generate-icons.js`). Los PNGs se commitean.

### 3. `manifest.json`
```json
{
  "name": "Yomi — ¿Puedo comerlo?",
  "short_name": "Yomi",
  "description": "Escanea y lo sabrás en segundos.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#EAF9F6",
  "theme_color": "#2DBC9E",
  "icons": [
    { "src": "/assets/icons/icon-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/assets/icons/icon-512x512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### 4. `sw.js` (service worker en root)
Estrategia:
- ** estático** (HTML, CSS, JS, icons): Cache-first con cache name versionado
- **API calls** (/api/*): Network-first, fallback a cache si offline
- **Imágenes**: Cache-first
- **Eliminación de caches antiguos** en `activate`

### 5. Meta tags en `index.html` y `scan.html`
```html
<link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/icons/favicon-32x32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/assets/icons/favicon-16x16.png" sizes="16x16" type="image/png">
<link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#2DBC9E">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Yomi">
```

### 6. Registro del service worker
En `index.html` (home):
```html
<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
</script>
```

En `scan.html` (scanner): **NO registrar SW** — el scanner necesita network para API calls y el SW podría interferir con los decoders WASM.

## Archivos a modificar
- `index.html` — meta tags + SW registration
- `scan.html` — meta tags (sin SW registration)

## Archivos a crear
- `assets/icons/favicon.svg`
- `assets/icons/generate-icons.js`
- `assets/icons/icon-192x192.png` (generado)
- `assets/icons/icon-512x512.png` (generado)
- `assets/icons/apple-touch-icon.png` (generado)
- `assets/icons/favicon-16x16.png` (generado)
- `assets/icons/favicon-32x32.png` (generado)
- `manifest.json`
- `sw.js`

## Dependencia
Necesita `sharp` instalado globalmente o como devDependency para generar PNGs. Alternativa: crear PNGs manualmente o usar otro método.

## Verificación
1. Abrir Chrome DevTools > Application > Manifest — verificar que carga
2. Chrome DevTools > Application > Service Workers — verificar registro
3. Lighthouse audit > PWA score
4. Probar instalación en Android (Chrome > Añadir a pantalla)
5. Probar en iOS Safari (Compartir > Añadir a pantalla de inicio)
6. `npm test` — 61 tests sin cambios
