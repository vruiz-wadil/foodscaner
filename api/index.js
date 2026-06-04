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
    const db = readLocalDb();

    if (db[barcode]) {
      return res.json({ status: 1, source: 'local', product: db[barcode] });
    }

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

    const worldResult = await queryOFF("world.openfoodfacts.org", "OFF World");
    if (worldResult) return res.json(worldResult);

    const mxResult = await queryOFF("mx.openfoodfacts.org", "OFF MX");
    if (mxResult) return res.json(mxResult);

    let upcTimeout;
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

          return res.json({ status: 1, source: 'local', product: {
            name: item.title, brand: item.brand || "Desconocida",
            image: item.images?.[0] || "", isFood,
            category: item.category || (isFood ? "Comida / Bebida (Búsqueda global)" : "No Alimenticio"),
            gluten: { hasGluten, details: glutenDetails },
            calories: { value: 0, level: "No Especificado", percent: 10 },
            allergens: [], nutriscore: "-", isFromFallback: true
          }});
        }
      }
    } catch (error) {
      clearTimeout(upcTimeout);
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

          return res.json({ status: 1, source: 'local', product: {
            name: nameGtin, brand: p.brand || "Desconocida",
            image: p.image_url || "", isFood: isFoodGtin,
            category: p.category || (isFoodGtin ? "Comida / Bebida (GTINHub)" : "No Alimenticio"),
            gluten: { hasGluten: hasGlutenGtin, details: glutenDetailsGtin },
            calories: { value: 0, level: "No Especificado", percent: 10 },
            allergens: [], nutriscore: "-", isFromFallback: true
          }});
        }
      }
    } catch (error) {
      clearTimeout(gtinTimeout);
    }

    return res.status(404).json({ status: 0, message: "Producto no encontrado" });
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
