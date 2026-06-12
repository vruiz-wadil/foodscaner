<div align="center">
  <h1>
    <span style="color: #10b981;">yo</span><span style="color: #f8fafc;">mi</span>
  </h1>
  <p><strong>¿Puedo comerlo? Escanea y lo sabes en segundos.</strong></p>
  <p>
    <a href="https://foodscaner.vercel.app" target="_blank">foodscaner.vercel.app</a>
  </p>
</div>

---

## ¿Qué es Yomi?

Yomi es un identificador nutricional de alimentos que escanea códigos de barras con tu cámara o los ingresa manualmente para obtener al instante:

- ✅ **Clasificación alimento / no-alimento** — detecta si es un producto comestible (vs cosméticos, detergentes, comida de mascotas, etc.)
- 🌾 **Gluten** — detecta presencia en ingredientes con distintos niveles de certeza, desde certificación hasta sospecha por IA
- 🔥 **Calorías** por cada 100g con barra de progreso visual y nivel de energía (verde/ámbar/rojo)
- ⚠️ **Alérgenos** — leche, huevos, cacahuates, soya, nueces, pescado, mostaza, sésamo, sulfitos, crustáceos, moluscos, altramuces, apio
- 🔍 **Trazas** — detecta frases "puede contener" / "may contain" / "contiene trazas" en ingredientes, más trazas declaradas explícitamente
- 🧠 **Análisis con IA** — revisión adicional vía Groq (LLaMA 3.3 70B) que cruza ingredientes contra la base de datos y detecta discrepancias
- 🅰️ **Nutri-Score** — clasificación nutricional A–E del producto
- ⚡ **Caché inteligente** — respuestas rápidas (~0.2s) para productos ya consultados

---

## 1. Búsqueda e identificación del producto

### 1.1 Captura del código de barras

El usuario puede ingresar un código de barras de dos formas:

- **Escáner por cámara**: se usa la librería `html5-qrcode`. La cámara se activa en un contenedor `<video>` y decodifica códigos de barras EAN-13, UPC-A, etc. en tiempo real. Al detectar un código, el escáner se detiene automáticamente y se inicia la consulta.
- **Entrada manual**: el usuario escribe el código en un campo de texto. Se valida con la expresión regular `/^\d+$/` — solo se aceptan caracteres numéricos. Si el usuario ingresa caracteres no numéricos, el botón de búsqueda se desactiva hasta que se corrija. El código se recorta a 20 caracteres máximo.

Ambos métodos activan la función `fetchProduct(barcode)` en `app.v3.js`, que inicia la cadena de consulta.

### 1.2 Cadena de consulta (query pipeline)

Cada código de barras se consulta secuencialmente contra las siguientes fuentes, en orden de prioridad. En cuanto una fuente devuelve datos, se detiene la cadena y se procesa el resultado.

#### Paso 1: Caché local (`/tmp/foodscaner_cache.json`)

- Archivo JSON en disco (en Vercel es efímero — `/tmp/` se destruye entre deploys).
- Cada entrada tiene: datos del producto, `cached_at` (timestamp de consulta) y `last_modified_t` (timestamp de última modificación del producto en OFF).
- **Validez**: 1 hora desde `cached_at`. Si no ha expirado, se devuelve directamente (~0.2–0.4s).
- **Stale**: si pasó 1 hora pero `last_modified_t` no ha cambiado (se hace una consulta HEAD ligera a OFF), el caché se refresca por otra hora.
- **Fallback offline**: si no hay conexión a Internet, el caché es válido por 7 días.

#### Paso 2: Open Food Facts — Mundial (`world.openfoodfacts.org`)

- Endpoint: `https://world.openfoodfacts.org/api/v0/product/{barcode}.json`
- Se espera respuesta hasta **8 segundos** (timeout). Si excede, se pasa al siguiente paso.
- De vuelve datos completos: nombre, marca, ingredientes, tabla nutricional, alérgenos, trazas, Nutri-Score, etiquetas, categorías, imágenes.
- Si el producto se encuentra con datos completos (ingredientes + nutrimentos), se usa directamente y se salta el resto de la cadena.
- Si el producto se encuentra pero **sin datos nutricionales ni ingredientes**, se guarda el nombre/marca (para búsqueda por nombre en USDA) y se continúa.

#### Paso 3: Open Food Facts — México (`mx.openfoodfacts.org`)

- Mismo endpoint que el mundial pero con dominio `.mx`.
- Catálogo limitado (~15,770 productos). Muchos códigos `750` (prefijo mexicano) no están.
- Se aplica el mismo timeout de 8s.

#### Paso 4: Enriquecimiento USDA FoodData Central

- **Solo si OFF encontró el producto** pero sin datos nutricionales ni alérgenos completos.
- **NO se ejecuta para códigos que inician con `750`** (prefijo mexicano), ya que USDA tiene datos mayoritariamente estadounidenses y la consulta añade ~8s.
- Mecanismo: se toma el nombre del producto devuelto por OFF (o UPCItemDb/GTINHub) y se busca en USDA con `api.nal.usda.gov/fdc/v1/foods/search?query={nombre}`.
- USDA devuelve resultados por nombre, no por código de barras. Para evitar falsos positivos (producto diferente con nombre similar), la información de USDA **se usa con precaución**: solo se aplica si el producto OFF no tiene datos propios.
- El gluten enriquecido se guarda en la propiedad `_gluten_enriched` y el frontend lo usa con prioridad sobre la detección local, tanto si es positivo como negativo.

#### Paso 5: UPCItemDb

- Fallback global cuando OFF no encontró el producto. Endpoint: `api.upcitemdb.com/prod/trial/lookup`.
- Tiene cobertura distinta a OFF. Muchos productos mexicanos están aquí.
- Devuelve: nombre, marca, imagen, categoría (sin datos nutricionales ni alérgenos).
- Cuando un producto se encuentra solo aquí, se activa el **análisis completo por IA** (ver sección 2).

#### Paso 6: GTINHub

- Fallback final con cobertura diferente a UPCItemDb. Endpoint: `api.gtinhub.com/v1/product/{barcode}`.
- **No fue eliminado**: se mantiene porque hay productos que UPCItemDb no encuentra pero GTINHub sí (ej: `7501011169630`).
- Al igual que UPCItemDb, solo devuelve datos básicos (nombre, marca, categoría). Activa análisis completo por IA.

#### Paso 7: Base de datos local (`/tmp/local_mexican_products.json`)

- Productos registrados manualmente por usuarios mediante el formulario de registro.
- Contiene: código de barras, nombre, marca, gluten (booleano), calorías, alérgenos (array de strings).
- También se puede usar para simular productos sin conexión (`?offline=1`).

### 1.3 Procesamiento de la respuesta (`parseApiProduct`)

Cuando el backend devuelve un producto, el frontend lo procesa en la función `parseApiProduct(product)` (`app.v3.js:329`):

#### Clasificación alimento vs no-alimento

Se toman las categorías del producto (`categories` y `categories_tags`) y se comparan contra una lista de palabras clave no-alimenticias:

```
cosmetics, beauty, higiene, hygiene, shampoo, champú, soap, jabón,
perfume, cleaner, limpieza, detergente, detergent, pet food, mascotas,
alimento para perros, alimento para gatos, clothes, ropa, toy, juguete
```

Si alguna categoría coincide, **O** si no hay nutrimentos ni ingredientes y las categorías incluyen "non-food", el producto se rechaza y se muestra la pantalla de "No es un alimento".

#### Extracción de datos

- **Nombre**: `product_name` o `product_name_es`, fallback a "Producto Desconocido".
- **Marca**: `brands`, fallback a "Marca genérica".
- **Imagen**: `image_front_url` o `image_url`.
- **Calorías**: se prefiere `energy-kcal_100g` sobre `energy-kcal`. Si solo hay kJ, se convierte (÷ 4.184). Se clasifica en Bajo (<150), Moderado (150–400) o Alto (>400) con percentil visual.
- **Nutri-Score**: `nutriscore_grade` o `nutrition_grades`, fallback a "-".

### 1.4 Caché de respuestas

La API mantiene un caché en `api/index.js` (~línea 50) que:

- Almacena respuestas completas de OFF (evita consultas repetidas).
- Verifica frescura con `last_modified_t` (timestamp de última modificación del producto en OFF).
- TTL fresco: 1 hora. Stale con verificación: extiende 1 hora si no hubo cambios. Sin conexión: 7 días.

---

## 2. Análisis Inteligente con IA

### 2.1 ¿Qué es?

Es un análisis complementario que utiliza inteligencia artificial (Groq + LLaMA 3.3 70B, gratuito, sin tarjeta de crédito) para examinar los ingredientes del producto y cruzarlos contra la base de datos. Tiene dos modos de operación según la disponibilidad de datos.

### 2.2 ¿Cómo funciona?

#### Llamada a la API

El frontend envía una petición POST a `/api/ai-query` con el siguiente cuerpo:

```json
{
  "name": "Nombre del producto",
  "brand": "Marca",
  "ingredients": "Lista completa de ingredientes (o null si no disponible)",
  "allergens": ["Alérgeno1", "Alérgeno2"]
}
```

#### Prompt enviado a Groq

El prompt incluye reglas estrictas para evitar alucinaciones:

```
Eres un experto en análisis de alimentos. Analiza el producto "{name}"
de la marca "{brand}".

Lista de ingredientes: "{ingredients}"

Alérgenos declarados: {allergens}

Responde ÚNICAMENTE con un objeto JSON válido:

{
  "gluten": {
    "hasGluten": true/false,
    "details": "Justificación breve con ingredientes específicos detectados"
  },
  "allergens": ["Leche", "Soja"],
  "confidence": "alta/media/baja",
  "notes": "notas adicionales"
}

REGLAS ESTRICTAS:
- Basa tu análisis ÚNICAMENTE en la lista de ingredientes proporcionada.
- hasGluten debe ser true SOLO si la lista de ingredientes contiene un
  ingrediente específico que contenga gluten (ej: "harina de trigo").
- Si no hay lista de ingredientes, usa confidence "baja".
- Distingue entre "contiene gluten como ingrediente" (hasGluten: true)
  y "puede contener trazas" (hasGluten: false, menciónalo en notes).
- No incluyas gluten ni cereales con gluten en la lista de alérgenos,
  el gluten se analiza en un campo separado.
- No inventes ingredientes.
```

#### Procesamiento de la respuesta

El frontend recibe el JSON y lo procesa según el contexto:

**Si es análisis completo** (producto de fallback sin datos): se renderiza toda la respuesta en la interfaz — gluten, alérgenos, confianza y notas — mediante `renderAIResult(data)`.

**Si es verificación silenciosa** (producto con datos completos): la respuesta se pasa a `compareWithDB(data, product)` que compara campo por campo:

- **Gluten**: si `product.gluten.hasGluten` != `aiData.gluten.hasGluten`, se muestra una discrepancia. Si la DB dice "no contiene gluten" y la IA sugiere presencia, el texto varía según la confianza:
  - `confidence: "baja"`: *"Si bien la información declarada no indica contenido de gluten, la IA sugiere posible presencia de gluten sin certeza: {details}"*
  - `confidence: "media"/"alta"`: *"Si bien la información declarada no indica contenido de gluten, se sospecha la posible presencia de gluten debido a que {details}"*
- **Alérgenos**: los alérgenos que detecta la IA y **no están** en la DB ni en trazas se muestran como *"Es posible la presencia de alérgenos adicionales no incluidos en la información declarada: {lista}"*. Los alérgenos de la DB que la IA no detecta NO se reportan (no es una discrepancia).

**Filtrado de gluten en alérgenos**: antes de comparar, los alérgenos del AI se filtran con la función `isGlutenRelated()` para eliminar "gluten", "trigo", "cebada", "centeno", "avena", etc. El gluten se maneja exclusivamente en su sección dedicada.

#### Comparación semántica de alérgenos

En `compareWithDB`, la comparación de alérgenos no es exacta por string. Usa tres niveles:

1. **Mapa canónico**: resuelve sinónimos a una forma única (soya→soja, lácteos→leche, maní→cacahuate).
2. **Palabras compartidas**: extrae palabras significativas (>2 caracteres) de ambos lados, incluyendo el contenido de paréntesis. Ej: "nueces" de la IA coincide con "(Nueces)" dentro de "Frutos de cáscara (Nueces)" de las trazas.
3. **Substring**: un término se considera coincidente si una palabra significativa contiene a la otra. Ej: "huevo" (IA) coincide con "huevos" (DB) porque "huevo" es substring de "huevos".

### 2.3 ¿Cuándo aparece?

| Escenario | ¿Qué muestra? |
|-----------|---------------|
| Producto encontrado en OFF con datos completos (ingredientes + nutrientes) | Análisis **silencioso**: solo se muestra si hay discrepancia en gluten o alérgenos. Si no, la sección de IA permanece oculta. |
| Producto encontrado en OFF pero sin datos nutricionales ni alérgenos | Análisis **completo visible**: se muestran gluten, alérgenos, confianza y notas al usuario. |
| Producto encontrado solo en UPCItemDb o GTINHub | Análisis **completo visible** (envía `ingredients: null` a la IA). La IA responde con `confidence: "baja"`. |
| Producto enriquecido con USDA | Se envía a la IA con los datos disponibles de USDA (si existen). |
| Producto certificado libre de gluten (`_isGf: true`) | La discrepancia de gluten se **omite**: si la IA detectara gluten pero el producto es GF, se sobrescribe con `hasGluten: false`. |
| Producto simulado (modo offline) | Se omite el análisis IA (no tiene sentido analizar datos manuales). |
| Producto en caché con resultado IA previo | Se reutiliza el resultado IA cacheado (incluyendo discrepancias). |

### 2.4 Caché de respuestas IA

Las respuestas de la IA se almacenan en el mismo archivo de caché (`/tmp/foodscaner_cache.json`) con:

- **TTL fresco**: 1 hora.
- **Verificación de cambios**: si expiró, se consulta `last_modified_t` del producto en OFF. Si no cambió, el resultado IA se considera aún válido.
- **Caída offline**: 7 días sin conexión.

### 2.5 Ejemplo concreto: producto 7500533003378

- **OFF lo encuentra** con ingredientes completos pero sin gluten/alérgenos explícitos.
- **AI recibe** los ingredientes reales del producto y analiza.
- **AI detecta** "los ingredientes no contienen trigo, cebada, centeno ni avena" → `hasGluten: false`.
- **AI detecta** posibles alérgenos: "soya" (de Lectina de Soya en ingredientes), "cacahuate" (por el nombre del producto: Cacahuates Salados).
- **compareWithDB** compara: DB no tiene alérgenos declarados ni trazas → muestra "soya, cacahuate" como alérgenos adicionales detectados por IA.
- **Trazas DB** vacías → no hay sección de "puede contener".
- **Disclaimer**: "información declarada" sin mencionar fuentes.

### 2.6 Límites y consideraciones

- **Groq free tier**: 30 RPM, 14,400 requests/día.
- **Timeout**: la petición a Groq tiene 15s de timeout. Si falla, se muestra error al usuario.
- **El prompt se actualizó** para que la IA no devuelva gluten en la lista de alérgenos, evitando duplicidad con la sección de gluten.

---

## 3. Declaración de gluten y alérgenos

### 3.1 Gluten

La detección de gluten se basa exclusivamente en campos explícitos de las bases de datos, no por deducción de ingredientes.

#### Fuentes consultadas

| Fuente | Campo | Ejemplo |
|--------|-------|---------|
| OFF | `allergens_tags` | `["en:gluten", "en:wheat"]` |
| OFF | `labels_tags` (certificación GF) | `["en:gluten-free", "en:no-gluten"]` |
| OFF/USDA | Nombre del producto (claim "sin gluten") | `"Sin Gluten"` en el nombre |
| USDA | `allergenWarning` | `"Wheat"` → se almacena como `_gluten_enriched` |

**NO** se usa deducción por palabras clave en ingredientes (trigo, cebada, harina, etc.). Si un producto contiene gluten en ingredientes pero no lo declara como alérgeno, será detectado por el análisis de IA y mostrado como discrepancia.

#### Textos mostrados según estado

| Estado | Texto | Condición |
|--------|-------|-----------|
| **Certificado sin gluten** | `"Sin Gluten (Certificado)"` | El producto tiene un label de certificación (`sin-gluten`, `gluten-free`, `libre-de-gluten`, `no-gluten`) en sus `labels_tags`. |
| **Declarado sin gluten** | `"Sin ingredientes con gluten detectados en la información declarada"` | El producto declara "sin gluten" en su nombre, o hay datos de ingredientes disponibles sin detección de gluten. |
| **Sin información** | `"Sin información de gluten"` | No hay `ingredients_text`, ni `traces`, ni `allergens_tags` con contenido. |
| **Contiene gluten (declarado)** | `"Contiene gluten (declarado en etiqueta)"` | `allergens_tags` contiene `gluten`, `wheat` o `trigo`. |
| **Gluten enriquecido por USDA** | El texto que devuelve USDA (positivo o negativo) | USDA encontró el producto y devolvió datos de gluten.

> **Importante**: El texto **"Libre de gluten"** solo se usa cuando hay una **certificación explícita** en la base de datos. En cualquier otro caso se usa **"Sin ingredientes con gluten detectados en la información declarada"** para evitar declaraciones falsas de ausencia de gluten. La redacción "información declarada" deja claro que el análisis se basa en lo que el fabricante declara, no en un análisis de laboratorio.

#### Filtrado de gluten en otras secciones

Para evitar duplicidad, todos los ítems relacionados con gluten se filtran de:

- **Lista de alérgenos** (`allergensList`): se eliminan "Gluten", "Trigo", "Trigo (Gluten)", "Cebada", "Centeno", "Avena" mediante la función `isGlutenRelated()`.
- **Lista de trazas** (`tracesList`): mismo filtro.
- **Alérgenos devueltos por la IA**: mismo filtro antes de comparar contra la DB.
- **Prompt de la IA**: se le instruye explícitamente: *"No incluyas gluten ni cereales con gluten (trigo, cebada, centeno, avena) en la lista de alérgenos, ya que el gluten se analiza en un campo separado."*

Esto asegura que el gluten solo aparezca en su **sección dedicada** (la tarjeta "Gluten" del análisis), y nunca duplicado en alérgenos, trazas o análisis IA.

### 3.2 Alérgenos

Los alérgenos se obtienen exclusivamente de campos explícitos de las bases de datos, no por deducción del texto de ingredientes.

#### Fuentes consultadas

| Fuente | Campo | Ejemplo |
|--------|-------|---------|
| OFF | `allergens_tags` | `["en:milk", "en:eggs", "en:peanuts"]` |
| OFF | `allergens_from_ingredients` | `"Milk, Soy"` (texto crudo) |
| OFF | `traces_tags` | `["en:peanuts"]` |
| OFF | `traces` | `"en:peanuts, en:soy"` |
| USDA | `allergenWarning` | `"Milk, Soy"` → mapeado a `allergens_tags` |

**NO** se usa:
- Detección por palabras clave en ingredientes (cacahuate, leche, soya, etc.)
- Parseo de secciones "puede contener" / "may contain" en ingredientes

Cualquier alérgeno presente en ingredientes pero no declarado explícitamente en la base de datos será detectado por el análisis de IA y mostrado como discrepancia.

#### Mapeo de tags a etiquetas

| Tag OFF | Etiqueta mostrada |
|---------|-------------------|
| `en:milk` | Leche (Lácteos) |
| `en:eggs` | Huevos |
| `en:peanuts` | Cacahuates (Maní) |
| `en:nuts` | Frutos de cáscara (Nueces) |
| `en:soybeans` | Soja |
| `en:mustard` | Mostaza |
| `en:molluscs` | Moluscos |
| `en:fish` | Pescado |
| `en:celery` | Apio |
| `en:sesame-seeds` | Sésamo |
| `en:sulphur-dioxide-and-sulphites` | Sulfitos |
| `en:crustaceans` | Crustáceos |
| `en:lupins` | Altramuces |
| `en:gluten` | ~~Gluten~~ (filtrado) |
| `en:wheat` | ~~Trigo~~ (filtrado) |
| `en:barley` | ~~Cebada~~ (filtrado) |
| `en:rye` | ~~Centeno~~ (filtrado) |
| `en:oats` | ~~Avena~~ (filtrado) |

#### Trazas

Las trazas se extraen únicamente de campos explícitos:

1. **Tags de trazas** (`traces_tags`): mismo mapeo que los tags de alérgenos. Se agregan como trazas si no están ya en la lista de alérgenos.
2. **Campo `traces` crudo**: el texto se divide por comas, se limpia de prefijos de idioma (ej: `en:`, `es:`) y se agrega capitalizado.

No se parsean secciones "puede contener" del texto de ingredientes.

#### Textos mostrados según estado

| Estado | Texto | Condición |
|--------|-------|-----------|
| **Sin alérgenos detectados** | `"✓ Sin alérgenos detectados en la información declarada."` | `allergens.length === 0` y `allergensDataAvailable === true` (había datos pero no se encontraron alérgenos). |
| **Información no disponible** | `"Información no disponible (Requiere verificar el empaque)"` | `allergensDataAvailable === false` (no hay ingredientes, tags ni datos de alérgenos). |
| **Alérgenos detectados** | Etiquetas individuales con ícono ⚠️ | Se detectaron alérgenos en cualquiera de las fuentes. Cada uno se renderiza como un `span.allergen-tag`. |
| **Trazas detectadas** | Etiquetas en sección "Puede contener trazas de:" con fondo distintivo | Hay trazas detectadas. La sección `#traces-section` se muestra con `#traces-list` conteniendo las etiquetas. |
| **Sin trazas** | La sección de trazas está oculta | `traces.length === 0`. |

#### Trazas en la detección por IA

Cuando el análisis IA detecta alérgenos, las trazas NO se consideran como "información declarada" para efectos de discrepancia. Es decir:

- Si la DB tiene "Leche" como alérgeno declarado y la IA también detecta "Leche", no hay discrepancia.
- Si la DB solo tiene "Frutos de cáscara" en trazas y la IA detecta "Nueces", la IA lo marca como alérgeno adicional detectado (porque las trazas no son declaración de presencia, son advertencia de posible contaminación cruzada).

#### Productos libres de gluten

Si el producto está certificado como libre de gluten (`_isGf: true`), el análisis de IA **no genera discrepancia de gluten**, incluso si la IA detectara posibles ingredientes con gluten. El valor de la DB (sin gluten) prevalece.

### 3.3 Alérgenos en el análisis inteligente

Cuando la IA analiza un producto:

- **Recibe la lista de ingredientes real** (cuando está disponible) para basar su análisis en hechos y no alucinar.
- **La IA detecta alérgenos** de la misma lista de 14 alérgenos regulados (leche, huevos, cacahuates, soya, frutos de cáscara, pescado, crustáceos, moluscos, mostaza, sésamo, sulfitos, altramuces, apio).
- **Los alérgenos detectados por IA** se comparan contra los alérgenos y trazas de la DB. Los que no están en ninguna se muestran como "alérgenos adicionales".
- **El gluten se filtra** de la respuesta de la IA mediante `isGlutenRelated()` antes de la comparación.
- **Si el producto es GF**, la discrepancia de gluten se omite por completo.
- **Ejemplo**: para el producto `7500533003378` (Cacahuates), la IA detecta "soya" (por Lectina de Soya en ingredientes). La DB no declara soya ni como alérgeno ni como traza, por lo que se muestra como alérgeno adicional.

---

## Pipeline de búsqueda (diagrama)

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
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
     ┌──────────┐    ┌────────────┐   ┌──────────┐
     │  Caché   │    │    Open    │   │ UPCItemDb│
     │  /tmp/   │    │ Food Facts │   │ GTINHub  │
     │ JSON     │    │ (World/MX) │   │ (fallback)│
     └──────────┘    └─────┬──────┘   └──────────┘
                           │
                     ┌─────▼──────┐
                     │  USDA FDC  │
                     │ (enrich by │
                     │  name,     │
                     │  positive  │
                     │  only)     │
                     └─────┬──────┘
                           │
                    ┌──────▼───────┐
                    │  Groq AI     │
                    │ (LLaMA 3.3)  │
                    │ 70B — gratis │
                    └──────────────┘
```

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | HTML5, CSS3 (Glassmorphism), JavaScript vanilla |
| Escáner | [html5-qrcode](https://github.com/mebjas/html5-qrcode) |
| Backend | Node.js + Express (serverless en Vercel) |
| APIs externas | Open Food Facts (mundial + MX), UPCItemDb, GTINHub, USDA FoodData Central, Groq (LLaMA 3.3 70B) |
| Caché | JSON en `/tmp/` |
| Despliegue | [Vercel](https://vercel.com) |

## Ejecutar localmente

```bash
npm install
npm start
# Abre http://localhost:3000
```

## Despliegue

Configurado para Vercel con `vercel.json`:

```bash
# Requiere token de deploy
npx vercel deploy --prod --token "TU_TOKEN"
```

### Variables de entorno en Vercel

- `GROQ_API_KEY` — clave de la API de Groq (gratuita en console.groq.com)

## Licencia

Datos nutricionales: [Open Food Facts](https://world.openfoodfacts.org/) (ODbL) · [UPCItemDb](https://www.upcitemdb.com/) · [GTINHub](https://www.gtinhub.com/) · [USDA FoodData Central](https://fdc.nal.usda.gov/) · [Groq](https://groq.com/)
