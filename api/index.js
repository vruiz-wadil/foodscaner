const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(express.json());

const DB_PATH = '/tmp/local_mexican_products.json';

const CANDIDATES = [
  path.join(__dirname, '..', 'local_mexican_products.json'),
  path.join(process.cwd(), 'local_mexican_products.json'),
  path.join(process.cwd(), '..', 'local_mexican_products.json'),
];

function findInitialDb() {
  for (const c of CANDIDATES) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const INITIAL_DB_PATH = findInitialDb();

try {
  if (!fs.existsSync(DB_PATH) && INITIAL_DB_PATH) {
    fs.copyFileSync(INITIAL_DB_PATH, DB_PATH);
  }
} catch (e) {}

function readLocalDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, '{}', 'utf8');
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (err) {
    return {};
  }
}

function writeLocalDb(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
    return true;
  } catch (err) {
    return false;
  }
}

app.get('/api/product/:barcode', async (req, res) => {
  try {
    const barcode = req.params.barcode;
    // const db = readLocalDb(); // BD local desactivada temporalmente
    // 2. Buscar en Open Food Facts (mundial)
    async function queryOFF(host, label) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        const url = `https://${host}/api/v2/product/${barcode}.json`;
        const response = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        if (response.ok) {
          const data = await response.json();
          if (data.status === 1 && data.product) return data;
        }
      } catch (error) {
        clearTimeout(t);
      }
      return null;
    }

    function hasOFFData(p) {
      return !!(p.ingredients_text || (p.allergens_tags && p.allergens_tags.length > 0) || p.allergens_from_ingredients || (p.traces && p.traces !== "undefined"));
    }

    let bestResult = null;
    const sourceResults = [];

    const worldResult = await queryOFF("world.openfoodfacts.org", "OFF World");
    if (worldResult) {
      const hd = hasOFFData(worldResult.product);
      const hn = !!(worldResult.product.nutriments && Object.keys(worldResult.product.nutriments).length > 0);
      sourceResults.push({ source: "Open Food Facts (Mundial)", found: true, hasAllergenData: hd, hasNutritionData: hn });
      if (hd) {
        return res.json({ ...worldResult, sourceLabel: "Open Food Facts (Mundial)", sourceResults });
      }
      bestResult = { ...worldResult, sourceLabel: "Open Food Facts (Mundial)" };
    } else {
      sourceResults.push({ source: "Open Food Facts (Mundial)", found: false, hasAllergenData: false, hasNutritionData: false });
    }

    const mxResult = await queryOFF("mx.openfoodfacts.org", "OFF MX");
    if (mxResult) {
      const hd = hasOFFData(mxResult.product);
      const hn = !!(mxResult.product.nutriments && Object.keys(mxResult.product.nutriments).length > 0);
      sourceResults.push({ source: "Open Food Facts (MX)", found: true, hasAllergenData: hd, hasNutritionData: hn });
      if (hd) {
        return res.json({ ...mxResult, sourceLabel: "Open Food Facts (MX)", sourceResults });
      }
      if (!bestResult) bestResult = { ...mxResult, sourceLabel: "Open Food Facts (MX)" };
    } else {
      sourceResults.push({ source: "Open Food Facts (MX)", found: false, hasAllergenData: false, hasNutritionData: false });
    }

    // 4. Buscar en USDA FoodData Central
    async function queryUSDA(barcode) {
      const USDA_API_KEY = "wT50TCqGVpmeEfLhVbFZNpTBU4SVgiqNOlEp1iBK";
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        console.log(`[USDA] Buscando en FoodData Central: ${barcode}`);
        const response = await fetch(
          `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: barcode, dataType: ["Branded"], pageSize: 1 }),
            signal: ctrl.signal
          }
        );
        clearTimeout(t);
        if (response.ok) {
          const data = await response.json();
          if (data.foods && data.foods.length > 0) {
            const item = data.foods[0];
            console.log(`[USDA] Encontrado en FoodData Central: ${item.description}`);

            let kcal = 0;
            if (item.foodNutrients) {
              const energy = item.foodNutrients.find(n => n.nutrientName === "Energy" && n.unitName === "KCAL");
              if (energy) kcal = Math.round(energy.value);
            }

            let energyLevel = "Bajo";
            let percent = 0;
            if (kcal > 400) { energyLevel = "Alto"; percent = Math.min(100, Math.round((kcal / 600) * 100)); }
            else if (kcal >= 150) { energyLevel = "Moderado"; percent = Math.round((kcal / 400) * 100); }
            else { energyLevel = "Bajo"; percent = Math.max(3, Math.round((kcal / 150) * 50)); }

            const ingredientsText = (item.ingredients || "").toLowerCase();
            const allergenText = (item.allergenWarning || "").toLowerCase();
            const glutenKeywords = ["trigo","wheat","harina","flour","avena","oat","cebada","barley","centeno","rye","gluten","espelta","kamut"];
            const detectedGluten = glutenKeywords.filter(kw => ingredientsText.includes(kw) || allergenText.includes(kw));
            const hasGluten = detectedGluten.length > 0;
            const glutenDetails = hasGluten ? `Contiene gluten (detectado: ${detectedGluten.join(", ")})` : "Libre de gluten (Según ingredientes USDA)";

            let allergens = [];
            if (item.allergenWarning) {
              item.allergenWarning.split(",").forEach(a => { const t = a.trim(); if (t && !allergens.includes(t)) allergens.push(t); });
            }

            return {
              status: 1,
              source: 'local',
              sourceLabel: 'USDA FoodData Central',
              product: {
                name: item.description || "Producto Desconocido",
                brand: item.brandName || item.brandOwner || "Desconocida",
                image: "",
                isFood: true,
                category: item.brandedFoodCategory || item.foodCategory || "Alimento (USDA)",
                gluten: { hasGluten, details: glutenDetails },
                calories: { value: kcal, level: energyLevel, percent },
                allergens: allergens,
                nutriscore: "-"
              }
            };
          }
        }
      } catch (error) {
        clearTimeout(t);
        if (error.name === 'AbortError') {
          console.warn(`[USDA] Timeout (8s) consultando FoodData Central`);
        } else {
          console.warn(`[USDA] Error consultando FoodData Central:`, error.message);
        }
      }
      return null;
    }

    const usdaResult = await queryUSDA(barcode);
    if (usdaResult) {
      const hd = !!(usdaResult.product.allergens && usdaResult.product.allergens.length > 0) || !!(usdaResult.product.gluten && usdaResult.product.gluten.dataAvailable !== false);
      const hn = usdaResult.product.calories && usdaResult.product.calories.value > 0;
      sourceResults.push({ source: "USDA FoodData Central", found: true, hasAllergenData: hd, hasNutritionData: hn });
      return res.json({ ...usdaResult, sourceResults });
    } else {
      sourceResults.push({ source: "USDA FoodData Central", found: false, hasAllergenData: false, hasNutritionData: false });
    }

    let upcTimeout;
    let fallbackResult = null;
    try {
      const upcCtrl = new AbortController();
      upcTimeout = setTimeout(() => upcCtrl.abort(), 8000);
      const upcResponse = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`, { signal: upcCtrl.signal });
      clearTimeout(upcTimeout);

      if (upcResponse.ok) {
        const upcData = await upcResponse.json();
        if (upcData.total > 0 && upcData.items?.[0]) {
          const item = upcData.items[0];
          const categoryLower = (item.category || "").toLowerCase();
          const titleLower = (item.title || "").toLowerCase();
          const descLower = (item.description || "").toLowerCase();

          const foodKeywords = ["food","beverage","snack","grocery","refresco","comida","dulce","galleta","bebida","juice","zumo","pan","leche","soda","cereal","pasta","arroz","aceite","condimento","salsa","conserva","chocolate"];
          const nonFoodKeywords = ["shampoo","champú","soap","jabón","detergent","limpieza","higiene","cosmetics","crema corporal","panty","protector diario","pet food","mascotas"];

          const matchesFood = foodKeywords.some(kw => categoryLower.includes(kw) || titleLower.includes(kw) || descLower.includes(kw));
          const matchesNonFood = nonFoodKeywords.some(kw => categoryLower.includes(kw) || titleLower.includes(kw) || descLower.includes(kw));
          const isFood = !matchesNonFood;

          const glutenKeywords = ["trigo","wheat","harina","flour","avena","oat","cebada","barley","centeno","rye"];
          const detectedGluten = glutenKeywords.filter(kw => titleLower.includes(kw) || descLower.includes(kw));
          const hasGluten = detectedGluten.length > 0;
          const glutenDetails = hasGluten ? `Contiene gluten (detectado: ${detectedGluten.join(", ")})` : "Libre de gluten (Requiere verificar empaque)";

          fallbackResult = { status: 1, source: 'local', sourceLabel: 'UpcItemDb', product: {
            name: item.title, brand: item.brand || "Desconocida",
            image: item.images?.[0] || "", isFood,
            category: item.category || (isFood ? "Comida / Bebida (Búsqueda global)" : "No Alimenticio"),
            gluten: { hasGluten, details: glutenDetails },
            calories: { value: 0, level: "No Especificado", percent: 10 },
            allergens: [], nutriscore: "-", isFromFallback: true
          }};
          sourceResults.push({ source: "UpcItemDb", found: true, hasAllergenData: false, hasNutritionData: false });
        } else {
          sourceResults.push({ source: "UpcItemDb", found: false, hasAllergenData: false, hasNutritionData: false });
        }
      }
    } catch (error) {
      clearTimeout(upcTimeout);
      sourceResults.push({ source: "UpcItemDb", found: false, hasAllergenData: false, hasNutritionData: false });
    }

    let gtinTimeout;
    try {
      const gtinCtrl = new AbortController();
      gtinTimeout = setTimeout(() => gtinCtrl.abort(), 8000);
      const gtinResponse = await fetch(`https://gtinhub.com/api/v1/product/${barcode}`, { signal: gtinCtrl.signal });
      clearTimeout(gtinTimeout);

      if (gtinResponse.ok) {
        const gtinData = await gtinResponse.json();
        if (gtinData.found && gtinData.product) {
          const p = gtinData.product;
          const nameGtin = p.name || "Producto Desconocido";
          const titleLower = nameGtin.toLowerCase();
          const descLower = (p.description || "").toLowerCase();
          const catLower = (p.category || "").toLowerCase();

          const foodKw = ["food","beverage","snack","grocery","refresco","comida","bebida","leche","soda","cereal","pasta","arroz","chocolate","jugo"];
          const nonFoodKw = ["shampoo","soap","jabón","detergent","limpieza","higiene","cosmetics","pet food"];
          const isFoodGtin = !nonFoodKw.some(k => titleLower.includes(k) || catLower.includes(k) || descLower.includes(k));

          const glutenKw = ["trigo","wheat","harina","flour","avena","oat","cebada","barley"];
          const hasGlutenGtin = glutenKw.some(k => titleLower.includes(k) || descLower.includes(k));
          const glutenDetailsGtin = hasGlutenGtin ? "Contiene gluten (detectado en descripción)" : "Libre de gluten (Requiere verificar empaque)";

          if (!fallbackResult) {
            fallbackResult = { status: 1, source: 'local', sourceLabel: 'GTINHub', product: {
              name: nameGtin, brand: p.brand || "Desconocida",
              image: p.image_url || "", isFood: isFoodGtin,
              category: p.category || (isFoodGtin ? "Comida / Bebida (GTINHub)" : "No Alimenticio"),
              gluten: { hasGluten: hasGlutenGtin, details: glutenDetailsGtin },
              calories: { value: 0, level: "No Especificado", percent: 10 },
              allergens: [], nutriscore: "-", isFromFallback: true
            }};
          }
          sourceResults.push({ source: "GTINHub", found: true, hasAllergenData: false, hasNutritionData: false });
        } else {
          sourceResults.push({ source: "GTINHub", found: false, hasAllergenData: false, hasNutritionData: false });
        }
      }
    } catch (error) {
      clearTimeout(gtinTimeout);
      sourceResults.push({ source: "GTINHub", found: false, hasAllergenData: false, hasNutritionData: false });
    }

    if (bestResult) return res.json({ ...bestResult, sourceResults });
    if (fallbackResult) return res.json({ ...fallbackResult, sourceResults });

    return res.status(404).json({ status: 0, message: "Producto no encontrado", sourceResults });
  } catch (err) {
    res.status(500).json({ status: 0, message: "Error interno del servidor" });
  }
});

app.post('/api/product', (req, res) => {
  const { barcode, product } = req.body;
  if (!barcode || !product || !product.name) {
    return res.status(400).json({ success: false, message: "Datos inválidos o incompletos" });
  }
  const db = readLocalDb();
  db[barcode] = {
    name: product.name, brand: product.brand || "Desconocida",
    image: product.image || "", isFood: product.isFood !== undefined ? product.isFood : true,
    category: product.category || "General",
    gluten: { hasGluten: product.hasGluten || false, details: product.glutenDetails || (product.hasGluten ? "Contiene gluten" : "Libre de gluten") },
    calories: { value: parseInt(product.calories) || 0, level: product.calories > 400 ? "Alto" : product.calories >= 150 ? "Moderado" : "Bajo", percent: Math.min(100, Math.round((parseInt(product.calories) || 0) / 5)) },
    allergens: Array.isArray(product.allergens) ? product.allergens : [],
    nutriscore: product.nutriscore || "c"
  };
  if (writeLocalDb(db)) {
    return res.json({ success: true, message: "Producto registrado exitosamente" });
  }
  res.status(500).json({ success: false, message: "Error interno al guardar" });
});

module.exports = app;
