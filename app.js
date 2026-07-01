/* ==========================================================================
   Yomi Core JavaScript Logic
   ========================================================================== */

function esc(s) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(s)));
  return div.innerHTML;
}

function placeholderSvg() {
  return "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>');
}

// Global state
let currentBarcode = null;
let currentScanLogId = null;

// DOM Elements
const btnToggleCamera = document.getElementById("btn-toggle-camera");
const cameraSelect = document.getElementById("camera-select");
const barcodeForm = document.getElementById("barcode-form");
const barcodeInput = document.getElementById("barcode-input");
const scannerView = document.getElementById("interactive-scanner");

const resultEmpty = document.getElementById("result-empty");
const resultLoading = document.getElementById("result-loading");
const resultRejected = document.getElementById("result-rejected");
const resultSuccess = document.getElementById("result-success");

// Result Elements (Success)
const productImg = document.getElementById("product-img");
const productName = document.getElementById("product-name");
const productBrand = document.getElementById("product-brand");
const productBarcode = document.getElementById("product-barcode");
const productSidebar = document.getElementById("product-sidebar");
const sidebarImg = document.getElementById("sidebar-img");
const sidebarName = document.getElementById("sidebar-name");
const sidebarBrand = document.getElementById("sidebar-brand");
const sidebarBarcode = document.getElementById("sidebar-barcode");
const scannerWrapper = document.querySelector(".scanner-wrapper");
const torchBtn        = document.getElementById('btn-torch');
const zoomWrap        = document.getElementById('zoom-wrapper');
const cameraHud       = document.getElementById('camera-hud');
const btnCameraSwitch = document.getElementById('btn-camera-switch');
const caloriesVal = document.getElementById("calories-val");
const caloriesProgress = document.getElementById("calories-progress");
const caloriesLevel = document.getElementById("calories-level");
const cardCalories = document.getElementById("card-calories");
const sugarsVal = document.getElementById("sugars-val");
const sugarsProgress = document.getElementById("sugars-progress");
const sugarsLevel = document.getElementById("sugars-level");
const cardSugars = document.getElementById("card-sugars");
const proteinsVal = document.getElementById("proteins-val");
const proteinsProgress = document.getElementById("proteins-progress");
const proteinsLevel = document.getElementById("proteins-level");
const cardProteins = document.getElementById("card-proteins");
const allergensList = document.getElementById("allergens-list");
const allergensSafeMsg = document.getElementById("allergens-safe-msg");
const noNutritionAlert = document.getElementById("no-nutrition-alert");
const analysisGrid = document.getElementById("analysis-grid");
const cardCarbs = document.getElementById("card-carbs");
const carbsVal = document.getElementById("carbs-val");
const carbsNet = document.getElementById("carbs-net");
const carbsProgress = document.getElementById("carbs-progress");
const carbsLevel = document.getElementById("carbs-level");
const cardSellos = document.getElementById("card-sellos");
const sellosContainer = document.getElementById("sellos-container");
const cardAllergens = document.getElementById("card-allergens");

// Result Elements (Rejected)
const rejectedTitle = document.getElementById("rejected-title");
const rejectedMessage = document.getElementById("rejected-message");
const rejectedProductName = document.getElementById("rejected-product-name");
const rejectedProductCategory = document.getElementById("rejected-product-category");

let currentBarcodeQuery = "";
let currentDataSources = "";

const COMMON_ALLERGENS = [
  { emoji: "🥛", label: "Lácteos", match: ["leche", "lácteos", "lactosa", "milk", "dairy"] },
  { emoji: "🥜", label: "Cacahuate", match: ["cacahuate", "cacahuete", "maní", "peanut"] },
  { emoji: "🌰", label: "Nueces", match: ["nueces", "nuez", "frutos de cáscara", "almendra", "almond", "nut"] },
  { emoji: "🌾", label: "Trigo", match: ["trigo", "wheat"], checkGluten: true },
  { emoji: "🥚", label: "Huevo", match: ["huevo", "huevos", "egg"] },
  { emoji: "🐟", label: "Pescado", match: ["pescado", "fish"] },
  { emoji: "🦐", label: "Mariscos", match: ["crustáceo", "crustacean", "molusco", "mollusc", "mariscos"] },
  { emoji: "🫘", label: "Soja", match: ["soja", "soya", "soy", "soybean"] }
];

const EXTRA_ALLERGEN_ICONS = {
  "mostaza": "🫙", "mustard": "🫙",
  "sésamo": "🌱", "sesamo": "🌱", "sesame": "🌱",
  "sulfito": "🧪", "sulfite": "🧪", "sulphur": "🧪",
  "crustáceo": "🦀", "crustacean": "🦀",
  "molusco": "🐚", "mollusc": "🐚",
  "altramuz": "🌸", "lupin": "🌸",
  "apio": "🥬", "celery": "🥬"
};

// ── Barcode validation ────────────────────────────────────────

function eanChecksum(code) {
  const n = code.length;
  let sum = 0;
  for (let i = 0; i < n - 1; i++) {
    const w = ((n - 1 - i) % 2 === 0) ? 1 : 3;
    sum += parseInt(code[i]) * w;
  }
  return (10 - (sum % 10)) % 10 === parseInt(code[n - 1]);
}

function expandUpcE(code) {
  // code: 8 chars [S, d0, d1, d2, d3, d4, d5, E]
  const S = code[0], E = code[7];
  const d = code.slice(1, 7);
  const last = d[5];
  let expanded;
  if (last <= '2') {
    expanded = `${S}${d[0]}${d[1]}${last}0000${d[2]}${d[3]}${d[4]}${E}`;
  } else if (last === '3') {
    expanded = `${S}${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}${E}`;
  } else if (last === '4') {
    expanded = `${S}${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}${E}`;
  } else {
    expanded = `${S}${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${last}${E}`;
  }
  return expanded;
}

function validateBarcode(raw) {
  const code = raw.replace(/[\s\-]/g, '');
  if (!/^\d+$/.test(code)) return { valid: false };
  const n = code.length;
  if (n !== 8 && n !== 12 && n !== 13) return { valid: false };
  if (eanChecksum(code)) return { valid: true, code };
  if (n === 8 && code[0] === '0') {
    const expanded = expandUpcE(code);
    if (eanChecksum(expanded)) return { valid: true, code: expanded };
  }
  return { valid: false };
}

// Application Scanner State
let isScanning = false;
let nativeScanRafId = null;
let nativeScanStream = null;
let torchOn = false;

// Smart scanner state
let scanFrameCount = 0;
let prevFrameHash = null;
let scanStartTime = 0;
let scanTimeoutId = null;
let invalidAttempts = 0;
let audioCtx = null;
let lastZbarRetry = 0;
// Initialize Application
// ── Scan History (localStorage, max 5) ───────────────
function saveToHistory(barcode, name, brand, image) {
  const history = getHistory().filter(h => h.barcode !== barcode);
  history.unshift({ barcode, name, brand, image: image || '' });
  if (history.length > 5) history.length = 5;
  localStorage.setItem("yomi_history", JSON.stringify(history));
  renderHistory();
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem("yomi_history")) || []; } catch { return []; }
}

function renderHistory() {
  const container = document.getElementById("scan-history-list");
  if (!container) return;
  const history = getHistory();
  if (!history.length) {
    container.innerHTML = '<p class="history-empty">Sin escaneos recientes</p>';
    return;
  }
  container.innerHTML = history.map(h => `
    <button class="history-item" data-barcode="${h.barcode}">
      ${h.image ? `<img class="history-thumb" src="${h.image}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<span class="history-thumb history-thumb-empty"></span>'}
      <span class="history-text">
        <span class="history-name">${h.name || "Producto"}</span>
        <span class="history-meta">${h.brand ? h.brand + " · " : ""}${h.barcode}</span>
      </span>
    </button>
  `).join("");
}

document.addEventListener("DOMContentLoaded", () => {
  // Disclaimer gate — show on first visit, persist acceptance in localStorage
  const DISCLAIMER_KEY = 'yomi_disclaimer_accepted';
  const dm = document.getElementById('disclaimer-modal');
  if (dm && !localStorage.getItem(DISCLAIMER_KEY)) {
    dm.classList.remove('hidden');
    document.getElementById('disclaimer-accept').onclick = () => {
      localStorage.setItem(DISCLAIMER_KEY, '1');
      dm.classList.add('hidden');
    };
  }

  setupEventListeners();
  const params = new URLSearchParams(location.search);
  const bc = params.get('barcode');
  if (bc) analyzeBarcode(bc.trim());
  else if (params.get('scan')) toggleCamera();
});

function isDesktopSplit() {
  return window.innerWidth >= 768 && window.innerHeight >= 600;
}

function resetToScan() {
  if (isScanning) stopScanning();
  showState(resultEmpty);
  barcodeInput.value = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (productSidebar) { productSidebar.classList.add("hidden"); scannerWrapper.classList.remove("hidden"); }
}

function setupEventListeners() {
  // Toggle camera scanner
  btnToggleCamera.addEventListener("click", toggleCamera);

  // New scan button (single-column layout)
  document.getElementById("btn-new-scan").addEventListener("click", resetToScan);

  // New scan button (desktop sidebar)
  const btnNewScanSidebar = document.getElementById("btn-new-scan-sidebar");
  if (btnNewScanSidebar) btnNewScanSidebar.addEventListener("click", resetToScan);

  // Nav "Escanear" button — reset to scan view if results are showing
  const navScanReset = document.getElementById("nav-scan-reset");
  if (navScanReset) navScanReset.addEventListener("click", resetToScan);

  // History item click (event delegation)
  const historyList = document.getElementById("scan-history-list");
  if (historyList) historyList.addEventListener("click", e => {
    const btn = e.target.closest(".history-item");
    if (btn) analyzeBarcode(btn.dataset.barcode);
  });

  renderHistory();

  // Camera selection change
  cameraSelect.addEventListener("change", restartCameraWithSelectedDevice);

  // Manual barcode submission
  barcodeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const barcode = barcodeInput.value.trim();
    if (barcode) {
      if (!/^\d+$/.test(barcode)) {
        renderError("Código inválido", "Ingresa solo números (código de barras).");
        barcodeInput.value = "";
        return;
      }
      if (isScanning) {
        stopScanning();
      }
      analyzeBarcode(barcode);
    }
  });

}

// Camera Scanner Logic
async function listCameras() {
  const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
  const all = await navigator.mediaDevices.enumerateDevices();
  tmp.getTracks().forEach(t => t.stop());
  return all.filter(d => d.kind === 'videoinput').map(d => ({ id: d.deviceId, label: d.label }));
}

async function toggleCamera() {
  if (isScanning) {
    stopScanning();
    return;
  }

  try {
    showState(resultEmpty);
    scannerView.classList.add("active");
    btnToggleCamera.innerHTML = `
      <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
      Detener Cámara
    `;
    btnToggleCamera.style.background = "var(--accent-error)";
    btnToggleCamera.style.boxShadow = "0 4px 15px var(--accent-error-glow)";

    // Request permissions and get cameras
    const devices = await listCameras();
    if (devices && devices.length > 0) {
      // Build camera selection list
      cameraSelect.innerHTML = "";
      devices.forEach(device => {
        const option = document.createElement("option");
        option.value = device.id;
        option.text = device.label || `Cámara ${cameraSelect.length + 1}`;
        cameraSelect.appendChild(option);
      });

      // Detect rear camera by label keywords
      const rearKeywords = ["back", "rear", "environment", "trasera", "posterior", "trás"];
      const rearCam = devices.find(d =>
        rearKeywords.some(kw => d.label.toLowerCase().includes(kw))
      );
      const defaultCam = rearCam || devices[0];

      // Pre-select rear camera in dropdown
      cameraSelect.value = defaultCam.id;

      isScanning = true;
      // Start scanning using rear camera by default
      showScanHint();
      startScanningNative(defaultCam.id);
    } else {
      alert("No se encontraron cámaras en este dispositivo.");
      resetCameraButton();
    }
  } catch (error) {
    console.error("Error al iniciar cámara:", error);
    alert("Permiso de cámara denegado o dispositivo ocupado.");
    resetCameraButton();
  }
}

function stopScanning() {
  stopScanningNative();
  resetCameraButton();
}

function restartCameraWithSelectedDevice() {
  if (!isScanning) return;
  stopScanningNative();
  startScanningNative(cameraSelect.value);
}

function resetCameraButton() {
  hideScanHint();
  isScanning = false;
  scannerView.classList.remove("active");
  btnToggleCamera.innerHTML = `
    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>
    Activar cámara
  `;
  btnToggleCamera.style.background = "var(--accent)";
  btnToggleCamera.style.boxShadow = "0 4px 15px rgba(245,166,35,0.35)";
}

function onBarcodeDetected(rawCode) {
  const result = validateBarcode(rawCode);
  if (!result.valid) {
    invalidAttempts++;
    return false;
  }
  barcodeInput.value = result.code;
  if (navigator.vibrate) navigator.vibrate(100);
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
  stopScanning();
  analyzeBarcode(result.code);
  return true;
}
const _HASH_PTS   = [0.25, 0.5, 0.75];
const _HASH_FIXED = [[0.1,0.1],[0.9,0.1],[0.1,0.9],[0.9,0.9],[0.5,0.1],[0.5,0.9],[0.33,0.33]];

function quickHash(imageData) {
  const d = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  let sum = 0;
  const pts = _HASH_PTS;
  const fixed = _HASH_FIXED;
  for (const fy of pts) for (const fx of pts) {
    const i = (Math.floor(fy * h) * w + Math.floor(fx * w)) * 4;
    sum += d[i] + d[i + 1] + d[i + 2];
  }
  for (const [fx, fy] of fixed) {
    const i = (Math.floor(fy * h) * w + Math.floor(fx * w)) * 4;
    sum += d[i] + d[i + 1] + d[i + 2];
  }
  return sum;
}

function hashDiff(a, b) {
  return Math.abs(a - b) / (a || 1);
}

function setScanState(state) {
  scannerView.classList.remove('scanning', 'detecting', 'failed');
  if (state) scannerView.classList.add(state);
}

function preprocessImage(imageData) {
  const d = imageData.data;
  const len = d.length;
  let min = 255, max = 0;
  for (let i = 0; i < len; i += 4) {
    const gray = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
    d[i] = d[i+1] = d[i+2] = gray;
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }
  const range = max - min || 1;
  for (let i = 0; i < len; i += 4) {
    const v = ((d[i] - min) / range) * 255 | 0;
    d[i] = d[i+1] = d[i+2] = v;
  }
  return imageData;
}

function decodeNative(detector, canvas) {
  if (!detector) return Promise.reject('BarcodeDetector no disponible');
  return detector.detect(canvas).then(b => b.length ? b[0].rawValue : Promise.reject('BarcodeDetector: código no encontrado'));
}

function decodeZbar(imageData) {
  const zw = window.zbarWasm;
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

async function startScanningNative(cameraId) {
  if (!('BarcodeDetector' in window) && !(window.zbarWasm && typeof window.zbarWasm.scanImageData === 'function')) {
    alert('El escáner aún no está listo. Ingresa el código manualmente.');
    resetCameraButton();
    return;
  }
  window._zbarFailed = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: cameraId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    nativeScanStream = stream;
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    setupScanControls(track, caps);
    const placeholder = scannerView.querySelector('.scanner-placeholder');
    if (placeholder) placeholder.style.display = 'none';
    const video = document.createElement('video');
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    scannerView.appendChild(video);
    await video.play();
    await new Promise(r => video.readyState >= 2 ? r() : video.addEventListener('loadeddata', r, { once: true }));
    const detector = ('BarcodeDetector' in window) ? new BarcodeDetector({ formats: ['ean_13', 'upc_a', 'upc_e', 'ean_8'] }) : null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let detecting = false;
    const tick = () => {
      if (!isScanning) return;
      if (detecting || video.readyState < 2 || !video.videoWidth) {
        nativeScanRafId = requestAnimationFrame(tick);
        return;
      }

      scanFrameCount++;

      // Throttle: process every 2nd frame (not 3rd)
      if (scanFrameCount % 2 !== 0) {
        nativeScanRafId = requestAnimationFrame(tick);
        return;
      }

      // Canvas 1200px max width
      const maxW = 1200;
      const sc = Math.min(1, maxW / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * sc);
      canvas.height = Math.round(video.videoHeight * sc);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Motion detection: skip if <2% change (first 3s always process)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const elapsed = Date.now() - scanStartTime;
      if (elapsed > 3000) {
        const h = quickHash(imageData);
        if (prevFrameHash !== null && hashDiff(prevFrameHash, h) < 0.02) {
          nativeScanRafId = requestAnimationFrame(tick);
          return;
        }
        prevFrameHash = h;
      }

      detecting = true;
      setScanState('scanning');

      // Preprocess for ZBar (grayscale + contrast)
      const processed = preprocessImage(new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height));

      // Dual scale: small canvas for tiny barcodes
      const smallW = Math.round(canvas.width * 500 / maxW);
      const smallH = Math.round(canvas.height * 500 / maxW);
      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = smallW;
      smallCanvas.height = smallH;
      const sctx = smallCanvas.getContext('2d', { willReadFrequently: true });
      sctx.drawImage(canvas, 0, 0, smallW, smallH);
      const smallData = sctx.getImageData(0, 0, smallW, smallH);
      const smallProcessed = preprocessImage(smallData);

      // 4 decoders in parallel: 2 scales × 2 engines
      const decoders = [
        decodeNative(detector, canvas),
        decodeNative(detector, smallCanvas),
        decodeZbar(processed),
        decodeZbar(smallProcessed)
      ];

      Promise.any(decoders)
        .then(code => {
          detecting = false;
          setScanState('detecting');
          if (!isScanning) return;
          if (!onBarcodeDetected(code)) nativeScanRafId = requestAnimationFrame(tick);
        })
        .catch(() => {
          detecting = false;
          setScanState('failed');
          if (isScanning) nativeScanRafId = requestAnimationFrame(tick);
        });
    };
    nativeScanRafId = requestAnimationFrame(tick);

    // Dynamic timeout: suggest manual after 15s
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
  } catch (err) {
    console.error('Error al iniciar BarcodeDetector:', err);
    stopScanningNative();
    resetCameraButton();
  }
}

function stopScanningNative() {
  setScanState(null);
  if (scanTimeoutId) { clearInterval(scanTimeoutId); scanTimeoutId = null; }
  prevFrameHash = null;
  scanFrameCount = 0;
  if (nativeScanRafId) { cancelAnimationFrame(nativeScanRafId); nativeScanRafId = null; }
  if (nativeScanStream) { nativeScanStream.getTracks().forEach(t => t.stop()); nativeScanStream = null; }
  teardownScanControls();
  const video = scannerView.querySelector('video');
  if (video) video.remove();
  const placeholder = scannerView.querySelector('.scanner-placeholder');
  if (placeholder) placeholder.style.display = '';
}

function setupScanControls(track, caps) {
  cameraHud.classList.remove('hidden');

  if (caps.torch) {
    torchBtn.classList.remove('hidden');
    torchBtn.onclick = async () => {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] }).catch(() => {});
      torchOn = next;
      torchBtn.classList.toggle('on', torchOn);
    };
  }

  if (caps.zoom && caps.zoom.max >= 2) {
    const levels = [1, 2, 3].filter(l => l <= caps.zoom.max);
    levels.forEach(level => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'zoom-btn' + (level === 1 ? ' active' : '');
      btn.textContent = level + '×';
      btn.dataset.zoom = level;
      btn.onclick = () => {
        track.applyConstraints({ advanced: [{ zoom: level }] }).catch(() => {});
        zoomWrap.querySelectorAll('.zoom-btn').forEach(b => b.classList.toggle('active', b === btn));
      };
      zoomWrap.appendChild(btn);
    });
    zoomWrap.classList.remove('hidden');
  }

  setupCameraSwitch();
  if (cameraSelect.options.length < 2) btnCameraSwitch.classList.add('hidden');
}

function teardownScanControls() {
  torchOn = false;
  torchBtn.classList.add('hidden');
  torchBtn.classList.remove('on');
  torchBtn.onclick = null;
  zoomWrap.classList.add('hidden');
  zoomWrap.innerHTML = '';
  btnCameraSwitch.onclick = null;
  btnCameraSwitch.classList.remove('hidden');
  closeCameraPopover();
  cameraHud.classList.add('hidden');
}

const isTouchDevice = navigator.maxTouchPoints > 1;

function setupCameraSwitch() {
  if (isTouchDevice) {
    btnCameraSwitch.onclick = () => {
      const opts = cameraSelect.options;
      if (opts.length < 2) return;
      cameraSelect.selectedIndex = (cameraSelect.selectedIndex + 1) % opts.length;
      restartCameraWithSelectedDevice();
    };
  } else {
    btnCameraSwitch.onclick = (e) => {
      e.stopPropagation();
      if (document.getElementById('camera-popover')) {
        closeCameraPopover();
        return;
      }
      openCameraPopover();
    };
  }
}

function openCameraPopover() {
  const popover = document.createElement('div');
  popover.id = 'camera-popover';
  popover.className = 'camera-popover';

  Array.from(cameraSelect.options).forEach(opt => {
    const isActive = opt.value === cameraSelect.value;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'camera-popover-option' + (isActive ? ' active' : '');
    btn.innerHTML = `<span class="pop-check">${isActive ? '✓' : ''}</span>${esc(opt.text)}`;
    btn.onclick = () => {
      cameraSelect.value = opt.value;
      restartCameraWithSelectedDevice();
      closeCameraPopover();
    };
    popover.appendChild(btn);
  });

  cameraHud.appendChild(popover);

  requestAnimationFrame(() => {
    document.addEventListener('click', closeCameraPopover, { once: true });
    document.addEventListener('keydown', handlePopoverEsc);
  });
}

function closeCameraPopover() {
  document.removeEventListener('click', closeCameraPopover);
  const popover = document.getElementById('camera-popover');
  if (popover) popover.remove();
  document.removeEventListener('keydown', handlePopoverEsc);
}

function handlePopoverEsc(e) {
  if (e.key === 'Escape') closeCameraPopover();
}

let scanActivityTimer = null;
let scanHintEl = null;

function showScanHint() {
  if (scanHintEl) return;
  scanHintEl = document.createElement('p');
  scanHintEl.id = 'scan-coaching';
  scanHintEl.style.cssText = 'color:rgba(255,255,255,0.6);font-size:0.8rem;text-align:center;margin:8px 0 0;padding:0 16px;line-height:1.4;';
  scanHintEl.textContent = 'Centra el código y mueve el teléfono despacio de lado a lado';
  if (scannerWrapper) scannerWrapper.insertBefore(scanHintEl, scannerWrapper.querySelector('.scanner-controls').nextSibling);
  scanActivityTimer = setTimeout(() => {
    if (scanHintEl && isScanning) scanHintEl.textContent = 'Buscando código...';
  }, 3000);
}

function hideScanHint() {
  if (scanActivityTimer) { clearTimeout(scanActivityTimer); scanActivityTimer = null; }
  if (scanHintEl) { scanHintEl.remove(); scanHintEl = null; }
}

// Display Result State Panels
function showState(stateElement) {
  [resultEmpty, resultLoading, resultRejected, resultSuccess].forEach(el => {
    el.classList.remove("active");
  });
  stateElement.classList.add("active");

  const controlPanel = document.querySelector(".control-panel");
  const resultsPanel = document.querySelector(".results-panel");
  const isDesktop = window.matchMedia("(min-width: 769px)").matches;
  if (stateElement === resultEmpty) {
    controlPanel.classList.remove("hidden");
    if (resultsPanel) resultsPanel.classList.add("hidden");
  } else {
    if (!isDesktop) controlPanel.classList.add("hidden");
    if (resultsPanel) resultsPanel.classList.remove("hidden");
    const target = stateElement.closest(".results-panel") || stateElement;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// Main Business Logic: Barcode Identification & API Querying
async function analyzeBarcode(barcode) {
  _lastAiProductKey = "";
  showState(resultLoading);
  currentBarcodeQuery = barcode;

  // 1. Query local server API (which checks local Mexican database + proxies Open Food Facts)
  try {
    const url = `/api/product/${barcode}`;
    const response = await fetch(url);
    if (barcode !== currentBarcodeQuery) return; // stale: a newer scan started meanwhile

    if (response.status === 404) {
      renderNotFound();
      return;
    }

    if (!response.ok) {
      throw new Error("Respuesta de API incorrecta");
    }

    const data = await response.json();
    if (barcode !== currentBarcodeQuery) return; // stale: a newer scan started meanwhile

    if (data.status === 0 || !data.product) {
      renderNotFound();
      return;
    }

    currentScanLogId = response.headers.get('x-scan-log-id') || null;
    currentDataSources = data.sourceLabel || "Desconocido";

    // Process and normalize API data
    let product;
    if (data.source === 'local') {
      product = data.product;
    } else {
      product = parseApiProduct(data.product);
    }

    // Ensure ingredientsText exists (for OCR button visibility)
    if (!product.ingredientsText && !product.ingredients_text) {
      product.ingredientsText = null;
    } else if (!product.ingredientsText && product.ingredients_text) {
      product.ingredientsText = product.ingredients_text;
    }

    // Preserve cache/verification flags
    product._fromCache = data._fromCache || false;
    product._verified = data._verified || false;

    renderProductData(product, barcode);
    showReportCardIfNeeded();
  } catch (error) {
    renderNotFound();
  }
}

// Parse Open Food Facts JSON data structures
function isGlutenRelated(label) {
  const l = label.toLowerCase().trim();
  return ["gluten", "trigo", "trigo (gluten)", "cebada", "centeno", "avena"].includes(l) || l.includes("(gluten)");
}

function extractDietaryFromLabels(labelsTags) {
  const lt = (labelsTags || []).map(t => t.toLowerCase());
  const d = { vegan: null, vegetarian: null, kosher: null, halal: null, organic: null, nonGmo: null, noAdditives: null, palmOilFree: null, fairTrade: null, caseinFree: null };
  if (lt.some(t => t === 'en:vegan')) { d.vegan = true; }
  if (lt.some(t => t === 'en:vegetarian')) { d.vegetarian = true; }
  if (lt.some(t => t.includes('kosher'))) { d.kosher = true; }
  if (lt.some(t => t === 'en:halal')) { d.halal = true; }
  const organicTag = lt.find(t => ['en:organic','en:eu-organic','en:usda-organic','en:bio','en:ab-agriculture-biologique'].includes(t) || t.includes('organic'));
  if (organicTag) { d.organic = true; }
  const gmoTag = lt.find(t => ['en:non-gmo','en:no-ogm','en:without-gmo','en:gmo-free','en:non-gmo-project'].includes(t) || t.includes('without-gmo') || t.includes('non-gmo'));
  if (gmoTag) { d.nonGmo = true; }
  const additiveTag = lt.find(t => ['en:no-additives','en:additive-free','en:without-additives','en:no-preservatives','en:no-artificial-additives','en:no-artificial-colors','en:no-artificial-flavors'].includes(t));
  if (additiveTag) { d.noAdditives = true; }
  const palmTag = lt.find(t => t.includes('palm-oil-free') || t === 'en:no-palm-oil');
  if (palmTag) { d.palmOilFree = true; }
  const fairTag = lt.find(t => ['en:fair-trade','en:fairtrade','en:comercio-justo','en:fair-trade-international','en:fair-trade-usa'].includes(t) || t.includes('fair-trade') || t.includes('fairtrade'));
  if (fairTag) { d.fairTrade = true; }
  const caseinFreeTag = lt.find(t => ['en:no-milk','en:dairy-free','en:milk-free','en:sans-lait'].includes(t) || t.includes('dairy-free') || t.includes('no-milk') || t.includes('milk-free'));
  if (caseinFreeTag) { d.caseinFree = true; }
  return d;
}

function renderDietaryBadges(product) {
  const section = document.getElementById("dietary-section");
  const gridEl = document.getElementById("dietary-grid");
  const detailPanel = document.getElementById("dietary-detail-panel");
  if (!gridEl) return; // null-safe for test env

  // Asegurar que dietary exista extrayendo desde labels del OFF si es necesario
  if (!product.dietary) {
    product.dietary = product.labelsTags ? extractDietaryFromLabels(product.labelsTags) : { vegan: null, vegetarian: null, kosher: null, halal: null, organic: null, nonGmo: null, noAdditives: null, palmOilFree: null, fairTrade: null, caseinFree: null };
  } else if (product.labelsTags && !product.labelsTagsMerged) {
    const fromLabels = extractDietaryFromLabels(product.labelsTags);
    product.labelsTagsMerged = true;
    Object.keys(fromLabels).forEach(k => {
      if (product.dietary[k] == null && fromLabels[k] != null) {
        product.dietary[k] = fromLabels[k];
        product.dietary[k + 'Source'] = 'db';
        product.dietary[k + 'Detail'] = 'Etiqueta del producto';
      }
    });
  }
  const d = product.dietary;
  if (!d) { if (section) section.classList.add("hidden"); return; }
  const g = product.gluten;

  function buildGlutenDetail(g) {
    if (!g) return "No hay información disponible sobre contenido de gluten.";
    if (g.classification === "certified") return g.details;
    if (g.classification === "no_info") return "No hay suficiente información en la base de datos para determinar el contenido de gluten.";
    return g.details;
  }

  function buildDetailText(colorClass, dietName, extra) {
    const map = {
      "db-yes": `<strong>Declarado como ${dietName}.</strong> ${extra || "Según la base de datos."}`,
      "ai-yes": `<strong>Probablemente ${dietName}.</strong> Inferido por IA del análisis de ingredientes.${extra ? " " + extra : ""}`,
      "ai-no": `<strong>Probablemente NO ${dietName}.</strong> Inferido por IA del análisis de ingredientes.${extra ? " " + extra : ""}`,
      "db-no": `<strong>Declarado como NO ${dietName}.</strong> ${extra || "Según la base de datos."}`,
      "unknown": `No hay suficiente información en la base de datos para determinar si es ${dietName}.`
    };
    return map[colorClass] || "";
  }

  // Compute gluten state
  let glutenState = "unknown", glutenDetail = buildGlutenDetail(g);
  if (g) {
    if (g.classification === "certified") glutenState = "db-yes";
    else if (!g.hasGluten && g.classification !== "no_info") glutenState = "ai-yes";
    else if (g.hasGluten && g.source === 'ai') glutenState = "ai-no";
    else if (g.hasGluten) glutenState = "db-no";
  }

  function stateFor(val, src) {
    if (val === true)  return src === 'db' ? 'db-yes' : 'ai-yes';
    if (val === false) return src === 'db' ? 'db-no'  : 'ai-no';
    return 'unknown';
  }

  // Diet items metadata — yes/no/noun drive the label text based on state
  function labelFor(state, item) {
    if (state === 'db-yes' || state === 'ai-yes') return (state === 'ai-yes' ? 'Posible ' : '') + item.yes;
    if (state === 'db-no'  || state === 'ai-no')  return (state === 'ai-no'  ? 'Posible ' : '') + item.no;
    return item.noun;
  }

  const items = [
    { emoji: "🌾", yes: "Sin gluten",    no: "Con gluten",       noun: "Gluten",       state: glutenState,  detail: glutenDetail },
    { emoji: "🥛", yes: "Sin caseína",   no: "Con caseína",      noun: "Caseína",      state: stateFor(d.caseinFree, d.caseinFreeSource),   detail: buildDetailText(stateFor(d.caseinFree, d.caseinFreeSource), "libre de caseína", d.caseinFreeDetail || "") },
    { emoji: "🌿", yes: "Orgánico",      no: "No orgánico",      noun: "Orgánico",     state: stateFor(d.organic, d.organicSource),          detail: buildDetailText(stateFor(d.organic, d.organicSource), "orgánico", d.organicDetail || "") },
    { emoji: "🥦", yes: "Vegetariano",   no: "No vegetariano",   noun: "Vegetariano",  state: stateFor(d.vegetarian, d.vegetarianSource),    detail: buildDetailText(stateFor(d.vegetarian, d.vegetarianSource), "vegetariano", d.vegetarianDetail || "") },
    { emoji: "🌱", yes: "Vegano",        no: "No vegano",        noun: "Vegano",       state: stateFor(d.vegan, d.veganSource),              detail: buildDetailText(stateFor(d.vegan, d.veganSource), "vegano", d.veganDetail || "") },
    { emoji: "✡️", yes: "Kosher",        no: "No kosher",        noun: "Kosher",       state: stateFor(d.kosher, d.kosherSource),            detail: buildDetailText(stateFor(d.kosher, d.kosherSource), "kosher", d.kosherDetail || "") },
    { emoji: "🌙", yes: "Halal",         no: "No halal",         noun: "Halal",        state: stateFor(d.halal, d.halalSource),              detail: buildDetailText(stateFor(d.halal, d.halalSource), "halal", d.halalDetail || "") },
    { emoji: "🧬", yes: "Sin OGM",       no: "Con OGM",          noun: "OGM",          state: stateFor(d.nonGmo, d.nonGmoSource),            detail: buildDetailText(stateFor(d.nonGmo, d.nonGmoSource), "libre de OGM", d.nonGmoDetail || "") },
    { emoji: "🧪", yes: "Sin aditivos",  no: "Con aditivos",     noun: "Aditivos",     state: stateFor(d.noAdditives, d.noAdditivesSource),  detail: buildDetailText(stateFor(d.noAdditives, d.noAdditivesSource), "libre de aditivos", d.noAdditivesDetail || "") },
    { emoji: "🌴", yes: "Sin palma",     no: "Con palma",        noun: "Palma",        state: stateFor(d.palmOilFree, d.palmOilFreeSource),  detail: buildDetailText(stateFor(d.palmOilFree, d.palmOilFreeSource), "libre de aceite de palma", d.palmOilFreeDetail || "") },
    { emoji: "🤝", yes: "C. justo",      no: "No c. justo",      noun: "C. justo",     state: stateFor(d.fairTrade, d.fairTradeSource),      detail: buildDetailText(stateFor(d.fairTrade, d.fairTradeSource), "de comercio justo", d.fairTradeDetail || "") },
  ];

  // Build grid
  gridEl.innerHTML = "";
  let selectedBtn = null;
  items.forEach(item => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dietary-grid-item " + item.state;
    btn.innerHTML = `<span class="emoji">${item.emoji}</span><span class="label">${labelFor(item.state, item)}</span>`;
    if (item.state === 'ai-yes' || item.state === 'ai-no') {
      const badge = document.createElement("span");
      badge.className = "ai-badge";
      badge.textContent = "🤖";
      btn.appendChild(badge);
    }
    btn.addEventListener("click", () => {
      if (selectedBtn === btn) {
        // toggle off
        btn.classList.remove("selected");
        if (detailPanel) { detailPanel.classList.add("hidden"); detailPanel.innerHTML = ""; }
        selectedBtn = null;
      } else {
        if (selectedBtn) selectedBtn.classList.remove("selected");
        btn.classList.add("selected");
        selectedBtn = btn;
        if (detailPanel) {
          detailPanel.innerHTML = item.detail;
          detailPanel.classList.remove("hidden");
        }
      }
    });
    gridEl.appendChild(btn);
  });

  if (section) section.classList.remove("hidden");
}

function parseApiProduct(product) {
  const name = product.product_name || product.product_name_es || "Producto Desconocido";
  const brand = product.brands || "Marca genérica";
  const image = product.image_front_url || product.image_url || "";
  
  // Categorization Logic (Is it food or not?)
  // Open food facts includes categories, categories_tags, food_groups
  const categories = (product.categories || "").toLowerCase();
  const categoryTags = (product.categories_tags || []).map(t => t.toLowerCase());
  
  // Non-food indicators
  const nonFoodKeywords = [
    "cosmetics", "beauty", "higiene", "hygiene", "shampoo", "champú", "soap", "jabón",
    "perfume", "cleaner", "limpieza", "detergente", "detergent", "pet food", "mascotas",
    "alimento para perros", "alimento para gatos", "clothes", "ropa", "toy", "juguete"
  ];
  
  let isFood = true;
  let categoryLabel = product.categories_old || product.categories || "Comida / Bebida";

  // Scan categories for non-food matches
  const matchesNonFood = nonFoodKeywords.some(keyword => 
    categories.includes(keyword) || categoryTags.some(tag => tag.includes(keyword))
  );

  // If there are no nutritional facts AND no ingredients, and categories match, or it's empty
  const hasNutriments = product.nutriments && Object.keys(product.nutriments).length > 0;
  const hasIngredients = product.ingredients_text || (product.ingredients && product.ingredients.length > 0);

  if (matchesNonFood || (!hasNutriments && !hasIngredients && categoryTags.some(tag => tag.includes("non-food")))) {
    isFood = false;
  }

  // Gluten Dectector Logic
  // Open Food Facts tags allergens/ingredients containing gluten
  const ingredientsText = (product.ingredients_text || "").toLowerCase();
  let tracesText = (product.traces || "").toLowerCase();
  const allergensTags = (product.allergens_tags || []).map(t => t.toLowerCase());

  // Filter out non-allergen garbage like "NUEVO" from traces field
  tracesText = tracesText.split(",").filter(t => {
    const word = t.trim().toLowerCase();
    return !["nuevo", "desconocido", "undefined", "unknown"].includes(word);
  }).join(",");

  const hasGlutenAllergenTag = allergensTags.some(tag => tag.includes("gluten") || tag.includes("wheat") || tag.includes("trigo"));
  const hasGlutenInTraces = /gluten|wheat|trigo/.test(tracesText);
  const hasGlutenInIngredients = /gluten|harina\s+de\s+trigo|trigo|wheat|cebada|centeno/.test(ingredientsText);

  // Check for positive labels indicating gluten-free
  const labelsTags = (product.labels_tags || []).map(t => t.toLowerCase());
  const additivesTags = (product.additives_tags || []).map(t => t.toLowerCase());
  const isLabeledGlutenFree = labelsTags.some(tag => tag.includes("gluten-free") || tag.includes("sin-gluten") || tag.includes("libre-de-gluten") || tag.includes("no-gluten"));

  // Also check product name and ingredients text for explicit gluten-free claims
  const productName = (product.product_name || "").toLowerCase();
  const hasGlutenFreeClaim = /gluten\s*free|sin\s*gluten|libre\s*de\s*gluten|no\s*gluten/i.test(productName) || /gluten\s*free|sin\s*gluten|libre\s*de\s*gluten|no\s*gluten/i.test(ingredientsText);

  const glutenDataAvailable = !!(product.ingredients_text || (product.traces && product.traces !== "undefined") || (product.allergens_tags && product.allergens_tags.length > 0));

  // Use USDA-enriched gluten data if available (takes priority unless labeled GF)
  const enrichedGluten = product._gluten_enriched;

  let hasGluten = false;
  let glutenDetails = (glutenDataAvailable || enrichedGluten) ? "Este producto no se declara libre de gluten, pero no se encontraron ingredientes que indiquen su presencia" : "Sin información de gluten";
  let glutenClassification = !glutenDataAvailable && !enrichedGluten ? "no_info" : "declared";

  const isGf = isLabeledGlutenFree || hasGlutenFreeClaim;

  if (enrichedGluten && !isGf) {
    hasGluten = enrichedGluten.hasGluten;
    glutenDetails = enrichedGluten.details;
    glutenClassification = "declared";
  } else if (glutenDataAvailable) {
    if (isLabeledGlutenFree) {
      glutenClassification = "certified";
      glutenDetails = "Sin Gluten (Certificado)";
    } else if (hasGlutenFreeClaim) {
      glutenClassification = "declared";
      glutenDetails = "Este producto no se declara libre de gluten, pero no se encontraron ingredientes que indiquen su presencia";
    } else if (hasGlutenAllergenTag) {
      hasGluten = true;
      glutenClassification = "declared";
      glutenDetails = "Contiene gluten (declarado en etiqueta)";
    } else if (hasGlutenInIngredients) {
      hasGluten = true;
      glutenClassification = "declared";
      glutenDetails = "Contiene gluten (detectado en ingredientes)";
    } else if (hasGlutenInTraces) {
      hasGluten = true;
      glutenClassification = "declared";
      glutenDetails = "Puede contener trazas de gluten";
    } else {
      glutenClassification = "declared";
      glutenDetails = "Este producto no se declara libre de gluten, pero no se encontraron ingredientes que indiquen su presencia";
    }
  } else if (isGf) {
    glutenClassification = isLabeledGlutenFree ? "certified" : "declared";
    glutenDetails = isLabeledGlutenFree ? "Sin Gluten (Certificado)" : "Este producto no se declara libre de gluten, pero no se encontraron ingredientes que indiquen su presencia";
  }

  // Calories parser
  // API returns values in kJ or kcal. We prefer kcal.
  let kcal = 0;
  if (product.nutriments) {
    kcal = product.nutriments["energy-kcal_100g"] || product.nutriments["energy-kcal"] || 0;
    if (!kcal) {
      const kj = product.nutriments["energy_100g"] || product.nutriments["energy"] || 0;
      if (kj) {
        kcal = Math.round(kj / 4.184);
      }
    }
  }
  
  function computeEnergyLevel(kcal) {
    if (kcal > 400) return { level: "Alto", percent: Math.min(100, Math.round((kcal / 600) * 100)) };
    if (kcal >= 150) return { level: "Moderado", percent: Math.round((kcal / 400) * 100) };
    return { level: "Bajo", percent: Math.max(3, Math.round((kcal / 150) * 50)) };
  }
  const el = computeEnergyLevel(kcal);
  let energyLevel = el.level, percent = el.percent;

  // Sugars and carbohydrates parser
  let sugars = null;
  let carbs = null;
  let fiber = null;
  let proteins = null;
  if (product.nutriments) {
    if (product.nutriments["sugars_100g"] !== undefined) sugars = product.nutriments["sugars_100g"];
    else if (product.nutriments["sugars"] !== undefined) sugars = product.nutriments["sugars"];
    if (product.nutriments["carbohydrates_100g"] !== undefined) carbs = product.nutriments["carbohydrates_100g"];
    else if (product.nutriments["carbohydrates"] !== undefined) carbs = product.nutriments["carbohydrates"];
    if (product.nutriments["fiber_100g"] !== undefined) fiber = product.nutriments["fiber_100g"];
    else if (product.nutriments["fiber"] !== undefined) fiber = product.nutriments["fiber"];
    if (product.nutriments["proteins_100g"] !== undefined) proteins = product.nutriments["proteins_100g"];
    else if (product.nutriments["proteins"] !== undefined) proteins = product.nutriments["proteins"];
  }

  // Saturated fat and sodium for Mexican warning seals
  let saturatedFat = null;
  let sodium = null;
  let sodiumSource = "nutriments";
  if (product.nutriments) {
    if (product.nutriments["saturated-fat_100g"] !== undefined) saturatedFat = product.nutriments["saturated-fat_100g"];
    else if (product.nutriments["saturated-fat"] !== undefined) saturatedFat = product.nutriments["saturated-fat"];
    if (product.nutriments["sodium_100g"] !== undefined) sodium = product.nutriments["sodium_100g"];
    else if (product.nutriments["sodium"] !== undefined) sodium = product.nutriments["sodium"];
  }

  // Fallback 1: estimate sodium from salt when sodium is missing
  if (sodium === null && product.nutriments) {
    const saltVal = product.nutriments["salt_100g"] !== undefined ? product.nutriments["salt_100g"] : product.nutriments["salt"];
    if (saltVal !== undefined) {
      sodium = saltVal * 0.393;
      sodiumSource = "salt";
    }
  }

  // Fallback 2: parse ingredients text for explicit salt percentage
  if (product.ingredients_text && (sodium === null || (product.nutriments && sodium < 0.3))) {
    const saltPctMatch = product.ingredients_text.match(/sal\s*(?:\w+\s+)*(\d+[.,]\d*)%/i);
    if (saltPctMatch) {
      const pct = parseFloat(saltPctMatch[1].replace(',', '.'));
      if (pct > 0 && pct <= 100) {
        const estimatedSodium = pct * 0.393;
        if (sodium === null || estimatedSodium > sodium) {
          sodium = estimatedSodium;
          sodiumSource = "ingredients";
        }
      }
    }
  }

  if (product.nutriments && sodium !== null) {
    product.nutriments["sodium_100g"] = sodium;
  }

  // Check enriched USDA data (only override if value is actually a number)
  if (product._sugars_enriched) {
    if (product._sugars_enriched.sugars != null && !isNaN(product._sugars_enriched.sugars)) sugars = product._sugars_enriched.sugars;
    if (product._sugars_enriched.carbohydrates != null && !isNaN(product._sugars_enriched.carbohydrates)) carbs = product._sugars_enriched.carbohydrates;
    if (product._sugars_enriched.fiber != null && !isNaN(product._sugars_enriched.fiber)) fiber = product._sugars_enriched.fiber;
  }

  // Detect if product is a beverage
  const beverageKeywords = ["bebida", "refresco", "jugo", "zumo", "agua", "drink", "beverage", "soda", "néctar", "infusión", "té", "café", "bebible"];
  const categoriesLower = (product.categories || "").toLowerCase();
  const isBeverage = beverageKeywords.some(k => categoriesLower.includes(k));

  // Sugar level thresholds (UK NHS traffic light system)
  let sugarLevel = "Bajo";
  let sugarPercent = 0;
  const sugarHighThreshold = isBeverage ? 11.25 : 22.5;
  const sugarLowThreshold = isBeverage ? 2.5 : 5;
  if (sugars !== null) {
    if (sugars > sugarHighThreshold) {
      sugarLevel = "Alto";
      sugarPercent = Math.min(100, Math.round((sugars / (sugarHighThreshold * 1.5)) * 100));
    } else if (sugars > sugarLowThreshold) {
      sugarLevel = "Medio";
      sugarPercent = Math.round((sugars / sugarHighThreshold) * 100);
    } else {
      sugarLevel = "Bajo";
      sugarPercent = Math.max(3, Math.round((sugars / sugarLowThreshold) * 50));
    }
  }

  // Allergens extraction
  const allergensMap = {
    "en:milk": "Leche (Lácteos)",
    "en:eggs": "Huevos",
    "en:peanuts": "Cacahuates (Maní)",
    "en:nuts": "Frutos de cáscara (Nueces)",
    "en:soybeans": "Soja",
    "en:mustard": "Mostaza",
    "en:molluscs": "Moluscos",
    "en:fish": "Pescado",
    "en:celery": "Apio",
    "en:sesame-seeds": "Sésamo",
    "en:sulphur-dioxide-and-sulphites": "Sulfitos",
    "en:crustaceans": "Crustáceos",
    "en:lupins": "Altramuces",
    "en:gluten": "Gluten",
    "en:wheat": "Trigo",
    "en:barley": "Cebada",
    "en:rye": "Centeno",
    "en:oats": "Avena"
  };

  const mapAllergenTag = (tag) => {
    const lower = tag.toLowerCase();
    return allergensMap[lower] || lower.replace(/^[a-z]{2}:/, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  };

  const allAllergenTags = (product.allergens_tags || []).map(t => t.toLowerCase());
  const tracesTags = (product.traces_tags || []).map(t => t.toLowerCase());

  const allergensList = [];
  allAllergenTags.forEach(tag => {
    const mapped = mapAllergenTag(tag);
    if (!allergensList.includes(mapped)) {
      allergensList.push(mapped);
    }
  });

  // Fallback translation for traces or custom allergen tags
  if (allergensList.length === 0 && product.allergens_from_ingredients) {
    const rawAllergens = product.allergens_from_ingredients.split(",").map(a => a.trim().toLowerCase());
    rawAllergens.forEach(ra => {
      if (ra && !allergensList.includes(ra)) {
        allergensList.push(ra.charAt(0).toUpperCase() + ra.slice(1));
      }
    });
  }

  const parseDeclaration = (text, regex) => {
    const match = text.match(regex);
    if (!match) return [];
    return match[1].split(',').flatMap(part =>
      part.trim().split(/\s+(?:y|&|and)\s+/).map(s => s.trim())
    ).filter(s => s.length > 1);
  };
  if (product.ingredients_text) {
    parseDeclaration(product.ingredients_text, /(?:contiene|contains)\s*:\s*([^.\n]+?)(?=(?:puede\s+contener|may\s+contain|\.|\n|$))/i).forEach(item => {
      const itemLower = item.toLowerCase().replace(/\btrazas?\s+de\s+/g, "");
      const known = COMMON_ALLERGENS.find(ca => ca.match.some(m => itemLower.includes(m)));
      if (known) {
        if (!allergensList.includes(known.label)) allergensList.push(known.label);
      } else {
        const extraKey = Object.keys(EXTRA_ALLERGEN_ICONS).find(k => itemLower.includes(k));
        if (extraKey) {
          const display = extraKey.charAt(0).toUpperCase() + extraKey.slice(1);
          if (!allergensList.includes(display)) allergensList.push(display);
        } else if (itemLower && !allergensList.includes(itemLower)) {
          const cleaned = itemLower.charAt(0).toUpperCase() + itemLower.slice(1);
          if (!allergensList.includes(cleaned)) allergensList.push(cleaned);
        }
      }
    });
  }

  // Traces: solo de campos explícitos de la base de datos (traces_tags, traces)
  // más declaraciones "Puede contener:" / "May contain:" del ingredients_text
  const tracesList = [];

  // Add traces from traces_tags
  const irrelevantTags = ["es:nuevo", "nuevo", "desconocido", "unknown"];
  tracesTags.forEach(tag => {
    if (!irrelevantTags.includes(tag.toLowerCase())) {
      const mapped = mapAllergenTag(tag);
      if (!allergensList.includes(mapped) && !tracesList.includes(mapped)) {
        tracesList.push(mapped);
      }
    }
  });
  if (product.traces && product.traces !== "undefined") {
    const irrelevantWords = ["nuevo", "desconocido", "undefined", "unknown"];
    product.traces.split(",").forEach(t => {
      const cleaned = t.replace(/^[a-z]{2}:/, "").trim();
      const cleanedLower = cleaned.toLowerCase();
      if (cleaned && !irrelevantWords.includes(cleanedLower) && !allergensList.includes(cleaned) && !tracesList.includes(cleaned)) {
        tracesList.push(cleaned.charAt(0).toUpperCase() + cleaned.slice(1));
      }
    });
  }

  if (product.ingredients_text) {
    parseDeclaration(product.ingredients_text, /(?:puede\s+contener|may\s+contain)\s*:\s*([^.\n]+?)(?=(?:\.|\n|$))/i).forEach(item => {
      const itemLower = item.toLowerCase().replace(/\btrazas?\s+de\s+/g, "");
      const known = COMMON_ALLERGENS.find(ca => ca.match.some(m => itemLower.includes(m)));
      if (known) {
        if (!allergensList.includes(known.label) && !tracesList.includes(known.label)) {
          tracesList.push(known.label);
        }
      } else {
        const extraKey = Object.keys(EXTRA_ALLERGEN_ICONS).find(k => itemLower.includes(k));
        if (extraKey) {
          const display = extraKey.charAt(0).toUpperCase() + extraKey.slice(1);
          if (!allergensList.includes(display) && !tracesList.includes(display)) {
            tracesList.push(display);
          }
        } else if (itemLower && !tracesList.includes(itemLower)) {
          const cleaned = itemLower.charAt(0).toUpperCase() + itemLower.slice(1);
          if (!allergensList.includes(cleaned) && !tracesList.includes(cleaned)) {
            tracesList.push(cleaned);
          }
        }
      }
    });
  }

  // Nota: Los alérgenos se obtienen exclusivamente de bases de datos (OFF, USDA)
  // y de declaraciones explícitas del fabricante ("Contiene:", "Puede contener:"),
  // no por detección por palabras clave en ingredientes.

  // Filter out gluten-related items from allergens and traces (handled in dedicated section)
  const filteredAllergens = allergensList.filter(a => !isGlutenRelated(a));
  const filteredTraces = tracesList.filter(t => !isGlutenRelated(t));

  // Inferred allergens from product name (shown como "sugerido" no "detectado")
  // Solo infiere si hay ingredientes disponibles; sin ingredientes la IA no tiene base
  const inferredAllergens = [];
  if (ingredientsText) {
    const allText = (product.product_name + " " + (product.categories || "")).toLowerCase();
    const fishKW = ["sardina", "atún", "salmón", "sardine", "tuna", "salmon", "anchova", "boquerón", "caballa", "merluza", "bacalao", "pescado", "fish"];
    if (fishKW.some(k => allText.includes(k)) && !filteredAllergens.some(a => a.includes("Pescado"))) {
      inferredAllergens.push("Pescado");
    }
  }

  // Dietary info with source tracking
  const dietary = { vegan: null, vegetarian: null, kosher: null, halal: null, organic: null, nonGmo: null, noAdditives: null, palmOilFree: null, fairTrade: null, veganSource: null, vegetarianSource: null, kosherSource: null, halalSource: null, organicSource: null, nonGmoSource: null, noAdditivesSource: null, palmOilFreeSource: null, fairTradeSource: null, veganDetail: null, vegetarianDetail: null, kosherDetail: null, halalDetail: null, organicDetail: null, nonGmoDetail: null, noAdditivesDetail: null, palmOilFreeDetail: null, fairTradeDetail: null };
  const analysisTags = (product.ingredients_analysis_tags || []).map(t => t.toLowerCase());
  if (labelsTags.some(t => t === 'en:vegan')) { dietary.vegan = true; dietary.veganSource = 'db'; dietary.veganDetail = "Certificado como vegano según la etiqueta del producto."; }
  if (labelsTags.some(t => t === 'en:vegetarian')) { dietary.vegetarian = true; dietary.vegetarianSource = 'db'; dietary.vegetarianDetail = "Certificado como vegetariano según la etiqueta del producto."; }
  if (labelsTags.some(t => t.includes('kosher'))) { dietary.kosher = true; dietary.kosherSource = 'db'; dietary.kosherDetail = "Certificado como kosher según la etiqueta del producto."; }
  if (analysisTags.includes('en:non-vegan')) { dietary.vegan = false; dietary.veganSource = 'db'; dietary.veganDetail = "Clasificado como no vegano según el análisis del producto."; }
  if (analysisTags.includes('en:vegan') && dietary.vegan !== false) { dietary.vegan = true; dietary.veganSource = 'db'; dietary.veganDetail = "Clasificado como vegano según el análisis del producto."; }
  if (analysisTags.includes('en:vegetarian')) { dietary.vegetarian = true; dietary.vegetarianSource = 'db'; dietary.vegetarianDetail = "Clasificado como vegetariano según el análisis del producto."; }
  if (labelsTags.some(t => t === 'en:halal')) { dietary.halal = true; dietary.halalSource = 'db'; dietary.halalDetail = "Certificado como halal según la etiqueta del producto."; }
  const organicTag = labelsTags.find(t => t === 'en:organic' || t === 'en:eu-organic' || t === 'en:usda-organic' || t === 'en:bio' || t === 'en:ab-agriculture-biologique' || t.includes('organic'));
  if (organicTag) { dietary.organic = true; dietary.organicSource = 'db'; dietary.organicDetail = "Certificado como orgánico según la etiqueta del producto."; }
  const gmoTag = labelsTags.find(t => t === 'en:non-gmo' || t === 'en:no-ogm' || t === 'en:without-gmo' || t === 'en:gmo-free' || t === 'en:non-gmo-project' || t.includes('without-gmo') || t.includes('non-gmo'));
  if (gmoTag) { dietary.nonGmo = true; dietary.nonGmoSource = 'db'; dietary.nonGmoDetail = "Certificado como libre de OGM según la etiqueta del producto."; }
  const additiveTag = labelsTags.find(t => t === 'en:no-additives' || t === 'en:additive-free' || t === 'en:without-additives' || t === 'en:no-preservatives' || t === 'en:no-artificial-additives' || t === 'en:no-artificial-colors' || t === 'en:no-artificial-flavors');
  if (additiveTag) { dietary.noAdditives = true; dietary.noAdditivesSource = 'db'; dietary.noAdditivesDetail = "Certificado como libre de aditivos según la etiqueta del producto."; }
  const palmTag = labelsTags.find(t => t.includes('palm-oil-free') || t === 'en:no-palm-oil') || (analysisTags.includes('en:palm-oil-free') ? 'en:palm-oil-free' : null);
  if (palmTag) { dietary.palmOilFree = true; dietary.palmOilFreeSource = 'db'; dietary.palmOilFreeDetail = "Certificado como libre de aceite de palma según la etiqueta del producto."; }
  const fairTag = labelsTags.find(t => t === 'en:fair-trade' || t === 'en:fairtrade' || t === 'en:comercio-justo' || t === 'en:fair-trade-international' || t === 'en:fair-trade-usa' || t.includes('fair-trade') || t.includes('fairtrade'));
  if (fairTag) { dietary.fairTrade = true; dietary.fairTradeSource = 'db'; dietary.fairTradeDetail = "Certificado como de comercio justo según la etiqueta del producto."; }

  // Casein-free detection (caseína = proteína láctea; SIN LACTOSA ≠ libre de caseína)
  dietary.caseinFree = null;
  if (product._casein_enriched) {
    // From USDA enrichment (by name)
    dietary.caseinFree = !product._casein_enriched.hasCasein ? true : false;
    dietary.caseinFreeSource = 'db';
    dietary.caseinFreeDetail = product._casein_enriched.hasCasein
      ? `Contiene caseína/lácteos (detectado: ${product._casein_enriched.detected.join(", ")})`
      : "No se detectaron ingredientes lácteos en la base USDA";
  } else {
    const hasMilkTag = allergensTags.some(t => t.includes('en:milk') || t.includes('en:dairy'));
    const caseinKW = /caseína|caseina|caseinato|suero\s+de\s+leche|suero\s+lácteo|whey|leche|milk|lácteo|lacteo|dairy|queso|cheese|crema\s+de\s+leche|nata|yogur|yogurt|ghee|requesón|requeson|cuajada|sólidos\s+de\s+leche|leche\s+en\s+polvo|milk\s+powder/i;
    const hasCaseinInIngredients = caseinKW.test(ingredientsText);
    const hasCaseinInTraces = caseinKW.test(tracesText);
    const isDairyFreeLabel = labelsTags.some(t => ['en:no-milk','en:dairy-free','en:milk-free','en:sans-lait'].includes(t) || t.includes('dairy-free') || t.includes('no-milk') || t.includes('milk-free'));
    const isDairyFreeName = /dairy.free|sin.l[aá]cteos|libre.de.le[ac]|milk.free/i.test(productName) || /dairy.free|sin.l[aá]cteos/i.test(ingredientsText);

    if (hasMilkTag || hasCaseinInIngredients || hasCaseinInTraces) {
      dietary.caseinFree = false;
      dietary.caseinFreeSource = 'db';
      dietary.caseinFreeDetail = hasMilkTag ? "Contiene lácteos (declarado en etiqueta)" : "Contiene caseína/lácteos (detectado en ingredientes)";
    } else if (isDairyFreeLabel || isDairyFreeName || dietary.vegan === true) {
      dietary.caseinFree = true;
      dietary.caseinFreeSource = 'db';
      dietary.caseinFreeDetail = dietary.vegan === true ? "Producto vegano — libre de todos los derivados lácteos" : "Declarado libre de lácteos/caseína";
    } else if (glutenDataAvailable) {
      // Hay datos de ingredientes pero no se detectó ningún lácteo → "Probable libre"
      dietary.caseinFree = true;
      dietary.caseinFreeSource = 'ai';
      dietary.caseinFreeDetail = "No se detectaron ingredientes lácteos. Verificar empaque para confirmación.";
    }
  }

  // Mexican warning seals (NOM-051 Fase 2)
  const sellos = [];
  const hasNutritionData = kcal > 0 || sugars !== null || saturatedFat !== null || sodium !== null;
  if (hasNutritionData) {
    const k = Math.round(kcal);
    const kcalThreshold = isBeverage ? 70 : 275;
    if (k >= kcalThreshold) sellos.push({ label: "CALORÍAS", value: k + " kcal", threshold: "≥" + kcalThreshold + " kcal" });

    if (sugars !== null && k > 0) {
      const pctSugar = (sugars * 4 / k) * 100;
      if (pctSugar >= 10) sellos.push({ label: "AZÚCARES", value: Math.round(pctSugar * 10) / 10 + "%", threshold: "≥10%" });
    } else if (sugars !== null && k === 0 && sugars > 0) {
      if (!isBeverage && sugars >= 10) sellos.push({ label: "AZÚCARES", value: sugars + "g", threshold: "≥10g" });
      else if (isBeverage && sugars >= 5) sellos.push({ label: "AZÚCARES", value: sugars + "g", threshold: "≥5g" });
    }

    if (saturatedFat !== null && k > 0) {
      const pctSatFat = (saturatedFat * 9 / k) * 100;
      if (pctSatFat >= 10) sellos.push({ label: "GRASAS SATURADAS", value: Math.round(pctSatFat * 10) / 10 + "%", threshold: "≥10%" });
    }

    if (sodium !== null) {
      const sodiumMg = Math.round(sodium * 1000);
      const sodiumThreshold = isBeverage ? 45 : 300;
      const exceedsFlat = sodiumMg >= sodiumThreshold;
      const exceedsPerCal = k > 0 && (sodiumMg / k) >= 1;
      if (exceedsFlat || exceedsPerCal) sellos.push({ label: "SODIO", value: sodiumMg + "mg", threshold: "≥" + sodiumThreshold + "mg" });
    }
  }

  // No recomendado para ciertos grupos
  const notRecommended = [];
  const ingredLower = (product.ingredients_text || "").toLowerCase();

  // Edulcorantes → niños
  const edulcorantesAdditives = ["en:e950","en:e951","en:e952","en:e954","en:e955","en:e959","en:e960","en:e961","en:e962","en:e965","en:e967","en:e968","en:e969"];
  const hasEdulcoranteTag = additivesTags.some(t => edulcorantesAdditives.includes(t));
  const edulcoranteKeywords = /edulcorante|sucralosa|stevia|glucósido|aspartame|acesulfame|sacarina|ciclamato|neohesperidina|taumatina|neotamo|advantamo|tagatosa|maltitol|lactitol|xilitol|eritritol|isomalt/i;
  const hasEdulcoranteText = edulcoranteKeywords.test(ingredLower);
  if (hasEdulcoranteTag || hasEdulcoranteText) {
    notRecommended.push({ icon: "👶", grupo: "Niños", razon: "Contiene edulcorantes", certain: true });
  }

  // Cafeína → niños
  const cafeinaKeywords = /\bcafeína\b|\bcafeina\b|\bcaffeine\b/i;
  if (cafeinaKeywords.test(ingredLower)) {
    if (!notRecommended.some(n => n.grupo === "Niños")) {
      notRecommended.push({ icon: "👶", grupo: "Niños", razon: "Contiene cafeína", certain: true });
    } else {
      const idx = notRecommended.findIndex(n => n.grupo === "Niños");
      notRecommended[idx].razon += " y cafeína";
      notRecommended[idx].certain = true;
    }
  }

  // Aspartame → fenilcetonúricos
  if (additivesTags.includes("en:e951") || /\baspartame\b/i.test(ingredLower)) {
    notRecommended.push({ icon: "🧬", grupo: "Fenilcetonúricos", razon: "Contiene aspartame (fenilalanina)", certain: true });
  }

  // Diabéticos: alto en azúcares, alto en carbohidratos netos
  // El análisis detallado de riesgo se obtiene del widget IA
  const netCarbs = (carbs !== null && fiber !== null) ? carbs - fiber : (carbs !== null ? carbs : null);
  const diabeticReasons = [];
  if (sugars !== null && sugarLevel === "Alto") {
    diabeticReasons.push(`Alto en azúcares (${Math.round(sugars * 10) / 10}g/100g)`);
  }
  if (netCarbs !== null) {
    const carbThreshold = isBeverage ? 10 : 20;
    if (netCarbs > carbThreshold && sugarLevel !== "Alto") {
      diabeticReasons.push(`Alto en carbohidratos netos (${Math.round(netCarbs * 10) / 10}g/100g)`);
    }
  }
  if (diabeticReasons.length > 0) {
    notRecommended.push({ icon: "🩸", grupo: "Diabéticos", razon: diabeticReasons.join("; "), certain: true });
  }

  // Sodio alto → hipertensos
  const sodiumMg = sodium !== null ? Math.round(sodium * 1000) : 0;
  if (sodiumMg >= 300) {
    notRecommended.push({ icon: "❤️", grupo: "Hipertensos", razon: `Alto en sodio (${sodiumMg}mg/100g)`, certain: true });
  }

  // Lactosa → intolerantes
  const hasLactosa = filteredAllergens.some(a => a.toLowerCase().includes("leche") || a.toLowerCase().includes("lácteos"));
  if (hasLactosa) {
    notRecommended.push({ icon: "🥛", grupo: "Intolerantes a lactosa", razon: "Contiene leche o derivados lácteos", certain: true });
  }

  // Nutriscore
  const nutriscore = product.nutriscore_grade || product.nutrition_grades || "-";

  const allergensDataAvailable = allergensList.length > 0 || filteredAllergens.length > 0 || inferredAllergens.length > 0 || !!(product.allergens_tags?.length || product.allergens_from_ingredients || ingredientsText);

  return {
    name,
    brand,
    image,
    isFood,
    category: categoryLabel,
    gluten: {
      hasGluten,
      details: glutenDetails,
      dataAvailable: glutenDataAvailable,
      classification: glutenClassification,
      _isGf: isGf,
      source: isLabeledGlutenFree || isGf || hasGlutenAllergenTag ? 'db' : enrichedGluten ? 'ai' : null
    },
    calories: {
      value: Math.round(kcal),
      level: energyLevel,
      percent: percent
    },
    sugars: {
      value: sugars !== null ? Math.round(sugars * 10) / 10 : null,
      level: sugarLevel,
      percent: sugarPercent
    },
    carbohydrates: {
      value: carbs !== null ? Math.round(carbs * 10) / 10 : null,
      fiber: fiber !== null ? Math.round(fiber * 10) / 10 : null
    },
    proteins: {
      value: proteins !== null ? Math.round(proteins * 10) / 10 : null,
      level: proteins !== null ? (proteins > 10 ? "Alto" : proteins > 3 ? "Moderado" : "Bajo") : null,
      percent: proteins !== null ? Math.min(100, Math.round((proteins / 20) * 100)) : 0
    },
    isBeverage,
    allergens: filteredAllergens,
    allergensDataAvailable,
    inferredAllergens,
    traces: [...new Map(filteredTraces.map(t => [t.toLowerCase().trim(), t])).values()],
    nutriscore: nutriscore,
    _enrichedFrom: product._enrichedFrom || null,
    _from_nutrition_ocr: product._from_nutrition_ocr || false,
    ingredientsText: product.ingredients_text || null,
    nutriments: product.nutriments || null,
    labelsTags: product.labels_tags || null,
    dietary,
    sellos,
    notRecommended
  };
}

// Format numeric value to show at most 2 decimal places, strip trailing zeros
function fmt(n) { return n === null || n === undefined || isNaN(n) ? n : parseFloat(Number(n).toFixed(2)); }

function renderNotRecommended(product) {
  const cardNotRec = document.getElementById("card-not-recommended");
  const notRecContainer = document.getElementById("not-recommended-container");
  if (!cardNotRec || !notRecContainer) return;
  notRecContainer.innerHTML = "";
  if (product.notRecommended && product.notRecommended.length > 0) {
    product.notRecommended.forEach(item => {
      const el = document.createElement("span");
      el.className = "not-rec-item " + (item.certain !== false ? "certain" : "possible");
      el.title = `${item.grupo}: ${item.razon}`;
      el.innerHTML = `<span class="not-rec-icon">${item.icon}</span><span class="not-rec-grupo">${esc(item.grupo)}</span><span class="not-rec-razon">${esc(item.razon)}</span>`;
      notRecContainer.appendChild(el);
    });
  } else {
    notRecContainer.innerHTML = '<span class="not-rec-none">No se declaran restricciones para este producto.</span>';
  }
  cardNotRec.classList.remove("hidden");
}

// Render dynamic results onto success screen
function renderProductData(product, barcode) {
  if (!product.isFood) {
    renderRejected(product);
    return;
  }

  currentBarcode = barcode;
  showState(resultSuccess);
  cardAllergens.classList.add("hidden");
  analysisGrid.classList.add("hidden");
  saveToHistory(barcode, product.name, product.brand, product.image);

  // Default data availability when not set by parser
  if (product.isFromFallback) {
    if (product.gluten && product.gluten.dataAvailable === undefined) product.gluten.dataAvailable = false;
    if (product.allergensDataAvailable === undefined) product.allergensDataAvailable = false;
  } else {
    if (product.gluten && product.gluten.dataAvailable === undefined) product.gluten.dataAvailable = true;
    if (product.allergensDataAvailable === undefined) product.allergensDataAvailable = true;
  }

  // Set header details
  productName.textContent = product.name;
  productBrand.textContent = product.brand;
  
  // Limpiar etiquetas offline previas si las hay
  const existingOfflineBadge = productBrand.parentNode.querySelector(".badge-offline");
  if (existingOfflineBadge) {
    existingOfflineBadge.remove();
  }
  
  if (product.isSimulated) {
    const offlineBadge = document.createElement("span");
    offlineBadge.className = "badge badge-offline";
    offlineBadge.textContent = "Simulado (Sin Conexión)";
    productBrand.parentNode.insertBefore(offlineBadge, productBrand.nextSibling);
  }
  
  productBarcode.textContent = barcode;

  renderDietaryBadges(product);

  productImg.src = product.image || placeholderSvg();
  productImg.alt = product.name || "";

  if (isDesktopSplit() && productSidebar) {
    sidebarImg.src = product.image || placeholderSvg();
    sidebarImg.alt = product.name || "";
    sidebarName.textContent = product.name || "";
    sidebarBrand.textContent = product.brand || "";
    sidebarBarcode.textContent = barcode;
    scannerWrapper.classList.add("hidden");
    productSidebar.classList.remove("hidden");
  }

  // Render ingredients list EARLY so it shows even for fallback products
  const ingredientsSection = document.getElementById("ingredients-section");
  const ingredientsTextEl = document.getElementById("ingredients-text");
  const ocrRequestSection = document.getElementById("ocr-request-section");
  if (ingredientsSection && ingredientsTextEl) {
    if (product.ingredientsText && product.ingredientsText.trim()) {
      ingredientsTextEl.textContent = product.ingredientsText;
      ingredientsSection.classList.remove("hidden");
      if (ocrRequestSection) ocrRequestSection.classList.add("hidden");
      // Show grid for ingredients
      if (analysisGrid) analysisGrid.classList.remove("hidden");
      const fixIng = document.getElementById("btn-fix-ingredients");
      if (fixIng) fixIng.onclick = () => showOcrModal(currentBarcode);
    } else {
      ingredientsSection.classList.add("hidden");
      if (ocrRequestSection) {
        ocrRequestSection.classList.remove("hidden");
        const ocrBtn = document.getElementById("btn-ocr-ingredients");
        if (ocrBtn) ocrBtn.onclick = () => showOcrModal(currentBarcode);
        // IMPORTANT: Show grid to display OCR button
        if (analysisGrid) analysisGrid.classList.remove("hidden");
      }
    }
  }

  const nutritionRequestBtn = document.getElementById("btn-nutrition-capture");
  const nutritionCaptureSection = document.getElementById("nutrition-capture-section");
  if (nutritionRequestBtn && nutritionCaptureSection) {
    const hasNutritionData = !!product._from_nutrition_ocr || (product.calories?.value > 0);
    nutritionCaptureSection.classList.toggle("hidden", hasNutritionData);
    nutritionRequestBtn.onclick = () => showNutritionModal(currentBarcode);
  }

  if (product.isFromFallback && !product._enrichedFrom && !product.ingredientsText && !product._from_nutrition_ocr) {
    // Only show warning if there's no information at all (no ingredients from OFF or OCR, no enrichment)
    noNutritionAlert.classList.remove("hidden");
    renderHypertensionCard(product);
    renderCholesterolCard(product);
    renderWeightCard(product);
    runAICheck(product, barcode);
    return;
  }

  analysisGrid.classList.remove("hidden");
  noNutritionAlert.classList.add("hidden");

  // Gluten card hidden (info shown in dietary grid)

  function styleCard(levelEl, progressEl, level, classMap, bgMap) {
    levelEl.className = classMap[level] || classMap["default"];
    progressEl.style.background = bgMap[level] || bgMap["default"];
  }

  const lvlBg = (h, m, l) => ({ Alto: h, Medio: m, Moderado: m, Bajo: l, default: l });
  const lvlCls = (prefix, h, m, l) => ({ Alto: prefix + h, Medio: prefix + m, Moderado: prefix + m, Bajo: prefix + l, default: prefix + l });

  // Render Calories Card details
  const noCalData = product.calories.value === 0 || product.calories.level === "No Especificado";
  if (noCalData) {
    cardCalories.classList.add("hidden");
  } else {
    cardCalories.classList.remove("hidden");
    caloriesVal.querySelector(".number").textContent = fmt(product.calories.value);
    caloriesProgress.style.width = `${product.calories.percent}%`;
    caloriesLevel.textContent = `Nivel de energía: ${product.calories.level}`;
    cardCalories.className = "analysis-card";
    styleCard(caloriesLevel, caloriesProgress, product.calories.level,
      lvlCls("level-indicator calories-", "high", "mod", "low"),
      lvlBg("var(--accent-error)", "var(--accent-alert)", "var(--accent-primary)"));
  }

  // Render Sugars Card
  if (product.sugars && product.sugars.value != null) {
    cardSugars.classList.remove("hidden");
    sugarsVal.textContent = fmt(product.sugars.value) + " g / 100g";
    sugarsProgress.style.width = (product.sugars.percent ?? 0) + "%";
    sugarsLevel.textContent = "Nivel de azúcar: " + (product.sugars.level ?? "Bajo");
    cardSugars.className = "analysis-card";
    styleCard(sugarsLevel, sugarsProgress, product.sugars.level,
      lvlCls("level-indicator sugars-", "high", "mod", "low"),
      lvlBg("var(--accent-error)", "var(--accent-alert)", "var(--accent-primary)"));
  } else {
    cardSugars.classList.add("hidden");
  }

  // Render Proteins Card
  if (product.proteins && product.proteins.value !== null) {
    cardProteins.classList.remove("hidden");
    proteinsVal.textContent = fmt(product.proteins.value) + " g / 100g";
    proteinsProgress.style.width = product.proteins.percent + "%";
    proteinsLevel.textContent = "Nivel de proteína: " + product.proteins.level;
    cardProteins.className = "analysis-card";
    styleCard(proteinsLevel, proteinsProgress, product.proteins.level,
      lvlCls("level-indicator proteins-", "high", "mod", "low"),
      lvlBg("var(--accent-primary)", "var(--accent-alert)", "var(--text-muted)"));
  } else {
    cardProteins.classList.add("hidden");
  }

  // Render Carbohydrates Card
  if (cardCarbs && carbsVal && carbsProgress && carbsLevel) {
    if (product.carbohydrates && product.carbohydrates.value !== null) {
      cardCarbs.classList.remove("hidden");
      const total = fmt(product.carbohydrates.value);
      const fiber = product.carbohydrates.fiber !== null ? fmt(product.carbohydrates.fiber) : null;
      const net = fiber !== null ? Math.round((total - fiber) * 10) / 10 : total;
      const netLabel = fiber !== null ? ` (Netos: ${net}g)` : "";
      carbsVal.textContent = total + " g / 100g" + netLabel;
      if (carbsNet) {
        if (fiber !== null) {
          carbsNet.textContent = "Fibra: " + fiber + "g | Netos: " + net + "g";
          carbsNet.classList.remove("hidden");
        } else {
          carbsNet.classList.add("hidden");
        }
      }
      const pct = Math.min(100, Math.round((total / 60) * 100));
      carbsProgress.style.width = pct + "%";
      let level = "Moderado";
      if (total > 30) level = "Alto";
      else if (total < 10) level = "Bajo";
      carbsLevel.textContent = "Nivel: " + level;
      cardCarbs.className = "analysis-card";
      styleCard(carbsLevel, carbsProgress, level,
        lvlCls("level-indicator carbs-", "high", "mod", "low"),
        lvlBg("var(--accent-error)", "var(--accent-alert)", "var(--accent-primary)"));
    } else {
      cardCarbs.classList.add("hidden");
    }
  }

  // Render Allergen Icon Grid + text tags
  const gridEl = document.getElementById("allergen-icon-grid");
  const legendEl = document.querySelector(".allergen-legend");
  let anyGridActive = false;
  if (product.allergensDataAvailable === false) {
    if (gridEl) gridEl.classList.add("hidden");
    if (legendEl) legendEl.classList.add("hidden");
  } else {
    if (gridEl) {
      gridEl.classList.remove("hidden");
      gridEl.innerHTML = "";
      const allAllergensLower = (product.allergens || []).map(a => a.toLowerCase());
      const allTracesLower = (product.traces || []).map(a => a.toLowerCase());
      COMMON_ALLERGENS.forEach(item => {
        const div = document.createElement("div");
        div.className = "allergen-grid-item";
        const matchesAllergen = item.match.some(m => allAllergensLower.some(a => a.includes(m)));
        const matchesTrace = item.match.some(m => allTracesLower.some(t => t.includes(m)));
        const matchesGluten = item.checkGluten && product.gluten && product.gluten.hasGluten;
        if (matchesAllergen || matchesGluten) {
          div.classList.add("detected");
          anyGridActive = true;
        } else if (matchesTrace) {
          div.classList.add("traces");
          anyGridActive = true;
        } else {
          div.classList.add("safe");
        }
        div.innerHTML = `<span class="emoji">${item.emoji}</span><span class="label">${item.label}</span>`;
        gridEl.appendChild(div);
      });
      // Inferred allergens (por nombre, no de BD) marcar como "ai-suggested"
      if (product.inferredAllergens?.length > 0) {
        const aiLower = product.inferredAllergens.map(a => a.toLowerCase().trim());
        COMMON_ALLERGENS.forEach(item => {
          const matchesAI = item.match.some(m => aiLower.some(a => a.includes(m)));
          if (matchesAI) {
            const divs = gridEl.querySelectorAll(".allergen-grid-item");
            divs.forEach(div => {
              const label = div.querySelector(".label");
              if (label && item.match.some(m => label.textContent.toLowerCase().includes(m))) {
                if (div.classList.contains("safe")) {
                  div.classList.remove("safe");
                  div.classList.add("ai-suggested");
                  const badge = document.createElement("span");
                  badge.className = "ai-badge";
                  badge.textContent = "🤖";
                  div.appendChild(badge);
                }
              }
            });
          }
        });
      }
    }
    if (legendEl) legendEl.classList.remove("hidden");
  }

  // Text tags for non-common allergens
  allergensList.innerHTML = "";
  const knownMatchLabels = COMMON_ALLERGENS.flatMap(i => i.match);
  const extraAllergens = (product.allergens || []).filter(a => {
    const al = a.toLowerCase();
    return !knownMatchLabels.some(m => al.includes(m));
  });
  if (extraAllergens.length > 0) {
    allergensSafeMsg.classList.add("hidden");
    extraAllergens.forEach(allergen => {
      const iconKey = Object.keys(EXTRA_ALLERGEN_ICONS).find(k => allergen.toLowerCase().includes(k));
      const icon = iconKey ? EXTRA_ALLERGEN_ICONS[iconKey] : "⚠️";
      const tag = document.createElement("span");
      tag.className = "allergen-tag";
      tag.innerHTML = `${icon} ${esc(allergen)}`;
      allergensList.appendChild(tag);
    });
    allergensList.classList.remove("hidden");
  } else if (anyGridActive) {
    allergensSafeMsg.classList.add("hidden");
    allergensList.classList.add("hidden");
  } else if (product.allergensDataAvailable === false) {
    allergensSafeMsg.classList.remove("hidden");
    allergensSafeMsg.textContent = "Información no disponible (Requiere verificar el empaque)";
    allergensSafeMsg.className = "safe-msg allergen-unknown";
    allergensList.classList.add("hidden");
  } else {
    allergensSafeMsg.classList.remove("hidden");
    allergensSafeMsg.textContent = "✓ Sin alérgenos detectados en la información declarada.";
    allergensSafeMsg.className = "safe-msg";
    allergensList.classList.add("hidden");
  }

  // Render traces (may contain) — only traces NOT already in the icon grid
  const tracesSection = document.getElementById("traces-section");
  const tracesContainer = document.getElementById("traces-list");
  if (tracesSection && tracesContainer) {
    tracesContainer.innerHTML = "";
    if (product.traces && product.traces.length > 0) {
      const gridMatchLabels = COMMON_ALLERGENS.flatMap(i => i.match);
      const uniqueTraces = product.traces.filter(t => {
        const tl = t.toLowerCase();
        return !gridMatchLabels.some(m => tl.includes(m));
      });
      if (uniqueTraces.length > 0) {
        uniqueTraces.forEach(t => {
          const tag = document.createElement("span");
          tag.className = "allergen-tag traces-tag";
          tag.textContent = t;
          tracesContainer.appendChild(tag);
        });
        tracesSection.classList.remove("hidden");
      } else {
        tracesSection.classList.add("hidden");
      }
    } else {
      tracesSection.classList.add("hidden");
    }
  }
  cardAllergens.classList.remove("hidden");

  // Render Mexican warning seals (NOM-051)
  if (cardSellos && sellosContainer) {
    sellosContainer.innerHTML = "";
    if (product.sellos && product.sellos.length > 0) {
      product.sellos.forEach(sello => {
        const div = document.createElement("div");
        div.className = "sello-octagon";
        div.innerHTML = `<span class="sello-label">EXCESO</span><span class="sello-value">${sello.label}</span><span class="sello-detail">${sello.value}</span><span class="sello-threshold">${sello.threshold}</span>`;
        sellosContainer.appendChild(div);
      });
      cardSellos.classList.remove("hidden");
    } else {
      cardSellos.classList.add("hidden");
    }
  }

  // Render No Recomendado Para section
  renderNotRecommended(product);

  // Render nutrition info collapsible section
  const nutritionSection = document.getElementById("nutrition-section");
  const nutritionTbody = document.getElementById("nutrition-tbody");
  if (nutritionSection && nutritionTbody) {
    if (product.nutriments && Object.keys(product.nutriments).length > 0) {
      const nutrientLabels = {
        'energy-kcal_100g': 'Energía (kcal)',
        'energy_100g': 'Energía (kJ)',
        'fat_100g': 'Grasas',
        'saturated-fat_100g': 'Grasas saturadas',
        'carbohydrates_100g': 'Carbohidratos',
        'sugars_100g': 'Azúcares',
        'fiber_100g': 'Fibra',
        'proteins_100g': 'Proteínas',
        'salt_100g': 'Sal',
        'sodium_100g': 'Sodio'
      };
      const rows = [];
      Object.keys(nutrientLabels).forEach(key => {
        if (product.nutriments.hasOwnProperty(key) && product.nutriments[key] !== null && product.nutriments[key] !== undefined) {
          const val = fmt(product.nutriments[key]);
          const unit = key.includes('kcal') ? 'kcal' : key.includes('kJ') ? 'kJ' : 'g';
          rows.push(`<tr><td>${nutrientLabels[key]}</td><td>${val} ${unit}</td></tr>`);
        }
      });
      if (rows.length > 0) {
        nutritionTbody.innerHTML = rows.join('');
        nutritionSection.classList.remove("hidden");
        const fixNut = document.getElementById("btn-fix-nutrition");
        if (fixNut) fixNut.onclick = () => showNutritionModal(currentBarcode);
      } else {
        nutritionSection.classList.add("hidden");
      }
    } else {
      nutritionSection.classList.add("hidden");
    }
  }

  renderHypertensionCard(product);
  renderCholesterolCard(product);
  renderWeightCard(product);
  if (isDesktopSplit()) {
    document.querySelectorAll('#result-success details').forEach(d => { d.open = true; });
  }
  runAICheck(product, barcode);
}

let _lastAiProductKey = "";

function runAICheck(product, barcode) {
  showDBDisclaimer(product);
  const hasOcr = product._from_ocr || product._from_nutrition_ocr;
  const discOcrEl = document.getElementById("disclaimer-ocr");
  if (discOcrEl) discOcrEl.classList.toggle("hidden", !hasOcr);

  const key = product.name + "|" + product.brand;
  if (key === _lastAiProductKey) return;
  _lastAiProductKey = key;

  const scanToken = barcode;

  const loadingEl = document.getElementById("ai-loading");
  const errorEl = document.getElementById("ai-error");
  if (!loadingEl || !errorEl) return;

  loadingEl.classList.remove("hidden");
  errorEl.classList.add("hidden");


  function callProvider(provider, timeout) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    return fetch('/api/ai-query?provider=' + provider, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: product.name,
        brand: product.brand,
        ingredients: product.ingredientsText || null,
        allergens: product.allergens || null,
        sugars: product.sugars?.value ?? null,
        carbohydrates: product.carbohydrates?.value ?? null,
        fiber: product.carbohydrates?.fiber ?? null,
        isBeverage: product.isBeverage ?? null,
        dietary: product.dietary ?? null,
        scanLogId: currentScanLogId || null
      }),
      signal: controller.signal
    }).then(r => { clearTimeout(id); return r.json(); });
  }

  function processAIResult(data) {
    loadingEl.classList.add("hidden");
    errorEl.classList.add("hidden");
    if (data.error) throw new Error(data.error);

    // Merge AI dietary data with OFF data
    if (data.dietary && product.dietary) {
      const fields = ['vegan','vegetarian','halal','organic','nonGmo','noAdditives','palmOilFree','fairTrade','caseinFree'];
      fields.forEach(f => {
        if (product.dietary[f] == null && data.dietary[f] !== undefined) {
          product.dietary[f] = data.dietary[f];
          product.dietary[f + 'Source'] = 'ai';
          product.dietary[f + 'Detail'] = data.dietaryDetails?.[f] || null;
        }
      });
      renderDietaryBadges(product);
    }

    // Merge AI notRecommended
    if (data.notRecommended && Array.isArray(data.notRecommended) && product.notRecommended) {
      data.notRecommended.forEach(aiItem => {
        const reason = (aiItem.razon || '').toLowerCase();
        if (reason.includes('no aplica') || reason.includes('no contiene') || reason.includes('no apto') || reason.includes('no es')) return;
        const grupoClave = s => { const n = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); if (n.includes('diabet')) return 'diabet'; if (n.includes('hipert')) return 'hipert'; if (n.includes('lact')) return 'lactos'; if (n.includes('fenilc')) return 'fenilc'; if (n.includes('celiac') || n.includes('celiaq')) return 'celiac'; if (n.includes('gluten')) return 'gluten'; if (n.includes('nino') || n.includes('ninos') || n.includes('menor')) return 'ninos'; return n; };
        if (!product.notRecommended.some(n => grupoClave(n.grupo) === grupoClave(aiItem.grupo))) {
          const isGlutenWarning = /gluten|celiac|celiaq/i.test(aiItem.grupo + ' ' + aiItem.razon);
          const certain = isGlutenWarning && !!product.gluten?.hasGluten;
          product.notRecommended.push({ icon: "🤖", grupo: aiItem.grupo, razon: aiItem.razon, certain });
        }
      });
      renderNotRecommended(product);
    }

    // Merge AI allergens (solo si hay ingredientes; sin ellos la IA no tiene base)
    if (data.allergens && Array.isArray(data.allergens) && product.ingredientsText) {
      const allKnown = [
        ...(product.allergens || []),
        ...(product.traces || [])
      ].map(a => a.toLowerCase().trim());
      const aiAll = data.allergens.filter(a => !isGlutenRelated(a)).map(a => a.toLowerCase().trim());
      const canonical = (s) => { const m = { "soya": "soja", "mani": "cacahuate", "cacahuete": "cacahuate", "lácteos": "leche" }; return m[s] || s; };
      const allWords = (s) => s.replace(/[^a-záéíóúñ]/g, " ").split(/\s+/).filter(w => w.length > 2);
      const matchesKnown = (a) => {
        const ca = canonical(a);
        const stripParen = (s) => s.replace(/\s*\(.*?\)\s*/g, "").trim();
        if (allKnown.some(k => canonical(stripParen(k)) === stripParen(ca))) return true;
        const wa = allWords(ca);
        return allKnown.some(k => { const wk = allWords(k); return wa.some(w => wk.includes(w)); });
      };
      const aiOnly = aiAll.filter(a => !matchesKnown(a));
      if (aiOnly.length > 0) {
        product.aiAllergens = aiOnly;
        const gridEl = document.getElementById("allergen-icon-grid");
        if (product.allergensDataAvailable === false) {
          const legendEl = document.querySelector(".allergen-legend");
          if (gridEl) {
            cardAllergens.classList.remove("hidden");
            gridEl.classList.remove("hidden");
            gridEl.innerHTML = "";
            COMMON_ALLERGENS.forEach(item => {
              const div = document.createElement("div");
              div.className = "allergen-grid-item safe";
              div.innerHTML = `<span class="emoji">${item.emoji}</span><span class="label">${item.label}</span>`;
              gridEl.appendChild(div);
            });
          }
          if (legendEl) legendEl.classList.remove("hidden");
        }
        if (gridEl) {
          COMMON_ALLERGENS.forEach(item => {
            const matchesAI = item.match.some(m => aiOnly.some(a => a.includes(m)));
            if (matchesAI) {
              const divs = gridEl.querySelectorAll(".allergen-grid-item");
              divs.forEach(div => {
                const label = div.querySelector(".label");
                if (label && item.match.some(m => label.textContent.toLowerCase().includes(m))) {
                  if (div.classList.contains("safe")) {
                    div.classList.remove("safe");
                    div.classList.add("ai-suggested");
                    const badge = document.createElement("span");
                    badge.className = "ai-badge";
                    badge.textContent = "🤖";
                    div.appendChild(badge);
                  }
                }
              });
            }
          });
        }
        const legendEl = document.querySelector(".allergen-legend");
        if (legendEl && !legendEl.querySelector(".legend-item-ai")) {
          const aiLegend = document.createElement("span");
          aiLegend.className = "legend-item legend-item-ai";
          aiLegend.innerHTML = '<span class="dot dot-purple"></span> Sugerido por IA';
          legendEl.appendChild(aiLegend);
        }
        const knownMatchLabels = COMMON_ALLERGENS.flatMap(i => i.match);
        const extraAI = aiOnly.filter(a => !knownMatchLabels.some(m => a.includes(m)));
        const allergensList = document.getElementById("allergens-list");
        if (extraAI.length > 0) {
          const allergensSafeMsg = document.getElementById("allergens-safe-msg");
          if (allergensSafeMsg) allergensSafeMsg.classList.add("hidden");
          extraAI.forEach(allergen => {
            const iconKey = Object.keys(EXTRA_ALLERGEN_ICONS).find(k => allergen.includes(k));
            const icon = iconKey ? EXTRA_ALLERGEN_ICONS[iconKey] : "🤖";
            const tag = document.createElement("span");
            tag.className = "allergen-tag ai-suggested";
            tag.innerHTML = `${icon} ${esc(allergen)}`;
            tag.title = "Sugerido por análisis de IA";
            allergensList.appendChild(tag);
          });
          allergensList.classList.remove("hidden");
        }
      }
    }

    // Diabetes card
    if (data.diabetes) renderDiabetesCard(data.diabetes);

    // Merge AI gluten
    if (data.gluten && product.gluten) {
      if (product.gluten.dataAvailable === false || product.gluten.classification === "no_info") {
        product.gluten.hasGluten = data.gluten.hasGluten;
        product.gluten.details = data.gluten.details || product.gluten.details;
        product.gluten.classification = "declared";
        product.gluten.dataAvailable = true;
        product.gluten.source = 'ai';
        renderDietaryBadges(product);
      }
    }
  }

  // --- Ejecución secuencial: 7 proveedores en cadena ---
  const providers = [
    { query: 'groq&model=llama-3.3-70b-versatile', timeout: 7000, label: 'Groq 70b', model: 'llama-3.3-70b-versatile' },
    { query: 'groq&model=llama-3.1-8b-instant',    timeout: 7000, label: 'Groq 8b',   model: 'llama-3.1-8b-instant' },
    { query: 'groq&model=llama3-8b-8192',          timeout: 7000, label: 'Groq 8b-1K', model: 'llama3-8b-8192 (1000r/m)' },
    { query: 'groq&model=gemma2-9b-it',            timeout: 7000, label: 'Gemma2 9b', model: 'gemma2-9b-it' },
    { query: 'groq&model=qwen-2.5-32b',             timeout: 7000, label: 'Qwen 32b',  model: 'qwen-2.5-32b' },
    { query: 'openrouter',                          timeout: 12000, label: 'OpenRouter', model: 'openrouter/free' },
    { query: 'gemini',                              timeout: 14000, label: 'Gemini 2.5', model: 'gemini-2.5-flash' }
  ];

  (function tryProvider(i) {
    if (scanToken !== currentBarcodeQuery) return; // stale: a newer scan started meanwhile
    if (i >= providers.length) {
      loadingEl.classList.add("hidden");
      errorEl.textContent = 'Análisis IA no disponible. Todos los proveedores fallaron. Los datos de la base de datos ya están visibles.';
      errorEl.classList.remove("hidden");
      return;
    }
    const p = providers[i];
    callProvider(p.query, p.timeout)
      .then(data => {
        if (scanToken !== currentBarcodeQuery) return; // stale: a newer scan started meanwhile
        if (data.error) throw new Error(data.error);
        processAIResult(data);
      })
      .catch(err => {
        if (scanToken !== currentBarcodeQuery) return; // stale: a newer scan started meanwhile
        tryProvider(i + 1);
      });
  })(0);
}

function showDBDisclaimer(product) {
  const el = document.getElementById("db-disclaimer");
  const sourceEl = document.getElementById("db-disclaimer-source");
  if (!el || !sourceEl) return;
  if (product.isSimulated) {
    el.classList.add("hidden");
    return;
  }
  const sources = [];
  if (currentDataSources) sources.push(currentDataSources);
  if (product.isFromFallback) sources.push("UPCItemDB");
  if (product._enrichedFrom) sources.push(product._enrichedFrom);
  sourceEl.textContent = sources.join(" + ") || "Open Food Facts";
  el.classList.remove("hidden");
}

function renderDiabetesCard(d) {
  const card = document.getElementById("card-diabetes");
  const riskEl = document.getElementById("diabetes-risk");
  const impactEl = document.getElementById("diabetes-impact");
  const notesEl = document.getElementById("diabetes-notes");
  if (!card || !riskEl) return;
  const riskLabels = { bajo: "Bajo 🟢", medio: "Medio 🟡", alto: "Alto 🔴" };
  const impactLabels = { bajo: "Bajo 🟢", medio: "Medio 🟡", alto: "Alto 🔴" };
  const riskText = riskLabels[d.risk] || d.risk || "N/A";
  const impactText = impactLabels[d.glycemicImpact] || d.glycemicImpact || "N/A";
  riskEl.textContent = riskText;
  riskEl.className = "status-value diabetes-risk-" + (d.risk || "bajo");
  if (impactEl) {
    impactEl.classList.remove("hidden");
    impactEl.textContent = "Impacto glucémico: " + impactText;
  }
  if (notesEl) {
    notesEl.classList.remove("hidden");
    notesEl.textContent = d.notes || "";
  }
  card.classList.remove("hidden");
  showHealthRisks();
}

function showHealthRisks() {
  const container = document.getElementById("card-health-risks");
  if (!container) return;
  const cards = container.querySelectorAll(".health-card");
  const anyVisible = Array.from(cards).some(c => !c.classList.contains("hidden"));
  container.classList.toggle("hidden", !anyVisible);
}

function setRiskBar(progressEl, levelEl, risk, pct) {
  if (progressEl) {
    progressEl.style.width = Math.min(100, Math.max(0, pct)) + "%";
    progressEl.style.background = risk === "alto" || risk === "alta" ? "var(--accent-error)" : risk === "medio" || risk === "media" ? "var(--accent-alert)" : "var(--accent-primary)";
  }
  if (levelEl) {
    const cls = risk === "alto" || risk === "alta" ? "high" : risk === "medio" || risk === "media" ? "mod" : "low";
    levelEl.className = "level-indicator health-level-" + cls;
    levelEl.textContent = (risk === "alto" || risk === "alta" ? "Alto" : risk === "medio" || risk === "media" ? "Medio" : "Bajo");
  }
}

function renderHypertensionCard(product) {
  const card = document.getElementById("card-hypertension");
  const riskEl = document.getElementById("hypertension-risk");
  const progressEl = document.getElementById("hypertension-progress");
  const levelEl = document.getElementById("hypertension-level");
  const sodiumEl = document.getElementById("hypertension-sodium");
  const notesEl = document.getElementById("hypertension-notes");
  if (!card || !riskEl) return;
  const nutriments = product.nutriments || {};
  let sodiumMg = null;
  if (nutriments['sodium_100g'] !== undefined) sodiumMg = Math.round(nutriments['sodium_100g'] * 1000);
  if (sodiumMg === null && nutriments['salt_100g'] !== undefined) sodiumMg = Math.round(nutriments['salt_100g'] * 0.393 * 1000);
  if (sodiumMg === null || sodiumMg === 0) { card.classList.add("hidden"); showHealthRisks(); return; }
  let risk, label;
  if (sodiumMg > 400) { risk = "alto"; label = "Alto 🔴"; }
  else if (sodiumMg >= 120) { risk = "medio"; label = "Medio 🟡"; }
  else { risk = "bajo"; label = "Bajo 🟢"; }
  riskEl.textContent = label;
  riskEl.className = "status-value hypertension-risk-" + risk;
  setRiskBar(progressEl, levelEl, risk, (sodiumMg / 800) * 100);
  if (sodiumEl) {
    sodiumEl.classList.remove("hidden");
    sodiumEl.textContent = "Sodio: " + sodiumMg + " mg / 100g";
  }
  if (notesEl) {
    const notes = risk === "alto"
      ? "Alto contenido de sodio. Puede elevar la presión arterial."
      : risk === "medio"
        ? "Contenido moderado de sodio. Revisa el consumo diario total."
        : "Bajo en sodio. Apto para dietas de restricción de sodio.";
    notesEl.classList.remove("hidden");
    notesEl.textContent = notes;
  }
  card.classList.remove("hidden");
  showHealthRisks();
}

function renderCholesterolCard(product) {
  const card = document.getElementById("card-cholesterol");
  const riskEl = document.getElementById("cholesterol-risk");
  const progressEl = document.getElementById("cholesterol-progress");
  const levelEl = document.getElementById("cholesterol-level");
  const satfatEl = document.getElementById("cholesterol-satfat");
  const notesEl = document.getElementById("cholesterol-notes");
  if (!card || !riskEl) return;
  const satFat = product.nutriments?.['saturated-fat_100g'];
  if (satFat === undefined || satFat === null) { card.classList.add("hidden"); showHealthRisks(); return; }
  const satFatR = Math.round(satFat * 10) / 10;
  let risk, label;
  if (satFatR > 6) { risk = "alto"; label = "Alto 🔴"; }
  else if (satFatR >= 3) { risk = "medio"; label = "Medio 🟡"; }
  else { risk = "bajo"; label = "Bajo 🟢"; }
  riskEl.textContent = label;
  riskEl.className = "status-value cholesterol-risk-" + risk;
  setRiskBar(progressEl, levelEl, risk, (satFatR / 12) * 100);
  if (satfatEl) {
    satfatEl.classList.remove("hidden");
    satfatEl.textContent = "Grasas saturadas: " + satFatR + " g / 100g";
  }
  if (notesEl) {
    const notes = risk === "alto"
      ? "Alto en grasas saturadas. La OMS recomienda menos del 10% de las calorías diarias."
      : risk === "medio"
        ? "Cantidad moderada de grasas saturadas."
        : "Bajo en grasas saturadas. Apto para dietas de control de colesterol.";
    notesEl.classList.remove("hidden");
    notesEl.textContent = notes;
  }
  card.classList.remove("hidden");
  showHealthRisks();
}

function renderWeightCard(product) {
  const card = document.getElementById("card-weight");
  const densityEl = document.getElementById("weight-density");
  const progressEl = document.getElementById("weight-progress");
  const levelEl = document.getElementById("weight-level");
  const detailEl = document.getElementById("weight-detail");
  const notesEl = document.getElementById("weight-notes");
  if (!card || !densityEl) return;
  const kcal = product.calories?.value || 0;
  if (kcal === 0) { card.classList.add("hidden"); showHealthRisks(); return; }
  let risk, label, detail;
  if (kcal > 300) { risk = "alta"; label = "Alta 🔴"; detail = ">300 kcal/100g. Porción pequeña = muchas calorías. Dificulta mantener un peso saludable."; }
  else if (kcal >= 150) { risk = "media"; label = "Media 🟡"; detail = "150–300 kcal/100g. Densidad moderada: requiere controlar el tamaño de la porción."; }
  else { risk = "baja"; label = "Baja 🟢"; detail = "<150 kcal/100g. Puedes comer un volumen mayor por pocas calorías. Favorece el control de peso."; }
  densityEl.textContent = label;
  densityEl.className = "status-value weight-density-" + risk;
  setRiskBar(progressEl, levelEl, risk, (kcal / 600) * 100);
  if (detailEl) {
    detailEl.classList.remove("hidden");
    detailEl.textContent = kcal + " kcal / 100g — " + detail;
  }
  if (notesEl) {
    const extras = [];
    const sugars = product.sugars?.value;
    const satFat = product.nutriments?.['saturated-fat_100g'];
    if (sugars !== null && sugars > 10) extras.push("azúcares elevados (" + sugars + "g)");
    if (satFat !== null && satFat > 3) extras.push("grasas saturadas elevadas (" + Math.round(satFat * 10) / 10 + "g)");
    if (extras.length > 0) {
      notesEl.classList.remove("hidden");
      notesEl.textContent = "Factores adicionales: " + extras.join(", ") + ".";
    } else {
      notesEl.classList.add("hidden");
    }
  }
  card.classList.remove("hidden");
  showHealthRisks();
}

function showReportCardIfNeeded() {
  const reportCard = document.getElementById("card-report");
  if (reportCard) {
    reportCard.classList.remove("hidden");
    const reportBtn = document.getElementById("btn-report");
    if (reportBtn) reportBtn.onclick = showReportModal;
  }
}


// Render rejected state screen
function renderRejected(product) {
  showState(resultRejected);
  rejectedTitle.textContent = product.isSimulated ? "Producto Simulado (No Alimento)" : "Producto Rechazado";
  rejectedMessage.textContent = product.isSimulated
    ? "Simulación offline: Este producto no es un alimento. Yomi solo analiza alimentos para consumo humano."
    : "Este producto no es un alimento. Yomi solo analiza alimentos o bebidas de consumo humano.";
  rejectedProductName.textContent = product.name || "Producto no identificado";
  rejectedProductCategory.textContent = product.category || "No alimenticio / Higiene / Otros";
}

// Render Not Found screen (extends rejected layout style)
function renderNotFound() {
  showState(resultRejected);
  rejectedTitle.textContent = "No Encontrado";
  rejectedMessage.textContent = "No encontramos este código de barras en las bases de datos disponibles.";
  rejectedProductName.textContent = "Desconocido";
  rejectedProductCategory.textContent = "N/D";
}

// Render generic error message screen (extends rejected layout style)
function renderError(title, message) {
  showState(resultRejected);
  rejectedTitle.textContent = title;
  rejectedMessage.textContent = message;
  rejectedProductName.textContent = "-";
  rejectedProductCategory.textContent = "-";
}

// === OCR INGREDIENT CAPTURE ===

function showOcrModal(barcode) {
  if (barcode) currentBarcode = barcode;
  const modal = document.getElementById("ocr-modal");
  if (modal) {
    modal.classList.remove("hidden");
    document.getElementById("ocr-step-1").classList.remove("hidden");
    document.getElementById("ocr-step-2").classList.add("hidden");
    document.getElementById("ocr-step-3").classList.add("hidden");
    document.getElementById("ocr-step-4").classList.add("hidden");
  }
}

function hideOcrModal() {
  const modal = document.getElementById("ocr-modal");
  if (modal) {
    const step4 = document.getElementById("ocr-step-4");
    const savedSuccessfully = step4 && !step4.classList.contains("hidden");
    modal.classList.add("hidden");
    if (savedSuccessfully && currentBarcode) analyzeBarcode(currentBarcode);
  }
}

function initOcrHandlers() {
  const fileInput = document.getElementById("ocr-photo-input");
  const uploadBtn = document.getElementById("ocr-upload-btn");
  const closeBtn = document.getElementById("ocr-modal-close");
  const editBtn = document.getElementById("ocr-edit-btn");
  const saveBtn = document.getElementById("ocr-save-btn");
  const finalCloseBtn = document.getElementById("ocr-close-btn");

  if (uploadBtn) uploadBtn.onclick = () => fileInput?.click();

  if (fileInput) {
    fileInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      document.getElementById("ocr-step-1").classList.add("hidden");
      document.getElementById("ocr-step-2").classList.remove("hidden");

      try {
        const imgUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = async () => {
          try {
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, 1200 / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(imgUrl);

            const imageData = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
            console.log('[OCR Vision] Sending image', canvas.width, 'x', canvas.height);

            const response = await fetch("/api/ocr/process", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imageData })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Error al procesar");

            const textArea = document.getElementById("ocr-result");
            if (textArea) textArea.value = data.cleanedText || "";

            document.getElementById("ocr-step-2").classList.add("hidden");
            document.getElementById("ocr-step-3").classList.remove("hidden");
          } catch (err) {
            console.error("[OCR Vision] Error:", err);
            alert("Error al procesar imagen:\n" + (err?.message || err));
            document.getElementById("ocr-step-2").classList.add("hidden");
            document.getElementById("ocr-step-1").classList.remove("hidden");
          }
        };
        img.src = imgUrl;
      } catch (err) {
        console.error("[OCR Vision] Error:", err);
        alert("Error al procesar imagen:\n" + (err?.message || err));
        document.getElementById("ocr-step-2").classList.add("hidden");
        document.getElementById("ocr-step-1").classList.remove("hidden");
      }
    };
  }

  if (editBtn) {
    editBtn.onclick = () => {
      const textArea = document.getElementById("ocr-result");
      if (textArea) textArea.removeAttribute("readonly");
      editBtn.style.display = "none";
    };
  }

  if (saveBtn) {
    saveBtn.onclick = async () => {
      if (!currentBarcode) return;

      saveBtn.disabled = true;
      const originalText = saveBtn.textContent;
      saveBtn.textContent = "💾 Guardando...";
      const textArea = document.getElementById("ocr-result");
      const ingredients = textArea?.value || "";

      try {
        const response = await fetch("/api/products/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ barcode: currentBarcode, ingredients, scanLogId: currentScanLogId })
        });

        if (!response.ok) throw new Error(`Error ${response.status}`);

        document.getElementById("ocr-step-3").classList.add("hidden");
        document.getElementById("ocr-step-4").classList.remove("hidden");
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
      } catch (err) {
        console.error("Save error:", err);
        alert("Error al guardar: " + err.message);
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
      }
    };
  }

  if (closeBtn) closeBtn.onclick = hideOcrModal;
  if (finalCloseBtn) finalCloseBtn.onclick = hideOcrModal;

  const overlay = document.querySelector(".modal-overlay");
  if (overlay) overlay.onclick = hideOcrModal;
}

// Nutrition OCR Modal Functions
function showNutritionModal(barcode) {
  if (barcode) currentBarcode = barcode;
  const modal = document.getElementById("nutrition-modal");
  if (modal) {
    modal.classList.remove("hidden");
    document.getElementById("nutrition-step-1").classList.remove("hidden");
    document.getElementById("nutrition-step-2").classList.add("hidden");
    document.getElementById("nutrition-step-3").classList.add("hidden");
    document.getElementById("nutrition-step-4").classList.add("hidden");
  }
}

function hideNutritionModal() {
  const modal = document.getElementById("nutrition-modal");
  if (modal) {
    const step4 = document.getElementById("nutrition-step-4");
    const savedSuccessfully = step4 && !step4.classList.contains("hidden");
    modal.classList.add("hidden");
    if (savedSuccessfully && currentBarcode) analyzeBarcode(currentBarcode);
  }
}

function initNutritionHandlers() {
  const closeBtn = document.getElementById("nutrition-modal-close");
  const uploadBtn = document.getElementById("nutrition-upload-btn");
  const photoInput = document.getElementById("nutrition-photo-input");
  const overlay = document.getElementById("nutrition-modal-overlay");

  if (uploadBtn && photoInput) {
    uploadBtn.onclick = () => {
      photoInput.click();
    };

    photoInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      document.getElementById("nutrition-step-1").classList.add("hidden");
      document.getElementById("nutrition-step-2").classList.remove("hidden");

      try {
        const imgUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = async () => {
          try {
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, 1024 / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(imgUrl);

            // Strip data URL prefix, send raw base64 to vision LLM
            const imageData = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
            console.log('[Nutrition Vision] Sending image', canvas.width, 'x', canvas.height, '— skipped Tesseract');

            const response = await fetch("/api/nutrition/process", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imageData })
            });

            const responseData = await response.json();
            if (!response.ok) throw new Error(responseData.error || "Error al procesar");

            const nutritionData = responseData.nutritionData || {};
            const nutritionStr = Object.entries(nutritionData).map(([k, v]) => `${k}: ${v}`).join("\n");

            document.getElementById("nutrition-result").value = nutritionStr || "(Sin valores extraídos)";
            document.getElementById("nutrition-step-2").classList.add("hidden");
            document.getElementById("nutrition-step-3").classList.remove("hidden");
          } catch (err) {
            console.error("Nutrition Vision error:", err);
            alert("Error al procesar: " + err.message);
            document.getElementById("nutrition-step-1").classList.remove("hidden");
            document.getElementById("nutrition-step-2").classList.add("hidden");
          }
        };
        img.src = imgUrl;
      } catch (err) {
        console.error("Nutrition Vision error:", err);
        alert("Error al procesar nutrientes: " + err.message);
        document.getElementById("nutrition-step-1").classList.remove("hidden");
        document.getElementById("nutrition-step-2").classList.add("hidden");
      }
    };
  }

  const saveBtn = document.getElementById("nutrition-save-btn");
  const finalCloseBtn = document.getElementById("nutrition-close-btn");
  const editBtn = document.getElementById("nutrition-edit-btn");

  if (editBtn) editBtn.onclick = () => {
    document.getElementById("nutrition-result").removeAttribute("readonly");
    editBtn.style.display = "none";
  };

  if (saveBtn) saveBtn.onclick = async () => {
    if (!currentBarcode) return;
    saveBtn.disabled = true;
    const original = saveBtn.textContent;
    saveBtn.textContent = "💾 Guardando...";

    const textareaVal = document.getElementById("nutrition-result").value || "";
    const nutritionData = {};
    textareaVal.split("\n").forEach(line => {
      const idx = line.indexOf(":");
      if (idx > 0) nutritionData[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });

    try {
      const response = await fetch("/api/products/nutrition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: currentBarcode, nutritionData, scanLogId: currentScanLogId })
      });
      if (!response.ok) throw new Error(`Error ${response.status}`);
      document.getElementById("nutrition-step-3").classList.add("hidden");
      document.getElementById("nutrition-step-4").classList.remove("hidden");
      saveBtn.disabled = false;
      saveBtn.textContent = original;
    } catch (err) {
      alert("Error al guardar: " + err.message);
      saveBtn.disabled = false;
      saveBtn.textContent = original;
    }
  };

  if (finalCloseBtn) finalCloseBtn.onclick = () => {
    const b = currentBarcode;
    hideNutritionModal();
    if (b) analyzeBarcode(b);
  };

  if (closeBtn) closeBtn.onclick = hideNutritionModal;
  if (overlay) overlay.onclick = hideNutritionModal;
}

// === REPORT MODAL ===

function showReportModal() {
  const modal = document.getElementById("report-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  document.getElementById("report-step-1").classList.remove("hidden");
  document.getElementById("report-step-2").classList.add("hidden");
  document.getElementById("report-step-3").classList.add("hidden");
  // Reset form
  document.querySelectorAll('input[name="report-cat"]').forEach(r => r.checked = false);
  const comment = document.getElementById("report-comment");
  if (comment) comment.value = "";
  const err = document.getElementById("report-error");
  if (err) err.textContent = "";
  const preview = document.getElementById("report-photo-preview");
  if (preview) { preview.src = ""; preview.style.display = "none"; }
  const nameEl = document.getElementById("report-photo-name");
  if (nameEl) nameEl.textContent = "";
  const photoInput = document.getElementById("report-photo-input");
  if (photoInput) photoInput.value = "";
}

function hideReportModal() {
  const modal = document.getElementById("report-modal");
  if (modal) modal.classList.add("hidden");
}

function initReportHandlers() {
  const modal = document.getElementById("report-modal");
  if (!modal) return;

  let capturedImage = null;

  const closeBtn = document.getElementById("report-modal-close");
  const overlay = document.getElementById("report-modal-overlay");
  const photoBtn = document.getElementById("report-photo-btn");
  const photoInput = document.getElementById("report-photo-input");
  const preview = document.getElementById("report-photo-preview");
  const photoName = document.getElementById("report-photo-name");
  const sendBtn = document.getElementById("report-send-btn");
  const errEl = document.getElementById("report-error");
  const closeFinalBtn = document.getElementById("report-close-btn");

  if (closeBtn) closeBtn.onclick = hideReportModal;
  if (overlay) overlay.onclick = hideReportModal;
  if (closeFinalBtn) closeFinalBtn.onclick = hideReportModal;

  if (photoBtn && photoInput) photoBtn.onclick = () => photoInput.click();

  if (photoInput) {
    photoInput.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const imgUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 900 / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(imgUrl);
        capturedImage = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
        if (preview) { preview.src = 'data:image/jpeg;base64,' + capturedImage; preview.style.display = 'block'; }
        if (photoName) photoName.textContent = file.name;
      };
      img.src = imgUrl;
    };
  }

  if (sendBtn) {
    sendBtn.onclick = async () => {
      const category = document.querySelector('input[name="report-cat"]:checked')?.value || '';
      const comment = document.getElementById("report-comment")?.value.trim() || '';
      if (!category && !comment) {
        if (errEl) errEl.textContent = 'Elige una categoría o escribe un comentario.';
        return;
      }
      if (errEl) errEl.textContent = '';
      document.getElementById("report-step-1").classList.add("hidden");
      document.getElementById("report-step-2").classList.remove("hidden");

      try {
        const resp = await fetch('/api/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            barcode: currentBarcode || '',
            productName: document.getElementById("product-name")?.textContent || '',
            category, comment,
            ...(capturedImage ? { image: capturedImage } : {})
          }),
          signal: AbortSignal.timeout(12000)
        });
        if (!resp.ok) throw new Error((await resp.json()).error || 'Error');
        document.getElementById("report-step-2").classList.add("hidden");
        document.getElementById("report-step-3").classList.remove("hidden");
        capturedImage = null;
      } catch (err) {
        document.getElementById("report-step-2").classList.add("hidden");
        document.getElementById("report-step-1").classList.remove("hidden");
        if (errEl) errEl.textContent = 'Error al enviar: ' + err.message;
      }
    };
  }
}

// Call init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initOcrHandlers();
    initNutritionHandlers();
    initReportHandlers();
  });
} else {
  initOcrHandlers();
  initNutritionHandlers();
  initReportHandlers();
}

