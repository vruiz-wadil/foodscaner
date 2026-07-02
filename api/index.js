require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { getAccessToken, fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache, fireGetOcrData, fireSetOcrData, fireGetNutritionOcr, fireSetNutritionOcr, fireListDocs, fireListAll, fireDeleteDoc, fireLogScan, fireMarkScanNotFound, fireMarkScanHasOcr, fireMarkScanHasNutrition, fireMarkScanConfidence, fireMarkScanSource, fireMarkScanSources, fireLogReport, ADMIN_COLLECTIONS } = require('./firestore');
const { computeStats } = require('./stats');

function detectOS(ua = '') {
  ua = ua.toLowerCase();
  if (/android/.test(ua)) return 'Android';
  if (/iphone|ipad|ipod/.test(ua)) return 'iOS';
  if (/windows/.test(ua)) return 'Windows';
  if (/mac os x|macintosh/.test(ua)) return 'macOS';
  if (/linux/.test(ua)) return 'Linux';
  return 'Otro';
}


const app = express();
app.set('trust proxy', 1); // Vercel sits behind exactly one proxy hop

app.use(express.static(path.join(__dirname, '..')));
app.use(express.json({ limit: '5mb' }));

const limiter = rateLimit({ windowMs: 60000, max: 30, message: { error: "Demasiadas solicitudes. Intenta de nuevo en 1 minuto." } });
app.use('/api/', limiter);

// --- Queue for Groq to avoid rate limiting ---
let groqQueue = [];
let groqProcessing = false;
let lastGroqCallTime = 0;
const GROQ_DELAY_MS = 2500; // ponytail: 2.5s between Groq calls to respect rate limits

async function queueGroqCall(prompt, model, maxTokens, urgentDelay = GROQ_DELAY_MS) {
  return new Promise((resolve, reject) => {
    groqQueue.push({ prompt, model, maxTokens, resolve, reject, createdAt: Date.now(), delayMs: urgentDelay });
    processGroqQueue();
  });
}

async function processGroqQueue() {
  if (groqProcessing || groqQueue.length === 0) return;
  groqProcessing = true;

  while (groqQueue.length > 0) {
    const now = Date.now();
    const timeSinceLastCall = now - lastGroqCallTime;
    const { delayMs } = groqQueue[0];
    const waitTime = Math.max(0, delayMs - timeSinceLastCall);

    if (waitTime > 0) {
      await new Promise(r => setTimeout(r, waitTime));
    }

    const { prompt, model, maxTokens, resolve, reject } = groqQueue.shift();
    try {
      console.log('[QUEUE] Processing Groq call, queue remaining:', groqQueue.length);
      const result = await callGroq(prompt, model, maxTokens);
      lastGroqCallTime = Date.now();
      resolve(result);
    } catch (error) {
      lastGroqCallTime = Date.now();
      console.error('[QUEUE] Groq error:', error.message);
      reject(error);
    }
  }

  groqProcessing = false;
}

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
  if (age > 86400) { delete memoryAiCache[key]; return null; }
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

// ponytail: mantequilla/manteca/butter excluidos — muchos falsos positivos (maní, cacao, cocoa butter)
const CASEIN_KW = ["caseína","caseina","caseinato","lactoalbúmina","lactoalbumina","lactoglobulina",
  "suero de leche","suero lácteo","suero lacteo","whey","leche","milk","lácteo","lacteo","dairy",
  "queso","cheese","crema de leche","nata","yogur","yogurt","ghee","requesón","requeson","cuajada",
  "lactosa","sólidos de leche","solidos de leche","leche en polvo","milk powder"];
function detectCasein(...texts) {
  const combined = texts.join(" ").toLowerCase();
  const detected = CASEIN_KW.filter(kw => combined.includes(kw));
  return { hasCasein: detected.length > 0, detected };
}

function computeEnergyLevel(kcal) {
  if (kcal > 400) return { level: "Alto", percent: Math.min(100, Math.round((kcal / 600) * 100)) };
  if (kcal >= 150) return { level: "Moderado", percent: Math.round((kcal / 400) * 100) };
  return { level: "Bajo", percent: Math.max(3, Math.round((kcal / 150) * 50)) };
}

function detectGluten(...texts) {
  const combined = texts.join(" ").toLowerCase();
  // Check for gluten-free claims first — if name says "sin gluten", trust it
  if (/sin\s*gluten|libre\s*de\s*gluten|gluten\s*free|no\s*gluten/i.test(combined)) {
    return { hasGluten: false, detected: [] };
  }
  const detected = GLUTEN_KW.filter(kw => combined.includes(kw));
  return { hasGluten: detected.length > 0, detected };
}

// --- AI Helpers (Groq + Gemini fallback) ---
async function callGroq(prompt, model = 'openai/gpt-oss-120b', max_tokens = 3000) {
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

async function callGroqVision(imageBase64, prompt, model = 'meta-llama/llama-4-scout-17b-16e-instruct', max_tokens = 500) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens, temperature: 0.1,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        { type: 'text', text: prompt }
      ]}]
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (response.status === 429) throw new Error("Límite de velocidad excedido en Groq.");
  if (!response.ok) {
    const errBody = await response.text();
    console.error('[Groq Vision] Error body:', errBody.substring(0, 500));
    throw new Error(`Groq vision error: ${response.status}`);
  }
  const data = await response.json();
  return { content: data.choices?.[0]?.message?.content || "" };
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


async function callAI(prompt, max_tokens = 3000) {
  if (!process.env.GROQ_API_KEY) return callOpenRouter(prompt);

  const groqModels = [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b'
  ];

  const results = await Promise.allSettled([
    ...groqModels.map(m => queueGroqCall(prompt, m, max_tokens)),
    callOpenRouter(prompt)
  ]);

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value && typeof r.value.content === 'string' && r.value.content.length > 0) return r.value;
  }
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

    // Fire-and-forget scan log (no await — never delays the response)
    const _decCity = c => { try { return decodeURIComponent(c || ''); } catch { return c || ''; } };
    const _scanLogId = String(1e16 - Date.now()).padStart(16, '0') + '_' + Math.random().toString(36).slice(2, 8);
    res.setHeader('X-Scan-Log-Id', _scanLogId);
    fireLogScan({
      _id: _scanLogId,
      ts: Date.now(),
      barcode,
      ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '',
      country: req.headers['x-vercel-ip-country'] || '',
      region:  req.headers['x-vercel-ip-country-region'] || '',
      city:    _decCity(req.headers['x-vercel-ip-city']),
      os:      detectOS(req.headers['user-agent']),
      ua:      req.headers['user-agent'] || ''
    });

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
      const cacheLevel = memoryCache[cachedBarcode] && (Math.floor(Date.now() / 1000) - memoryCache[cachedBarcode].cachedAt) <= CACHE_MAX_AGE ? 'L1' : 'L2';
      const age = now - cached.cachedAt;
      const isOFF = cached.source && cached.source.includes("Open Food Facts");

      // Enrich cache hits: inject OCR data and build missing nutrition cards from OFF nutriments
      if (cached.response.product && !cached.response.product.calories) {
        const enriched = await addOcrDataIfAvailable({ ...cached.response.product });
        cached.response.product = enriched;
        memoryCache[cachedBarcode] = { ...memoryCache[cachedBarcode], response: cached.response };
      }

      if (age < OFF_FRESH_TTL) {
        fireMarkScanSources(_scanLogId, [], cacheLevel, '', '');
        return res.json(cached.response);
      }

      if (isOFF && cached.offLastModified !== undefined && age < OFF_STALE_TTL) {
        const host = cached.source.includes("Mundial") ? "world.openfoodfacts.org" : "mx.openfoodfacts.org";
        const currentModified = await checkOFFLastModified(cachedBarcode, host);
        if (currentModified !== null && currentModified === cached.offLastModified) {
          memoryCache[cachedBarcode].cachedAt = now;
          fireMarkScanSources(_scanLogId, [], cacheLevel, '', '');
          return res.json(cached.response);
        }
      }

      if (!isOFF && age < FALLBACK_TTL) {
        memoryCache[cachedBarcode].cachedAt = now;
        fireMarkScanSources(_scanLogId, [], cacheLevel, '', '');
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
                const casein = detectCasein(ingredientsText, allergenText);

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
                    nutriscore: "-",
                    dietary: casein.hasCasein ? { caseinFree: false, caseinFreeSource: 'db', caseinFreeDetail: `Contiene caseína/lácteos (detectado: ${casein.detected.join(", ")})` } : {}
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
        fireMarkScanSources(_scanLogId, sourceResults, 'none', 'db', 'db');
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
            const caseinEnrich = detectCasein(ingredientsText, allergenText);
            let allergens = [];
            if (item.allergenWarning) {
              const usdaToEn = { milk: "en:milk", eggs: "en:eggs", peanuts: "en:peanuts", soy: "en:soybeans", soybeans: "en:soybeans", wheat: "en:wheat", "tree nuts": "en:nuts", fish: "en:fish", shellfish: "en:crustaceans", sesame: "en:sesame-seeds", mustard: "en:mustard", sulfites: "en:sulphur-dioxide-and-sulphites" };
              item.allergenWarning.split(",").forEach(a => {
                const t = a.trim().toLowerCase();
                const mapped = usdaToEn[t] || t;
                if (t && !allergens.includes(mapped)) allergens.push(mapped);
              });
            }
            return { calories: { value: kcal, level: energyLevel, percent }, gluten: { hasGluten, details: glutenDetails }, casein: caseinEnrich, sugars: { sugars: sugarsVal, carbohydrates: carbsVal, fiber: fiberVal }, saturatedFat: satFatVal, sodium: sodiumVal, allergens, ingredientsText: item.ingredients || "" };
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
          const caseinUpc = detectCasein(titleLower, descLower);

          fallbackResult = { status: 1, source: 'local', sourceLabel: 'UpcItemDb', product: {
            name: item.title, brand: item.brand || "Desconocida",
            image: item.images?.[0] || "", isFood,
            category: item.category || (isFood ? "Comida / Bebida (Búsqueda global)" : "No Alimenticio"),
            gluten: { hasGluten, details: glutenDetails },
            calories: { value: 0, level: "No Especificado", percent: 10 },
            allergens: [], nutriscore: "-", isFromFallback: true,
            dietary: caseinUpc.hasCasein ? { caseinFree: false, caseinFreeSource: 'db', caseinFreeDetail: `Contiene caseína/lácteos (detectado: ${caseinUpc.detected.join(", ")})` } : {}
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
            const isGlutenFreeClaim = /sin\s*gluten|libre\s*de\s*gluten|gluten\s*free|no\s*gluten/i.test(titleLower);
            const caseinGtin = detectCasein(titleLower, descLower);
            fallbackResult = { status: 1, source: 'local', sourceLabel: 'GTINHub', product: {
              name: nameGtin, brand: brandGtin, image: p.image || "", isFood: isFoodGtin,
              category: p.category || (isFoodGtin ? "Comida / Bebida (GTINHub)" : "No Alimenticio"),
              gluten: { hasGluten: hasGlutenGtin, classification: isGlutenFreeClaim ? "declared" : undefined, details: hasGlutenGtin ? "Contiene gluten (detectado)" : isGlutenFreeClaim ? "Producto declarado libre de gluten (en nombre)" : "Información no disponible (Requiere verificar el empaque)" },
              calories: { value: 0, level: "No Especificado", percent: 10 },
              allergens: [], nutriscore: "-", isFromFallback: true,
              dietary: caseinGtin.hasCasein ? { caseinFree: false, caseinFreeSource: 'db', caseinFreeDetail: `Contiene caseína/lácteos (detectado: ${caseinGtin.detected.join(", ")})` } : {}
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
        const { content } = await callAI(prompt, 150);
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
            if (enrichment.casein) p._casein_enriched = enrichment.casein;
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

    // Helper: inject user-captured OCR ingredients and nutrition into product
    async function addOcrDataIfAvailable(product) {
      const [ocrData, nutritionOcr] = await Promise.all([
        fireGetOcrData(barcode),
        fireGetNutritionOcr(barcode)
      ]);

      if (ocrData?.ingredients_ocr) {
        product.ingredients_text = ocrData.ingredients_ocr;
        product._from_ocr = true;
        // Gluten detection from OCR ingredients (only set when detected; never downgrade richer OFF data)
        const gluten = detectGluten(ocrData.ingredients_ocr);
        if (gluten.hasGluten) {
          product.gluten = { hasGluten: true, details: "Contiene gluten (detectado en ingredientes)", dataAvailable: true };
        }
        // Casein detection from OCR ingredients
        const caseinOcr = detectCasein(ocrData.ingredients_ocr);
        if (caseinOcr.hasCasein) {
          product.dietary = product.dietary || {};
          if (product.dietary.caseinFree == null) {
            product.dietary.caseinFree = false;
            product.dietary.caseinFreeSource = 'db';
            product.dietary.caseinFreeDetail = `Contiene caseína/lácteos (detectado: ${caseinOcr.detected.join(", ")})`;
          }
        }
      }

      if (nutritionOcr?.nutritionData) {
        const nd = nutritionOcr.nutritionData;
        const nutVal = s => { const m = String(s || '').match(/[\d.]+/); return m ? parseFloat(m[0]) : null; };
        const NUT_MAP = {
          calorias: 'energy-kcal_100g', grasas: 'fat_100g',
          grasas_saturadas: 'saturated-fat_100g', grasas_trans: 'trans-fat_100g',
          carbohidratos: 'carbohydrates_100g', fibra: 'fiber_100g',
          azucares: 'sugars_100g', proteinas: 'proteins_100g'
        };
        if (!product.nutriments) product.nutriments = {};
        for (const [k, v] of Object.entries(nd)) {
          const key = NUT_MAP[k];
          if (key) { const n = nutVal(v); if (n != null) product.nutriments[key] = n; }
          if (k === 'sodio') { const n = nutVal(v); if (n != null) product.nutriments['sodium_100g'] = n / 1000; }
        }
        // OCR always wins: overwrite card-shaped fields regardless of existing OFF data
        const kcal = product.nutriments['energy-kcal_100g'];
        if (kcal != null) {
          product.calories = { value: kcal, ...computeEnergyLevel(kcal) };
        }
        const prot = product.nutriments['proteins_100g'];
        if (prot != null) {
          product.proteins = { value: prot, level: prot > 10 ? "Alto" : prot > 3 ? "Moderado" : "Bajo", percent: Math.min(100, Math.round(prot / 20 * 100)) };
        }
        const sug = product.nutriments['sugars_100g'];
        if (sug != null) {
          product.sugars = { value: sug, level: sug > 22.5 ? "Alto" : sug > 5 ? "Medio" : "Bajo", percent: sug > 22.5 ? Math.min(100, Math.round(sug / 33.75 * 100)) : sug > 5 ? Math.round(sug / 22.5 * 100) : Math.max(3, Math.round(sug / 5 * 50)) };
        }
        if (nd.carbohidratos != null) {
          const c = nutVal(nd.carbohidratos), f = nutVal(nd.fibra);
          if (c != null) product.carbohydrates = { value: c, fiber: f };
        }
        product._from_nutrition_ocr = true;
      }

      // Build cards from OFF nutriments when not already set by OCR
      if (product.nutriments) {
        if (!product.calories) { const kcal = product.nutriments['energy-kcal_100g']; if (kcal != null) product.calories = { value: kcal, ...computeEnergyLevel(kcal) }; }
        if (!product.proteins) { const prot = product.nutriments['proteins_100g']; if (prot != null) product.proteins = { value: prot, level: prot > 10 ? "Alto" : prot > 3 ? "Moderado" : "Bajo", percent: Math.min(100, Math.round(prot / 20 * 100)) }; }
        if (!product.sugars) { const sug = product.nutriments['sugars_100g']; if (sug != null) product.sugars = { value: sug, level: sug > 22.5 ? "Alto" : sug > 5 ? "Medio" : "Bajo", percent: sug > 22.5 ? Math.min(100, Math.round(sug / 33.75 * 100)) : sug > 5 ? Math.round(sug / 22.5 * 100) : Math.max(3, Math.round(sug / 5 * 50)) }; }
        if (!product.carbohydrates) { const c = product.nutriments['carbohydrates_100g'], f = product.nutriments['fiber_100g']; if (c != null) product.carbohydrates = { value: c, fiber: f ?? null }; }
      }

      return product;
    }

    // If we have bestResult, use it
    if (bestResult) {
      bestResult.product = await addOcrDataIfAvailable(bestResult.product);
      const respData = { ...bestResult, sourceResults };
      await setCacheEntry(barcode, respData, bestSource, bestLastModified);
      const _ingSrc = respData.product?.ingredients_ocr ? 'ocr' : (bestSource || '').includes('Groq') ? 'ai' : 'db';
      const _nutSrc = respData.product?.nutritionData?.source === 'ocr' ? 'ocr' : (bestSource || '').includes('Groq') ? 'ai' : 'db';
      fireMarkScanSources(_scanLogId, sourceResults, 'none', _ingSrc, _nutSrc);
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
      fallbackResult.product = await addOcrDataIfAvailable(fallbackResult.product);
      const respData = { ...fallbackResult, sourceResults };
      await setCacheEntry(barcode, respData, "UpcItemDb", null);
      const _ingSrc2 = respData.product?.ingredients_ocr ? 'ocr' : 'db';
      const _nutSrc2 = respData.product?.nutritionData?.source === 'ocr' ? 'ocr' : 'db';
      fireMarkScanSources(_scanLogId, sourceResults, 'none', _ingSrc2, _nutSrc2);
      return res.json(respData);
    }

    // Último recurso: identificar vía Groq + USDA
    sourceResults.push({ source: "Groq (IA)", found: false, productName: "—", brandName: "—", allergenInfo: "—", nutritionInfo: "—" });
    const groqId = await identifyViaAI(barcode);
    if (groqId) {
      sourceResults[sourceResults.length - 1] = { source: "Groq (IA)", found: true, productName: groqId.name, brandName: groqId.brand, allergenInfo: "Consultando USDA...", nutritionInfo: "Consultando USDA..." };
      const enrichment = await enrichFromUSDA(groqId.name, groqId.brand);
      if (enrichment) {
        let gp = {
          name: groqId.name, brand: groqId.brand, image: "", isFood: true,
          category: "Comida / Bebida (Identificado por IA)",
          gluten: enrichment.gluten, calories: enrichment.calories,
          allergens: enrichment.allergens, nutriscore: "-", isFromFallback: true,
          _enrichedFrom: "USDA (IA + nombre)", _sugars_enriched: enrichment.sugars,
          nutriments: {}, dietary: {}
        };
        if (enrichment.saturatedFat != null) gp.nutriments['saturated-fat_100g'] = enrichment.saturatedFat;
        if (enrichment.sodium != null) gp.nutriments['sodium_100g'] = Math.round(enrichment.sodium) / 1000;

        gp = await addOcrDataIfAvailable(gp);

        const respData = { status: 1, source: 'local', sourceLabel: 'Groq + USDA', product: gp, sourceResults };
        await setCacheEntry(barcode, respData, "Groq+USDA", null);
        const _ingSrc3 = respData.product?.ingredients_ocr ? 'ocr' : 'ai';
        const _nutSrc3 = respData.product?.nutritionData?.source === 'ocr' ? 'ocr' : 'ai';
        fireMarkScanSources(_scanLogId, sourceResults, 'none', _ingSrc3, _nutSrc3);
        return res.json(respData);
      }
    }

    // OCR-only fallback: product not found anywhere but user submitted OCR data
    const ocrOnlyBase = { name: "Producto", brand: "Desconocida", image: "", isFood: true, category: "Alimento", allergens: [], nutriscore: "-", isFromFallback: true, calories: { value: 0, level: "No Especificado", percent: 10 }, gluten: { hasGluten: false, details: "Verificar empaque" }, nutriments: {}, dietary: {} };
    const ocrOnlyProduct = await addOcrDataIfAvailable(ocrOnlyBase);
    if (ocrOnlyProduct._from_ocr || ocrOnlyProduct._from_nutrition_ocr) {
      const respData = { status: 1, source: 'local', sourceLabel: 'OCR', product: ocrOnlyProduct, sourceResults };
      const _ingSrc4 = ocrOnlyProduct._from_ocr ? 'ocr' : 'db';
      const _nutSrc4 = ocrOnlyProduct._from_nutrition_ocr ? 'ocr' : 'db';
      fireMarkScanSources(_scanLogId, sourceResults, 'none', _ingSrc4, _nutSrc4);
      return res.json(respData);
    }

    fireMarkScanNotFound(_scanLogId);
    fireMarkScanSources(_scanLogId, sourceResults, 'none', '', '');
    return res.status(404).json({ status: 0, message: "Producto no encontrado", sourceResults });
  } catch (err) {
    res.status(500).json({ status: 0, message: "Error interno del servidor" });
  }
});

app.post('/api/ai-query', async (req, res) => {
  const { name, brand, ingredients, allergens, sugars, carbohydrates, fiber, isBeverage, dietary, scanLogId } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre del producto requerido" });

  // AI cache: misma consulta repetida dentro de 24h devuelve resultado previo
  // Generamos modelLabel a partir del query (cache o fresh)
  const provider = req.query.provider || 'all';
  let modelLabel;
  if (provider === 'groq') {
    modelLabel = "Groq: " + (req.query.model || 'openai/gpt-oss-120b');
  } else if (provider === 'openrouter') {
    modelLabel = "OpenRouter: " + (req.query.model || 'free');
  } else if (provider === 'gemini') {
    modelLabel = "Gemini 2.5 Flash";
  } else {
    modelLabel = "Groq: " + (req.query.model || 'openai/gpt-oss-120b');
  }
  const cacheKey = [name, brand, ingredients, sugars, carbohydrates, fiber, isBeverage].join('|');
  const cached = await getAiCacheEntry(cacheKey);
  if (cached) {
    cached._model = modelLabel;
    if (scanLogId && cached.confidence) fireMarkScanConfidence(scanLogId, cached.confidence, cached.notes);
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
  "dietary":{"vegan":bool,"vegetarian":bool,"halal":bool,"organic":bool,"nonGmo":bool,"noAdditives":bool,"palmOilFree":bool,"fairTrade":bool,"caseinFree":bool},
  "dietaryDetails":{"vegan":"explicación","vegetarian":"explicación","halal":"explicación","organic":"explicación","nonGmo":"explicación","noAdditives":"explicación","palmOilFree":"explicación","fairTrade":"explicación","caseinFree":"explicación"},
  "notRecommended":[{"grupo":"Niños","razon":"contiene cafeína"}],
  "confidence":"alta|media|baja",
  "notes":"breve"
}

REGLAS:
- Gluten: true SOLO si ingredientes contienen trigo/avena/cebada/centeno explícitamente
- Sin ingredientes → basa en conocimiento general, confidence "baja"
- Alérgenos: SOLO si ingredientes/nombre contiene el alérgeno explícito (Sardinas→Pescado). No inventes de marcas
- Diabetes: usa OMS (bajo ≤5g azúcar sólidos / ≤2.5g bebidas, alto >22.5g / >11.25g). Fibra reduce impacto
- Dietary: analiza contra ingredientes. vegan=sin origen animal, halal=sin cerdo/alcohol, nonGmo=sin OGM, noAdditives=sin aditivos, palmOilFree=sin aceite palma, fairTrade=solo si nombre/marca lo indica, caseinFree=sin leche ni derivados (caseína/caseinato/suero/whey/queso/crema/yogur/nata). "Sin lactosa"/deslactosado NO es libre de caseína
- DietaryDetails: explica cada campo mencionando ingredientes concretos que justifiquen la decisión
- notRecommended: incluir SOLO grupos no aptos (con ingrediente problemático). Si ninguno, array vacío. NUNCA incluir grupos que "no aplican"
- DUDAS → confidence "baja" y explica en notes
- No inventes ingredientes`;

  try {
    let content, model;
    try {
      if (provider === 'groq') {
        if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY no configurada");
        const groqModel = req.query.model || 'openai/gpt-oss-120b';
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
    if (scanLogId && parsed.confidence) fireMarkScanConfidence(scanLogId, parsed.confidence, parsed.notes);
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

// Save captured nutrition data to Firebase
app.post('/api/products/nutrition', async (req, res) => {
  try {
    const { barcode, nutritionData, scanLogId } = req.body;
    if (!barcode || !nutritionData) return res.status(400).json({ error: 'Missing barcode or nutritionData' });
    await removeCacheEntry(barcode);
    await fireSetNutritionOcr(barcode, nutritionData);
    if (scanLogId) fireMarkScanHasNutrition(scanLogId);
    res.json({ status: 'ok', barcode });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar nutrición: ' + error.message });
  }
});

// Process ingredients from image using vision LLM (no Tesseract)
app.post('/api/ocr/process', async (req, res) => {
  try {
    const { imageData } = req.body;
    if (!imageData) return res.status(400).json({ error: 'Missing imageData' });

    const prompt = `Extrae el texto de ingredientes de esta imagen de etiqueta alimentaria.
Devuelve el texto tal como aparece, incluyendo ingredientes y cualquier declaración de alérgenos como "Contiene:", "Puede contener:", "Trazas de:" u otras advertencias similares.
Corrige errores obvios de lectura pero no inventes texto ni omitas secciones.
Si no puedes leer los ingredientes, responde con texto vacío.`;

    const result = await callGroqVision(imageData, prompt);
    if (!result?.content) throw new Error("No response from vision LLM");

    const cleanedText = result.content.trim();
    console.log('[OCR Vision] Extracted:', cleanedText.substring(0, 100));
    res.json({ status: 'ok', cleanedText });
  } catch (error) {
    console.error('[OCR Vision] Error:', error);
    res.status(500).json({ error: 'Error al procesar OCR: ' + (error?.message || error) });
  }
});

// Process nutrition from image using vision LLM (no Tesseract)
app.post('/api/nutrition/process', async (req, res) => {
  try {
    const { imageData } = req.body;
    if (!imageData) return res.status(400).json({ error: 'Missing imageData' });

    const prompt = `Eres un experto en etiquetas nutricionales. Analiza esta imagen y extrae SOLO los valores "Por 100g" (o "Per 100g").

REGLAS:
- IGNORA "Por porción", "Per serving", "Per portion"
- OMITE nutrientes que no aparezcan (no uses 0)
- Convierte comas a puntos (1,3 → 1.3)
- Incluye la unidad en el valor (kcal, g, mg, etc.)
- Devuelve SOLO JSON válido, sin markdown, sin comentarios

Claves permitidas: calorias, grasas, grasas_saturadas, grasas_trans, carbohidratos, fibra, azucares, azucares_añadidos, proteinas, sodio

Ejemplo: {"calorias": "150 kcal", "grasas": "2 g", "proteinas": "5 g", "sodio": "320 mg"}

RESPUESTA (SOLO JSON):`;

    console.log('[Nutrition Vision] Calling Groq vision...');
    const result = await callGroqVision(imageData, prompt);

    if (!result?.content) throw new Error("No response from vision LLM");

    let trimmed = result.content.trim();
    const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) trimmed = jsonMatch[1].trim();
    trimmed = trimmed.replace(/\/\/.*?$/gm, '').trim();

    const parsed = JSON.parse(trimmed);
    const keyCount = Object.keys(parsed).length;
    console.log('[Nutrition Vision] ✓ keys:', keyCount);

    if (keyCount === 0) {
      return res.status(400).json({ error: 'No se encontraron valores nutricionales. Intenta con una foto más clara de la tabla.' });
    }

    return res.json({ status: 'ok', nutritionData: parsed });
  } catch (error) {
    console.error('[Nutrition Vision] Error:', error);
    res.status(500).json({ error: 'Error al procesar nutrientes: ' + (error?.message || error) });
  }
});

// Debug: Check OCR data in Firebase
app.get('/api/ocr/debug/:barcode', async (req, res) => {
  try {
    const { barcode } = req.params;
    const ocrData = await fireGetOcrData(barcode);
    if (ocrData) {
      res.json({ status: 'found', barcode, data: ocrData });
    } else {
      res.json({ status: 'not_found', barcode, message: 'No OCR data in Firebase' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete OCR data from Firebase
app.delete('/api/ocr/:barcode', async (req, res) => {
  try {
    const { barcode } = req.params;
    const token = await getAccessToken();
    if (!token) return res.status(401).json({ error: 'No Firebase access' });

    const projectId = 'foodscaner-cache-v2';
    const resp = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/products_ocr/${encodeURIComponent(barcode)}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });

    if (resp.ok) {
      res.json({ status: 'deleted', barcode });
    } else {
      res.status(resp.status).json({ error: 'Failed to delete OCR' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete nutrition OCR data from Firebase
app.delete('/api/nutrition/:barcode', async (req, res) => {
  try {
    const { barcode } = req.params;
    const token = await getAccessToken();
    if (!token) return res.status(401).json({ error: 'No Firebase access' });

    const projectId = 'foodscaner-cache-v2';
    const resp = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/products_nutrition/${encodeURIComponent(barcode)}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });

    if (resp.ok) {
      await removeCacheEntry(barcode);
      res.json({ status: 'deleted', barcode });
    } else {
      res.status(resp.status).json({ error: 'Failed to delete nutrition OCR' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug: Test Firebase access
app.get('/api/debug/firebase', async (req, res) => {
  try {
    const hasKey = !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    res.json({
      hasFirebaseKey: hasKey,
      keyLength: hasKey ? process.env.FIREBASE_SERVICE_ACCOUNT_KEY.length : 0,
      keyPreview: hasKey ? process.env.FIREBASE_SERVICE_ACCOUNT_KEY.substring(0, 50) + '...' : 'N/A'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save processed ingredients to Firebase
app.post('/api/products/ocr', async (req, res) => {
  try {
    const { barcode, ingredients, scanLogId } = req.body;
    console.log('[OCR Save] Received:', { barcode, ingredientsLength: ingredients?.length });

    if (!barcode || !ingredients) {
      console.error('[OCR Save] Missing data:', { barcode, ingredients });
      return res.status(400).json({ error: 'Missing barcode or ingredients' });
    }

    console.log('[OCR Save] Clearing cache for', barcode);
    await removeCacheEntry(barcode);

    console.log('[OCR Save] Calling fireSetOcrData...');
    await fireSetOcrData(barcode, ingredients);
    if (scanLogId) fireMarkScanHasOcr(scanLogId);

    console.log('[OCR Save] Success');
    res.json({
      status: 'ok',
      message: 'Ingredientes guardados correctamente',
      barcode
    });
  } catch (error) {
    console.error('[OCR Save] Error:', error);
    res.status(500).json({ error: 'Error al guardar ingredientes: ' + error.message });
  }
});

// --- Report Endpoint ---
app.post('/api/report', async (req, res) => {
  const { barcode, productName, category, comment, image } = req.body || {};
  if (!category && !comment) return res.status(400).json({ error: 'Se requiere categoría o comentario' });
  if (image && image.length > 700000) return res.status(413).json({ error: 'Imagen demasiado grande (máx ~700 KB)' });
  const ua = req.headers['user-agent'] || '';
  const decCity = c => { try { return decodeURIComponent(c || ''); } catch { return c || ''; } };
  const ok = await fireLogReport({
    ts: Date.now(), barcode: barcode || '', productName: productName || '',
    category: category || '', comment: comment || '',
    ...(image ? { image } : {}),
    os: detectOS(ua), ua,
    ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '',
    country: req.headers['x-vercel-ip-country'] || '',
    region: req.headers['x-vercel-ip-country-region'] || '',
    city: decCity(req.headers['x-vercel-ip-city'])
  });
  if (!ok) return res.status(500).json({ error: 'No se pudo guardar el reporte' });
  res.json({ ok: true });
});

// --- Admin Panel API ---
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: 'Admin no configurado' });
  if (req.get('x-admin-token') !== ADMIN_TOKEN) return res.status(401).json({ error: 'No autorizado' });
  next();
}

function validCol(req, res, next) {
  if (!ADMIN_COLLECTIONS.includes(req.params.collection)) return res.status(400).json({ error: 'Colección inválida' });
  next();
}

app.get('/api/admin/login-check', requireAdmin, (req, res) => res.json({ ok: true }));

// ponytail: cache módulo 5 min; en Vercel cada instancia tiene el suyo — suficiente a esta escala.
let statsCache = { data: null, ts: 0 };
const STATS_TTL = 5 * 60 * 1000;

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  if (statsCache.data && Date.now() - statsCache.ts < STATS_TTL && !req.query.fresh) {
    return res.json(statsCache.data);
  }
  const logs = await fireListAll('scan_logs');
  if (!logs) return res.status(500).json({ error: 'Error al listar documentos' });

  const names = await barcodeNameMap();
  const data = computeStats(logs, names);

  const counts = { scan_logs: logs.length };
  for (const col of ['reports', 'products_ocr', 'products_nutrition']) {
    const items = await fireListAll(col);
    counts[col] = items ? items.length : 0;
  }
  const l2Ai = await fireListDocs('ai_cache', null);
  const cacheKeys = new Set([
    ...Object.keys(memoryCache), ...names.keys(),
    ...Object.keys(memoryAiCache), ...(l2Ai?.items || []).map(i => i.id)
  ]);
  counts.cache = cacheKeys.size;
  data.counts = counts;

  statsCache = { data, ts: Date.now() };
  res.json(data);
});

// Mapa barcode -> nombre de producto desde cache L2 + L1. Best-effort: null-safe.
async function barcodeNameMap() {
  const map = new Map();
  const l2 = await fireListDocs('product_cache', null);
  for (const item of (l2?.items || [])) {
    const p = item.data?.response?.product;
    const n = p?.product_name || p?.name || '';
    if (n) map.set(item.id, n);
  }
  for (const [bc, entry] of Object.entries(memoryCache)) {
    const p = entry.response?.product;
    const n = p?.product_name || p?.name || '';
    if (n) map.set(bc, n);
  }
  return map;
}

app.get('/api/admin/cache-all', requireAdmin, async (req, res) => {
  // Product cache: merge L1 (memory) + L2 (Firestore)
  const l1ProductKeys = Object.keys(memoryCache);
  const l2Product = await fireListDocs('product_cache', null);
  const l2ProductIds = new Set((l2Product?.items || []).map(i => i.id));

  const productNameOf = p => p?.product_name || p?.name || '';
  const productBrandOf = p => p?.brands || p?.brand || '';

  const productMap = new Map();
  for (const barcode of l1ProductKeys) {
    const entry = memoryCache[barcode];
    const p = entry.response?.product;
    productMap.set(barcode, {
      barcode,
      name: productNameOf(p),
      brand: productBrandOf(p),
      source: entry.source || 'unknown',
      inL1: true,
      inL2: l2ProductIds.has(barcode),
      cachedAt: entry.cachedAt || 0
    });
  }
  for (const item of (l2Product?.items || [])) {
    if (!productMap.has(item.id)) {
      const d = item.data || {};
      const p = d.response?.product;
      productMap.set(item.id, {
        barcode: item.id,
        name: productNameOf(p),
        brand: productBrandOf(p),
        source: d.source || 'unknown',
        inL1: false,
        inL2: true,
        cachedAt: d.cachedAt || 0
      });
    }
  }

  // Best-effort name+brand -> barcode(s) lookup, used to enrich AI entries below
  const normalize = s => (s || '').toLowerCase().trim();
  const barcodesByNameBrand = new Map();
  for (const p of productMap.values()) {
    if (!p.name) continue;
    const nbKey = normalize(p.name) + '|' + normalize(p.brand);
    if (!barcodesByNameBrand.has(nbKey)) barcodesByNameBrand.set(nbKey, []);
    barcodesByNameBrand.get(nbKey).push(p.barcode);
  }

  // AI cache: merge L1 (memory) + L2 (Firestore)
  const l1AiKeys = Object.keys(memoryAiCache);
  const l2Ai = await fireListDocs('ai_cache', null);
  const l2AiIds = new Set((l2Ai?.items || []).map(i => i.id));

  const barcodesForKey = key => {
    const [name, brand] = key.split('|');
    return barcodesByNameBrand.get(normalize(name) + '|' + normalize(brand)) || [];
  };

  const aiMap = new Map();
  for (const key of l1AiKeys) {
    const entry = memoryAiCache[key];
    const resp = entry.response || {};
    aiMap.set(key, {
      key,
      displayName: key.split('|')[0] || key.substring(0, 60),
      barcodes: barcodesForKey(key),
      model: resp._model || '',
      inL1: true,
      inL2: l2AiIds.has(key),
      cachedAt: entry.cachedAt || 0
    });
  }
  for (const item of (l2Ai?.items || [])) {
    if (!aiMap.has(item.id)) {
      const d = item.data || {};
      const resp = d.response || d;
      aiMap.set(item.id, {
        key: item.id,
        displayName: item.id.split('|')[0] || item.id.substring(0, 60),
        barcodes: barcodesForKey(item.id),
        model: resp._model || '',
        inL1: false,
        inL2: true,
        cachedAt: d.cachedAt || 0
      });
    }
  }

  res.json({
    product: [...productMap.values()].sort((a, b) => b.cachedAt - a.cachedAt),
    ai: [...aiMap.values()].sort((a, b) => b.cachedAt - a.cachedAt)
  });
});

app.delete('/api/admin/cache-all/:type/:key', requireAdmin, async (req, res) => {
  const { type, key } = req.params;
  const layer = req.query.layer || 'all'; // l1 | l2 | all

  if (type === 'product') {
    if (layer === 'l1' || layer === 'all') delete memoryCache[key];
    if (layer === 'l2' || layer === 'all') await fireRemoveCache(key);
  } else if (type === 'ai') {
    if (layer === 'l1' || layer === 'all') delete memoryAiCache[key];
    if (layer === 'l2' || layer === 'all') await fireDeleteDoc('ai_cache', key);
  } else {
    return res.status(400).json({ error: 'Tipo inválido (use product|ai)' });
  }

  res.json({ status: 'deleted', type, key, layer });
});

app.get('/api/admin/:collection', requireAdmin, validCol, async (req, res) => {
  const result = await fireListDocs(req.params.collection, req.query.pageToken || null);
  if (!result) return res.status(500).json({ error: 'Error al listar documentos' });
  if (req.params.collection === 'scan_logs') {
    const names = await barcodeNameMap();
    for (const it of result.items) {
      if (it.data?.barcode) it.data.productName = names.get(it.data.barcode) || '';
    }
  }
  res.json(result);
});

app.delete('/api/admin/:collection/:id', requireAdmin, validCol, async (req, res) => {
  const { collection, id } = req.params;
  if (collection === 'product_cache') {
    await removeCacheEntry(id);
  } else if (collection === 'ai_cache') {
    delete memoryAiCache[id];
    await fireDeleteDoc(collection, id);
  } else {
    await fireDeleteDoc(collection, id);
  }
  res.json({ status: 'deleted', collection, id });
});

module.exports = app;
module.exports.computeEnergyLevel = computeEnergyLevel;
module.exports.detectGluten = detectGluten;
module.exports.detectCasein = detectCasein;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
