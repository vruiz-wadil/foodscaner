/* ==========================================================================
   Yomi Core JavaScript Logic
   ========================================================================== */

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
const glutenStatus = document.getElementById("gluten-status");
const cardGluten = document.getElementById("card-gluten");
const caloriesVal = document.getElementById("calories-val");
const caloriesProgress = document.getElementById("calories-progress");
const caloriesLevel = document.getElementById("calories-level");
const cardCalories = document.getElementById("card-calories");
const allergensList = document.getElementById("allergens-list");
const allergensSafeMsg = document.getElementById("allergens-safe-msg");
const noNutritionAlert = document.getElementById("no-nutrition-alert");
const analysisGrid = document.getElementById("analysis-grid");

// Result Elements (Rejected)
const rejectedTitle = document.getElementById("rejected-title");
const rejectedMessage = document.getElementById("rejected-message");
const rejectedProductName = document.getElementById("rejected-product-name");
const rejectedProductCategory = document.getElementById("rejected-product-category");
const notFoundActions = document.getElementById("not-found-actions");

const btnShowRegisterForm = document.getElementById("btn-show-register-form");
const registerProductFormContainer = document.getElementById("register-product-form-container");
const newProductForm = document.getElementById("new-product-form");

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

  // Mostrar u ocultar el formulario de registro local
  btnShowRegisterForm.addEventListener("click", () => {
    registerProductFormContainer.classList.toggle("hidden");
  });

  // Guardar nuevo producto en la base de datos local mediante POST
  newProductForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentBarcodeQuery) return;

    const allergensRaw = document.getElementById("reg-allergens").value.trim();
    const allergens = allergensRaw
      ? allergensRaw.split(",").map(a => a.trim()).filter(a => a.length > 0)
      : [];

    const newProductData = {
      name: document.getElementById("reg-name").value.trim(),
      brand: document.getElementById("reg-brand").value.trim(),
      isFood: document.getElementById("reg-isfood").value === "true",
      hasGluten: document.getElementById("reg-gluten").value === "true",
      calories: parseInt(document.getElementById("reg-calories").value) || 0,
      allergens: allergens
    };

    try {
      const response = await fetch('/api/product', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          barcode: currentBarcodeQuery,
          product: newProductData
        })
      });

      const resData = await response.json();

      if (response.ok && resData.success) {
        alert("¡Producto registrado con éxito en la Base de Datos Local!");
        // Ocultar formulario, limpiar entradas y volver a buscar el producto
        registerProductFormContainer.classList.add("hidden");
        newProductForm.reset();
        analyzeBarcode(currentBarcodeQuery);
      } else {
        alert("Error al registrar el producto: " + (resData.message || "Error desconocido"));
      }
    } catch (err) {
      console.error("Error al enviar registro local:", err);
      alert("No se pudo conectar con el servidor local para guardar el producto.");
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
      stopScanning();
      analyzeBarcode(decodedText);
    },
    (errorMessage) => {
      // VERBOSE LOGGING AVOIDED TO REDUCE OVERHEAD
    }
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
  
  // Ocultar acciones de simulación de no encontrado por defecto
  if (notFoundActions) {
    notFoundActions.classList.add("hidden");
  }
  if (registerProductFormContainer) {
    registerProductFormContainer.classList.add("hidden");
  }

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

    if (response.status === 404) {
      renderNotFound();
      return;
    }

    if (!response.ok) {
      throw new Error("Respuesta de API incorrecta");
    }

    const data = await response.json();

    if (data.status === 0 || !data.product) {
      renderNotFound();
      return;
    }

    currentDataSources = data.sourceLabel || "Desconocido";

    // Process and normalize API data
    if (data.source === 'local') {
      renderProductData(data.product, barcode);
    } else {
      const parsedProduct = parseApiProduct(data.product);
      renderProductData(parsedProduct, barcode);
    }
  } catch (error) {
    console.warn("Fallo de conexión o CORS al consultar la API. Activando simulación offline para el código:", barcode);
    const simulatedProduct = generateSimulatedProduct(barcode);
    setTimeout(() => {
      currentDataSources = "Simulado (Sin Conexión)";
      renderProductData(simulatedProduct, barcode);
    }, 500);
  }
}

// Parse Open Food Facts JSON data structures
function isGlutenRelated(label) {
  const l = label.toLowerCase().trim();
  return ["gluten", "trigo", "trigo (gluten)", "cebada", "centeno", "avena"].includes(l) || l.includes("(gluten)");
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
  const tracesText = (product.traces || "").toLowerCase();
  const allergensTags = (product.allergens_tags || []).map(t => t.toLowerCase());

  // Oats (avena/oat) are not inherently gluten-containing; they may be cross-contaminated
  // but certified gluten-free oats exist. Remove from keyword list to avoid false positives.
  const glutenKeywords = ["gluten", "trigo", "cebada", "centeno", "espelta", "kamut", "wheat", "barley", "rye", "spelt"];

  // Strip "may contain" / "puede contener" sections before matching to avoid false positives
  // from cross-contamination disclaimers. Traces are shown separately in the UI.
  const cleanIngredients = ingredientsText.replace(/(?:puede\s+contener|may\s+contain|contiene\s+trazas|trazas?\s*de)[^.!;]*/gi, "");
  const matchesGlutenInIngredients = glutenKeywords.some(keyword => cleanIngredients.includes(keyword));
  const hasGlutenAllergenTag = allergensTags.some(tag => tag.includes("gluten") || tag.includes("wheat") || tag.includes("trigo"));

  // Check for positive labels indicating gluten-free
  const labelsTags = (product.labels_tags || []).map(t => t.toLowerCase());
  const isLabeledGlutenFree = labelsTags.some(tag => tag.includes("gluten-free") || tag.includes("sin-gluten") || tag.includes("libre-de-gluten"));

  // Also check product name and ingredients text for explicit gluten-free claims
  const productName = (product.product_name || "").toLowerCase();
  const hasGlutenFreeClaim = /gluten\s*free|sin\s*gluten|libre\s*de\s*gluten/i.test(productName) || /gluten\s*free|sin\s*gluten|libre\s*de\s*gluten/i.test(ingredientsText);

  const glutenDataAvailable = !!(product.ingredients_text || (product.traces && product.traces !== "undefined") || (product.allergens_tags && product.allergens_tags.length > 0));

  // Use USDA-enriched gluten data if available (takes priority)
  const enrichedGluten = product._gluten_enriched;

  let hasGluten = false;
  let glutenDetails = (glutenDataAvailable || enrichedGluten) ? "Sin ingredientes con gluten detectados en la información declarada" : "Sin información de gluten";
  let glutenClassification = !glutenDataAvailable && !enrichedGluten ? "no_info" : "declared";

  if (enrichedGluten) {
    hasGluten = enrichedGluten.hasGluten;
    glutenDetails = enrichedGluten.details;
    glutenClassification = "declared";
  } else if (glutenDataAvailable) {
    if ((matchesGlutenInIngredients || hasGlutenAllergenTag) && !isLabeledGlutenFree && !hasGlutenFreeClaim) {
      hasGluten = true;
      glutenClassification = hasGlutenAllergenTag ? "declared" : "detected";
      const detectedInIngredients = glutenKeywords.filter(k => cleanIngredients.includes(k));
      glutenDetails = detectedInIngredients.length > 0 
        ? `Contiene gluten (${detectedInIngredients.join(", ")})` 
        : "Contiene gluten detectado";
    } else if (isLabeledGlutenFree) {
      glutenClassification = "certified";
      glutenDetails = "Sin Gluten (Certificado)";
    } else if (hasGlutenFreeClaim) {
      glutenClassification = "declared";
      glutenDetails = "Sin ingredientes con gluten detectados en la información declarada";
    }
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
  
  // Determine energy level thresholds
  let energyLevel = "Bajo";
  let percent = 0;
  if (kcal > 400) {
    energyLevel = "Alto";
    percent = Math.min(100, Math.round((kcal / 600) * 100));
  } else if (kcal >= 150) {
    energyLevel = "Moderado";
    percent = Math.round((kcal / 400) * 100);
  } else {
    energyLevel = "Bajo";
    percent = Math.max(3, Math.round((kcal / 150) * 50));
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

  // Extract traces from ingredients text (puede contener / may contain)
  const tracesList = [];
  let searchableIngredients = ingredientsText;
  const mayContainPattern = /(?:puede\s+contener|may\s+contain|contiene\s+trazas|trazas?\s*de)\s*:?\s*([^.!;]+)/gi;
  let mcMatch;
  while ((mcMatch = mayContainPattern.exec(ingredientsText)) !== null) {
    const section = mcMatch[0].toLowerCase();
    const traceKeywords = [
      { kw: "cacahuate", label: "Cacahuates (Maní)" },
      { kw: "cacahuete", label: "Cacahuates (Maní)" },
      { kw: "peanut", label: "Cacahuates (Maní)" },
      { kw: "soya", label: "Soja" },
      { kw: "soja", label: "Soja" },
      { kw: "soy", label: "Soja" },
      { kw: "leche", label: "Leche (Lácteos)" },
      { kw: "milk", label: "Leche (Lácteos)" },
      { kw: "huevo", label: "Huevos" },
      { kw: "egg", label: "Huevos" },
      { kw: "nueces", label: "Frutos de cáscara (Nueces)" },
      { kw: "nuez", label: "Frutos de cáscara (Nueces)" },
      { kw: "almendra", label: "Frutos de cáscara (Nueces)" },
      { kw: "almond", label: "Frutos de cáscara (Nueces)" },
      { kw: "trigo", label: "Trigo (Gluten)" },
      { kw: "wheat", label: "Trigo (Gluten)" },
      { kw: "gluten", label: "Gluten" },
      { kw: "pescado", label: "Pescado" },
      { kw: "fish", label: "Pescado" },
      { kw: "mostaza", label: "Mostaza" },
      { kw: "mustard", label: "Mostaza" },
      { kw: "sésamo", label: "Sésamo" },
      { kw: "sesame", label: "Sésamo" },
      { kw: "sulfito", label: "Sulfitos" },
      { kw: "crustáceo", label: "Crustáceos" },
      { kw: "crustacean", label: "Crustáceos" },
      { kw: "molusco", label: "Moluscos" },
      { kw: "mollusc", label: "Moluscos" },
      { kw: "altramuz", label: "Altramuces" },
      { kw: "lupin", label: "Altramuces" },
      { kw: "apio", label: "Apio" },
      { kw: "celery", label: "Apio" }
    ];
    traceKeywords.forEach(({ kw, label }) => {
      const regex = new RegExp("\\b" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      if (regex.test(section) && !allergensList.includes(label) && !tracesList.includes(label)) {
        tracesList.push(label);
      }
    });
    // Remove this section from searchable text so it won't be falsely detected as declared allergen
    searchableIngredients = searchableIngredients.replace(mcMatch[0], "");
  }

  // Then add traces from traces_tags and raw traces field
  tracesTags.forEach(tag => {
    const mapped = mapAllergenTag(tag);
    if (!allergensList.includes(mapped) && !tracesList.includes(mapped)) {
      tracesList.push(mapped);
    }
  });
  if (product.traces && product.traces !== "undefined") {
    product.traces.split(",").forEach(t => {
      const cleaned = t.replace(/^[a-z]{2}:/, "").trim();
      if (cleaned && !allergensList.includes(cleaned) && !tracesList.includes(cleaned)) {
        tracesList.push(cleaned.charAt(0).toUpperCase() + cleaned.slice(1));
      }
    });
  }

  // Fallback: detectar alérgenos en el texto de ingredientes (excluyendo secciones de "puede contener")
  if (allergensList.length === 0 && searchableIngredients) {
    const allergenKeywords = [
      { kw: "cacahuate", label: "Cacahuates (Maní)" },
      { kw: "cacahuete", label: "Cacahuates (Maní)" },
      { kw: "peanut", label: "Cacahuates (Maní)" },
      { kw: "soya", label: "Soja" },
      { kw: "soja", label: "Soja" },
      { kw: "soy", label: "Soja" },
      { kw: "leche", label: "Leche (Lácteos)" },
      { kw: "milk", label: "Leche (Lácteos)" },
      { kw: "lactosa", label: "Leche (Lácteos)" },
      { kw: "lactose", label: "Leche (Lácteos)" },
      { kw: "huevo", label: "Huevos" },
      { kw: "egg", label: "Huevos" },
      { kw: "nueces", label: "Frutos de cáscara (Nueces)" },
      { kw: "nuez", label: "Frutos de cáscara (Nueces)" },
      { kw: "almendra", label: "Frutos de cáscara (Nueces)" },
      { kw: "almond", label: "Frutos de cáscara (Nueces)" },
      { kw: "trigo", label: "Trigo (Gluten)" },
      { kw: "wheat", label: "Trigo (Gluten)" },
      { kw: "gluten", label: "Gluten" },
      { kw: "pescado", label: "Pescado" },
      { kw: "fish", label: "Pescado" },
      { kw: "mostaza", label: "Mostaza" },
      { kw: "mustard", label: "Mostaza" },
      { kw: "sésamo", label: "Sésamo" },
      { kw: "sesame", label: "Sésamo" },
      { kw: "sulfito", label: "Sulfitos" },
      { kw: "crustáceo", label: "Crustáceos" },
      { kw: "crustacean", label: "Crustáceos" },
      { kw: "molusco", label: "Moluscos" },
      { kw: "mollusc", label: "Moluscos" },
      { kw: "altramuz", label: "Altramuces" },
      { kw: "lupin", label: "Altramuces" },
      { kw: "apio", label: "Apio" },
      { kw: "celery", label: "Apio" }
    ];
    allergenKeywords.forEach(({ kw, label }) => {
      const regex = new RegExp("\\b" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      if (regex.test(searchableIngredients) && !allergensList.includes(label)) {
        allergensList.push(label);
      }
    });
  }

  // Filter out gluten-related items from allergens and traces (handled in dedicated section)
  const filteredAllergens = allergensList.filter(a => !isGlutenRelated(a));
  const filteredTraces = tracesList.filter(t => !isGlutenRelated(t));

  // Nutriscore
  const nutriscore = product.nutriscore_grade || product.nutrition_grades || "-";

  const allergensDataAvailable = allergensList.length > 0 || !!(product.allergens_tags?.length || product.allergens_from_ingredients || ingredientsText);

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
      classification: glutenClassification
    },
    calories: {
      value: Math.round(kcal),
      level: energyLevel,
      percent: percent
    },
    allergens: filteredAllergens,
    allergensDataAvailable,
    traces: [...new Map(filteredTraces.map(t => [t.toLowerCase().trim(), t])).values()],
    nutriscore: nutriscore,
    _enrichedFrom: product._enrichedFrom || null,
    ingredientsText: product.ingredients_text || null
  };
}

// Render dynamic results onto success screen
function renderProductData(product, barcode) {
  if (!product.isFood) {
    renderRejected(product);
    return;
  }

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

  if (product.image) {
    productImg.src = product.image;
    productImg.alt = product.name;
  } else {
    productImg.src = "";
  }

  if (product.isFromFallback && !product._enrichedFrom) {
    analysisGrid.classList.add("hidden");
    noNutritionAlert.classList.remove("hidden");
    runAICheck(product);
    return;
  }

  analysisGrid.classList.remove("hidden");
  noNutritionAlert.classList.add("hidden");

  // Render Gluten Card details
  glutenStatus.textContent = product.gluten.details;
  cardGluten.className = "analysis-card";
  const gc = product.gluten.classification || "declared";
  if (gc === "certified") {
    glutenStatus.className = "status-value gluten-certified";
    cardGluten.style.borderColor = "var(--accent-primary)";
  } else if (gc === "declared") {
    glutenStatus.className = "status-value gluten-declared";
    cardGluten.style.borderColor = product.gluten.hasGluten ? "var(--accent-alert)" : "var(--accent-primary)";
  } else if (gc === "detected") {
    glutenStatus.className = "status-value gluten-detected";
    cardGluten.style.borderColor = "var(--accent-alert)";
  } else {
    glutenStatus.className = "status-value gluten-unknown";
    cardGluten.style.borderColor = "var(--text-muted)";
  }

  // Render Calories Card details
  caloriesVal.querySelector(".number").textContent = product.calories.value;
  caloriesProgress.style.width = `${product.calories.percent}%`;
  caloriesLevel.textContent = `Nivel de energía: ${product.calories.level}`;
  
  cardCalories.className = "analysis-card";
  if (product.calories.level === "Alto") {
    caloriesLevel.className = "level-indicator calories-high";
    caloriesProgress.style.background = "var(--accent-error)";
  } else if (product.calories.level === "Moderado") {
    caloriesLevel.className = "level-indicator calories-mod";
    caloriesProgress.style.background = "var(--accent-alert)";
  } else {
    caloriesLevel.className = "level-indicator calories-low";
    caloriesProgress.style.background = "var(--accent-primary)";
  }

  // Render Allergen Icon Grid + text tags
  const gridEl = document.getElementById("allergen-icon-grid");
  if (gridEl) {
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
      } else if (matchesTrace) {
        div.classList.add("traces");
      } else {
        div.classList.add("safe");
      }
      div.innerHTML = `<span class="emoji">${item.emoji}</span><span class="label">${item.label}</span>`;
      gridEl.appendChild(div);
    });
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
      const tag = document.createElement("span");
      tag.className = "allergen-tag";
      tag.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px; height:12px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        ${allergen}
      `;
      allergensList.appendChild(tag);
    });
    allergensList.classList.remove("hidden");
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

  // Render traces (may contain)
  const tracesSection = document.getElementById("traces-section");
  const tracesContainer = document.getElementById("traces-list");
  if (tracesSection && tracesContainer) {
    tracesContainer.innerHTML = "";
    if (product.traces && product.traces.length > 0) {
      product.traces.forEach(t => {
        const tag = document.createElement("span");
        tag.className = "allergen-tag traces-tag";
        tag.textContent = t;
        tracesContainer.appendChild(tag);
      });
      tracesSection.classList.remove("hidden");
    } else {
      tracesSection.classList.add("hidden");
    }
  }

  runAICheck(product);
}

let _lastAiProductKey = "";

function runAICheck(product) {
  const aiSection = document.getElementById("ai-query-section");
  if (!aiSection) return;

  showDBDisclaimer(product);

  const key = product.name + "|" + product.brand;
  if (key === _lastAiProductKey) return;
  _lastAiProductKey = key;

  const loading = document.getElementById("ai-query-loading");
  const result = document.getElementById("ai-query-result");
  const error = document.getElementById("ai-query-error");
  if (!loading || !result || !error) return;

  aiSection.classList.remove("hidden");
  aiSection.style.display = "block";
  loading.classList.remove("hidden");
  result.classList.add("hidden");
  error.classList.add("hidden");

  fetch('/api/ai-query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: product.name, brand: product.brand, ingredients: product.ingredientsText || null, allergens: product.allergens || null })
  })
  .then(r => r.json())
  .then(data => {
    loading.classList.add("hidden");
    if (data.error) {
      error.textContent = "Error: " + (data.details || data.error);
      error.classList.remove("hidden");
      return;
    }

    const missingData = product.gluten?.dataAvailable === false || product.allergensDataAvailable === false;
    if (product.isFromFallback || missingData) {
      renderAIResult(data);
      result.classList.remove("hidden");
    } else {
      if (!compareWithDB(data, product)) {
        aiSection.classList.add("hidden");
        aiSection.style.display = "";
      }
    }
  })
  .catch(err => {
    loading.classList.add("hidden");
    error.textContent = "Error de conexión: " + err.message;
    error.classList.remove("hidden");
  });
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

function compareWithDB(aiData, product) {
  const result = document.getElementById("ai-query-result");
  const glutenLine = document.getElementById("ai-gluten-line");
  const allergensLine = document.getElementById("ai-allergens-line");
  const confidenceLine = document.getElementById("ai-confidence-line");
  const notesLine = document.getElementById("ai-notes-line");
  if (!result || !glutenLine || !allergensLine || !confidenceLine || !notesLine) return;

  glutenLine.innerHTML = "";
  allergensLine.innerHTML = "";
  confidenceLine.innerHTML = "";
  notesLine.innerHTML = "";
  result.classList.add("hidden");

  let hasDiscrepancy = false;

  if (product.gluten && aiData.gluten && product.gluten.dataAvailable !== false) {
    const dbVal = product.gluten.hasGluten;
    const aiVal = aiData.gluten.hasGluten;
    if (dbVal !== aiVal) {
      const conf = (aiData.confidence || "").toLowerCase();
      const confNote = conf && conf !== "alta" ? ` (Confianza: ${conf})` : "";
      if (dbVal) {
        glutenLine.innerHTML = `<strong>Gluten:</strong> La información declarada indica que contiene gluten, pero la IA no pudo confirmarlo${confNote}.`;
      } else {
        const details = aiData.gluten.details || "ingredientes detectados por IA";
        const prefix = conf === "baja" ? "la IA sugiere posible presencia de gluten sin certeza" : "se sospecha la posible presencia de gluten debido a que";
        const sep = conf === "baja" ? ": " : " ";
        glutenLine.innerHTML = `<strong>Gluten:</strong> Si bien la información declarada no indica contenido de gluten, ${prefix}${sep}${details}${confNote}.`;
      }
      hasDiscrepancy = true;
    }
  }

  if (product.allergensDataAvailable !== false && aiData.allergens) {
    const allKnown = [
      ...(product.allergens || []),
      ...(product.traces || [])
    ].map(a => a.toLowerCase().trim());

    // Filter out gluten-related allergens from AI response (handled in dedicated section)
    const aiAll = (aiData.allergens || []).filter(a => !isGlutenRelated(a)).map(a => a.toLowerCase().trim());

    // Canonical mapping: resolve synonyms to a single form
    const canonical = (s) => {
      const map = { "soya": "soja", "mani": "cacahuate", "cacahuete": "cacahuate", "lácteos": "leche" };
      return map[s] || s;
    };

    // Extract all meaningful words (including from parentheticals)
    const allWords = (s) => s.replace(/[^a-záéíóúñ]/g, " ").split(/\s+/).filter(w => w.length > 2);

    const matchesKnown = (a) => {
      const ca = canonical(a);
      // exact match after canonical normalization (remove parentheticals for this check)
      const stripParen = (s) => s.replace(/\s*\(.*?\)\s*/g, "").trim();
      if (allKnown.some(k => canonical(stripParen(k)) === stripParen(ca))) return true;
      // shared word match (including parenthetical content)
      const wa = allWords(ca);
      return allKnown.some(k => {
        const wk = allWords(k);
        return wa.some(w => wk.includes(w));
      });
    };

    const aiOnly = aiAll.filter(a => !matchesKnown(a));
    if (aiOnly.length > 0) {
      allergensLine.innerHTML = "<strong>Alérgenos:</strong> Es posible la presencia de alérgenos adicionales no incluidos en la información declarada: <strong>" + aiOnly.join(", ") + "</strong>.";
      hasDiscrepancy = true;
    }
  }

  if (hasDiscrepancy) {
    result.classList.remove("hidden");
  } else {
    result.classList.add("hidden");
  }

  return hasDiscrepancy;
}

function renderAIResult(data) {
  const glutenLine = document.getElementById("ai-gluten-line");
  const allergensLine = document.getElementById("ai-allergens-line");
  const confidenceLine = document.getElementById("ai-confidence-line");
  const notesLine = document.getElementById("ai-notes-line");

  if (glutenLine) {
    const g = data.gluten || {};
    const icon = g.hasGluten ? "⚠️" : "✅";
    const details = g.details || "Sin determinar";
    glutenLine.innerHTML = `<strong>Gluten:</strong> ${icon} ${details}`;
    glutenLine.style.color = g.hasGluten ? "var(--accent-alert)" : "var(--accent-primary)";
  }

  if (allergensLine) {
    const a = data.allergens || [];
    const text = a.length > 0 ? a.join(", ") : "No se detectaron alérgenos comunes";
    allergensLine.innerHTML = `<strong>Alérgenos:</strong> ${text}`;
    allergensLine.style.color = a.length > 0 ? "var(--accent-alert)" : "var(--accent-primary)";
  }

  if (confidenceLine) {
    const labels = { alta: "Alta", media: "Media", baja: "Baja" };
    confidenceLine.textContent = `Confianza: ${labels[data.confidence] || data.confidence || "N/A"}`;
  }

  if (notesLine) {
    notesLine.textContent = data.notes ? `📝 ${data.notes}` : "";
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

// Genera un producto de simulación realista basado en el código de barras
function generateSimulatedProduct(barcode) {
  const lastDigit = parseInt(barcode.slice(-1)) || 0;
  
  // Usar residuo de la suma de dígitos para alternar tipos de producto
  const sumDigits = barcode.split("").reduce((acc, val) => acc + (parseInt(val) || 0), 0);
  const typeKey = sumDigits % 3;
  
  if (typeKey === 0) {
    // Caso de producto NO alimenticio
    return {
      name: `Producto de Cuidado Personal Simulado #${barcode.slice(-4)}`,
      brand: "Simulacro S.A.",
      image: "",
      isFood: false,
      category: "Cuidado e Higiene Personal (No Alimenticio)",
      isSimulated: true
    };
  } else if (typeKey === 1) {
    // Caso de alimento con gluten y alérgenos
    return {
      name: `Galletas de Avena y Miel de Simulación`,
      brand: "Trigo & Co",
      image: "",
      isFood: true,
      category: "Cereales y Galletas",
      gluten: {
        hasGluten: true,
        details: "Contiene gluten (avena y trigo)"
      },
      calories: {
        value: 395,
        level: "Moderado",
        percent: 68
      },
      allergens: ["Trigo (Gluten)", "Frutos de cáscara (Nueces)"],
      nutriscore: "c",
      isSimulated: true
    };
  } else {
    // Caso de alimento saludable sin gluten y sin alérgenos
    return {
      name: `Zumo de Manzana y Pera Natural`,
      brand: "Fruta Express",
      image: "",
      isFood: true,
      category: "Jugos y Zumos de Frutas",
      gluten: {
        hasGluten: false,
        details: "Sin Gluten (Libre de trazas)"
      },
      calories: {
        value: 48,
        level: "Bajo",
        percent: 10
      },
      allergens: [],
      nutriscore: "a",
      isSimulated: true
    };
  }
}
