require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache, fireGetVerifiedProduct, fireGetExtendedCache, fireSetExtendedCache } = require('./firestore');

// Load verified products database
let verifiedProducts = {};
try {
  const dbPath = path.join(__dirname, '..', 'products-verified.json');
  if (fs.existsSync(dbPath)) {
    verifiedProducts = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    console.log(`[DB] Loaded ${Object.keys(verifiedProducts).length} verified products`);
  }
} catch (e) {
  console.warn('[DB] Error loading verified products:', e.message);
}

const app = express();

app.use(express.static(path.join(__dirname, '..')));
app.use(express.json());

const limiter = rateLimit({ windowMs: 60000, max: 30, message: { error: "Demasiadas solicitudes. Intenta de nuevo en 1 minuto." } });
app.use('/api/', limiter);

app.get('/', (req, res) => res.json({ status: 'ok', name: 'foodscaner', version: '1.0.0' }));

// --- Cache Helpers (L1 en memoria, L2 Firestore) ---
const memoryCache = {};
const memoryAiCache = {};
// ponytail: memoryCache grows unbounded; add TTL+eviction if memory usage becomes concern
const CACHE_MAX_AGE = 86400; // 24h

async function getCacheEntry(barcode) {
  const entry = memoryCache[barcode];
  if (entry) {
    const age = Math.floor(Date.now() / 1000) - entry.cachedAt;
    if (age <= CACHE_MAX_AGE) return entry;
    delete memoryCache[barcode];
  }
  const fire = await fireGetCache(barcode);
  if (fire) memoryCache[barcode] = { ...fire, cachedAt: Math.floor(Date.now() / 1000) };
  return fire;
}

async function setCacheEntry(barcode, response, source, offLastModified = null) {
  const now = Math.floor(Date.now() / 1000);
  memoryCache[barcode] = { response, source, offLastModified, cachedAt: now };
  await fireSetCache(barcode, response, source, offLastModified);
}

async function removeCacheEntry(barcode) {
  delete memoryCache[barcode];
  await fireRemoveCache(barcode);
}

async function getAiCacheEntry(key) {
  const entry = memoryAiCache[key];
  if (!entry) {
    const fire = await fireGetAiCache(key);
    if (fire) memoryAiCache[key] = { response: fire, cachedAt: Math.floor(Date.now() / 1000) };
    return fire;
  }
  const age = Math.floor(Date.now() / 1000) - entry.cachedAt;
  if (age > 86400) return null;
  return entry.response;
}

async function setAiCacheEntry(key, response) {
  memoryAiCache[key] = { response, cachedAt: Math.floor(Date.now() / 1000) };
  await fireSetAiCache(key, response);
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

// --- AI Helpers (Groq + Gemini fallback) ---
async function callGroq(prompt, model = 'llama-3.3-70b-versatile', max_tokens = 3000) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens }),
    signal: AbortSignal.timeout(5000)
  });
  if (response.status === 429) throw new Error("Límite de velocidad excedido en Groq.");
  if (!response.ok) throw new Error(`Groq error: ${response.status}`);
  const data = await response.json();
  return { content: data.choices?.[0]?.message?.content || "", model: "Groq: " + model };
}

async function callOpenRouter(prompt) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'openrouter/free', messages: [{ role: 'user', content: prompt }], temperature: 0.1 }),
    signal: AbortSignal.timeout(9000)
  });
  if (response.status === 429) throw new Error("Límite de velocidad excedido en OpenRouter.");
  if (!response.ok) throw new Error(`OpenRouter error: ${response.status}`);
  const data = await response.json();
  return { content: data.choices?.[0]?.message?.content || "", model: "OpenRouter: " + (data.model || "free") };
}

async function callGemini(prompt) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + process.env.GEMINI_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1 } }),
    signal: AbortSignal.timeout(10000)
  });
  if (response.status === 429) throw new Error("Límite de velocidad excedido en Gemini.");
  if (!response.ok) throw new Error(`Gemini error: ${response.status}`);
  const data = await response.json();
  return { content: data.candidates?.[0]?.content?.parts?.[0]?.text || "", model: "Gemini 2.5 Flash" };
}

async function callAI(prompt, groqModel = 'llama-3.3-70b-versatile', max_tokens = 3000) {
  if (!process.env.GROQ_API_KEY) return callOpenRouter(prompt);

  // Paralelo: ambos proveedores al mismo tiempo, gana el primero en responder
  const results = await Promise.allSettled([
    callGroq(prompt, groqModel, max_tokens),
    callOpenRouter(prompt)
  ]);

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value && typeof r.value.content === 'string' && r.value.content.length > 0) return r.value;
  }
  // Si ambos fallaron, lanzar el error del segundo (OpenRouter)
  throw results[1].reason || results[0].reason || new Error("Ambos proveedores fallaron");
}

function isValidBarcode(s) { return /^\d{8,14}$/.test(s); }

// ponytail: fuzzy barcode search - generates variations if exact match fails
function generateBarcodeVariations(barcode) {
  const variations = [barcode];

  // Remove last digit (check digit variation)
  if (barcode.length > 8) {
    variations.push(barcode.slice(0, -1));
  }

  // Try with 750 prefix (Mexico)
  if (!barcode.startsWith('750')) {
    variations.push(`750${barcode.slice(-10)}`);
  }

  // Try removing first digits if too long
  if (barcode.length > 12) {
    variations.push(barcode.slice(-12));
    variations.push(barcode.slice(-13));
  }

  // Try padding with zeros if too short
  if (barcode.length < 12) {
    variations.push(barcode.padStart(12, '0'));
    variations.push(barcode.padStart(13, '0'));
  }

  return [...new Set(variations)].filter(b => isValidBarcode(b));
}

// --- Product Search ---
app.get('/api/product/:barcode', async (req, res) => {
  try {
    const barcode = req.params.barcode;
    if (!isValidBarcode(barcode)) return res.status(400).json({ status: 0, message: "Código de barras inválido" });

    const barcodeVariations = generateBarcodeVariations(barcode);
    const now = Math.floor(Date.now() / 1000);

    // ----- L0: VERIFIED PRODUCTS (Permanent) -----
    if (verifiedProducts[barcode]) {
      const verified = verifiedProducts[barcode];
      console.log(`[VERIFIED] Found: ${barcode}`);
      return res.json({
        status: 1,
        source: 'local',
        sourceLabel: 'Base Verificada México',
        product: verified,
        _verified: true,
        _freshness: 'verified',
        sourceResults: [
          { source: 'Base Verificada México', found: true, productName: verified.name, brandName: verified.brand, allergenInfo: 'Verificado', nutritionInfo: `${verified.calories} kcal` }
        ]
      });
    }

    // ----- CACHE LOOKUP (try all variations) -----
    let cached = null;
    let cachedBarcode = barcode;
    for (const variant of barcodeVariations) {
      cached = await getCacheEntry(variant);
      if (cached) {
        cachedBarcode = variant;
        break;
      }
    }

    if (cached) {
      cached.response._fromCache = true;
      const age = now - cached.cachedAt;
      const isOFF = cached.source && cached.source.includes("Open Food Facts");

      if (age < OFF_FRESH_TTL) {
        return res.json(cached.response);
      }

      if (isOFF && cached.offLastModified !== undefined && age < OFF_STALE_TTL) {
        const host = cached.source.includes("Mundial") ? "world.openfoodfacts.org" : "mx.openfoodfacts.org";
        const currentModified = await checkOFFLastModified(cachedBarcode, host);
        if (currentModified !== null && currentModified === cached.offLastModified) {
          memoryCache[cachedBarcode].cachedAt = now;
          return res.json(cached.response);
        }
      }

      if (!isOFF && age < FALLBACK_TTL) {
        memoryCache[cachedBarcode].cachedAt = now;
        return res.json(cached.response);
      }

      await removeCacheEntry(cachedBarcode);
    }

    // ----- FULL QUERY (cache miss or stale) -----
    async function queryOFF(host) {
      // Try all barcode variations
      for (const variant of barcodeVariations) {
        try {
          const url = `https://${host}/api/v2/product/${variant}.json`;
          const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (response.ok) {
            const data = await response.json();
            if (data.status === 1 && data.product) return data;
          }
        } catch (e) { console.warn(`[OFF] query error for ${variant}:`, e.message); }
      }
      return null;
    }

    function hasOFFData(p) {
      return !!(p.ingredients_text || (p.allergens_tags && p.allergens_tags.length > 0) || p.allergens_from_ingredients || (p.traces && p.traces !== "undefined"));
    }

    async function processOFFResult(result, sourceLabel, labelShort) {
      // ponytail: collect all sources before returning - don't exit early
      if (!result) {
        sourceResults.push({ source: sourceLabel, found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
        return null;
      }
      const p = result.product;
      const pn = p.product_name || p.product_name_es || "Producto";
      const bn = p.brands || "—";
      const hd = hasOFFData(p);
      const ai = hd ? (p.allergens_tags?.length > 0 ? p.allergens_tags.join(", ") : "Con datos") : "Sin datos";
      const ni = (p.nutriments && p.nutriments['energy-kcal_100g']) ? Math.round(p.nutriments['energy-kcal_100g']) + " kcal/100g" : "Sin datos";
      sourceResults.push({ source: sourceLabel, found: true, productName: pn, brandName: bn, allergenInfo: ai, nutritionInfo: ni });

      if (hd && !bestResult) {
        bestResult = { ...result, sourceLabel };
        bestSource = sourceLabel;
        bestLastModified = result.product.last_modified_t || null;
        return { found: true, data: bestResult };
      }
      if (!bestResult) {
        bestResult = { ...result, sourceLabel };
        bestSource = sourceLabel;
        bestLastModified = result.product.last_modified_t || null;
      }
      return null;
    }

    let bestResult = null;
    let bestSource = "";
    let bestLastModified = null;
    const sourceResults = [];

    // Search ALL sources before returning
    const worldResult = await queryOFF("world.openfoodfacts.org");
    await processOFFResult(worldResult, "Open Food Facts (Mundial)", "OFF World");

    const mxResult = await queryOFF("mx.openfoodfacts.org");
    await processOFFResult(mxResult, "Open Food Facts (MX)", "OFF MX");

    const usResult = await queryOFF("us.openfoodfacts.org");
    await processOFFResult(usResult, "Open Food Facts (USA)", "OFF USA");

    // USDA FoodData Central — only if not a 750 prefix (doesn't find MX products)
    if (barcode.startsWith("750")) {
      sourceResults.push({ source: "USDA FoodData Central", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
      console.log(`[USDA] Saltado: código 750 (México)`);
    } else if (!res.headersSent) {
      async function queryUSDA(barcode) {
        try {
          // Try each barcode variation
          for (const variant of barcodeVariations) {
            console.log(`[USDA] Buscando en FoodData Central: ${variant}`);
            const response = await fetch(
              `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${process.env.USDA_API_KEY}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: variant, dataType: ["Branded"], pageSize: 5 }),
                signal: AbortSignal.timeout(8000)
              }
            );
            if (response.ok) {
              const data = await response.json();
              if (data.foods && data.foods.length > 0) {
                const matched = data.foods.find(f => {
                  const upc = (f.gtinUpc || "").replace(/\D/g, "");
                  const variantClean = variant.replace(/\D/g, "");
                  return upc && (upc === variantClean || upc.endsWith(variantClean) || variantClean.endsWith(upc));
                });
                if (!matched) {
                  console.log(`[USDA] Resultado descartado: ningún GTIN coincide con ${variant}`);
                  continue;
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
        await setCacheEntry(barcode, respData, "USDA FoodData Central", null);
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
      } catch (e) { console.warn('[USDA] enrich error:', e.message); }
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

    async function identifyViaAI(barcode) {
      const prompt = `Eres un experto en identificación de productos por código de barras. El código de barras es: ${barcode}. Basado en tu conocimiento, responde ÚNICAMENTE con un objeto JSON válido sin explicaciones: { "name": "nombre del producto", "brand": "marca", "known": true }. Si NO conoces el producto, responde: { "name": "", "brand": "", "known": false }.`;
      try {
        const content = await callAI(prompt, 'llama-3.3-70b-versatile', 150);
        const match = content.match(/\{.*\}/s);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.known && parsed.name && parsed.name !== "Producto") return parsed;
        }
      } catch (e) { console.warn('[AI] identify error:', e.message); }
      return null;
    }

    // Search UPCItemDb and GTINHub before returning
    // Enrichment: buscar por nombre en USDA si OFF/UPCItemDb/GTINHub tiene nombre pero faltan datos
    if (bestResult && !bestResult.product?.isFromFallback) {
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
      // bestResult found - continue to UPCItemDb/GTINHub for complete sourceResults
      // (will return after all sources searched)
    }

    // Continue searching even if bestResult exists - we need complete sourceResults
    // (UPCItemDb and GTINHub are already searched above and added to sourceResults)

    // If we have bestResult, use it
    if (bestResult) {
      const respData = { ...bestResult, sourceResults };
      await setCacheEntry(barcode, respData, bestSource, bestLastModified);
      return res.json(respData);
    }

    // Otherwise use fallbackResult if available
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
      await setCacheEntry(barcode, respData, "UpcItemDb", null);
      return res.json(respData);
    }

    // Último recurso: identificar vía Groq + USDA
    sourceResults.push({ source: "Groq (IA)", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
    const groqId = await identifyViaAI(barcode);
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
        await setCacheEntry(barcode, respData, "Groq+USDA", null);
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

  // AI cache: misma consulta repetida dentro de 24h devuelve resultado previo
  // Generamos modelLabel a partir del query (cache o fresh)
  const provider = req.query.provider || 'all';
  let modelLabel;
  if (provider === 'groq') {
    modelLabel = "Groq: " + (req.query.model || 'llama-3.3-70b-versatile');
  } else if (provider === 'openrouter') {
    modelLabel = "OpenRouter: " + (req.query.model || 'free');
  } else if (provider === 'gemini') {
    modelLabel = "Gemini 2.5 Flash";
  } else {
    modelLabel = "Groq: " + (req.query.model || 'llama-3.3-70b-versatile');
  }
  const cacheKey = [name, brand, ingredients, sugars, carbohydrates, fiber, isBeverage].join('|');
  const cached = await getAiCacheEntry(cacheKey);
  if (cached) {
    cached._model = modelLabel;
    return res.json(cached);
  }

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

  const prompt = `Eres un experto en análisis de alimentos. Analiza "${name}"${brand ? ` (${brand})` : ''}.${ingredients ? `\nIngredientes: "${ingredients}"` : ''}${allergens?.length ? `\nAlérgenos: ${allergens.join(", ")}` : ''}${nutritionStr}

Responde SOLO JSON sin markdown:
{
  "gluten": {"hasGluten":bool,"details":"breve"},
  "allergens":["ej: Leche"],
  "diabetes":{"risk":"bajo|medio|alto","glycemicImpact":"bajo|medio|alto","notes":"breve"},
  "dietary":{"vegan":bool,"vegetarian":bool,"halal":bool,"organic":bool,"nonGmo":bool,"noAdditives":bool,"palmOilFree":bool,"fairTrade":bool},
  "dietaryDetails":{"vegan":"explicación","vegetarian":"explicación","halal":"explicación","organic":"explicación","nonGmo":"explicación","noAdditives":"explicación","palmOilFree":"explicación","fairTrade":"explicación"},
  "notRecommended":[{"grupo":"Niños","razon":"contiene cafeína"}],
  "confidence":"alta|media|baja",
  "notes":"breve"
}

REGLAS:
- Gluten: true SOLO si ingredientes contienen trigo/avena/cebada/centeno explícitamente
- Sin ingredientes → basa en conocimiento general, confidence "baja"
- Alérgenos: SOLO si ingredientes/nombre contiene el alérgeno explícito (Sardinas→Pescado). No inventes de marcas
- Diabetes: usa OMS (bajo ≤5g azúcar sólidos / ≤2.5g bebidas, alto >22.5g / >11.25g). Fibra reduce impacto
- Dietary: analiza contra ingredientes. vegan=sin origen animal, halal=sin cerdo/alcohol, nonGmo=sin OGM, noAdditives=sin aditivos, palmOilFree=sin aceite palma, fairTrade=solo si nombre/marca lo indica
- DietaryDetails: explica cada campo mencionando ingredientes concretos que justifiquen la decisión
- notRecommended: incluir SOLO grupos no aptos (con ingrediente problemático). Si ninguno, array vacío. NUNCA incluir grupos que "no aplican"
- DUDAS → confidence "baja" y explica en notes
- No inventes ingredientes`;

  try {
    let content, model;
    try {
      if (provider === 'groq') {
        if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY no configurada");
        const groqModel = req.query.model || 'llama-3.3-70b-versatile';
        ({ content, model } = await callGroq(prompt, groqModel));
      } else if (provider === 'openrouter') {
        ({ content, model } = await callOpenRouter(prompt));
      } else if (provider === 'gemini') {
        if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY no configurada");
        ({ content, model } = await callGemini(prompt));
      } else {
        ({ content, model } = await callAI(prompt));
      }
    }
    catch (e) {
      return res.json({ error: "Análisis IA no disponible: " + e.message + " Los datos de la base de datos ya están visibles." });
    }

    if (!content) return res.json({ error: "Análisis IA no disponible temporalmente. Los datos de la base de datos ya están visibles." });

    let parsed;
    try {
      const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
      parsed._model = model;
      if (parsed.notRecommended && Array.isArray(parsed.notRecommended)) {
        parsed.notRecommended = parsed.notRecommended.filter(nr => {
          const r = (nr.razon || '').toLowerCase();
          return !(r.includes('no aplica') || r.includes('no contiene'));
        });
      }
    } catch {
      return res.status(502).json({ error: "No se pudo parsear la respuesta JSON", raw: content });
    }

    // No se espera (fire-and-forget): esta respuesta compite contra el timeout
    // del proveedor en el frontend (7-14s según el proveedor); esperar la
    // escritura a Firestore aquí empuja la respuesta más allá de ese timeout
    // y provoca aborts ("signal is aborted without reason").
    res.json(parsed);
    setAiCacheEntry(cacheKey, parsed);
  } catch (err) {
    res.json({ error: "Error inesperado en análisis IA. Los datos del producto ya están visibles." });
  }
});

app.delete('/api/cache/:barcode', async (req, res) => {
  await removeCacheEntry(req.params.barcode);
  res.json({ ok: true, message: "Caché eliminado para " + req.params.barcode });
});

// Refresh cache: force re-fetch and re-analyze
app.post('/api/cache/refresh/:barcode', async (req, res) => {
  const { barcode } = req.params;

  try {
    // If verified product, refresh AI analysis only
    if (verifiedProducts[barcode]) {
      const verified = verifiedProducts[barcode];
      const aiAnalysis = await callAI(
        `Analiza: ${verified.name} (${verified.brand}). Ingredientes: ${verified.ingredients}`
      );
      await fireSetExtendedCache(barcode, verified, 'Base Verificada México', aiAnalysis, 30);
      return res.json({
        status: 'ok',
        message: 'Producto verificado actualizado',
        type: 'verified',
        barcode
      });
    }

    // For dynamic products, clear and refetch
    await removeCacheEntry(barcode);

    res.json({
      status: 'ok',
      message: 'Caché eliminado. Próxima búsqueda traerá datos frescos.',
      type: 'dynamic',
      barcode
    });
  } catch (error) {
    console.error('[REFRESH] Error:', error.message);
    res.status(500).json({ error: 'Error al refrescar caché' });
  }
});

module.exports = app;
module.exports.computeEnergyLevel = computeEnergyLevel;
module.exports.detectGluten = detectGluten;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
