<div align="center">
  <h1>
    <span style="color: #10b981;">yo</span><span style="color: #f8fafc;">mi</span>
  </h1>
  <p><strong>¿Puedo comerlo? Escanea y lo sabes en segundos.</strong></p>
  <p>
    <a href="https://yomiscan.vercel.app" target="_blank">yomiscan.vercel.app</a>
  </p>
</div>

---

## ¿Qué es Yomi?

Yomi es un identificador nutricional de alimentos que escanea códigos de barras con tu cámara o los ingresa manualmente para obtener al instante:

- ✅ **Clasificación alimento / no-alimento** — detecta si es un producto comestible (vs cosméticos, detergentes, comida de mascotas, etc.)
- 🟠 **Sellos NOM-051 mexicanos** — advertencias de exceso de calorías, azúcares, grasas saturadas y sodio según la normativa oficial, calculados en tiempo real sobre los nutrientes declarados
- 🌿 **Tipo de dieta** — tabla con 10 atributos (libre de gluten, vegano, vegetariano, kosher, halal, orgánico, sin OGM, sin aditivos, sin aceite de palma, comercio justo) con indicador de fuente (BD vs IA)
- ⚠️ **Alérgenos** — grid de iconos con estado detectado/trazas/libre, más etiquetas de alérgenos no comunes + sección de trazas
- 🚫 **No recomendado para** — grupos de población (niños, diabéticos, hipertensos, fenilcetonúricos, intolerantes a lactosa) con fondo rojo (certeza por ingredientes/BD) o amarillo (inferido por IA)
- 🔥 **Calorías** por cada 100g con barra de progreso visual y nivel de energía (verde/ámbar/rojo)
- 🍬 **Azúcares** con nivel según umbrales UK NHS (ajustado para sólidos vs bebidas)
- 🥖 **Carbohidratos** totales y netos (con fibra cuando disponible)
- 🥩 **Proteínas** con nivel
- ❤️ **Riesgo para hipertensos** — widget basado en sodio (mg/100g): bajo 🟢 / medio 🟡 / alto 🔴
- 🧪 **Riesgo por grasas saturadas** — widget basado en grasas saturadas (g/100g): bajo 🟢 / medio 🟡 / alto 🔴
- ⚖️ **Control de peso** — widget de densidad calórica (kcal/100g): baja 🟢 / media 🟡 / alta 🔴, con detección de factores adicionales
- 🩸 **Riesgo para diabéticos** — widget con nivel de riesgo, impacto glucémico y notas basado en azúcares y fibra
- 📋 **Lista de ingredientes** colapsable
- 📊 **Información nutricional** en tabla colapsable
- 🧠 **Análisis con IA** — revisión vía Groq (LLaMA 3.3 70B) que llena vacíos en datos dietarios, detecta alérgenos adicionales y analiza riesgo diabético
- ⚡ **Caché inteligente** con TTL por tipo de fuente y verificación de cambios

---

## 1. Búsqueda e identificación del producto

### 1.1 Captura del código de barras

El usuario puede ingresar un código de barras de dos formas:

- **Escáner por cámara**: usa `html5-qrcode`. La cámara se activa en un contenedor `<video>` y decodifica códigos EAN-13, UPC-A, etc. en tiempo real. Detecta automáticamente la cámara trasera. Al detectar un código, vibra (si soportado), se detiene y lanza la consulta.
- **Entrada manual**: el usuario escribe el código en un campo de texto validado con `/^\d+$/`.

Ambos métodos activan `analyzeBarcode(barcode)`.

### 1.2 Cadena de consulta (query pipeline)

Cada código se consulta secuencialmente contra las siguientes fuentes. En cuanto una fuente devuelve datos completos, se detiene la cadena y se procesa el resultado.

#### Paso 1: Caché local (`/tmp/foodscaner_cache.json`)

- JSON en disco (efímero en Vercel — `/tmp/` se destruye entre deploys).
- Cada entrada tiene: datos del producto, `cachedAt`, `offLastModified` (timestamp de última modificación en OFF).
- **TTL fresco**: 1 hora. Si expiró, se consulta `last_modified_t` ligero; si no cambió, se refresca por otra hora.
- **Fallback offline**: 7 días.

#### Paso 2: Open Food Facts — Mundial (`world.openfoodfacts.org`)

- Endpoint: `https://world.openfoodfacts.org/api/v2/product/{barcode}.json?fields=...`
- Timeout 8s. Si excede, pasa al siguiente paso.
- Si el producto tiene datos completos (ingredientes + nutrimentos), se usa directamente.
- Si se encuentra pero sin datos, se guarda el nombre/marca para enriquecimiento por nombre vía USDA.

#### Paso 3: Open Food Facts — México (`mx.openfoodfacts.org`)

- Mismo endpoint, dominio `.mx`. Timeout 8s.

#### Paso 4: USDA FoodData Central (enriquecimiento por nombre)

- Solo si OFF encontró el producto pero sin datos nutricionales ni alérgenos completos.
- NO se ejecuta para códigos que inician con `750` (prefijo mexicano).
- Se toma el nombre del producto y se busca en USDA con `api.nal.usda.gov/fdc/v1/foods/search`.
- El gluten enriquecido se guarda en `_gluten_enriched` y el frontend lo usa con prioridad.

#### Paso 5: UPCItemDb

- Fallback global. Endpoint: `api.upcitemdb.com/prod/trial/lookup`.
- Devuelve nombre, marca, imagen, categoría. Sin datos nutricionales. Activa análisis completo por IA.

#### Paso 6: GTINHub

- Fallback con cobertura diferente. Endpoint: `api.gtinhub.com/api/v1/product/{barcode}`.
- Misma dinámica que UPCItemDb.

#### Paso 7: Identificación por IA (Groq) + USDA

- Último recurso: se consulta a Groq para identificar el producto por código de barras.
- Si Groq lo reconoce, se busca por nombre en USDA para obtener datos nutricionales.

### 1.3 Procesamiento de la respuesta (`parseApiProduct`)

Cuando el backend devuelve un producto, el frontend lo procesa:

#### Clasificación alimento vs no-alimento

Se comparan categorías contra keywords no-alimenticias (`cosmetics`, `shampoo`, `detergent`, `pet food`, etc.). Si coincide o si no hay nutrimentos/ingredientes y las categorías incluyen "non-food", se rechaza.

#### Extracción de datos

- **Calorías**: se prefiere `energy-kcal_100g`. Si solo hay kJ, se convierte (÷ 4.184). Clasifica: Bajo (<150), Moderado (150–400), Alto (>400).
- **Azúcares**: `sugars_100g`. Clasifica según umbrales UK NHS: para sólidos (>22.5 Alto, >5 Medio), para bebidas (>11.25 Alto, >2.5 Medio).
- **Carbohidratos**: `carbohydrates_100g`. Fibra: `fiber_100g`. Calcula carbohidratos netos cuando hay fibra.
- **Proteínas**: `proteins_100g`. Clasifica: Bajo (<3), Moderado (3–10), Alto (>10).
- **Nutri-Score**: `nutriscore_grade`, fallback a "-".

#### Sellos NOM-051 mexicanos

Se calculan en tiempo real según los perfiles de nutrientes:

| Sello | Condición sólidos | Condición bebidas |
|-------|------------------|-------------------|
| EXCESO CALORÍAS | ≥275 kcal/100g | ≥70 kcal/100g |
| EXCESO AZÚCARES | ≥10% de energía de azúcares O ≥10g/100g | ≥10% de energía O ≥5g/100ml |
| EXCESO GRASAS SATURADAS | ≥10% de energía de grasas saturadas | ≥10% de energía |
| EXCESO SODIO | ≥300mg/100g O ≥1mg/kcal | ≥45mg/100ml O ≥1mg/kcal |

#### Widgets de riesgo para condiciones de salud

Se muestran automáticamente cuando el producto tiene los datos necesarios:

| Condición | Dato usado | Umbrales |
|-----------|-----------|----------|
| Hipertensión | Sodio (mg/100g) | ≤120 🟢, 120–400 🟡, >400 🔴 |
| Colesterol | Grasas saturadas (g/100g) | ≤3 🟢, 3–6 🟡, >6 🔴 |
| Control de peso | Densidad calórica (kcal/100g) | <150 🟢, 150–300 🟡, >300 🔴 |
| Diabetes | Azúcares + fibra (via IA) | Bajo 🟢 / Medio 🟡 / Alto 🔴 |

#### Tipo de dieta

Se muestran 10 atributos dietarios con fuente de origen (BD o IA) y nivel de certeza:

- Libre de gluten (certificado, posiblemente libre, posiblemente no libre, no libre, sin info)
- Vegano, Vegetariano, Kosher, Halal, Orgánico, Sin OGM, Sin Aditivos, Sin Aceite de Palma, Comercio Justo (Sí/Probable/Probable No/No/Sin Info)

#### Alérgenos

Se obtienen exclusivamente de campos explícitos de las bases de datos (`allergens_tags`, `traces_tags`, `allergens_from_ingredients`, `traces`, `allergenWarning` de USDA) **y** de declaraciones explícitas del fabricante en ingredientes:

- **"Contiene:" / "Contains:"** — se parsea del `ingredients_text` y los ítems se agregan como alérgenos declarados.
- **"Puede contener:" / "May contain:"** — se parsea del `ingredients_text` y los ítems se agregan como trazas.

Se renderiza un grid de 8 iconos comunes (lácteos, cacahuate, nueces, trigo, huevo, pescado, mariscos, soja) con estado `detected`/`traces`/`safe`. Alérgenos no comunes se muestran como etiquetas de texto.

Los ítems relacionados con gluten se **filtran** de la lista de alérgenos y trazas mediante `isGlutenRelated()` para evitar duplicidad (el gluten se maneja en la tabla de dieta).

#### No recomendado para

Se evalúa en base a ingredientes y perfil nutricional:

| Grupo | Detonante | Certeza |
|-------|-----------|---------|
| Niños | Edulcorantes, cafeína | Alta (ingredientes/BD) |
| Fenilcetonúricos | Aspartame | Alta |
| Diabéticos | Azúcar > umbral alto | Alta |
| Hipertensos | Sodio ≥300mg/100g | Alta |
| Intolerantes a lactosa | Leche/lácteos en alérgenos | Alta |
| Grupos adicionales | Detectados por IA | Baja/Media (fondo amarillo) |

Los items con certeza alta tienen fondo rojo; los inferidos por IA tienen fondo amarillo.

---

## 2. Análisis Inteligente con IA

### 2.1 ¿Qué es?

Análisis complementario que usa Groq (LLaMA 3.3 70B) para examinar ingredientes y llenar vacíos de información.

### 2.2 Funcionalidades

El análisis IA realiza cuatro tareas:

1. **Dietary merge**: cuando la BD no tiene información sobre atributos dietarios (vegano, kosher, etc.), la IA los infiere de los ingredientes y se actualiza la tabla de dieta con fuente "IA" y etiqueta "Probable".

2. **Alérgenos adicionales**: detecta alérgenos en ingredientes que la BD no declara. Se muestran con badge 🤖.

3. **Análisis de diabetes**: evalúa riesgo diabético e impacto glucémico basado en azúcares, carbohidratos, fibra e ingredientes.

4. **Not recommended por IA**: detecta grupos de población adicionales (ej: embarazadas por cafeína). Se agregan con icono 🤖 y fondo amarillo.

### 2.3 Llamada a la API

POST a `/api/ai-query` con nombre, marca, ingredientes, alérgenos, azúcares, carbohidratos, fibra y datos dietarios. La IA responde con gluten, alérgenos, diabetes, dietary y notRecommended en JSON.

---

## Pipeline de búsqueda

```
                    ┌──────────────┐
                    │   Frontend   │
                    │  (index.html │
                    │   app.v3.js  │
                    │   styles.css)│
                    └──────┬───────┘
                           │ fetch()
                    ┌──────▼───────┐
                    │  API Layer   │
                    │  (Express)   │
                    └──────┬───────┘
                           │
            ┌───────────────┼──────────────┬──────────────┐
            ▼               ▼              ▼              ▼
     ┌──────────┐    ┌────────────┐   ┌──────────┐  ┌──────────┐
     │  Caché   │    │    Open    │   │ UPCItemDb│  │  Groq +  │
     │  /tmp/   │    │ Food Facts │   │ GTINHub  │  │  USDA    │
     │ JSON     │    │ (World/MX) │   │ (fallback)│  │ (último  │
     └──────────┘    └─────┬──────┘   └──────────┘  │ recurso) │
                           │                         └──────────┘
                     ┌─────▼──────┐
                     │  USDA FDC  │
                     │ (enrichment│
                     │  by name)  │
                     └─────┬──────┘
                           │
                    ┌──────▼───────┐
                    │  Groq AI     │
                    │ Análisis     │
                    └──────────────┘
```

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | HTML5, CSS3 (Glassmorphism), JavaScript vanilla |
| Escáner | [html5-qrcode](https://github.com/mebjas/html5-qrcode) |
| Backend | Node.js + Express (serverless en Vercel) |
| APIs externas | Open Food Facts (mundial + MX), UPCItemDb, GTINHub, USDA FoodData Central, Groq (LLaMA 3.3 70B) |
| Caché | JSON en `/tmp/` |
| Despliegue | [Vercel](https://vercel.com) |

---

## Ejecutar localmente

```bash
npm install
npm start
# Abre http://localhost:3000
```

## Despliegue

```bash
npx vercel --prod
```

### Variables de entorno en Vercel

- `GROQ_API_KEY` — clave de la API de Groq (gratuita en console.groq.com)
- `USDA_API_KEY` — clave de la API de USDA FoodData Central (gratuita en fdc.nal.usda.gov)

---

## Licencia

Datos nutricionales: [Open Food Facts](https://world.openfoodfacts.org/) (ODbL) · [UPCItemDb](https://www.upcitemdb.com/) · [GTINHub](https://www.gtinhub.com/) · [USDA FoodData Central](https://fdc.nal.usda.gov/) · [Groq](https://groq.com/)
