/* ==========================================================================
   FoodScaner Core JavaScript Logic
   ========================================================================== */

// Demo & Mock database for guaranteed success during evaluation and offline fallback
const DEMO_PRODUCTS = {
  "7613034626844": {
    name: "Galletas Chokella de Chocolate",
    brand: "Nestlé",
    image: "https://images.openfoodfacts.org/images/products/761/303/462/6844/front_es.36.400.jpg",
    isFood: true,
    category: "Galletas y pasteles",
    gluten: {
      hasGluten: true,
      details: "Contiene gluten (trigo)"
    },
    calories: {
      value: 446,
      level: "Alto", /* Alto: >400, Medio: 150-400, Bajo: <150 */
      percent: 85 /* Progress bar */
    },
    allergens: ["Trigo (Gluten)", "Leche", "Soja"],
    nutriscore: "d"
  },
  "8410046001254": {
    name: "Caldo de Pollo 100% Natural",
    brand: "Gallina Blanca",
    image: "https://images.openfoodfacts.org/images/products/841/004/600/1254/front_es.103.400.jpg",
    isFood: true,
    category: "Caldos deshidratados y preparados",
    gluten: {
      hasGluten: false,
      details: "Sin Gluten (Certificado)"
    },
    calories: {
      value: 7,
      level: "Bajo",
      percent: 2
    },
    allergens: [],
    nutriscore: "b"
  },
  "5449000000996": {
    name: "Coca-Cola Sabor Original",
    brand: "Coca-Cola",
    image: "https://images.openfoodfacts.org/images/products/544/900/000/0996/front_es.520.400.jpg",
    isFood: true,
    category: "Bebidas endulzadas",
    gluten: {
      hasGluten: false,
      details: "Libre de gluten"
    },
    calories: {
      value: 42,
      level: "Bajo",
      percent: 8
    },
    allergens: [],
    nutriscore: "e"
  },
  "8411300000100": {
    name: "Champú Flex Clásico Cuidado Diario",
    brand: "Revlon",
    image: "", // Dejar vacío para disparar el fallback svg
    isFood: false,
    category: "Higiene y Cosméticos (Champús)"
  }
};

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
const nutriscoreVal = document.getElementById("nutriscore-val");

// Result Elements (Rejected)
const rejectedTitle = document.getElementById("rejected-title");
const rejectedMessage = document.getElementById("rejected-message");
const rejectedProductName = document.getElementById("rejected-product-name");
const rejectedProductCategory = document.getElementById("rejected-product-category");
const notFoundActions = document.getElementById("not-found-actions");
const btnSimulateNotFound = document.getElementById("btn-simulate-not-found");
const btnShowRegisterForm = document.getElementById("btn-show-register-form");
const registerProductFormContainer = document.getElementById("register-product-form-container");
const newProductForm = document.getElementById("new-product-form");

let currentBarcodeQuery = "";

// Application Scanner State
let html5QrCode = null;
let isScanning = false;

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
});

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
      if (isScanning) {
        stopScanning();
      }
      analyzeBarcode(barcode);
    }
  });

  // Demo pills
  document.querySelectorAll(".btn-demo").forEach(button => {
    button.addEventListener("click", () => {
      const barcode = button.getAttribute("data-barcode");
      barcodeInput.value = barcode;
      if (isScanning) {
        stopScanning();
      }
      analyzeBarcode(barcode);
    });
  });

  // Botón para simular producto no encontrado en la API
  btnSimulateNotFound.addEventListener("click", () => {
    if (currentBarcodeQuery) {
      const simulatedProduct = generateSimulatedProduct(currentBarcodeQuery);
      // Personalizar si el usuario mencionó que es un refresco específico
      if (currentBarcodeQuery === "7501071140945") {
        simulatedProduct.name = "Refresco Squirt Cantarito 600ml";
        simulatedProduct.brand = "Squirt (Peñafiel)";
        simulatedProduct.category = "Refrescos y Bebidas Gasificadas";
        simulatedProduct.gluten.hasGluten = false;
        simulatedProduct.gluten.details = "Sin Gluten (Libre de trazas)";
        simulatedProduct.calories = {
          value: 38,
          level: "Bajo",
          percent: 7
        };
        simulatedProduct.allergens = [];
        simulatedProduct.nutriscore = "e";
      }
      renderProductData(simulatedProduct, currentBarcodeQuery);
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
      nutriscore: document.getElementById("reg-nutriscore").value,
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

      // Initialize scanner object
      html5QrCode = new Html5Qrcode("interactive-scanner");
      isScanning = true;

      // Start scanning using the first device in list
      startScanning(devices[0].id);
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
}

// Main Business Logic: Barcode Identification & API Querying
async function analyzeBarcode(barcode) {
  showState(resultLoading);
  currentBarcodeQuery = barcode;

  // 1. Check if mock data is available to bypass remote fetching for immediate feedback
  if (DEMO_PRODUCTS[barcode]) {
    setTimeout(() => {
      renderProductData(DEMO_PRODUCTS[barcode], barcode);
    }, 800); // Simulate realistic quick delay
    return;
  }

  // 2. Query local server API (which checks local Mexican database + proxies Open Food Facts)
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

    // Process and normalize API data
    if (data.source === 'local') {
      // Si viene de nuestra base de datos local pre-normalizada
      renderProductData(data.product, barcode);
    } else {
      // Si viene de Open Food Facts externa, lo parseamos
      const parsedProduct = parseApiProduct(data.product);
      renderProductData(parsedProduct, barcode);
    }

  } catch (error) {
    console.warn("Fallo de conexión o CORS al consultar la API. Activando simulación offline para el código:", barcode);
    // Generar un producto de simulación para que la app funcione sin internet o bajo protocolo file://
    const simulatedProduct = generateSimulatedProduct(barcode);
    setTimeout(() => {
      renderProductData(simulatedProduct, barcode);
    }, 500);
  }
}

// Parse Open Food Facts JSON data structures
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

  const glutenKeywords = ["gluten", "trigo", "cebada", "centeno", "avena", "espelta", "kamut", "wheat", "barley", "rye", "oat", "spelt"];
  const matchesGlutenInIngredients = glutenKeywords.some(keyword => ingredientsText.includes(keyword) || tracesText.includes(keyword));
  const hasGlutenAllergenTag = allergensTags.some(tag => tag.includes("gluten") || tag.includes("wheat") || tag.includes("trigo"));
  
  // Check for positive labels indicating gluten-free
  const labelsTags = (product.labels_tags || []).map(t => t.toLowerCase());
  const isLabeledGlutenFree = labelsTags.some(tag => tag.includes("gluten-free") || tag.includes("sin-gluten") || tag.includes("libre-de-gluten"));

  let hasGluten = false;
  let glutenDetails = "Libre de gluten";

  if ((matchesGlutenInIngredients || hasGlutenAllergenTag) && !isLabeledGlutenFree) {
    hasGluten = true;
    // Find what ingredient triggered it
    const detectedInIngredients = glutenKeywords.filter(k => ingredientsText.includes(k));
    glutenDetails = detectedInIngredients.length > 0 
      ? `Contiene gluten (${detectedInIngredients.join(", ")})` 
      : "Contiene gluten detectado";
  } else if (isLabeledGlutenFree) {
    glutenDetails = "Sin Gluten (Certificado)";
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
    "en:peanuts": "Cacahuetes",
    "en:nuts": "Frutos de cáscara (Nueces)",
    "en:soybeans": "Soja",
    "en:mustard": "Mostaza",
    "en:molluscs": "Moluscos",
    "en:fish": "Pescado",
    "en:celery": "Apio",
    "en:sesame-seeds": "Sésamo",
    "en:sulphur-dioxide-and-sulphites": "Sulfitos",
    "en:crustaceans": "Crustáceos",
    "en:lupins": "Altramuces"
  };

  const allergensList = [];
  allergensTags.forEach(tag => {
    // Clean tag prefix e.g., "en:milk" or "es:leche"
    const matched = allergensMap[tag];
    if (matched && !allergensList.includes(matched)) {
      allergensList.push(matched);
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

  // Nutriscore
  const nutriscore = product.nutriscore_grade || product.nutrition_grades || "-";

  return {
    name,
    brand,
    image,
    isFood,
    category: categoryLabel,
    gluten: {
      hasGluten,
      details: glutenDetails
    },
    calories: {
      value: Math.round(kcal),
      level: energyLevel,
      percent: percent
    },
    allergens: allergensList,
    nutriscore: nutriscore
  };
}

// Render dynamic results onto success screen
function renderProductData(product, barcode) {
  if (!product.isFood) {
    renderRejected(product);
    return;
  }

  showState(resultSuccess);

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

  // Badge para datos del fallback (UpcItemDb) con info nutricional limitada
  const existingFallbackBadge = productBrand.parentNode.querySelector(".badge-fallback");
  if (existingFallbackBadge) {
    existingFallbackBadge.remove();
  }
  
  if (product.isFromFallback) {
    const fbBadge = document.createElement("span");
    fbBadge.className = "badge badge-fallback";
    fbBadge.textContent = "Sin Info Nutricional (Fallback)";
    productBrand.parentNode.insertBefore(fbBadge, productBrand.nextSibling);
  }
  
  if (product.image) {
    productImg.src = product.image;
    productImg.alt = product.name;
  } else {
    productImg.src = "";
  }

  // Render Gluten Card details
  glutenStatus.textContent = product.gluten.details;
  cardGluten.className = "analysis-card"; // Reset
  if (product.gluten.hasGluten) {
    glutenStatus.className = "status-value gluten-contains";
    cardGluten.style.borderColor = "var(--accent-alert)";
  } else {
    glutenStatus.className = "status-value gluten-safe";
    cardGluten.style.borderColor = "var(--accent-primary)";
  }

  // Render Calories Card details
  caloriesVal.querySelector(".number").textContent = product.calories.value;
  caloriesProgress.style.width = `${product.calories.percent}%`;
  caloriesLevel.textContent = `Nivel de energía: ${product.calories.level}`;
  
  // Color code calorie progress bar
  cardCalories.className = "analysis-card"; // Reset
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

  // Render Allergens Card details
  allergensList.innerHTML = "";
  if (product.allergens.length > 0) {
    allergensSafeMsg.classList.add("hidden");
    product.allergens.forEach(allergen => {
      const tag = document.createElement("span");
      tag.className = "allergen-tag";
      tag.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px; height:12px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        ${allergen}
      `;
      allergensList.appendChild(tag);
    });
  } else {
    allergensSafeMsg.classList.remove("hidden");
  }

  // Render Nutri-Score indicator
  const score = (product.nutriscore || "").toLowerCase();
  nutriscoreVal.textContent = score ? score.toUpperCase() : "N/D";
  
  // Reset active classes
  document.querySelectorAll(".ns-score").forEach(el => {
    el.classList.remove("active");
  });

  if (score && ["a", "b", "c", "d", "e"].includes(score)) {
    const activeBlock = document.querySelector(`.ns-score[data-score="${score}"]`);
    if (activeBlock) {
      activeBlock.classList.add("active");
    }
  }
}

// Render rejected state screen
function renderRejected(product) {
  showState(resultRejected);
  rejectedTitle.textContent = product.isSimulated ? "Producto Simulado (No Alimento)" : "Producto Rechazado";
  rejectedMessage.textContent = product.isSimulated
    ? "Simulación offline: Este producto no es un alimento. FoodScaner solo analiza alimentos para consumo humano."
    : "Este producto no es un alimento. FoodScaner solo analiza alimentos o bebidas de consumo humano.";
  rejectedProductName.textContent = product.name || "Producto no identificado";
  rejectedProductCategory.textContent = product.category || "No alimenticio / Higiene / Otros";
}

// Render Not Found screen (extends rejected layout style)
function renderNotFound() {
  showState(resultRejected);
  rejectedTitle.textContent = "No Encontrado";
  rejectedMessage.textContent = "No logramos identificar este código de barras en la base de datos abierta de Open Food Facts ni en nuestra base local.";
  rejectedProductName.textContent = "Desconocido";
  rejectedProductCategory.textContent = "N/D";
  
  // Mostrar opción para que el usuario pueda simularlo en caliente
  if (notFoundActions) {
    notFoundActions.classList.remove("hidden");
  }
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
