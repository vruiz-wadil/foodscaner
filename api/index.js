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

const GLUTEN_KW = ["trigo","wheat","harina","flour","avena","oat","cebada","barley","centeno","rye","gluten","espelta","kamut"];

function computeEnergyLevel(kcal) {
  if (kcal > 400) return { level: "Alto", percent: Math.min(100, Math.round((kcal / 600) * 100)) };
  if (kcal >= 150) return { level: "Moderado", percent: Math.round((kcal / 400) * 100) };
  return { level: "Bajo", percent: Math.max(3, Math.round((kcal / 150) * 50)) };
}

function detectGluten(...texts) {
  const combined = texts.join(" ").toLowerCase();
  const detected = GLUTEN_KW.filter(kw => combined.includes(kw));
  return { hasGluten: detected.length > 0, detected };
}

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
          const cache2 = readCache();
          cache2[barcode].cachedAt = now;
          writeCache(cache2);
          return res.json(cached.response);
        }
      }

      if (!isOFF && age < FALLBACK_TTL) {
        const cache2 = readCache();
        cache2[barcode].cachedAt = now;
        writeCache(cache2);
        return res.json(cached.response);
      }

      removeCacheEntry(barcode);
    }

    // ----- FULL QUERY (cache miss or stale) -----
    async function queryOFF(host) {
      try {
        const url = `https://${host}/api/v2/product/${barcode}.json`;
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          const data = await response.json();
          if (data.status === 1 && data.product) return data;
        }
      } catch (e) {}
      return null;
    }

    function hasOFFData(p) {
      return !!(p.ingredients_text || (p.allergens_tags && p.allergens_tags.length > 0) || p.allergens_from_ingredients || (p.traces && p.traces !== "undefined"));
    }

    function processOFFResult(result, sourceLabel, labelShort) {
      if (!result) {
        sourceResults.push({ source: sourceLabel, found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
        return;
      }
      const p = result.product;
      const pn = p.product_name || p.product_name_es || "Producto";
      const bn = p.brands || "—";
      const hd = hasOFFData(p);
      const ai = hd ? (p.allergens_tags?.length > 0 ? p.allergens_tags.join(", ") : "Con datos") : "Sin datos";
      const ni = (p.nutriments && p.nutriments['energy-kcal_100g']) ? Math.round(p.nutriments['energy-kcal_100g']) + " kcal/100g" : "Sin datos";
      sourceResults.push({ source: sourceLabel, found: true, productName: pn, brandName: bn, allergenInfo: ai, nutritionInfo: ni });
      if (hd) {
        const respData = { ...result, sourceLabel, sourceResults };
        const lastMod = result.product.last_modified_t || null;
        setCacheEntry(barcode, respData, sourceLabel, lastMod);
        return res.json(respData);
      }
      if (!bestResult) {
        bestResult = { ...result, sourceLabel };
        bestSource = sourceLabel;
        bestLastModified = result.product.last_modified_t || null;
      }
    }

    let bestResult = null;
    let bestSource = "";
    let bestLastModified = null;
    const sourceResults = [];

    const worldResult = await queryOFF("world.openfoodfacts.org");
    let worldReturned = processOFFResult(worldResult, "Open Food Facts (Mundial)", "OFF World");
    if (worldReturned !== undefined) return;

    const mxResult = await queryOFF("mx.openfoodfacts.org");
    let mxReturned = processOFFResult(mxResult, "Open Food Facts (MX)", "OFF MX");
    if (mxReturned !== undefined) return;

    // USDA FoodData Central — only if not a 750 prefix (doesn't find MX products)
    if (barcode.startsWith("750")) {
      sourceResults.push({ source: "USDA FoodData Central", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
      console.log(`[USDA] Saltado: código 750 (México)`);
    } else {
      async function queryUSDA(barcode) {
        try {
          console.log(`[USDA] Buscando en FoodData Central: ${barcode}`);
          const response = await fetch(
            `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${process.env.USDA_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: barcode, dataType: ["Branded"], pageSize: 5 }),
              signal: AbortSignal.timeout(8000)
            }
          );
          if (response.ok) {
            const data = await response.json();
            if (data.foods && data.foods.length > 0) {
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

              const el = computeEnergyLevel(kcal);
              let energyLevel = el.level, percent = el.percent;

              const ingredientsText = (item.ingredients || "").toLowerCase();
              const allergenText = (item.allergenWarning || "").toLowerCase();
              const gluten = detectGluten(ingredientsText, allergenText);
              const hasGluten = gluten.hasGluten;
              const glutenDetails = hasGluten ? `Contiene gluten (detectado: ${gluten.detected.join(", ")})` : "No se detectaron ingredientes con gluten en la base USDA";

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
          console.warn(`[USDA] Error consultando FoodData Central:`, error.message);
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
      try {
        const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${process.env.USDA_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, dataType: ["Branded"], pageSize: 3 }),
          signal: AbortSignal.timeout(6000)
        });
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
            let sugarsVal = null;
            let carbsVal = null;
            let fiberVal = null;
            if (item.foodNutrients) {
              const energy = item.foodNutrients.find(n => n.nutrientName === "Energy" && n.unitName === "KCAL");
              if (energy) kcal = Math.round(energy.value);
              const sugars = item.foodNutrients.find(n => n.nutrientName === "Sugars, total" && n.unitName === "G");
              if (sugars) sugarsVal = Math.round(sugars.value * 10) / 10;
              const carbs = item.foodNutrients.find(n => n.nutrientName === "Carbohydrate, by difference" && n.unitName === "G");
              if (carbs) carbsVal = Math.round(carbs.value * 10) / 10;
              const fiber = item.foodNutrients.find(n => n.nutrientName === "Fiber, total dietary" && n.unitName === "G");
              if (fiber) fiberVal = Math.round(fiber.value * 10) / 10;
            }
            let satFatVal = null;
            let sodiumVal = null;
            if (item.foodNutrients) {
              const satFat = item.foodNutrients.find(n => n.nutrientName === "Fatty acids, total saturated" && n.unitName === "G");
              if (satFat) satFatVal = Math.round(satFat.value * 10) / 10;
              const sod = item.foodNutrients.find(n => n.nutrientName === "Sodium, Na" && (n.unitName === "MG" || n.unitName === "mg"));
              if (sod) sodiumVal = Math.round(sod.value * 10) / 10;
            }
            const el = computeEnergyLevel(kcal);
            let energyLevel = el.level, percent = el.percent;
            const ingredientsText = (item.ingredients || "").toLowerCase();
            const allergenText = (item.allergenWarning || "").toLowerCase();
            const gluten = detectGluten(ingredientsText, allergenText);
            const hasGluten = gluten.hasGluten;
            const glutenDetails = hasGluten ? `Contiene gluten (detectado: ${gluten.detected.join(", ")})` : "Sin ingredientes con gluten detectados en la información declarada";
            let allergens = [];
            if (item.allergenWarning) {
              const usdaToEn = { milk: "en:milk", eggs: "en:eggs", peanuts: "en:peanuts", soy: "en:soybeans", soybeans: "en:soybeans", wheat: "en:wheat", "tree nuts": "en:nuts", fish: "en:fish", shellfish: "en:crustaceans", sesame: "en:sesame-seeds", mustard: "en:mustard", sulfites: "en:sulphur-dioxide-and-sulphites" };
              item.allergenWarning.split(",").forEach(a => {
                const t = a.trim().toLowerCase();
                const mapped = usdaToEn[t] || t;
                if (t && !allergens.includes(mapped)) allergens.push(mapped);
              });
            }
            return { calories: { value: kcal, level: energyLevel, percent }, gluten: { hasGluten, details: glutenDetails }, sugars: { sugars: sugarsVal, carbohydrates: carbsVal, fiber: fiberVal }, saturatedFat: satFatVal, sodium: sodiumVal, allergens, ingredientsText: item.ingredients || "" };
          }
        }
      } catch (e) {}
      return null;
    }

    // Fallback: UPCItemDb (solo nombre/marca, sin datos nutrimentales)
    let fallbackResult = null;
    try {
      const upcResponse = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`, { signal: AbortSignal.timeout(8000) });

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

          const gluten = detectGluten(titleLower, descLower);
          const hasGluten = gluten.hasGluten;
          const glutenDetails = hasGluten ? `Contiene gluten (detectado: ${gluten.detected.join(", ")})` : "Información no disponible (Requiere verificar el empaque)";

          fallbackResult = { status: 1, source: 'local', sourceLabel: 'UpcItemDb', product: {
            name: item.title, brand: item.brand || "Desconocida",
            image: item.images?.[0] || "", isFood,
            category: item.category || (isFood ? "Comida / Bebida (Búsqueda global)" : "No Alimenticio"),
            gluten: { hasGluten, details: glutenDetails },
            calories: { value: 0, level: "No Especificado", percent: 10 },
            allergens: [], nutriscore: "-", isFromFallback: true,
            dietary: {}
          }};
          sourceResults.push({ source: "UpcItemDb", found: true, productName: item.title, brandName: item.brand || "—", allergenInfo: "Sin datos", nutritionInfo: "Sin datos" });
        } else {
          sourceResults.push({ source: "UpcItemDb", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
        }
      } else {
        sourceResults.push({ source: "UpcItemDb", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
      }
    } catch (error) {
      sourceResults.push({ source: "UpcItemDb", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
    }

    // GTINHub fallback (cobertura diferente a UPCItemDb)
    if (!fallbackResult) {
      try {
        console.log(`[GTINHub] Buscando: ${barcode}`);
        const gtinResponse = await fetch(`https://gtinhub.com/api/v1/product/${barcode}`, { signal: AbortSignal.timeout(8000) });
        if (gtinResponse.ok) {
          const gtinData = await gtinResponse.json();
          if (gtinData.found && gtinData.product) {
            const p = gtinData.product;
            const nameGtin = p.name || "Producto";
            const brandGtin = p.brand || p.brandOwner || "Desconocida";
            const titleLower = (p.name || "").toLowerCase();
            const descLower = (p.description || "").toLowerCase();
            const catLower = (p.category || "").toLowerCase();
            const nonFoodKw = ["shampoo","soap","jabón","detergent","limpieza","higiene","cosmetics","pet food","mascotas"];
            const isFoodGtin = !nonFoodKw.some(k => titleLower.includes(k) || descLower.includes(k) || catLower.includes(k));
            const hasGlutenGtin = detectGluten(titleLower, descLower).hasGluten;
            fallbackResult = { status: 1, source: 'local', sourceLabel: 'GTINHub', product: {
              name: nameGtin, brand: brandGtin, image: p.image || "", isFood: isFoodGtin,
              category: p.category || (isFoodGtin ? "Comida / Bebida (GTINHub)" : "No Alimenticio"),
              gluten: { hasGluten: hasGlutenGtin, details: hasGlutenGtin ? "Contiene gluten (detectado)" : "Información no disponible (Requiere verificar el empaque)" },
              calories: { value: 0, level: "No Especificado", percent: 10 },
              allergens: [], nutriscore: "-", isFromFallback: true,
              dietary: {}
            }};
            sourceResults.push({ source: "GTINHub", found: true, productName: nameGtin, brandName: brandGtin, allergenInfo: "Sin datos", nutritionInfo: "Sin datos" });
          } else {
            sourceResults.push({ source: "GTINHub", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
          }
        } else {
          sourceResults.push({ source: "GTINHub", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
        }
      } catch (error) {
        sourceResults.push({ source: "GTINHub", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
      }
    }

    async function identifyViaGroq(barcode) {
      const prompt = `Eres un experto en identificación de productos por código de barras. El código de barras es: ${barcode}. Basado en tu conocimiento, responde ÚNICAMENTE con un objeto JSON válido sin explicaciones: { "name": "nombre del producto", "brand": "marca", "known": true }. Si NO conoces el producto, responde: { "name": "", "brand": "", "known": false }.`;
      try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 150 }),
          signal: AbortSignal.timeout(10000)
        });
        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || "";
          const match = content.match(/\{.*\}/s);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (parsed.known && parsed.name && parsed.name !== "Producto") return parsed;
          }
        }
      } catch (e) {}
      return null;
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
            p._gluten_enriched = enrichment.gluten;
          }
          p._sugars_enriched = enrichment.sugars;
          if (enrichment.saturatedFat != null && (!p.nutriments || p.nutriments['saturated-fat_100g'] === undefined)) {
            if (!p.nutriments) p.nutriments = {};
            p.nutriments['saturated-fat_100g'] = enrichment.saturatedFat;
          }
          if (enrichment.sodium != null && (!p.nutriments || p.nutriments['sodium_100g'] === undefined)) {
            if (!p.nutriments) p.nutriments = {};
            p.nutriments['sodium_100g'] = Math.round(enrichment.sodium) / 1000;
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
        fallbackResult.product._sugars_enriched = enrichment.sugars;
        if (!fallbackResult.product.nutriments) fallbackResult.product.nutriments = {};
        if (enrichment.saturatedFat != null && fallbackResult.product.nutriments['saturated-fat_100g'] === undefined) {
          fallbackResult.product.nutriments['saturated-fat_100g'] = enrichment.saturatedFat;
        }
        if (enrichment.sodium != null && fallbackResult.product.nutriments['sodium_100g'] === undefined) {
          fallbackResult.product.nutriments['sodium_100g'] = Math.round(enrichment.sodium) / 1000;
        }
        fallbackResult.product._enrichedFrom = "USDA (por nombre)";
      }
      const respData = { ...fallbackResult, sourceResults };
      setCacheEntry(barcode, respData, "UpcItemDb", null);
      return res.json(respData);
    }

    // Último recurso: identificar vía Groq + USDA
    sourceResults.push({ source: "Groq (IA)", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
    const groqId = await identifyViaGroq(barcode);
    if (groqId) {
      sourceResults[sourceResults.length - 1] = { source: "Groq (IA)", found: true, productName: groqId.name, brandName: groqId.brand, allergenInfo: "Consultando USDA...", nutritionInfo: "Consultando USDA..." };
      const enrichment = await enrichFromUSDA(groqId.name, groqId.brand);
      if (enrichment) {
        const gp = {
          name: groqId.name, brand: groqId.brand, image: "", isFood: true,
          category: "Comida / Bebida (Identificado por IA)",
          gluten: enrichment.gluten, calories: enrichment.calories,
          allergens: enrichment.allergens, nutriscore: "-", isFromFallback: true,
          _enrichedFrom: "USDA (IA + nombre)", _sugars_enriched: enrichment.sugars,
          nutriments: {}, dietary: {}
        };
        if (enrichment.saturatedFat != null) gp.nutriments['saturated-fat_100g'] = enrichment.saturatedFat;
        if (enrichment.sodium != null) gp.nutriments['sodium_100g'] = Math.round(enrichment.sodium) / 1000;
        const respData = { status: 1, source: 'local', sourceLabel: 'Groq + USDA', product: gp, sourceResults };
        setCacheEntry(barcode, respData, "Groq+USDA", null);
        return res.json(respData);
      }
    }

    return res.status(404).json({ status: 0, message: "Producto no encontrado", sourceResults });
  } catch (err) {
    res.status(500).json({ status: 0, message: "Error interno del servidor" });
  }
});

app.post('/api/ai-query', async (req, res) => {
  const { name, brand, ingredients, allergens, sugars, carbohydrates, fiber, isBeverage, dietary } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre del producto requerido" });

  let nutritionStr = '';
  if (sugars !== undefined && sugars !== null) {
    nutritionStr += `\n\nAzúcares por 100g: ${sugars}g`;
  }
  if (carbohydrates !== undefined && carbohydrates !== null) {
    nutritionStr += `\nCarbohidratos por 100g: ${carbohydrates}g`;
  }
  if (fiber !== undefined && fiber !== null) {
    nutritionStr += `\nFibra por 100g: ${fiber}g`;
  }
  if (isBeverage) {
    nutritionStr += `\nNota: Este producto es una bebida.`;
  }

  const prompt = `Eres un experto en análisis de alimentos. Analiza el producto "${name}"${brand ? ` de la marca "${brand}"` : ''}.${ingredients ? `\n\nLista de ingredientes: "${ingredients}"` : ''}${allergens && allergens.length ? `\n\nAlérgenos declarados: ${allergens.join(", ")}` : ''}${nutritionStr}

Responde ÚNICAMENTE con un objeto JSON válido, sin explicaciones adicionales, sin markdown, sin bloques de código:

{
  "gluten": {
    "hasGluten": true,
    "details": "Justificación breve con ingredientes específicos detectados"
  },
  "allergens": ["Leche", "Soja"],
  "diabetes": {
    "risk": "bajo",
    "glycemicImpact": "bajo",
    "notes": "Explicación breve basada en azúcares, carbohidratos, fibra e ingredientes"
  },
  "dietary": {
    "vegan": true,
    "vegetarian": true,
    "halal": true,
    "organic": true,
    "nonGmo": true,
    "noAdditives": true,
    "palmOilFree": true,
    "fairTrade": true
  },
  "dietaryDetails": {
    "vegan": "Explicación de por qué es o no vegano, mencionando ingredientes específicos si aplica.",
    "vegetarian": "Explicación de por qué es o no vegetariano.",
    "halal": "Explicación de por qué es o no halal.",
    "organic": "Explicación de por qué es o no orgánico.",
    "nonGmo": "Explicación de por qué es o no libre de OGM.",
    "noAdditives": "Explicación de por qué es o no libre de aditivos.",
    "palmOilFree": "Explicación de por qué es o no libre de aceite de palma.",
    "fairTrade": "Explicación de por qué es o no de comercio justo."
  },
  "notRecommended": [
    {"grupo": "Niños", "razon": "Contiene edulcorantes y cafeína"},
    {"grupo": "Embarazadas", "razon": "Contiene cafeína"}
  ],
  "confidence": "alta/media/baja",
  "notes": "notas adicionales"
}

REGLAS ESTRICTAS:
- Basa tu análisis ÚNICAMENTE en la lista de ingredientes proporcionada. No inventes ingredientes ni asumas la composición del producto por su nombre o marca.
- hasGluten debe ser true SOLO si la lista de ingredientes contiene un ingrediente específico que contenga gluten (ej: "harina de trigo", "avena", "cebada").
- Si no hay lista de ingredientes, basa tu análisis en el conocimiento general del producto y usa confidence "baja".
- Si hasGluten es false, details debe explicar por qué no se detectaron ingredientes con gluten en la lista proporcionada.
- Distingue entre "contiene gluten como ingrediente" (hasGluten: true) y "puede contener trazas" (hasGluten: false, menciónalo en notes).
- SI TIENES DUDAS, usa confidence "baja" y explica en notes.
- No inventes ingredientes. Si la lista de ingredientes no contiene algo, no lo incluyas en tu análisis.
- No incluyas gluten ni cereales con gluten (trigo, cebada, centeno, avena) en la lista de alérgenos, ya que el gluten se analiza en un campo separado.
- DIABETES: risk debe ser "bajo", "medio" o "alto" según la cantidad de azúcares por 100g, carbohidratos totales, y fibra (la fibra mitiga el impacto). Usa las tablas de referencia de la OMS: bajo ≤5g sólidos / ≤2.5g bebidas, alto >22.5g sólidos / >11.25g bebidas.
- DIABETES: glycemicImpact debe estimar si el producto tiene índice glucémico bajo, medio o alto según ingredientes, presencia de fibra y tipo de carbohidratos.
- DIABETES: Si no hay datos de azúcares ni carbohidratos, usa riesgo "bajo" con confidence "baja" y explain en notes.
- No incluyas información de diabetes en el campo "notes" principal, úsala en "diabetes.notes".
- DIETARY: Analiza cada campo basado en la lista de ingredientes: vegan (sin origen animal), vegetarian (sin carne/pescado), halal (sin cerdo/alcohol/gelatina), organic (ingredientes orgánicos), nonGmo (sin OGM), noAdditives (sin aditivos/preservantes artificiales), palmOilFree (sin aceite de palma), fairTrade (comercio justo, solo si el nombre o marca lo indica). Si no hay lista de ingredientes, usa confidence "baja" y basa tu respuesta en conocimiento general.
- DIETARYDETAILS: Para cada campo en dietaryDetails, proporciona una explicación específica que mencione ingredientes concretos del producto que justifiquen tu decisión. Ejemplo: si vegan=false porque contiene "leche entera", el detail debe decir "Contiene leche entera (ingrediente de origen animal)". Si no hay lista de ingredientes, explica que el análisis se basa en conocimiento general del producto.
- NOTRECOMMENDED: Identifica SOLO grupos de población para los que este producto NO es recomendable según sus ingredientes. Ej: "Niños" si contiene edulcorantes o cafeína, "Embarazadas" si contiene cafeína o alcohol, "Fenilcetonúricos" si contiene aspartame. NO incluyas grupos que SÍ sean aptos para el producto. Si un grupo no aplica, simplemente no lo incluyas en el array. Si no hay ingredientes o ningún grupo aplica, devuelve array vacío.`;

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

module.exports = { app, computeEnergyLevel, detectGluten };
