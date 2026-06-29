# Yomi — Identificador Nutricional de Alimentos

**Yomi** es una aplicación web que permite escanear o ingresar el código de barras de cualquier producto alimenticio y obtener al instante un análisis completo: información nutricional, alérgenos, restricciones dietéticas, riesgos para la salud, y sellos de advertencia según la NOM-051 mexicana. Cuando los datos no existen en ninguna base de datos, la IA los infiere a partir del nombre y los ingredientes.

🌐 **Producción:** [www.yomi.mx](https://www.yomi.mx)

---

## Índice

1. [Stack técnico](#stack-técnico)
2. [Arquitectura general](#arquitectura-general)
3. [Flujo de búsqueda de producto](#flujo-de-búsqueda-de-producto)
4. [Sistema de caché multinivel](#sistema-de-caché-multinivel)
5. [Análisis con Inteligencia Artificial](#análisis-con-inteligencia-artificial)
6. [OCR — Captura de etiquetas por imagen](#ocr--captura-de-etiquetas-por-imagen)
7. [Detección de restricciones dietéticas](#detección-de-restricciones-dietéticas)
8. [Sellos NOM-051](#sellos-nom-051)
9. [Riesgos para la salud](#riesgos-para-la-salud)
10. [Frontend](#frontend)
11. [Base de datos Firebase](#base-de-datos-firebase)
12. [API — Endpoints](#api--endpoints)
13. [Variables de entorno](#variables-de-entorno)
14. [Instalación y desarrollo local](#instalación-y-desarrollo-local)
15. [Despliegue en Vercel](#despliegue-en-vercel)

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| **Backend** | Node.js + Express.js |
| **Frontend** | HTML + CSS + Vanilla JS (sin frameworks) |
| **Base de datos** | Firebase Firestore (REST API, sin SDK) |
| **IA — texto** | Groq (LLaMA 3.3 70B, LLaMA 3.1 8B, Mixtral, Gemma) + OpenRouter + Gemini 2.5 Flash |
| **IA — visión** | Groq Vision (Llama 4 Scout) |
| **Deploy** | Vercel (Fluid Compute) |
| **Escáner** | `BarcodeDetector` API nativa + ZXing-WASM ponyfill + ZBar-WASM — 4 decoders en paralelo por frame |
| **Fuentes de productos** | Open Food Facts (MX / World / USA), USDA FoodData Central, UPCItemDb, GTINHub |

---

## Arquitectura general

```
┌─────────────────────────────────────────────┐
│                  FRONTEND                   │
│  index.html + app.js + styles.css           │
│                                             │
│  • Escáner de cámara (dual-engine rAF loop)  │
│  • Ingreso manual de código de barras       │
│  • Historial de últimos 5 escaneos          │
│  • Modales OCR (ingredientes + nutrición)   │
│  • Renderizado de resultado completo        │
└───────────────┬─────────────────────────────┘
                │ GET /api/product/:barcode
                │ POST /api/ai-query
                │ POST /api/ocr-ingredients
                │ POST /api/ocr-nutrition
                ▼
┌─────────────────────────────────────────────┐
│               API (Express.js)              │
│  api/index.js                               │
│                                             │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │  L1 Cache   │  │   Fuentes externas   │  │
│  │  (memoria)  │  │  OFF · USDA · UPC    │  │
│  └──────┬──────┘  └──────────────────────┘  │
│         │                                   │
│  ┌──────▼──────┐  ┌──────────────────────┐  │
│  │  L2 Cache   │  │   IA (Groq/Gemini)   │  │
│  │ (Firestore) │  │   Groq Vision (OCR)  │  │
│  └─────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────┐
│            Firebase Firestore               │
│                                             │
│  product_cache      → respuestas completas  │
│  ai_cache           → análisis IA (24h TTL) │
│  products_ocr       → ingredientes por OCR  │
│  products_nutrition → nutrición por OCR     │
└─────────────────────────────────────────────┘
```

---

## Flujo de búsqueda de producto

Cuando el usuario escanea o ingresa un código de barras, el servidor ejecuta el siguiente pipeline en orden, devolviendo el primer resultado satisfactorio:

```
Código de barras recibido
        │
        ▼
1. Validación (8–14 dígitos numéricos)
        │
        ▼
2. Generación de variantes del código
   (sin dígito de control, con prefijo 750-MX,
    padding/trim de ceros, longitudes alternativas)
        │
        ▼
3. ¿Está en caché? (L1 memoria → L2 Firestore)
   ├── Sí, fresco (< 1h)  → responder directo
   ├── Sí, OFF < 24h      → verificar last_modified en OFF
   │   ├── Sin cambios    → responder desde caché
   │   └── Cambió         → invalidar y continuar
   ├── Sí, fallback < 7d  → responder directo
   └── No / expirado      → continuar búsqueda
        │
        ▼
4. Open Food Facts (en paralelo)
   ├── world.openfoodfacts.org
   ├── mx.openfoodfacts.org
   └── us.openfoodfacts.org
   → Se selecciona la fuente con más datos de alérgenos/ingredientes
        │
        ▼
5. USDA FoodData Central
   (solo si barcode NO empieza con 750 — México)
        │
        ▼
6. UPCItemDb (base de datos de códigos UPC)
        │
        ▼
7. GTINHub (base de datos global de GTINs)
        │
        ▼
8. Enriquecimiento USDA por nombre
   (si el producto se encontró pero sin datos nutricionales,
    se busca el nombre en USDA para completar calorías,
    grasas saturadas, sodio, alérgenos)
        │
        ▼
9. Identificación por IA (último recurso)
   (LLM infiere nombre y marca a partir del código,
    luego busca en USDA con ese nombre)
        │
        ▼
10. Datos OCR del usuario (si existen en Firestore)
    → Siempre se inyectan sobre el resultado final
        │
        ▼
11. 404 si ninguna fuente encontró el producto
```

### Enriquecimiento post-resultado

Una vez encontrado el producto en cualquier fuente, el servidor siempre:

- **Inyecta datos OCR** (`addOcrDataIfAvailable`): si el usuario capturó ingredientes o nutrición por OCR para ese barcode, se fusionan con el resultado.
- **Calcula detección determinista** de gluten y caseína sobre los ingredientes disponibles.
- **Guarda en caché** el resultado completo en L1 + L2.

---

## Sistema de caché multinivel

### L1 — Memoria (en proceso)

```js
const memoryCache = {};   // producto completo
const memoryAiCache = {}; // respuestas de IA
```

- Acceso instantáneo (0ms de latencia).
- Se pierde al reiniciar el servidor (Vercel puede tener múltiples instancias).
- TTL: 24 horas para productos, 24 horas para IA.

### L2 — Firestore (persistente)

- Colección `product_cache`: cada documento tiene el campo `_data` (JSON serializado de la respuesta completa).
- Colección `ai_cache`: análisis IA indexados por hash del nombre + ingredientes.
- Sobrevive reinicios y es compartido entre todas las instancias de Vercel.

### TTLs por fuente

| Fuente | TTL incondicional | TTL con validación |
|---|---|---|
| Open Food Facts | 1 hora | 24 horas (si OFF no cambió) |
| USDA / UPC / GTINHub | — | 7 días |
| IA | — | 24 horas |

### Refresco manual

El usuario puede forzar la reconsulta desde la UI con el botón **"Actualizar Caché"**, que llama a `DELETE /api/cache/:barcode` y luego recarga el producto.

---

## Análisis con Inteligencia Artificial

### Arquitectura multi-proveedor

El análisis IA se dispara automáticamente después de mostrar el resultado de la base de datos, enriqueciendo campos que los datos estructurados no cubren (dietas, grupos de riesgo, impacto diabético, etc.).

```
callAI(prompt)
    │
    ├── Groq (cola con delay de 2.5s entre llamadas)
    │   ├── llama-3.3-70b-versatile  (primario)
    │   ├── llama-3.1-8b-instant
    │   ├── llama-3.1-70b-versatile
    │   ├── mixtral-8x7b-32768
    │   └── gemma-7b-it
    │
    ├── OpenRouter (modelo libre, en paralelo a Groq)
    │
    └── Gemini 2.5 Flash (fallback explícito)

→ Se devuelve la primera respuesta válida (Promise.allSettled)
```

### Queue de Groq

Para no superar los rate limits de Groq, todas las llamadas pasan por una cola FIFO con espera mínima de 2.5 segundos entre invocaciones.

### Prompt de análisis

El prompt le pide al modelo un JSON estricto con:

```json
{
  "gluten": { "hasGluten": bool, "details": "..." },
  "allergens": ["Leche", "Soya"],
  "diabetes": { "risk": "bajo|medio|alto", "glycemicImpact": "...", "notes": "..." },
  "dietary": {
    "vegan": bool, "vegetarian": bool, "halal": bool,
    "organic": bool, "nonGmo": bool, "noAdditives": bool,
    "palmOilFree": bool, "fairTrade": bool, "caseinFree": bool
  },
  "dietaryDetails": { "vegan": "explicación con ingredientes concretos", ... },
  "notRecommended": [{ "grupo": "Niños", "razon": "contiene cafeína" }],
  "confidence": "alta|media|baja",
  "notes": "..."
}
```

**Reglas clave del prompt:**
- Gluten: solo si ingredientes mencionan explícitamente trigo/avena/cebada/centeno.
- `caseinFree=true` solo si no hay leche ni derivados. "Sin lactosa" / deslactosado **no** implica libre de caseína.
- `notRecommended`: solo grupos realmente afectados; array vacío si ninguno.
- Umbral de azúcar para diabetes: OMS (≤5g/100g sólidos = bajo, >22.5g = alto).

### Fusión IA → producto

La función `processAIResult()` en el frontend aplica los datos de IA **solo donde el campo es `null`** — nunca sobreescribe veredictos deterministas (`source: 'db'`) con IA.

---

## OCR — Captura de etiquetas por imagen

Cuando un producto no tiene ingredientes o nutrición en ninguna base de datos, la UI ofrece dos modales de captura:

### 1. Modal de Ingredientes (`POST /api/ocr-ingredients`)

El usuario fotografía la lista de ingredientes del empaque. El servidor:

1. Recibe la imagen en base64.
2. La envía a **Groq Vision** (Llama 4 Scout) con el prompt para extraer el texto de ingredientes, incluyendo declaraciones de alérgenos y trazas.
3. El texto extraído se guarda en Firestore (`products_ocr/{barcode}`).
4. El frontend actualiza la UI con los ingredientes detectados y re-ejecuta la detección de gluten/caseína.

### 2. Modal de Nutrición (`POST /api/ocr-nutrition`)

El usuario fotografía la tabla nutricional. El servidor:

1. Recibe la imagen en base64.
2. La envía a Groq Vision con el prompt para extraer valores por 100g/ml.
3. Los datos se guardan en Firestore (`products_nutrition/{barcode}`).
4. Se inyectan automáticamente en futuras consultas del mismo barcode.

### Inyección automática en caché

En cada respuesta (hit o miss de caché), el servidor llama a `addOcrDataIfAvailable(product)` que:

- Consulta `products_ocr` → inyecta `ingredients_text` y re-detecta gluten/caseína.
- Consulta `products_nutrition` → construye objetos `calories`, `proteins`, `carbohydrates`, `sugars`, `fat` en el formato esperado por el frontend (con `value`, `level`, `percent`).
- Marca el producto con `_from_ocr` y/o `_from_nutrition_ocr` para que la UI muestre el indicador de fuente OCR.

---

## Detección de restricciones dietéticas

### Pipeline de detección (por orden de prioridad)

```
1. Datos estructurados de OFF (labels_tags, allergens_tags)
   ej: "en:gluten-free", "en:dairy-free", "en:vegan"

2. Detección determinista por keywords en ingredientes/trazas
   (GLUTEN_KW y CASEIN_KW en api/index.js)

3. Enriquecimiento USDA (_gluten_enriched, _casein_enriched)

4. Análisis IA (solo rellena campos null, nunca sobreescribe)
```

### Dietas detectadas

| Dieta | Método | Señal positiva | Señal negativa |
|---|---|---|---|
| Libre de Gluten | Keywords + OFF labels | `en:gluten-free` | trigo, wheat, harina, avena, cebada, centeno, rye, gluten, espelta, kamut |
| Libre de Caseína | Keywords + OFF labels | `en:dairy-free`, `en:no-milk` | caseína, caseinato, suero, whey, leche, milk, queso, yogur, nata... |
| Vegano | OFF labels + IA | `en:vegan` | ingredientes de origen animal |
| Vegetariano | OFF labels + IA | `en:vegetarian` | carne, pescado, mariscos |
| Halal | OFF labels + IA | `en:halal` | cerdo, alcohol |
| Kosher | OFF labels + IA | `en:kosher` | — |
| Orgánico | OFF labels + IA | `en:organic` | — |
| Sin OGM | OFF labels + IA | `en:non-gmo` | — |
| Sin Aditivos | IA | — | colorantes, conservantes, edulcorantes artificiales |
| Sin Aceite de Palma | IA | `en:palm-oil-free` | aceite de palma |
| Comercio Justo | OFF labels + IA | `en:fair-trade` | — |

**Nota importante — caseína vs lactosa:** Un producto "sin lactosa" o "deslactosado" *sí contiene caseína* (proteína de la leche). El sistema distingue ambos correctamente: `en:no-lactose` nunca se usa como señal de "libre de caseína".

### Renderizado de veredictos

| Estado | Apariencia | Significado |
|---|---|---|
| `db-yes` | Verde sólido | Confirmado por base de datos |
| `ai-yes` | Verde claro + tramado diagonal amarillo + 🤖 | Probable que sí (inferido por IA) |
| `db-no` | Rojo sólido | Confirmado por base de datos que NO aplica |
| `ai-no` | Rojo claro + tramado diagonal amarillo + 🤖 | Probable que NO aplica (inferido por IA) |
| `unknown` | Gris desaturado | Sin información suficiente |

---

## Sellos NOM-051

La NOM-051 es la norma mexicana de etiquetado frontal. Yomi calcula en tiempo real si el producto debe llevar sellos de advertencia según los umbrales oficiales:

| Sello | Nutriente | Umbral sólidos | Umbral bebidas |
|---|---|---|---|
| EXCESO CALORÍAS | Energía | > 275 kcal/100g | > 70 kcal/100ml |
| EXCESO AZÚCARES | Azúcares | > 10g/100g | > 5g/100ml |
| EXCESO GRASAS SATURADAS | Grasas sat. | > 4g/100g | > 3g/100ml |
| EXCESO SODIO | Sodio | > 350mg/100g | > 100mg/100ml |
| EXCESO GRASAS TRANS | Grasas trans | > 0g (cero tolerancia) | > 0g |

Los sellos se renderizan como octágonos negros (clip-path CSS) que replican el diseño oficial. El cálculo es client-side y se marca como estimado.

---

## Riesgos para la salud

El análisis muestra tarjetas de riesgo para cuatro condiciones calculadas con los datos nutricionales disponibles:

| Tarjeta | Cálculo |
|---|---|
| **Diabetes** | Basado en azúcares + índice glucémico (IA). Umbrales OMS: bajo ≤5g, alto >22.5g/100g |
| **Hipertensión** | Sodio mg/100g. Riesgo alto si > 600mg, medio > 200mg |
| **Colesterol** | Grasas saturadas g/100g. Riesgo alto si > 5g, medio > 1.5g |
| **Peso** | Densidad calórica kcal/100g. Alta si > 400 kcal |

---

## Frontend

El frontend es Vanilla JS sin frameworks. Los archivos principales:

### `index.html`
Estructura estática. Los estados de resultado (`#result-empty`, `#result-loading`, `#result-success`, `#result-rejected`) son divs que se muestran/ocultan mediante la clase `.active`.

### `app.js`
- **`analyzeBarcode(barcode)`** — función principal. Llama a `/api/product/:barcode`, normaliza con `parseApiProduct()`, renderiza y dispara análisis IA.
- **`parseApiProduct(product)`** — normaliza el producto de cualquier fuente al formato interno uniforme.
- **`showState(el)`** — oculta todos los estados y activa el indicado. Oculta el panel de escáner cuando hay resultado.
- **`renderDietaryBadges(product)`** — renderiza todas las filas de dietas vía `makeDietRow()` + array `dietMeta`.
- **`processAIResult(data, product)`** — fusiona la respuesta IA, respetando veredictos deterministas.
- **`saveToHistory(barcode, name, brand)`** — guarda en `localStorage['yomi_history']` (máx. 5 entradas).

#### Escáner de código de barras

El escáner corre un `requestAnimationFrame` loop con **4 decoders en paralelo por frame**. Gana el primero que decodifique (`Promise.any`).

##### Motores de decodificación

| Motor | Plataforma | Carga |
|---|---|---|
| `BarcodeDetector` nativo | Android Chrome, Mac Safari, Edge (Chromium) | API del navegador |
| ZXing-WASM (`barcode-detector@2/pure`) | iOS Safari, Windows Chrome/Edge, Firefox | ESM CDN (ponyfill) |
| ZBar-WASM (`@undecaf/zbar-wasm@0.11.0`) | Todas las plataformas | jsDelivr CDN |

En plataformas sin `BarcodeDetector` nativo el ponyfill ZXing lo expone en `window.BarcodeDetector`. ZBar corre siempre como segundo motor independiente.

##### Pipeline por frame (`tick`)

```
1. Throttle — procesa 1 de cada 2 frames (rAF a ~60 fps → ~30 evaluaciones/s)
        │
2. Canvas 1200px — escala el frame a máx. 1200px de ancho
        │
3. Motion detection — calcula hash rápido del frame
   └── Si cambio < 2% respecto al frame anterior → saltar (sin movimiento)
       (desactivado los primeros 3s para no perder el primer código)
        │
4. preprocessImage() — copia grayscale + auto-contraste para ZBar
   (normaliza el rango de luminancia → mejora lectura en etiquetas oscuras o
    productos en botellas curvas donde la iluminación es desigual)
        │
5. Canvas pequeño (≈500px) — downscale adicional para códigos de barras
   muy pequeños o muy alejados de la cámara
        │
6. Promise.any([
     decodeNative(detector, canvas),       // BarcodeDetector full-scale
     decodeNative(detector, smallCanvas),  // BarcodeDetector small-scale
     decodeZbar(processed),               // ZBar full-scale preprocessado
     decodeZbar(smallProcessed)           // ZBar small-scale preprocessado
   ])
        │
        ├── resolve(code) → onBarcodeDetected(code) → validateBarcode → analyzeBarcode
        └── reject (todos fallaron) → siguiente tick
```

##### Características adicionales

- **Resolución 1080p**: `getUserMedia` solicita `{ width: { ideal: 1920 }, height: { ideal: 1080 } }`.
- **Linterna y zoom**: se muestran solo cuando `track.getCapabilities()` reporta soporte de hardware (iPhone, Android). No aparecen en webcam.
- **ZBar fault tolerance**: flag `_zbarFailed` + cooldown de 5s ante un abort del WASM, para no bloquear el loop si el módulo falla al cargar.
- **Timeout dinámico**: tras 15s sin detectar un código válido, se sugiere ingreso manual.
- **Estados visuales**: el marco del escáner pulsa ámbar (buscando), destella verde (detectado), destella rojo (frame sin código).

**Validación de código (`validateBarcode`):**
1. Normaliza — elimina espacios y guiones, verifica solo dígitos.
2. Filtra por longitud — acepta solo 8, 12 o 13 dígitos. Cualquier otro largo es lectura parcial.
3. Checksum EAN (GS1) — descarta lecturas con dígito de control incorrecto (~90% de los truncados).
4. Expansión UPC-E — si falla el checksum EAN-8 y el primer dígito es `0`, intenta expandir de 8→12 dígitos (formato de productos importados de EE.UU.).

### `styles.css`
Sistema de diseño "Etiqueta" — identidad visual inspirada en etiquetas oficiales de alimentos:
- **Paleta:** `#FAFAF8` papel · `#0A0A0A` tinta · `#1A6B3E` verde bosque · `#C8350B` chile rojo · `#C87B0B` ámbar
- **Tipografía:** DM Serif Display (nombres de producto) · JetBrains Mono (datos numéricos) · Inter (cuerpo)
- **Cards:** flat con borde 2px solid + sombra offset 4px, sin glassmorphism

---

## Base de datos Firebase

Yomi usa Firestore **sin el SDK oficial** — solo REST API + JWT firmado con RS256 para evitar dependencias de gRPC. La autenticación se genera en `api/firestore.js`.

### Colecciones

| Colección | Documento | Contenido |
|---|---|---|
| `product_cache` | `{barcode}` | Respuesta completa serializada en campo `_data` |
| `ai_cache` | `hash(nombre+ingredientes)` | Respuesta JSON del análisis IA |
| `products_ocr` | `{barcode}` | `{ ingredients_ocr, approved, createdAt }` |
| `products_nutrition` | `{barcode}` | `{ nutritionData: { calories, proteins, ... }, createdAt }` |

---

## API — Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/product/:barcode` | Búsqueda principal de producto |
| `POST` | `/api/ai-query` | Análisis IA de un producto |
| `POST` | `/api/ocr-ingredients` | Extrae ingredientes de una imagen |
| `POST` | `/api/ocr-nutrition` | Extrae tabla nutricional de una imagen |
| `GET` | `/api/ocr/:barcode` | Datos OCR guardados para un barcode |
| `DELETE` | `/api/ocr/:barcode` | Elimina datos OCR de un barcode |
| `DELETE` | `/api/cache/:barcode` | Invalida caché (L1 + L2) de un producto |
| `GET` | `/api/health` | Estado del servidor |

### Respuesta de `/api/product/:barcode`

```json
{
  "status": 1,
  "source": "Open Food Facts (MX)",
  "product": {
    "name": "Galletas María",
    "brand": "Gamesa",
    "image": "https://...",
    "isFood": true,
    "calories": { "value": 430, "level": "Alto", "percent": 72 },
    "gluten": { "hasGluten": true, "details": "Contiene trigo" },
    "allergens": ["Gluten", "Leche"],
    "dietary": { "caseinFree": false, "caseinFreeSource": "db" },
    "nutriscore": "d",
    "ingredients_text": "Harina de trigo...",
    "_fromCache": false
  },
  "sourceResults": [
    { "source": "Open Food Facts (MX)", "found": true, "productName": "Galletas María", "brandName": "Gamesa" }
  ]
}
```

---

## Variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
# Firebase (Firestore para caché persistente)
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"...","private_key":"-----BEGIN RSA PRIVATE KEY-----\n...","client_email":"..."}'

# Groq (IA principal — texto y visión)
GROQ_API_KEY=gsk_...

# Google Gemini (fallback de IA)
GEMINI_API_KEY=AIza...

# OpenRouter (fallback de IA)
OPENROUTER_API_KEY=sk-or-...

# USDA FoodData Central
USDA_API_KEY=...
```

Solo `GROQ_API_KEY` es estrictamente requerida. Sin Firebase la caché funciona solo en memoria. Sin USDA se omite esa fuente.

---

## Instalación y desarrollo local

```bash
# Clonar el repositorio
git clone https://github.com/vruiz-wadil/foodscaner.git
cd foodscaner

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env   # editar con tus keys

# Iniciar servidor de desarrollo
npm start
# → http://localhost:3000
```

El servidor Express sirve los archivos estáticos del frontend automáticamente. No hay build step — edita HTML/CSS/JS y recarga el browser (Ctrl+Shift+R para limpiar caché).

```bash
# Tests
npm test            # ejecución única
npm run test:watch  # modo watch
```

---

## Despliegue en Vercel

```bash
npm i -g vercel
vercel --prod
```

Las variables de entorno se configuran en Vercel → Settings → Environment Variables.

La configuración en `vercel.json` enruta `/api/*` a la función Node.js y sirve el resto como estático.

---

Desarrollado por **Wadil AI Studio**
