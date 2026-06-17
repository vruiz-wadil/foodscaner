/* ==========================================================================
   Yomi Core JavaScript Logic
   ========================================================================== */

function esc(s) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(s)));
  return div.innerHTML;
}

// Global state
let currentBarcode = null;

// DOM Elements
const btnToggleCamera = document.getElementById("btn-toggle-camera");
const cameraSelectWrapper = document.getElementById("camera-select-wrapper");
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

// Result Elements (Rejected)
const rejectedTitle = document.getElementById("rejected-title");
const rejectedMessage = document.getElementById("rejected-message");
const rejectedProductName = document.getElementById("rejected-product-name");
const rejectedProductCategory = document.getElementById("rejected-product-category");

let currentBarcodeQuery = "";
let currentDataSources = "";
let currentSourceResults = [];

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

// Application Scanner State
let html5QrCode = null;
let isScanning = false;

// Initialize Application
document.addEventListener("DOMContentLoaded", setupEventListeners);

function setupEventListeners() {
  // Toggle camera scanner
  btnToggleCamera.addEventListener("click", toggleCamera);
  
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

// Camera Scanner Logic using html5-qrcode
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
    btnToggleCamera.style.background = "linear-gradient(135deg, var(--accent-error), #dc2626)";
    btnToggleCamera.style.boxShadow = "0 4px 15px var(--accent-error-glow)";

    // Request permissions and get cameras
    const devices = await Html5Qrcode.getCameras();
    if (devices && devices.length > 0) {
      // Build camera selection list
      cameraSelect.innerHTML = "";
      devices.forEach(device => {
        const option = document.createElement("option");
        option.value = device.id;
        option.text = device.label || `Cámara ${cameraSelect.length + 1}`;
        cameraSelect.appendChild(option);
      });

      if (devices.length > 1) {
        cameraSelectWrapper.classList.remove("hidden");
      }

      // Detect rear camera by label keywords
      const rearKeywords = ["back", "rear", "environment", "trasera", "posterior", "trás"];
      const rearCam = devices.find(d =>
        rearKeywords.some(kw => d.label.toLowerCase().includes(kw))
      );
      const defaultCam = rearCam || devices[0];

      // Pre-select rear camera in dropdown
      cameraSelect.value = defaultCam.id;

      // Initialize scanner object
      html5QrCode = new Html5Qrcode("interactive-scanner");
      isScanning = true;

      // Start scanning using rear camera by default
      startScanning(defaultCam.id);
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

function startScanning(cameraId) {
  if (!html5QrCode) return;

  html5QrCode.start(
    cameraId,
    {
      fps: 15,
      qrbox: (width, height) => {
        // Return responsive scanning box size
        const minDim = Math.min(width, height);
        return { width: Math.floor(minDim * 0.7), height: Math.floor(minDim * 0.4) };
      }
    },
    (decodedText) => {
      // SUCCESS CALLBACK
      console.log(`Código detectado: ${decodedText}`);
      // Auto fill input
      barcodeInput.value = decodedText;
      // Vibrate if supported
      if (navigator.vibrate) {
        navigator.vibrate(100);
      }
      // Beep sound
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.value = 0.3;
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } catch (e) { /* audio no disponible */ }
      stopScanning();
      analyzeBarcode(decodedText);
    },
    () => {}
  ).catch(err => {
    console.error("Error al iniciar scanner:", err);
  });
}

function stopScanning() {
  if (!html5QrCode) return;

  html5QrCode.stop().then(() => {
    html5QrCode = null;
    resetCameraButton();
  }).catch(err => {
    console.error("Error al detener scanner:", err);
    resetCameraButton();
  });
}

function restartCameraWithSelectedDevice() {
  if (!isScanning || !html5QrCode) return;

  const selectedCameraId = cameraSelect.value;
  html5QrCode.stop().then(() => {
    startScanning(selectedCameraId);
  }).catch(err => {
    console.error("Error al cambiar de cámara:", err);
  });
}

function resetCameraButton() {
  isScanning = false;
  scannerView.classList.remove("active");
  cameraSelectWrapper.classList.add("hidden");
  btnToggleCamera.innerHTML = `
    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
    Activar Cámara
  `;
  btnToggleCamera.style.background = "linear-gradient(135deg, var(--accent-primary), #059669)";
  btnToggleCamera.style.boxShadow = "0 4px 15px var(--accent-primary-glow)";
}

// Display Result State Panels
function showState(stateElement) {
  [resultEmpty, resultLoading, resultRejected, resultSuccess].forEach(el => {
    el.classList.remove("active");
  });
  stateElement.classList.add("active");
  
  if (stateElement !== resultEmpty) {
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

    currentDataSources = data.sourceLabel || "Desconocido";
    currentSourceResults = data.sourceResults || [];

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
    renderConfidenceWidget();
    renderCacheStatus(product, barcode);
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
  const d = { vegan: null, vegetarian: null, kosher: null, halal: null, organic: null, nonGmo: null, noAdditives: null, palmOilFree: null, fairTrade: null };
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
  return d;
}

function renderDietaryBadges(product) {
  const section = document.getElementById("dietary-section");
  // Asegurar que dietary exista extrayendo desde labels del OFF si es necesario
  if (!product.dietary) {
    product.dietary = product.labelsTags ? extractDietaryFromLabels(product.labelsTags) : { vegan: null, vegetarian: null, kosher: null, halal: null, organic: null, nonGmo: null, noAdditives: null, palmOilFree: null, fairTrade: null };
  } else if (product.labelsTags && !product.labelsTagsMerged) {
    // Fill null dietary fields from labels (e.g., nonGmo from en:non-gmo-project)
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
  const glutenStatus = document.getElementById("dietary-gluten-status");
  const glutenDetail = document.getElementById("dietary-gluten-detail");
  const veganStatus = document.getElementById("dietary-vegan-status");
  const veganDetail = document.getElementById("dietary-vegan-detail");
  const vegStatus = document.getElementById("dietary-vegetarian-status");
  const vegDetail = document.getElementById("dietary-vegetarian-detail");
  const kosherStatus = document.getElementById("dietary-kosher-status");
  const kosherDetail = document.getElementById("dietary-kosher-detail");
  const halalStatus = document.getElementById("dietary-halal-status");
  const halalDetail = document.getElementById("dietary-halal-detail");
  const organicStatus = document.getElementById("dietary-organic-status");
  const organicDetail = document.getElementById("dietary-organic-detail");
  const nonGmoStatus = document.getElementById("dietary-non-gmo-status");
  const nonGmoDetail = document.getElementById("dietary-non-gmo-detail");
  const noAdditivesStatus = document.getElementById("dietary-no-additives-status");
  const noAdditivesDetail = document.getElementById("dietary-no-additives-detail");
  const palmOilFreeStatus = document.getElementById("dietary-palm-oil-free-status");
  const palmOilFreeDetail = document.getElementById("dietary-palm-oil-free-detail");
  const fairTradeStatus = document.getElementById("dietary-fair-trade-status");
  const fairTradeDetail = document.getElementById("dietary-fair-trade-detail");

  function getRow(attrId) {
    const el = document.getElementById(attrId);
    return el ? el.closest(".dietary-row") : null;
  }

  function setStatus(el, row, colorClass, text) {
    el.className = "dietary-status " + colorClass;
    el.textContent = text;
  }

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

  function setupRow(row, detailEl, detailHtml) {
    if (!row || !detailEl) return;
    if (!row.querySelector(".dietary-row-header")) {
      row.insertAdjacentHTML("afterbegin", '<div class="dietary-row-header"></div>');
      const header = row.querySelector(".dietary-row-header");
      const attr = row.querySelector(".dietary-attr");
      const status = row.querySelector(".dietary-status");
      const chevron = row.querySelector(".dietary-chevron");
      if (attr && status && chevron) {
        header.appendChild(attr);
        header.appendChild(status);
        header.appendChild(chevron);
      }
    }
    detailEl.innerHTML = detailHtml || "";
    row.onclick = function(e) {
      if (e.target.closest(".dietary-detail")) return;
      row.classList.toggle("open");
      detailEl.classList.toggle("hidden");
    };
  }

  // Gluten row
  if (g) {
    const glutenRow = getRow("dietary-gluten-attr");
    let glutenColor, glutenText;
    if (g.classification === "certified") {
      glutenColor = "db-yes"; glutenText = "Sí";
    } else if (!g.hasGluten && g.classification !== "no_info") {
      glutenColor = "ai-yes"; glutenText = "Posiblemente Libre";
    } else if (g.hasGluten && g.source === 'ai') {
      glutenColor = "ai-no"; glutenText = "Posiblemente NO Libre";
    } else if (g.hasGluten) {
      glutenColor = "db-no"; glutenText = "No";
    } else {
      glutenColor = "unknown"; glutenText = "Sin Info";
    }
    setStatus(glutenStatus, glutenRow, glutenColor, glutenText);
    setupRow(glutenRow, glutenDetail, buildGlutenDetail(g));
  }

  const defaultLabels = { vegan: "🌱 Vegano", vegetarian: "🥦 Vegetariano", kosher: "✡️ Kosher", halal: "🌙 Halal", organic: "🌿 Orgánico", nonGmo: "🧬 Sin OGM", noAdditives: "🧪 Sin Aditivos", palmOilFree: "🌴 Sin Aceite de Palma", fairTrade: "🤝 Comercio Justo" };

  function makeDietRow(dietVal, source, detailId, dietName, label, attrId) {
    const statusEl = { vegan: veganStatus, vegetarian: vegStatus, kosher: kosherStatus, halal: halalStatus, organic: organicStatus, nonGmo: nonGmoStatus, noAdditives: noAdditivesStatus, palmOilFree: palmOilFreeStatus, fairTrade: fairTradeStatus }[label];
    const rowEl = getRow(attrId);
    const detailEl = { vegan: veganDetail, vegetarian: vegDetail, kosher: kosherDetail, halal: halalDetail, organic: organicDetail, nonGmo: nonGmoDetail, noAdditives: noAdditivesDetail, palmOilFree: palmOilFreeDetail, fairTrade: fairTradeDetail }[label];
    const attrEl = document.getElementById(attrId);
    if (attrEl && defaultLabels[label]) attrEl.textContent = defaultLabels[label];
    if (dietVal === true) {
      const isDb = source === 'db';
      const color = isDb ? 'db-yes' : 'ai-yes';
      setStatus(statusEl, rowEl, color, isDb ? "Sí" : "Probable");
      setupRow(rowEl, detailEl, buildDetailText(color, dietName, d[label + "Detail"] || ""));
    } else if (dietVal === false) {
      const isDb = source === 'db';
      const color = isDb ? 'db-no' : 'ai-no';
      setStatus(statusEl, rowEl, color, isDb ? "No" : "Probable No");
      setupRow(rowEl, detailEl, buildDetailText(color, dietName, d[label + "Detail"] || ""));
    } else {
      setStatus(statusEl, rowEl, "unknown", "Sin Info");
      setupRow(rowEl, detailEl, buildDetailText("unknown", dietName));
    }
  }

  const dietMeta = [
    { val: d.vegan, src: d.veganSource, label: "vegan", dietName: "vegano", attrId: "dietary-vegan-attr" },
    { val: d.vegetarian, src: d.vegetarianSource, label: "vegetarian", dietName: "vegetariano", attrId: "dietary-vegetarian-attr" },
    { val: d.kosher, src: d.kosherSource, label: "kosher", dietName: "kosher", attrId: "dietary-kosher-attr" },
    { val: d.halal, src: d.halalSource, label: "halal", dietName: "halal", attrId: "dietary-halal-attr" },
    { val: d.organic, src: d.organicSource, label: "organic", dietName: "orgánico", attrId: "dietary-organic-attr" },
    { val: d.nonGmo, src: d.nonGmoSource, label: "nonGmo", dietName: "libre de OGM", attrId: "dietary-non-gmo-attr" },
    { val: d.noAdditives, src: d.noAdditivesSource, label: "noAdditives", dietName: "libre de aditivos", attrId: "dietary-no-additives-attr" },
    { val: d.palmOilFree, src: d.palmOilFreeSource, label: "palmOilFree", dietName: "libre de aceite de palma", attrId: "dietary-palm-oil-free-attr" },
    { val: d.fairTrade, src: d.fairTradeSource, label: "fairTrade", dietName: "de comercio justo", attrId: "dietary-fair-trade-attr" }
  ];
  dietMeta.forEach(m => makeDietRow(m.val, m.src, m.label, m.dietName, m.label, m.attrId));
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

  if (product.image) {
    productImg.src = product.image;
    productImg.alt = product.name;
  } else {
    productImg.src = "";
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

  // Show nutrition capture button if no nutrients available
  const hasNutrients = product.nutriments && Object.keys(product.nutriments).length > 0;
  const nutritionRequestBtn = document.getElementById("btn-nutrition-capture");
  const nutritionCaptureSection = document.getElementById("nutrition-capture-section");
  if (nutritionRequestBtn && nutritionCaptureSection) {
    if (!hasNutrients) {
      nutritionCaptureSection.classList.remove("hidden");
      nutritionRequestBtn.onclick = () => showNutritionModal(currentBarcode);
    } else {
      nutritionCaptureSection.classList.add("hidden");
    }
  }

  if (product.isFromFallback && !product._enrichedFrom && !product.ingredientsText) {
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

  analysisGrid.classList.remove("hidden");
  noNutritionAlert.classList.add("hidden");

  // Gluten card hidden (info shown in dietary table)

  function styleCard(levelEl, progressEl, level, classMap, bgMap) {
    levelEl.className = classMap[level] || classMap["default"];
    progressEl.style.background = bgMap[level] || bgMap["default"];
  }

  const lvlBg = (h, m, l) => ({ Alto: h, Medio: m, Moderado: m, Bajo: l, default: l });
  const lvlCls = (prefix, h, m, l) => ({ Alto: prefix + h, Medio: prefix + m, Moderado: prefix + m, Bajo: prefix + l, default: prefix + l });

  // Render Calories Card details
  caloriesVal.querySelector(".number").textContent = fmt(product.calories.value);
  caloriesProgress.style.width = `${product.calories.percent}%`;
  caloriesLevel.textContent = `Nivel de energía: ${product.calories.level}`;
  cardCalories.className = "analysis-card";
  styleCard(caloriesLevel, caloriesProgress, product.calories.level,
    lvlCls("level-indicator calories-", "high", "mod", "low"),
    lvlBg("var(--accent-error)", "var(--accent-alert)", "var(--accent-primary)"));

  // Render Sugars Card
  if (product.sugars && product.sugars.value !== null) {
    cardSugars.classList.remove("hidden");
    sugarsVal.textContent = fmt(product.sugars.value) + " g / 100g";
    sugarsProgress.style.width = product.sugars.percent + "%";
    sugarsLevel.textContent = "Nivel de azúcar: " + product.sugars.level;
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
  runAICheck(product, barcode);
}

let _lastAiProductKey = "";

function runAICheck(product, barcode) {
  showDBDisclaimer(product);

  const key = product.name + "|" + product.brand;
  if (key === _lastAiProductKey) return;
  _lastAiProductKey = key;

  const scanToken = barcode;

  const loadingEl = document.getElementById("ai-loading");
  const errorEl = document.getElementById("ai-error");
  const providerLogEl = document.getElementById("ai-provider-log");
  if (!loadingEl || !errorEl || !providerLogEl) return;

  providerLogEl.innerHTML = '';
  providerLogEl.classList.remove("hidden");
  loadingEl.classList.remove("hidden");
  errorEl.classList.add("hidden");

  function addProviderLog(provider, status, msg, raw) {
    const entry = document.createElement("div");
    entry.className = "provider-entry";
    entry.innerHTML = `<span class="status-dot ${status}"></span><span class="provider-name">${provider}</span> ${msg}`;
    if (raw) entry.title = raw;
    providerLogEl.appendChild(entry);
  }

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
        dietary: product.dietary ?? null
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
      const fields = ['vegan','vegetarian','halal','organic','nonGmo','noAdditives','palmOilFree','fairTrade'];
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
        if (!product.notRecommended.some(n => n.grupo === aiItem.grupo)) {
          product.notRecommended.push({ icon: "🤖", grupo: aiItem.grupo, razon: aiItem.razon, certain: false });
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

    // Confidence widget
    const confidenceEl = document.getElementById("confidence-ai");
    const aiLevelEl = document.getElementById("confidence-ai-level");
    if (data.confidence && confidenceEl && aiLevelEl) {
      let level = (data.confidence || "").toLowerCase();
      if (!product.ingredientsText) { level = "baja"; }
      const emojis = { alta: "🟢", media: "🟡", baja: "🔴" };
      const labels = { alta: "Alta", media: "Media", baja: "Baja" };
      aiLevelEl.innerHTML = `${emojis[level] || "⚪"} ${esc(labels[level] || data.confidence || "N/A")}`;
      aiLevelEl.className = "confidence-ai-level confidence-ai-" + (level === "alta" ? "alta" : level === "media" ? "media" : "baja");
      confidenceEl.classList.remove("hidden");
    }
    const notesEl = document.getElementById("confidence-notes");
    const notesTextEl = document.getElementById("confidence-notes-text");
    if (notesEl && notesTextEl) {
      notesTextEl.textContent = !product.ingredientsText
        ? "No se proporcionó lista de ingredientes. El análisis se basa únicamente en el nombre y la marca del producto, por lo que los resultados pueden ser inexactos."
        : (data.notes || "");
      notesEl.classList.remove("hidden");
    }
    const modelEl = document.getElementById("confidence-model");
    const modelTextEl = document.getElementById("confidence-model-text");
    if (modelEl && modelTextEl && data._model) {
      modelTextEl.textContent = data._model;
      modelEl.classList.remove("hidden");
    }

    loadingEl.classList.add("hidden");
    errorEl.classList.add("hidden");
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
        addProviderLog(p.label, 'ok', p.model);
        processAIResult(data);
      })
      .catch(err => {
        if (scanToken !== currentBarcodeQuery) return; // stale: a newer scan started meanwhile
        addProviderLog(p.label, 'fail', err.message, err.toString());
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

function renderConfidenceWidget() {
  const card = document.getElementById("card-confidence");
  const sourcesEl = document.getElementById("confidence-sources");
  if (!card || !sourcesEl) return;

  // Fuentes consultadas
  sourcesEl.innerHTML = "";
  if (currentSourceResults.length > 0) {
    currentSourceResults.forEach(sr => {
      const tag = document.createElement("span");
      tag.className = "confidence-source-item confidence-source-" + (sr.found ? "found" : "miss");
      tag.innerHTML = `${sr.found ? "✅" : "❌"} ${sr.source}`;
      tag.title = sr.found ? `${sr.productName} — ${sr.brandName}` : "No encontrado";
      sourcesEl.appendChild(tag);
    });
  } else if (currentDataSources) {
    const tag = document.createElement("span");
    tag.className = "confidence-source-item confidence-source-found";
    tag.textContent = currentDataSources;
    sourcesEl.appendChild(tag);
  }
  card.classList.remove("hidden");
}

function renderCacheStatus(product, barcode) {
  const el = document.getElementById("cache-status");
  const badge = document.getElementById("freshness-badge");
  const details = document.getElementById("freshness-details");
  const detailsText = document.getElementById("freshness-text");
  const btn = document.getElementById("btn-refresh-product");

  if (!el || !badge || !btn) return;

  // Hide if not from cache and not verified
  if (!product?._fromCache && !product?._verified) {
    el.classList.add("hidden");
    return;
  }

  el.classList.remove("hidden");

  // Show freshness indicator
  if (product?._verified) {
    badge.textContent = "✓ Verificado";
    badge.className = "freshness-badge verified";
    if (detailsText) detailsText.textContent = "Base de datos verificada — Datos confiables";
    if (details) details.classList.remove("hidden");
  } else if (product?._fromCache) {
    badge.textContent = `⏱ En caché`;
    badge.className = "freshness-badge cached";
    if (detailsText) detailsText.textContent = "Datos en caché — Toca Actualizar para datos frescos";
    if (details) details.classList.remove("hidden");
  }

  // Refresh button
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "⏳ Actualizando...";

    try {
      const response = await fetch("/api/cache/refresh/" + barcode, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) throw new Error(`Error ${response.status}`);
      const result = await response.json();

      btn.textContent = `✓ ${result.message}`;
      if (result.type === "verified") {
        badge.textContent = "✓ Verificado (Actualizado)";
        badge.className = "freshness-badge verified";
      } else {
        btn.textContent = "🔄 Actualizar Caché";
        // Re-scan for fresh data
        setTimeout(() => analyzeBarcode(barcode), 500);
      }
    } catch (e) {
      console.warn("Error al refrescar:", e);
      btn.textContent = "❌ Error";
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "🔄 Actualizar Caché";
      }, 2000);
    }
  };
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
let Tesseract = window.Tesseract;

function showOcrModal(barcode) {
  if (!Tesseract) {
    alert("OCR no está disponible. Intenta recargar la página.");
    return;
  }
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
  if (modal) modal.classList.add("hidden");
  currentBarcode = null;
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
        if (!Tesseract || !Tesseract.recognize) {
          throw new Error("Tesseract.js no está cargado. Recarga la página.");
        }

        const imgUrl = URL.createObjectURL(file);
        const progress = document.getElementById("ocr-progress");

        // Update progress
        if (progress) {
          progress.style.width = "30%";
          setTimeout(() => { if (progress) progress.style.width = "70%"; }, 300);
        }

        console.log('[OCR] Starting Tesseract recognition...');
        const result = await Tesseract.recognize(imgUrl, 'spa', {
          logger: m => {
            if (progress && m.progress) {
              progress.style.width = (30 + m.progress * 40) + "%";
            }
          }
        });

        if (!result || !result.data || !result.data.text) {
          throw new Error("Tesseract no extrajo texto. Intenta con una foto más clara.");
        }

        URL.revokeObjectURL(imgUrl);
        const rawText = result.data.text.trim() || "(No text detected)";
        console.log('[OCR] Raw text extracted:', rawText.substring(0, 100));

        // Process with AI to clean text
        if (progress) progress.style.width = "85%";
        const aiResponse = await fetch("/api/ocr/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rawText }),
          signal: AbortSignal.timeout(30000)
        });

        if (!aiResponse.ok) {
          const errorData = await aiResponse.json();
          throw new Error("AI processing failed: " + (errorData?.error || aiResponse.status));
        }
        const aiData = await aiResponse.json();
        const cleanedText = aiData.cleanedText;

        const textArea = document.getElementById("ocr-result");
        if (textArea) {
          textArea.value = cleanedText;
        }

        if (progress) progress.style.width = "100%";

        setTimeout(() => {
          document.getElementById("ocr-step-2").classList.add("hidden");
          document.getElementById("ocr-step-3").classList.remove("hidden");
        }, 500);
      } catch (err) {
        console.error("[OCR] Error:", err);
        const errorMsg = err?.message || err?.toString?.() || "Error desconocido";
        alert("Error al procesar imagen:\n" + errorMsg);
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
          body: JSON.stringify({ barcode: currentBarcode, ingredients })
        });

        if (!response.ok) throw new Error(`Error ${response.status}`);

        document.getElementById("ocr-step-3").classList.add("hidden");
        document.getElementById("ocr-step-4").classList.remove("hidden");
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
  if (modal) modal.classList.add("hidden");
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
        const reader = new FileReader();
        reader.onload = async (e) => {
          const result = await Tesseract.recognize(e.target.result, "spa");
          const ocrText = result.data.text;

          const response = await fetch("/api/nutrition/process", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rawText: ocrText })
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || "Nutrition processing failed");
          }

          const nutritionData = data.nutritionData || {};
          const nutritionStr = Object.entries(nutritionData)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n");

          document.getElementById("nutrition-result").value = nutritionStr || "(Sin valores extraídos)";
          document.getElementById("nutrition-step-2").classList.add("hidden");
          document.getElementById("nutrition-step-3").classList.remove("hidden");
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.error("Nutrition OCR error:", err);
        alert("Error al procesar nutrientes: " + err.message);
        document.getElementById("nutrition-step-1").classList.remove("hidden");
        document.getElementById("nutrition-step-2").classList.add("hidden");
      }
    };
  }

  if (closeBtn) closeBtn.onclick = hideNutritionModal;
  if (overlay) overlay.onclick = hideNutritionModal;
}

// Call init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initOcrHandlers();
    initNutritionHandlers();
  });
} else {
  initOcrHandlers();
  initNutritionHandlers();
}

