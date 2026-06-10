require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Servir archivos estáticos del directorio actual sin caché
app.use(express.static(__dirname, {
  setHeaders: (res, filepath) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
}));

const DB_PATH = path.join(__dirname, 'local_mexican_products.json');

// Leer base de datos local
function readLocalDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, '{}', 'utf8');
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error al leer la base de datos local:", err);
    return {};
  }
}

// Guardar base de datos local
function writeLocalDb(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error("Error al guardar la base de datos local:", err);
    return false;
  }
}

// Endpoint GET: Buscar producto con tres capas de búsqueda y fallback
app.get('/api/product/:barcode', async (req, res, next) => {
  try {
    const barcode = req.params.barcode;
    // const db = readLocalDb(); // BD local desactivada temporalmente
  // 2. Buscar en Open Food Facts (mundial)
  async function queryOFF(host, label) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      console.log(`[${label}] Buscando en ${host}: ${barcode}`);
      const url = `https://${host}/api/v2/product/${barcode}.json`;
      const response = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (response.ok) {
        const data = await response.json();
        if (data.status === 1 && data.product) {
          console.log(`[${label}] Encontrado en ${host}: ${barcode}`);
          return data;
        }
      }
    } catch (error) {
      clearTimeout(t);
      if (error.name === 'AbortError') {
        console.warn(`[${label}] Timeout (8s) consultando ${host}`);
      } else {
        console.warn(`[${label}] Error consultando ${host}:`, error.message);
      }
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
    const p = worldResult.product;
    const pn = p.product_name || p.product_name_es || "Producto";
    const bn = p.brands || "—";
    const hd = hasOFFData(p);
    const ai = hd ? (p.allergens_tags?.length > 0 ? p.allergens_tags.join(", ") : "Con datos") : "Sin datos";
    const ni = (p.nutriments && p.nutriments['energy-kcal_100g']) ? Math.round(p.nutriments['energy-kcal_100g']) + " kcal/100g" : "Sin datos";
    sourceResults.push({ source: "Open Food Facts (Mundial)", found: true, productName: pn, brandName: bn, allergenInfo: ai, nutritionInfo: ni });
    if (hd) {
      return res.json({ ...worldResult, sourceLabel: "Open Food Facts (Mundial)", sourceResults });
    }
    bestResult = { ...worldResult, sourceLabel: "Open Food Facts (Mundial)" };
  } else {
    sourceResults.push({ source: "Open Food Facts (Mundial)", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
  }

  // 3. Buscar en Open Food Facts (MX)
  const mxResult = await queryOFF("mx.openfoodfacts.org", "OFF MX");
  if (mxResult) {
    const p = mxResult.product;
    const pn = p.product_name || p.product_name_es || "Producto";
    const bn = p.brands || "—";
    const hd = hasOFFData(p);
    const ai = hd ? (p.allergens_tags?.length > 0 ? p.allergens_tags.join(", ") : "Con datos") : "Sin datos";
    const ni = (p.nutriments && p.nutriments['energy-kcal_100g']) ? Math.round(p.nutriments['energy-kcal_100g']) + " kcal/100g" : "Sin datos";
    sourceResults.push({ source: "Open Food Facts (MX)", found: true, productName: pn, brandName: bn, allergenInfo: ai, nutritionInfo: ni });
    if (hd) {
      return res.json({ ...mxResult, sourceLabel: "Open Food Facts (MX)", sourceResults });
    }
    if (!bestResult) bestResult = { ...mxResult, sourceLabel: "Open Food Facts (MX)" };
  } else {
    sourceResults.push({ source: "Open Food Facts (MX)", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
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
    const p = usdaResult.product;
    const pn = p.name || "Producto";
    const bn = p.brand || "—";
    const ai = (p.allergens && p.allergens.length > 0) ? p.allergens.join(", ") : (p.gluten && p.gluten.dataAvailable !== false ? p.gluten.details : "Sin datos");
    const ni = (p.calories && p.calories.value > 0) ? p.calories.value + " kcal/100g" : "Sin datos";
    sourceResults.push({ source: "USDA FoodData Central", found: true, productName: pn, brandName: bn, allergenInfo: ai, nutritionInfo: ni });
    return res.json({ ...usdaResult, sourceResults });
  } else {
    sourceResults.push({ source: "USDA FoodData Central", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
  }

  // 5. Fallback a UpcItemDb (Base de datos global con 20 millones de productos comerciales)
  let upcTimeout;
  let fallbackResult = null;
  try {
    const upcCtrl = new AbortController();
    upcTimeout = setTimeout(() => upcCtrl.abort(), 8000);
    console.log(`[Fallback API] Intentando en UpcItemDb para: ${barcode}`);
    const upcUrl = `https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`;
    const upcResponse = await fetch(upcUrl, { signal: upcCtrl.signal });
    clearTimeout(upcTimeout);

    if (upcResponse.ok) {
      const upcData = await upcResponse.json();
      if (upcData.total > 0 && upcData.items && upcData.items[0]) {
        const item = upcData.items[0];
        console.log(`[Fallback API] Encontrado en UpcItemDb: ${item.title}`);

        const categoryLower = (item.category || "").toLowerCase();
        const titleLower = (item.title || "").toLowerCase();
        const descLower = (item.description || "").toLowerCase();

        const foodKeywords = [
          "food", "beverage", "snack", "grocery", "refresco", "comida", "dulce", 
          "galleta", "bebida", "juice", "zumo", "pan", "leche", "soda", "cereal", 
          "pasta", "arroz", "aceite", "condimento", "salsa", "conserva", "chocolate"
        ];
        
        const nonFoodKeywords = [
          "shampoo", "champú", "soap", "jabón", "detergent", "limpieza", "higiene", 
          "cosmetics", "crema corporal", "panty", "protector diario", "pet food", "mascotas"
        ];

        const matchesFood = foodKeywords.some(kw => categoryLower.includes(kw) || titleLower.includes(kw) || descLower.includes(kw));
        const matchesNonFood = nonFoodKeywords.some(kw => categoryLower.includes(kw) || titleLower.includes(kw) || descLower.includes(kw));

        const isFood = !matchesNonFood;

        let hasGluten = false;
        let glutenDetails = "Libre de gluten (Requiere verificar empaque)";
        
        const glutenKeywords = ["trigo", "wheat", "harina", "flour", "avena", "oat", "cebada", "barley", "centeno", "rye"];
        const detectedGluten = glutenKeywords.filter(kw => titleLower.includes(kw) || descLower.includes(kw));
        
        if (detectedGluten.length > 0) {
          hasGluten = true;
          glutenDetails = `Contiene gluten (detectado: ${detectedGluten.join(", ")})`;
        }

        fallbackResult = { status: 1, source: 'local', sourceLabel: 'UpcItemDb', product: {
          name: item.title,
          brand: item.brand || "Desconocida",
          image: item.images && item.images[0] ? item.images[0] : "",
          isFood: isFood,
          category: item.category || (isFood ? "Comida / Bebida (Búsqueda global)" : "No Alimenticio"),
          gluten: { hasGluten: hasGluten, details: glutenDetails },
          calories: { value: 0, level: "No Especificado", percent: 10 },
          allergens: [],
          nutriscore: "-",
          isFromFallback: true
        }};
        sourceResults.push({ source: "UpcItemDb", found: true, productName: item.title, brandName: item.brand || "—", allergenInfo: "Sin datos", nutritionInfo: "Sin datos" });
      } else {
        sourceResults.push({ source: "UpcItemDb", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
      }
    }
  } catch (error) {
    clearTimeout(upcTimeout);
    console.warn(`[Fallback API] Error consultando UpcItemDb:`, error.message);
    sourceResults.push({ source: "UpcItemDb", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
  }

  // 6. Fallback a GTINHub (10 requests/day gratis sin API key)
  let gtinTimeout;
  try {
    const gtinCtrl = new AbortController();
    gtinTimeout = setTimeout(() => gtinCtrl.abort(), 8000);
    console.log(`[Fallback API] Intentando en GTINHub para: ${barcode}`);
    const gtinResponse = await fetch(`https://gtinhub.com/api/v1/product/${barcode}`, { signal: gtinCtrl.signal });
    clearTimeout(gtinTimeout);

    if (gtinResponse.ok) {
      const gtinData = await gtinResponse.json();
      if (gtinData.found && gtinData.product) {
        const p = gtinData.product;
        console.log(`[Fallback API] Encontrado en GTINHub: ${p.name}`);

        const nameGtin = p.name || "Producto Desconocido";
        const brandGtin = p.brand || "Desconocida";
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
            name: nameGtin,
            brand: brandGtin,
            image: p.image_url || "",
            isFood: isFoodGtin,
            category: p.category || (isFoodGtin ? "Comida / Bebida (GTINHub)" : "No Alimenticio"),
            gluten: { hasGluten: hasGlutenGtin, details: glutenDetailsGtin },
            calories: { value: 0, level: "No Especificado", percent: 10 },
            allergens: [],
            nutriscore: "-",
            isFromFallback: true
          }};
        }
        sourceResults.push({ source: "GTINHub", found: true, productName: nameGtin, brandName: brandGtin, allergenInfo: "Sin datos", nutritionInfo: "Sin datos" });
      } else {
        sourceResults.push({ source: "GTINHub", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
      }
    }
  } catch (error) {
    clearTimeout(gtinTimeout);
    console.warn(`[Fallback API] Error consultando GTINHub:`, error.message);
    sourceResults.push({ source: "GTINHub", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
  }

  // Si no está en ninguna base de datos
  if (bestResult) return res.json({ ...bestResult, sourceResults });
  if (fallbackResult) return res.json({ ...fallbackResult, sourceResults });
  return res.status(404).json({ status: 0, message: "Producto no encontrado", sourceResults });
  } catch (err) {
    console.error(`[ERROR] Fallo en búsqueda de ${req.params.barcode}:`, err.message);
    res.status(500).json({ status: 0, message: "Error interno del servidor" });
  }
});

// Endpoint POST: Registrar nuevo producto
app.post('/api/product', (req, res) => {
  const { barcode, product } = req.body;

  if (!barcode || !product || !product.name) {
    return res.status(400).json({ success: false, message: "Datos inválidos o incompletos" });
  }

  const db = readLocalDb();
  
  // Guardar producto
  db[barcode] = {
    name: product.name,
    brand: product.brand || "Desconocida",
    image: product.image || "",
    isFood: product.isFood !== undefined ? product.isFood : true,
    category: product.category || "General",
    gluten: {
      hasGluten: product.hasGluten || false,
      details: product.glutenDetails || (product.hasGluten ? "Contiene gluten" : "Libre de gluten")
    },
    calories: {
      value: parseInt(product.calories) || 0,
      level: product.calories > 400 ? "Alto" : product.calories >= 150 ? "Moderado" : "Bajo",
      percent: Math.min(100, Math.round((parseInt(product.calories) || 0) / 5))
    },
    allergens: Array.isArray(product.allergens) ? product.allergens : [],
    nutriscore: product.nutriscore || "c"
  };

  if (writeLocalDb(db)) {
    console.log(`[Local DB] Nuevo producto registrado: ${barcode} - ${product.name}`);
    return res.json({ success: true, message: "Producto registrado exitosamente" });
  } else {
    return res.status(500).json({ success: false, message: "Error interno al guardar" });
  }
});

app.post('/api/ai-query', async (req, res) => {
  const { name, brand } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre del producto requerido" });

  const prompt = `Eres un experto en análisis de alimentos. Analiza el producto "${name}"${brand ? ` de la marca "${brand}"` : ''}.

Responde ÚNICAMENTE con un objeto JSON válido, sin explicaciones adicionales, sin markdown, sin bloques de código:

{
  "gluten": {
    "hasGluten": true,
    "details": "Explicación breve"
  },
  "allergens": ["Leche", "Soja"],
  "confidence": "alta/media/baja",
  "notes": "notas adicionales"
}

Si no tienes suficiente información usa confidence "baja" y explica en notes.`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://foodscaner.vercel.app',
        'X-Title': 'Yomi Food Scanner'
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(502).json({ error: "Error de OpenRouter", details: errorText });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: "Respuesta vacía de OpenRouter" });

    let parsed;
    try {
      const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ error: "No se pudo parsear la respuesta JSON", raw: content });
    }

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  Yomi corriendo con éxito!`);
  console.log(`  Accede a la app en: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
