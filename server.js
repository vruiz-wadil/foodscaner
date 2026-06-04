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
    const db = readLocalDb();

  // 1. Buscar en BD local primero
  if (db[barcode]) {
    console.log(`[Local DB] Producto encontrado: ${barcode} (${db[barcode].name})`);
    return res.json({ status: 1, source: 'local', product: db[barcode] });
  }

  // 2. Buscar en Open Food Facts (mundial + MX)
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

  const worldResult = await queryOFF("world.openfoodfacts.org", "OFF World");
  if (worldResult) return res.json(worldResult);

  // 3. Fallback a servidor regional de México (MX)
  const mxResult = await queryOFF("mx.openfoodfacts.org", "OFF MX");
  if (mxResult) return res.json(mxResult);

  // 4. Fallback a UpcItemDb (Base de datos global con 20 millones de productos comerciales)
  let upcTimeout;
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

        // Clasificar si es alimento analizando categorías y descripción
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

        // Intentar detectar presencia de gluten por ingredientes o descripción
        let hasGluten = false;
        let glutenDetails = "Libre de gluten (Requiere verificar empaque)";
        
        const glutenKeywords = ["trigo", "wheat", "harina", "flour", "avena", "oat", "cebada", "barley", "centeno", "rye"];
        const detectedGluten = glutenKeywords.filter(kw => titleLower.includes(kw) || descLower.includes(kw));
        
        if (detectedGluten.length > 0) {
          hasGluten = true;
          glutenDetails = `Contiene gluten (detectado: ${detectedGluten.join(", ")})`;
        }

        const normalizedProduct = {
          name: item.title,
          brand: item.brand || "Desconocida",
          image: item.images && item.images[0] ? item.images[0] : "",
          isFood: isFood,
          category: item.category || (isFood ? "Comida / Bebida (Búsqueda global)" : "No Alimenticio"),
          gluten: {
            hasGluten: hasGluten,
            details: glutenDetails
          },
          calories: {
            value: 0,
            level: "No Especificado",
            percent: 10
          },
          allergens: [],
          nutriscore: "-",
          isFromFallback: true
        };

        return res.json({ status: 1, source: 'local', product: normalizedProduct });
      }
    }
  } catch (error) {
    clearTimeout(upcTimeout);
    console.warn(`[Fallback API] Error consultando UpcItemDb:`, error.message);
  }

  // 5. Fallback a GTINHub (10 requests/day gratis sin API key)
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

        const normalizedGtin = {
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
        };

        return res.json({ status: 1, source: 'local', product: normalizedGtin });
      }
    }
  } catch (error) {
    clearTimeout(gtinTimeout);
    console.warn(`[Fallback API] Error consultando GTINHub:`, error.message);
  }

  // Si no está en ninguna base de datos
  return res.status(404).json({ status: 0, message: "Producto no encontrado" });
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

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  FoodScaner corriendo con éxito!`);
  console.log(`  Accede a la app en: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
