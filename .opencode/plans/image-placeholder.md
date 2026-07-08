# Plan: Image Placeholder Unificado

## Problema
3 lugares manejan imagen de producto de forma inconsistente:
- `home.js:21` — `onerror` usa `#img-placeholder-tpl` que NO existe en DOM → crashea
- `scan.html:182` — `onerror` con SVG inline data URI (encoding frágil)
- `scan.html:122` — sin `onerror` → imagen rota del browser

## Solución
Crear función `placeholderSvg()` que devuelva el SVG correcto, y usarla en los 3 lugares.

### SVG placeholder
Mismo ícono que ya existe: rectángulo + círculo + polilínea (cámara con imagen), color `#888` stroke, fondo `#f5f5f5`.

### Cambios

#### 1. `app.js` — función `placeholderSvg()`
```js
function placeholderSvg() {
  return "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>');
}
```

#### 2. `app.js:1469-1474` — `renderProductData()`
```js
// Antes:
if (product.image) {
  productImg.src = product.image;
  productImg.alt = product.name;
} else {
  productImg.src = "";
}

// Después:
productImg.src = product.image || placeholderSvg();
productImg.alt = product.name || "";
```

#### 3. `app.js:1476-1478` — sidebar img
```js
// Antes:
sidebarImg.src = product.image || "";

// Después:
sidebarImg.src = product.image || placeholderSvg();
```

#### 4. `scan.html:182` — #product-img
Quitar el `onerror` inline (ya no hace falta porque `app.js` setea el fallback antes).

```html
<!-- Antes: -->
<img id="product-img" src="" alt="Imagen del producto" onerror="this.src='data:image/svg+xml;utf8,...'">

<!-- Después: -->
<img id="product-img" src="" alt="Imagen del producto">
```

#### 5. `scan.html:122` — #sidebar-img
No necesita cambio — `app.js` ya setea `placeholderSvg()`.

#### 6. `home.js:19-28` — `imgHtml()`
```js
// Antes:
function imgHtml(item) {
  if (item.image) {
    return `<img class="product-card-img" src="${item.image}" alt="" onerror="this.replaceWith(document.querySelector('#img-placeholder-tpl').content.cloneNode(true))">`;
  }
  return `<div class="product-card-img-placeholder">...</div>`;
}

// Después:
function imgHtml(item) {
  if (item.image) {
    return `<img class="product-card-img" src="${item.image}" alt="" onerror="this.onerror=null;this.src='${placeholderSvg()}'">`;
  }
  return `<div class="product-card-img-placeholder">...</div>`;
}
```

Nota: `home.js` no tiene acceso a `placeholderSvg()` de `app.js` (son archivos separados). Opciones:
- **A)** Duplicar la función en `home.js` (2 líneas)
- **B)** Mover a un `utils.js` compartido
- **C)** Definir inline en `home.js` con la data URI directa

Recomendación: **Opción A** — es una función de 2 líneas, no vale la pena crear un archivo nuevo.

## Archivos a modificar
- `app.js` — agregar `placeholderSvg()` + usar en renderProductData
- `scan.html` — quitar `onerror` inline de #product-img
- `home.js` — reemplazar `onerror` roto

## Verificación
1. `npx vitest run` — 61 tests
2. `node -c app.js` — syntax check
3. Probar visualmente: producto sin imagen → muestra placeholder gris en home, scanner, y sidebar
