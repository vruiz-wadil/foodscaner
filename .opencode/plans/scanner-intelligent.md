# Plan: Scanner Inteligente — Opción 1 + 3

## Objetivo
Mejorar la decodificación de códigos de barras en dispositivos con problemas (iPhone, webcams Edge, cámaras de baja resolución).

## Cambios a implementar en `app.js`

### 1. Nuevas variables de estado (agregar después de línea 144)
```js
// Smart scanner state
let scanFrameCount = 0;
let prevFrameHash = null;
let lastDecoded = null;
let confirmCount = 0;
let scanStartTime = 0;
let scanTimeoutId = null;
let invalidAttempts = 0;
let audioCtx = null;
let lastZbarRetry = 0;
```

### 2. Reescribir `tick()` (líneas 426-451)
```js
const tick = () => {
  if (!isScanning) return;
  if (detecting || video.readyState < 2 || !video.videoWidth) {
    nativeScanRafId = requestAnimationFrame(tick);
    return;
  }

  scanFrameCount++;

  // Throttle: procesar 1 de cada 3 frames
  if (scanFrameCount % 3 !== 0) {
    nativeScanRafId = requestAnimationFrame(tick);
    return;
  }

  // Canvas 800px (no 1920)
  const maxW = 800;
  const scale = Math.min(1, maxW / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Motion detection: muestrear 16 puntos
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const hash = quickHash(imageData);
  if (prevFrameHash !== null && hashDiff(prevFrameHash, hash) < 0.05) {
    nativeScanRafId = requestAnimationFrame(tick);
    return;
  }
  prevFrameHash = hash;

  detecting = true;

  // Ambos decoders en PARALELO
  const decoders = [decodeNative(detector, canvas)];
  if (window.zbarWasm && typeof window.zbarWasm.scanImageData === 'function' && !window._zbarFailed) {
    decoders.push(decodeZbar(imageData));
  }

  Promise.any(decoders)
    .then(code => {
      detecting = false;
      if (!isScanning) return;
      // Multi-frame confirmation
      if (code === lastDecoded) {
        confirmCount++;
      } else {
        lastDecoded = code;
        confirmCount = 1;
      }
      if (confirmCount >= 2) {
        if (!onBarcodeDetected(code)) nativeScanRafId = requestAnimationFrame(tick);
      } else {
        nativeScanRafId = requestAnimationFrame(tick);
      }
    })
    .catch(() => {
      detecting = false;
      lastDecoded = null;
      confirmCount = 0;
      if (isScanning) nativeScanRafId = requestAnimationFrame(tick);
    });
};
```

### 3. Funciones helper para motion detection (agregar antes de `tick`)
```js
function quickHash(imageData) {
  const d = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  let sum = 0;
  const points = [
    [w*0.25, h*0.25], [w*0.5, h*0.25], [w*0.75, h*0.25],
    [w*0.25, h*0.5],  [w*0.5, h*0.5],  [w*0.75, h*0.5],
    [w*0.25, h*0.75], [w*0.5, h*0.75], [w*0.75, h*0.75],
    [w*0.1, h*0.1],   [w*0.9, h*0.1],  [w*0.1, h*0.9],
    [w*0.9, h*0.9],   [w*0.5, h*0.1],  [w*0.5, h*0.9],
    [w*0.33, h*0.33]
  ];
  for (const [x, y] of points) {
    const i = (Math.floor(y) * w + Math.floor(x)) * 4;
    sum += d[i] + d[i+1] + d[i+2];
  }
  return sum;
}

function hashDiff(a, b) {
  return Math.abs(a - b) / (a || 1);
}
```

### 4. Modificar `decodeZbar` — retry periódico (línea 377)
```js
// Cambiar la línea de _zbarFailed check:
function decodeZbar(imageData) {
  const zw = window.zbarWasm;
  // Retry cada 5 segundos en vez de permanentemente
  if (window._zbarFailed) {
    if (Date.now() - lastZbarRetry < 5000) return Promise.reject('ZBar: previamente falló');
    lastZbarRetry = Date.now();
    window._zbarFailed = false;
  }
  if (!zw || typeof zw.scanImageData !== 'function') {
    window._zbarFailed = true;
    return Promise.reject('ZBar: scanImageData=' + typeof zw?.scanImageData);
  }
  try {
    return zw.scanImageData(imageData).then(syms => {
      for (const s of syms) { const v = s.decode(); if (v) return v; }
      return Promise.reject('ZBar: código no encontrado');
    }, err => {
      const msg = err?.message || err || '';
      if (msg.includes('abort') || msg.includes('Abort')) window._zbarFailed = true;
      return Promise.reject('ZBar: ' + msg);
    });
  } catch (e) {
    const msg = e?.message || e || '';
    if (msg.includes('abort') || msg.includes('Abort')) window._zbarFailed = true;
    return Promise.reject('ZBar: ' + msg);
  }
}
```

### 5. Reutilizar AudioContext en `onBarcodeDetected` (líneas 353-365)
```js
// Reemplazar el bloque try/catch de audio:
try {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.value = 0.3;
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.15);
} catch (e) { /* audio not available */ }
```

### 6. Tracking de fallos en `onBarcodeDetected` (línea 349-350)
```js
function onBarcodeDetected(rawCode) {
  const result = validateBarcode(rawCode);
  if (!result.valid) {
    invalidAttempts++;
    return false;
  }
  // ... resto igual
}
```

### 7. Timeout dinámico — agregar en `startScanningNative` después del `startScanning`
```js
// Después de nativeScanRafId = requestAnimationFrame(tick);
scanStartTime = Date.now();
invalidAttempts = 0;
scanTimeoutId = setInterval(() => {
  if (!isScanning) { clearInterval(scanTimeoutId); return; }
  const elapsed = Date.now() - scanStartTime;
  if (elapsed > 15000 && scanHintEl) {
    scanHintEl.textContent = '¿No funciona? Ingresa el código manualmente ↑';
  }
  if (invalidAttempts >= 3 && scanHintEl) {
    scanHintEl.textContent = 'Código dañado, ingresa manualmente ↑';
  }
}, 1000);
```

### 8. Limpiar timeout en `stopScanningNative` (agregar al inicio)
```js
function stopScanningNative() {
  if (scanTimeoutId) { clearInterval(scanTimeoutId); scanTimeoutId = null; }
  lastDecoded = null;
  confirmCount = 0;
  prevFrameHash = null;
  // ... resto igual
}
```

## Archivos a modificar
- `app.js` — todos los cambios anteriores

## No modificar
- `scan.html` — sin cambios
- `styles.css` — sin cambios

## Verificación
1. `npm test` — 61 tests deben pasar
2. `node -c app.js` — syntax check
3. Deploy a Vercel
4. Probar en Firefox desktop + Safari iPhone
