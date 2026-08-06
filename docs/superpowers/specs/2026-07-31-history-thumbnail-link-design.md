# Thumbnail + link a scan en historial de la pestaña Análisis

## Contexto

`history.html` (pestaña "Análisis") lista los escaneos del usuario vía `history-ui.js`, en dos ramas según membresía:
- **Local** (`renderLocalHistoryWithUpsell`): usuarios sin membresía activa, lee `window.getLocalHistory()` (localStorage `yomi_history`). Cada item ya trae `.image` (guardado por `saveToHistory` en app.js).
- **Nube** (`renderCloudHistory`): usuarios premium, lee `GET /api/me/history` → Firestore `users/{uid}/history`. El schema actual (`barcode`, `productName`, `verdict`, `scannedAt`) no incluye imagen.

Hoy ninguna de las dos ramas muestra thumbnail ni navega a `scan.html` al hacer click — solo tienen texto + botón de compartir.

## Cambios

### Backend

**`api/index.js` — `postHistoryHandler`**
Acepta `image` opcional en el body (string, URL). Si viene, valida `typeof === 'string'` y longitud ≤ `MAX_IMAGE_URL_LEN = 500`; si excede o no es string, se ignora el campo (no se rechaza la petición completa — la imagen es cosmética, no crítica). Se guarda vía `fireLogUserHistory` igual que el resto de campos (paso genérico por `toFirestoreFields`, sin cambios en `firestore.js`).

**`getHistoryHandler` / `fireListUserHistory`**
Sin cambios — ya retornan todos los campos del doc (`fromFirestoreFields` es genérico), `image` sale incluido automáticamente cuando existe.

**Compatibilidad:** entradas ya guardadas en Firestore sin `image` quedan tal cual (undefined) — el cliente cae a placeholder, sin backfill.

### Cliente — `app.js`

`logScanToCloudHistory(barcode, productName, verdict)` → `logScanToCloudHistory(barcode, productName, verdict, image)`, agrega `image` al body del POST. Se llama pasando `product.image` desde `renderProductData`.

### UI — `history-ui.js`

Ambas ramas (`renderLocalHistoryWithUpsell` y `renderCloudHistory`) comparten un mismo cambio de template por item:

- Thumbnail (~44px, `border-radius` chico) antes del texto: `<img src="${item.image}">` si existe, si no un placeholder SVG inline (mismo ícono genérico de producto que usa `home.js`, duplicado aquí porque `history.html` no comparte scope de script con `home.js`).
- Toda la `row-card` se vuelve clickeable (`role="button"`, `tabindex="0"`, click/Enter/Espacio) → navega a `scan.html?barcode=${barcode}`.
- El botón compartir existente hace `stopPropagation()` en su click para no disparar la navegación de la card.

Campo `barcode` en la rama nube: `GET /api/me/history` ya retorna `barcode` en cada entry (usado hoy solo como `data-barcode` del botón compartir) — se reusa para el link, sin cambios de API adicionales.

## Fuera de alcance

- Backfill de imágenes para entradas históricas sin `image`.
- Cambios al historial de `index.html` (`home.js`) — ya tiene thumbnail y link, sirvió de referencia visual pero no se toca.
