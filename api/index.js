require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(express.json());

const DB_PATH = '/tmp/local_mexican_products.json';
const CACHE_PATH = '/tmp/foodscaner_cache.json';

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

// --- Cache Helpers ---
function readCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return {};
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch { return {}; }
}

function writeCache(cache) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch {}
}

function getCacheEntry(barcode) {
  const cache = readCache();
  return cache[barcode] || null;
}

function setCacheEntry(barcode, response, source, offLastModified = null) {
  const cache = readCache();
  const now = Math.floor(Date.now() / 1000);
  cache[barcode] = {
    response,
    source,
    offLastModified,
    cachedAt: now
  };
  writeCache(cache);
}

function removeCacheEntry(barcode) {
  const cache = readCache();
  delete cache[barcode];
  writeCache(cache);
}

// Lightweight OFF freshness check: fetch only last_modified_t (tiny payload)
async function checkOFFLastModified(barcode, host) {
  try {
    const url = `https://${host}/api/v2/product/${barcode}.json?fields=last_modified_t`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = await resp.json();
      if (data.status === 1 && data.product) {
        return data.product.last_modified_t || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

const OFF_FRESH_TTL = 3600;      // 1h: serve from cache unconditionally
const OFF_STALE_TTL = 86400;     // 24h: serve from cache if OFF unchanged
const FALLBACK_TTL = 604800;     // 7d: serve from cache for non-OFF sources

// --- Product Search ---
app.get('/api/product/:barcode', async (req, res) => {
  try {
    const barcode = req.params.barcode;
    const now = Math.floor(Date.now() / 1000);

    // ----- CACHE LOOKUP -----
    const cached = getCacheEntry(barcode);
    if (cached) {
      const age = now - cached.cachedAt;
      const isOFF = cached.source && cached.source.includes("Open Food Facts");

      if (age < OFF_FRESH_TTL) {
        return res.json(cached.response);
      }

      if (isOFF && cached.offLastModified !== undefined && age < OFF_STALE_TTL) {
        const host = cached.source.includes("Mundial") ? "world.openfoodfacts.org" : "mx.openfoodfacts.org";
        const currentModified = await checkOFFLastModified(barcode, host);
        if (currentModified !== null && currentModified === cached.offLastModified) {
          cache[barcode].cachedAt = now;
          writeCache(cache);
          return res.json(cached.response);
        }
      }

      if (!isOFF && age < FALLBACK_TTL) {
        cache[barcode].cachedAt = now;
        writeCache(cache);
        return res.json(cached.response);
      }

      removeCacheEntry(barcode);
    }

    // ----- FULL QUERY (cache miss or stale) -----
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
    let bestSource = "";
    let bestLastModified = null;
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
        const respData = { ...worldResult, sourceLabel: "Open Food Facts (Mundial)", sourceResults };
        const lastMod = worldResult.product.last_modified_t || null;
        setCacheEntry(barcode, respData, "Open Food Facts (Mundial)", lastMod);
        return res.json(respData);
      }
      bestResult = { ...worldResult, sourceLabel: "Open Food Facts (Mundial)" };
      bestSource = "Open Food Facts (Mundial)";
      bestLastModified = worldResult.product.last_modified_t || null;
    } else {
      sourceResults.push({ source: "Open Food Facts (Mundial)", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
    }

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
        const respData = { ...mxResult, sourceLabel: "Open Food Facts (MX)", sourceResults };
        const lastMod = mxResult.product.last_modified_t || null;
        setCacheEntry(barcode, respData, "Open Food Facts (MX)", lastMod);
        return res.json(respData);
      }
      if (!bestResult) {
        bestResult = { ...mxResult, sourceLabel: "Open Food Facts (MX)" };
        bestSource = "Open Food Facts (MX)";
        bestLastModified = mxResult.product.last_modified_t || null;
      }
    } else {
      sourceResults.push({ source: "Open Food Facts (MX)", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
    }

    // USDA FoodData Central — only if not a 750 prefix (doesn't find MX products)
    if (barcode.startsWith("750")) {
      sourceResults.push({ source: "USDA FoodData Central", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
      console.log(`[USDA] Saltado: código 750 (México)`);
    } else {
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
              body: JSON.stringify({ query: barcode, dataType: ["Branded"], pageSize: 5 }),
              signal: ctrl.signal
            }
          );
          clearTimeout(t);
          if (response.ok) {
            const data = await response.json();
            if (data.foods && data.foods.length > 0) {
              // Verificar que el GTIN/UPC coincida con el código buscado
              const matched = data.foods.find(f => {
                const upc = (f.gtinUpc || "").replace(/\D/g, "");
                const barcodeClean = barcode.replace(/\D/g, "");
                return upc && (upc === barcodeClean || upc.endsWith(barcodeClean) || barcodeClean.endsWith(upc));
              });
              if (!matched) {
                console.log(`[USDA] Resultado descartado: ningún GTIN coincide con ${barcode}`);
                return null;
              }
              const item = matched;
              console.log(`[USDA] Encontrado en FoodData Central: ${item.description} (GTIN: ${item.gtinUpc})`);

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
            const glutenDetails = hasGluten ? `Contiene gluten (detectado: ${detectedGluten.join(", ")})` : "No se detectaron ingredientes con gluten en la base USDA";

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
        const respData = { ...usdaResult, sourceResults };
        setCacheEntry(barcode, respData, "USDA FoodData Central", null);
        return res.json(respData);
      } else {
        sourceResults.push({ source: "USDA FoodData Central", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
      }
    }

    // Enrichment: buscar por nombre en USDA si OFF/UPCItemDb tiene nombre pero faltan datos
    async function enrichFromUSDA(productName, brandName) {
      if (!productName || productName === "Producto" || productName === "—" || productName === "Producto Desconocido") return null;
      const query = brandName && brandName !== "—" && brandName !== "Desconocida" ? `${productName} ${brandName}` : productName;
      const USDA_API_KEY = "wT50TCqGVpmeEfLhVbFZNpTBU4SVgiqNOlEp1iBK";
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      try {
        const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, dataType: ["Branded"], pageSize: 3 }),
          signal: ctrl.signal
        });
        clearTimeout(t);
        if (response.ok) {
          const data = await response.json();
          if (data.foods && data.foods.length > 0) {
            const queryLower = query.toLowerCase();
            const matched = data.foods.find(f => {
              const desc = (f.description || "").toLowerCase();
              return desc.includes(queryLower) || queryLower.includes(desc);
            }) || data.foods[0];
            const item = matched;
            let kcal = 0;
            if (item.foodNutrients) {
              const energy = item.foodNutrients.find(n => n.nutrientName === "Energy" && n.unitName === "KCAL");
              if (energy) kcal = Math.round(energy.value);
            }
            let energyLevel = "Bajo", percent = 0;
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
              const usdaToEn = { milk: "en:milk", eggs: "en:eggs", peanuts: "en:peanuts", soy: "en:soybeans", soybeans: "en:soybeans", wheat: "en:wheat", "tree nuts": "en:nuts", fish: "en:fish", shellfish: "en:crustaceans", sesame: "en:sesame-seeds", mustard: "en:mustard", sulfites: "en:sulphur-dioxide-and-sulphites" };
              item.allergenWarning.split(",").forEach(a => {
                const t = a.trim().toLowerCase();
                const mapped = usdaToEn[t] || t;
                if (t && !allergens.includes(mapped)) allergens.push(mapped);
              });
            }
            return { calories: { value: kcal, level: energyLevel, percent }, gluten: { hasGluten, details: glutenDetails }, allergens, ingredientsText: item.ingredients || "" };
          }
        }
      } catch (error) {
        clearTimeout(t);
      }
      return null;
    }

    // Fallback: UPCItemDb (solo nombre/marca, sin datos nutrimentales)
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
          sourceResults.push({ source: "UpcItemDb", found: true, productName: item.title, brandName: item.brand || "—", allergenInfo: "Sin datos", nutritionInfo: "Sin datos" });
        } else {
          sourceResults.push({ source: "UpcItemDb", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
        }
      }
    } catch (error) {
      clearTimeout(upcTimeout);
      sourceResults.push({ source: "UpcItemDb", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
    }

    // GTINHub fallback (cobertura diferente a UPCItemDb)
    if (!fallbackResult) {
      let gtinTimeout;
      try {
        const gtinCtrl = new AbortController();
        gtinTimeout = setTimeout(() => gtinCtrl.abort(), 8000);
        console.log(`[GTINHub] Buscando: ${barcode}`);
        const gtinResponse = await fetch(`https://gtinhub.com/api/v1/product/${barcode}`, { signal: gtinCtrl.signal });
        clearTimeout(gtinTimeout);
        if (gtinResponse.ok) {
          const gtinData = await gtinResponse.json();
          if (gtinData.found && gtinData.product) {
            const p = gtinData.product;
            const nameGtin = p.name || "Producto";
            const brandGtin = p.brand || p.brandOwner || "Desconocida";
            const titleLower = (p.name || "").toLowerCase();
            const descLower = (p.description || "").toLowerCase();
            const catLower = (p.category || "").toLowerCase();
            const foodKw = ["food","beverage","snack","grocery","comida","dulce","galleta","bebida","leche","cereal","pasta","arroz"];
            const nonFoodKw = ["shampoo","soap","jabón","detergent","limpieza","higiene","cosmetics","pet food","mascotas"];
            const isFoodGtin = !nonFoodKw.some(k => titleLower.includes(k) || descLower.includes(k) || catLower.includes(k));
            const hasGlutenGtin = ["trigo","wheat","harina","flour","avena","oat","cebada","barley","centeno","rye"].some(k => titleLower.includes(k) || descLower.includes(k));
            fallbackResult = { status: 1, source: 'local', sourceLabel: 'GTINHub', product: {
              name: nameGtin, brand: brandGtin, image: p.image || "", isFood: isFoodGtin,
              category: p.category || (isFoodGtin ? "Comida / Bebida (GTINHub)" : "No Alimenticio"),
              gluten: { hasGluten: hasGlutenGtin, details: hasGlutenGtin ? "Contiene gluten (detectado)" : "Libre de gluten (Requiere verificar empaque)" },
              calories: { value: 0, level: "No Especificado", percent: 10 },
              allergens: [], nutriscore: "-", isFromFallback: true
            }};
            sourceResults.push({ source: "GTINHub", found: true, productName: nameGtin, brandName: brandGtin, allergenInfo: "Sin datos", nutritionInfo: "Sin datos" });
          } else {
            sourceResults.push({ source: "GTINHub", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
          }
        }
      } catch (error) {
        clearTimeout(gtinTimeout);
        sourceResults.push({ source: "GTINHub", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
      }
    }

    // Enrichment: buscar por nombre en USDA si OFF/UPCItemDb/GTINHub tiene nombre pero faltan datos
    if (bestResult) {
      const p = bestResult.product;
      const pName = p.product_name || p.product_name_es || "";
      const pBrand = p.brands || "";
      const needsEnrich = !p.nutriments || !p.nutriments['energy-kcal_100g'] || !p.allergens_tags || p.allergens_tags.length === 0;
      if (needsEnrich) {
        const enrichment = await enrichFromUSDA(pName, pBrand);
        if (enrichment) {
          if (!p.nutriments) p.nutriments = {};
          if (!p.nutriments['energy-kcal_100g'] && enrichment.calories.value > 0) {
            p.nutriments['energy-kcal_100g'] = enrichment.calories.value;
          }
          if (!p.allergens_tags || p.allergens_tags.length === 0) {
            p.allergens_tags = enrichment.allergens;
          }
          if (!p.ingredients_text && enrichment.ingredientsText) {
            p.ingredients_text = enrichment.ingredientsText;
            if (enrichment.gluten.hasGluten) {
              p._gluten_enriched = enrichment.gluten;
            }
          }
          p._enrichedFrom = "USDA (por nombre)";
        }
      }
      const respData = { ...bestResult, sourceResults };
      setCacheEntry(barcode, respData, bestSource, bestLastModified);
      return res.json(respData);
    }
    if (fallbackResult) {
      const fbName = fallbackResult.product.name || "";
      const fbBrand = fallbackResult.product.brand || "";
      const enrichment = await enrichFromUSDA(fbName, fbBrand);
      if (enrichment) {
        if (enrichment.calories.value > 0) {
          fallbackResult.product.calories = enrichment.calories;
        }
        if (enrichment.gluten.hasGluten) {
          fallbackResult.product.gluten = enrichment.gluten;
        }
        fallbackResult.product.allergens = enrichment.allergens;
        fallbackResult.product._enrichedFrom = "USDA (por nombre)";
      }
      const respData = { ...fallbackResult, sourceResults };
      setCacheEntry(barcode, respData, "UpcItemDb", null);
      return res.json(respData);
    }

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

app.post('/api/ai-query', async (req, res) => {
  const { name, brand } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre del producto requerido" });

  const prompt = `Eres un experto en análisis de alimentos. Analiza el producto "${name}"${brand ? ` de la marca "${brand}"` : ''}.

Responde ÚNICAMENTE con un objeto JSON válido, sin explicaciones adicionales, sin markdown, sin bloques de código:

{
  "gluten": {
    "hasGluten": true,
    "details": "Justificación breve con ingredientes específicos detectados"
  },
  "allergens": ["Leche", "Soja"],
  "confidence": "alta/media/baja",
  "notes": "notas adicionales"
}

REGLAS ESTRICTAS:
- hasGluten debe ser true SOLO si puedes identificar un ingrediente específico que contenga gluten en la composición del producto (ej: "harina de trigo", "avena"). NO marques hasGluten true solo por el nombre del producto o su categoría.
- Si no puedes identificar un ingrediente específico con gluten, hasGluten debe ser false y explica en details por qué (ej: "el producto no declara ingredientes con gluten").
- Distingue entre "contiene gluten como ingrediente" (hasGluten: true) y "puede contener trazas" (hasGluten: false, menciónalo en notes).
- SI TIENES DUDAS, usa confidence "baja" y explica en notes.
- Si hasGluten es true, details DEBE incluir el ingrediente exacto que contiene gluten. No inventes ingredientes.
- Si hasGluten es false, details debe explicar por qué se considera libre de gluten.`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(502).json({ error: "Error de Groq", details: errorText });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: "Respuesta vacía de Groq" });

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

module.exports = app;
