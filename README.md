# Yomi — Identificador Nutricional de Alimentos

**Yomi** es una aplicación web que permite escanear o ingresar el código de barras de cualquier producto alimenticio y obtener al instante un análisis completo: información nutricional, alérgenos, restricciones dietéticas, riesgos para la salud, y sellos de advertencia según la NOM-051 mexicana. Cuando los datos no existen en ninguna base de datos, la IA los infiere a partir del nombre y los ingredientes.

🌐 **Producción:** [www.yomi.mx](https://www.yomi.mx)

---

## Índice

1. [Stack técnico](#stack-técnico)
2. [Arquitectura general](#arquitectura-general)
3. [Estructura del proyecto](#estructura-del-proyecto)
4. [Flujo de búsqueda de producto](#flujo-de-búsqueda-de-producto)
5. [Sistema de caché multinivel](#sistema-de-caché-multinivel)
6. [Análisis con Inteligencia Artificial](#análisis-con-inteligencia-artificial)
7. [OCR — Captura de etiquetas por imagen](#ocr--captura-de-etiquetas-por-imagen)
8. [Detección de restricciones dietéticas](#detección-de-restricciones-dietéticas)
9. [Sellos NOM-051](#sellos-nom-051)
10. [Riesgos para la salud](#riesgos-para-la-salud)
11. [Veredicto SANO / REGULAR / EVITAR](#veredicto-sano--regular--evitar)
12. [Frontend](#frontend)
13. [PWA — instalable y funcionamiento offline](#pwa--instalable-y-funcionamiento-offline)
14. [Reporte de problemas](#reporte-de-problemas)
15. [Nudges de engagement (honestos, no gamificación)](#nudges-de-engagement-honestos-no-gamificación)
16. [Panel de administración](#panel-de-administración)
17. [Seguridad, accesibilidad y aspectos legales](#seguridad-accesibilidad-y-aspectos-legales)
18. [Base de datos Firebase](#base-de-datos-firebase)
19. [API — Endpoints](#api--endpoints)
20. [Variables de entorno](#variables-de-entorno)
21. [Instalación y desarrollo local](#instalación-y-desarrollo-local)
22. [Pruebas (tests)](#pruebas-tests)
23. [Despliegue en Vercel](#despliegue-en-vercel)

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| **Backend** | Node.js + Express.js (Vercel Serverless / Fluid Compute) |
| **Frontend** | HTML + CSS + Vanilla JS (sin frameworks, sin build step) |
| **PWA** | Service Worker (`sw.js`) + `manifest.json` — instalable, funciona offline |
| **Base de datos** | Firebase Firestore (REST API + JWT RS256, sin SDK oficial ni gRPC) |
| **IA — texto** | Groq (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, y modelos adicionales como fallback desde el frontend) + OpenRouter (`openrouter/free`) + Gemini 2.5 Flash |
| **IA — visión (OCR)** | Groq Vision (`meta-llama/llama-4-scout-17b-16e-instruct`) |
| **Deploy** | Vercel (`vercel.json`: función Node para `/api/*`, estático para el resto) |
| **Escáner** | `BarcodeDetector` API nativa + ZXing-WASM ponyfill + ZBar-WASM — 4 decoders en paralelo por frame, motores **auto-hospedados** en `/vendor/` (sin CDN, funciona offline) |
| **Fuentes de productos** | Open Food Facts (MX / World / USA), USDA FoodData Central, UPCItemDb, GTINHub |
| **Admin** | Panel propio (`/admin`) con sesión por cookie HttpOnly, auth por token comparado en tiempo constante |
| **Tests** | Vitest (backend + frontend, `tests/`) |

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
                │ DELETE /api/cache/:barcode
                │ POST /api/cache/refresh/:barcode
                │ POST /api/ocr/process, /api/products/ocr
                │ DELETE /api/ocr/:barcode
                │ POST /api/nutrition/process, /api/products/nutrition
                │ DELETE /api/nutrition/:barcode
                │ POST /api/report
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
│  scan_logs          → registro de búsquedas │
│  reports            → reportes de usuario   │
└─────────────────────────────────────────────┘
```

---

## Estructura del proyecto

```
food/
├── api/
│   ├── index.js          # Express app: rutas /api/*, pipeline de búsqueda, IA, admin
│   ├── firestore.js       # Cliente REST de Firestore (JWT RS256, sin SDK/gRPC)
│   ├── geo.js              # Resolución de geolocalización por IP (ipquery.io)
│   └── stats.js            # Cómputo de estadísticas del panel de admin
├── admin/
│   ├── index.html           # UI del panel de administración
│   └── admin.js               # Lógica del panel (login, tabs, cache viewer, reportes)
├── vendor/                # Motores de escaneo auto-hospedados (offline-first)
│   ├── barcode-detector.js    # Ponyfill ZXing-WASM de BarcodeDetector
│   ├── zbar-wasm.mjs           # Wrapper JS de ZBar
│   ├── zbar.wasm                 # Binario ZBar
│   └── zxing_reader.wasm          # Binario ZXing
├── assets/
│   └── icons/               # Favicons/PWA icons (generados con sharp)
├── tests/                  # Suite Vitest (backend + frontend)
├── index.html              # Home: historial, accesos, enlaces sociales, registro del SW
├── scan.html                # Pantalla de escaneo (SW no se registra aquí, ver más abajo)
├── app.js                    # Lógica del escáner + render de resultados + IA + reportes
├── home.js                     # Lógica de la home (historial, nudge de activación)
├── styles.css / home.css         # Sistema de diseño "Etiqueta"
├── sw.js                    # Service Worker (network-first HTML/JS/CSS, cache-first assets)
├── manifest.json             # Web App Manifest (instalable)
├── privacidad.html             # Aviso de Privacidad
├── terminos.html                 # Términos de Uso
├── vercel.json               # Rutas, builds estáticos y cabeceras de seguridad HTTP
├── vitest.config.js            # Config de tests (entorno Node, setup en tests/setup.js)
└── package.json                  # Dependencias, scripts (start, test, test:watch)
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

El análisis IA se dispara automáticamente después de mostrar el resultado de la base de datos, enriqueciendo campos que los datos estructurados no cubren (dietas, grupos de riesgo, impacto diabético, etc.). Hay dos rutas distintas que usan IA, con comportamiento distinto:

**1. Análisis de producto en pantalla de resultados** (`analyzeWithAI()` en `app.js`) — el frontend prueba proveedores **secuencialmente**, uno a la vez, avanzando al siguiente solo si el anterior falla o hace timeout:

```
POST /api/ai-query?provider=X&model=Y   (un intento por proveedor, en orden)

1. Groq — openai/gpt-oss-120b     (timeout 7s)
2. Groq — llama-3.1-8b-instant    (timeout 7s)
3. Groq — llama3-8b-8192          (timeout 7s)
4. Groq — gemma2-9b-it            (timeout 7s)
5. Groq — qwen-2.5-32b            (timeout 7s)
6. OpenRouter — openrouter/free   (timeout 12s)
7. Gemini — gemini-2.5-flash      (timeout 14s)

→ Se usa la primera respuesta válida; si los 7 fallan, se muestra
  "Análisis IA no disponible" y los datos de base de datos ya visibles no se tocan.
```

**2. Identificación de producto por IA** (paso 9 del pipeline de búsqueda, cuando ninguna fuente encontró el barcode) — el backend usa `callAI()`, que sí corre proveedores **en paralelo** vía `Promise.allSettled` y devuelve el primero que responda:

```
callAI(prompt)
    │
    ├── Groq — openai/gpt-oss-120b   (cola FIFO, 2.5s mín. entre llamadas)
    ├── Groq — openai/gpt-oss-20b    (misma cola)
    └── OpenRouter — openrouter/free (en paralelo a Groq)
```

### Queue de Groq

Para no superar los rate limits de Groq, las llamadas de `callAI()` pasan por una cola FIFO con espera mínima de 2.5 segundos entre invocaciones (`queueGroqCall`). Las llamadas del chain secuencial de `/api/ai-query` no comparten esta cola — cada request es un intento aislado con su propio timeout.

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

Cuando un producto no tiene ingredientes o nutrición en ninguna base de datos, la UI ofrece dos modales de captura. Hay dos formas de llegar a ellos, con comportamiento distinto:

- **Producto encontrado pero incompleto** — el usuario abre cada modal de forma independiente (`showOcrModal(barcode)` / captura de nutrición) desde los botones "Corregir ingredientes" / captura de nutrición en la pantalla de resultados. Cada modal se guarda por separado.
- **Barcode no encontrado en ninguna fuente** — la pantalla "No Encontrado" ofrece el botón **"Dar de alta este producto"**, que abre `showOcrModal(barcode, true)` en **modo registro**: un asistente de varios pasos que encadena ambos modales de forma obligatoria (ver siguiente sección).

### Asistente de alta manual de producto (modo registro)

Cuando ninguna fuente (OFF/USDA/UPCItemDb/GTINHub/identificación por IA) encuentra el barcode, en vez de un callejón sin salida el usuario puede darlo de alta manualmente:

1. **Paso 0 — Nombre y marca** (`#ocr-step-0`, inputs `#reg-product-name` / `#reg-product-brand`): paso nuevo y obligatorio antes de fotografiar nada. Un envío vacío bloquea con un error inline (`showModalStepError`) — no hay `alert()` nativo.
2. **Paso de ingredientes** (`#ocr-modal`, pasos 1-3, sin cambios respecto al modal normal): foto → Groq Vision extrae el texto → el usuario puede editarlo → guardar.
3. **Encadenamiento automático a nutrición**: al guardar los ingredientes en modo registro, el modal de ingredientes se cierra y se abre directo el modal de nutrición (`showNutritionModal`) — también obligatorio, mismo patrón foto → extracción → edición → guardar. Fuera del modo registro, guardar ingredientes simplemente muestra la pantalla de éxito del propio modal.
4. **Cierre y re-render**: al cerrar el modal de nutrición con datos guardados, se dispara `analyzeBarcode()` (el mismo camino de re-fetch que ya usan los modales OCR normales) — el producto ahora se re-lee con el nombre/marca reales capturados en el paso 0 (en vez de los valores hardcodeados `"Producto"` / `"Desconocida"` del stub anterior) y el análisis IA/veredicto se dispara automáticamente sobre esos datos, sin un paso separado de "generar veredicto".

Backend: `fireSetOcrData(barcode, ingredients, extra)` (`api/firestore.js`) ahora acepta y persiste `name`/`brand` en `products_ocr/{barcode}`. `POST /api/products/ocr` (`api/index.js`) lee `name`/`brand` del body y los reenvía. `addOcrDataIfAvailable()` — la función que ya existía para inyectar OCR en cada respuesta de `GET /api/product/:barcode` — ahora también sobreescribe `product.name`/`product.brand` con los valores guardados cuando existen.

### 1. Modal de Ingredientes (`POST /api/ocr/process` + `POST /api/products/ocr`)

El usuario fotografía la lista de ingredientes del empaque. El servidor:

1. `/api/ocr/process` recibe la imagen en base64 y la envía a **Groq Vision** (Llama 4 Scout) con el prompt para extraer el texto de ingredientes, incluyendo declaraciones de alérgenos y trazas.
2. El texto extraído se muestra al usuario para revisión/edición.
3. `/api/products/ocr` guarda el texto confirmado en Firestore (`products_ocr/{barcode}`, campo `ingredients_ocr`).
4. El frontend actualiza la UI con los ingredientes detectados y re-ejecuta la detección de gluten/caseína.

### 2. Modal de Nutrición (`POST /api/nutrition/process` + `POST /api/products/nutrition`)

El usuario fotografía la tabla nutricional. El servidor:

1. `/api/nutrition/process` recibe la imagen en base64 y la envía a Groq Vision con el prompt para extraer valores por 100g/ml.
2. `/api/products/nutrition` guarda los datos confirmados en Firestore (`products_nutrition/{barcode}`).
3. Se inyectan automáticamente en futuras consultas del mismo barcode.

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

## Veredicto SANO / REGULAR / EVITAR

Sobre la pantalla de resultados, un banner destacado resume el análisis en un veredicto de tres estados, calculado client-side por `computeVerdict()` en `app.js` a partir de datos que ya se calcularon (sellos NOM-051 + grupos en `notRecommended`) — no dispara ninguna consulta adicional.

| Veredicto | Texto | Condición |
|---|---|---|
| `sano` | ✓ Puedes comerlo | 0 sellos NOM-051 y ningún grupo de riesgo "certero" |
| `regular` | ⚠ Con moderación | 1–2 sellos, o algún grupo de riesgo certero con ≤1 sello |
| `evitar` | ✗ Mejor evítalo | 3+ sellos, o riesgo certero combinado con 2+ sellos |

**Reglas importantes:**
- Un producto sin datos reales (viene de un fallback como UPCItemDb sin ingredientes/nutrición) **nunca** se marca `sano` — la ausencia de sellos en un registro vacío no es evidencia de que el producto sea seguro; se muestra "⚠ Sin datos suficientes para evaluar" en su lugar.
- Solo el veredicto `sano` dispara una animación de entrada celebratoria (`verdict-reveal`) — `regular` y `evitar` se muestran estáticos a propósito, para que una advertencia nunca se sienta como un momento gamificado.
- Justo debajo del banner se muestra siempre el disclaimer: *"Estimación automatizada con IA, con fines informativos — no es un diagnóstico ni sustituye el consejo de un profesional de salud."*
- El veredicto se guarda junto con el historial de escaneos (`saveToHistory`) para que las tarjetas de "recientes" en la home también muestren su color/estado.

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
- **`saveToHistory(barcode, name, brand, image, verdict)`** — guarda en `localStorage['yomi_history']` (máx. 5 entradas), incluyendo el veredicto SANO/REGULAR/EVITAR para que las tarjetas de "recientes" en la home muestren su color.

#### Escáner de código de barras

El escáner corre un `requestAnimationFrame` loop con **4 decoders en paralelo por frame**. Gana el primero que decodifique (`Promise.any`).

##### Motores de decodificación

| Motor | Plataforma | Carga |
|---|---|---|
| `BarcodeDetector` nativo | Android Chrome, Mac Safari, Edge (Chromium) | API del navegador |
| ZXing-WASM (ponyfill) | iOS Safari, Windows Chrome/Edge, Firefox | `/vendor/barcode-detector.js` + `/vendor/zxing_reader.wasm` (auto-hospedado) |
| ZBar-WASM | Todas las plataformas | `/vendor/zbar-wasm.mjs` + `/vendor/zbar.wasm` (auto-hospedado) |

En plataformas sin `BarcodeDetector` nativo el ponyfill ZXing lo expone en `window.BarcodeDetector`. ZBar corre siempre como segundo motor independiente. Ambos motores se sirven desde `/vendor/` en el propio dominio — no hay dependencia de ningún CDN externo, lo que permite que el escáner funcione completamente offline una vez instalado (ver [PWA](#pwa--instalable-y-funcionamiento-offline)).

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

## PWA — instalable y funcionamiento offline

Yomi es una Progressive Web App instalable, con `manifest.json` (`display: standalone`, ícono maskable 192/512px, `theme_color: #2DBC9E`) y un Service Worker (`sw.js`) con estrategias de caché distintas según el tipo de recurso:

| Tipo de recurso | Estrategia | Motivo |
|---|---|---|
| `/api/*` | Network-first, cae a caché si falla | Datos siempre frescos cuando hay red |
| HTML / JS / CSS del app shell | Network-first, cae a caché si falla | Un deploy nuevo se ve de inmediato; solo usa caché offline |
| Otros estáticos (íconos, motores WASM del escáner) | Cache-first | Rara vez cambian, se sirven instantáneo |

**Precacheo en la instalación (`STATIC_ASSETS`):** shell de la app (`index.html`, `scan.html`, CSS, JS), manifest, íconos, y los motores `/vendor/barcode-detector.js` + `/vendor/zbar-wasm.mjs`. Los binarios WASM pesados (`zxing_reader.wasm` ~940KB, `zbar.wasm` ~240KB) se cachean de forma oportunista la primera vez que el usuario activa la cámara, no en la instalación — para no descargar ~1.18MB de más a quien nunca escanea.

El Service Worker **solo se registra en `index.html`** (la home) — no en `scan.html`, para evitar conflictos con la carga de los módulos WASM del escáner.

---

## Reporte de problemas

Desde la pantalla de resultados, el usuario puede reportar un problema con el producto (`POST /api/report`): categoría, comentario y, opcionalmente, una foto. El servidor valida la imagen antes de guardarla — debe venir en base64 puro (regex `^[A-Za-z0-9+/]+=*$`) y no exceder ~700KB — y registra el reporte junto con user-agent, SO detectado y geolocalización por IP (`ipquery.io`).

---

## Nudges de engagement (honestos, no gamificación)

Yomi incluye dos nudges de comportamiento deliberadamente mínimos y honestos — sin rachas, sin urgencia falsa, sin puntos ni logros:

- **Hint de activación (una sola vez):** justo después del primer escaneo (`yomi_history` pasa de 0 a 1), la home muestra *"Prueba con algo que tengas a la mano ahora — toma 10 segundos."* Se marca con una flag en `localStorage` (`yomi_activation_shown`) para que aparezca exactamente una vez por dispositivo y nunca vuelva a insistir.
- **Confirmación de reporte:** al re-escanear un barcode que este dispositivo reportó antes, se muestra *"Reportaste un problema con este producto anteriormente — gracias por ayudarnos a mejorarlo"*. Deliberadamente **no** afirma que el problema se corrigió — no hay una señal confiable para verificar eso sin trabajo adicional de backend (una invalidación de caché se ve igual si la disparó un admin corrigiendo el dato o un TTL normal) — solo confirma que el reporte quedó registrado.

---

## Panel de administración

Panel propio en `/admin` (`admin/index.html` + `admin/admin.js`) para revisar caché, logs de escaneo, reportes y estadísticas de uso.

- **Autenticación:** un único token (`ADMIN_TOKEN`) enviado una vez al hacer login; el servidor lo compara con `crypto.timingSafeEqual` (comparación en tiempo constante, evita filtrar el token por diferencias de timing) y, si es válido, emite una cookie de sesión `admin_session` **HttpOnly** (no accesible desde JS del cliente), `Secure` en producción, `SameSite=Strict`, con expiración de 8 horas. Las llamadas siguientes al panel viajan con esa cookie, no con el token en texto plano.
- Si `ADMIN_TOKEN` no está configurado en el entorno, todas las rutas `/api/admin/*` responden `503 Admin no configurado` en vez de quedar abiertas.
- Vistas: caché unificada L1+L2 (`/api/admin/cache-all`), estadísticas de escaneo con caché de 5 minutos (`/api/admin/stats`), y colecciones Firestore individuales (`scan_logs`, `reports`, etc. vía `/api/admin/:collection`).
- En la lista de la pestaña "📷 OCR" (`products_ocr`), la línea de resumen (`summaryOf()` en `admin.js`) antepone `"{name} / {brand} — "` cuando el documento tiene esos campos, para distinguir a simple vista un producto dado de alta manualmente de una simple corrección de ingredientes, sin tener que abrir el modal "Ver" (JSON crudo).

---

## Seguridad, accesibilidad y aspectos legales

### Cabeceras HTTP de seguridad

Aplicadas tanto en middleware de Express (`api/index.js`, cubre todo lo que pasa por la función Node) como en `vercel.json` (cubre estáticos servidos directo por el edge de Vercel):

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy`: restringe scripts/estilos/conexiones a `'self'` más los orígenes explícitamente necesarios (Google Fonts, imágenes de Open Food Facts), permite `wasm-unsafe-eval` para los motores WASM del escáner, y bloquea `object-src` y `frame-ancestors` por completo.

### Accesibilidad (WCAG AA)

- Contraste AA verificado en chips de estado de alérgenos (`detected`/`traces`) y badges dietéticos `db-yes`.
- Modales (disclaimer, OCR de ingredientes, OCR de nutrición, reporte) tienen semántica de diálogo (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`), focus trap real y se cierran con Escape.
- `aria-label` en indicadores de estado de alérgenos y controles de la cámara; regiones vivas (`aria-live`) para mensajes de carga progresivos y errores.
- Errores de cámara y validación usan diálogos de modal accesibles en vez de `alert()` nativo.
- Tabs deshabilitados en la navegación no son focuseables (evita que el teclado se detenga en controles inertes).

### Aspectos legales

- **Aviso de Privacidad** (`privacidad.html`) y **Términos de Uso** (`terminos.html`), enlazados desde el modal de disclaimer inicial que el usuario debe aceptar antes de usar la app.
- Disclaimer de IA visible **debajo del banner de veredicto** en cada resultado: *"Estimación automatizada con IA, con fines informativos — no es un diagnóstico ni sustituye el consejo de un profesional de salud."* — lenguaje endurecido para no hacer afirmaciones de salud no verificadas (contexto COFEPRIS).
- Los sellos NOM-051 se marcan como cálculo estimado en tiempo real, no como el etiquetado oficial impreso del producto.

---

## Base de datos Firebase

Yomi usa Firestore **sin el SDK oficial** — solo REST API + JWT firmado con RS256 para evitar dependencias de gRPC. La autenticación se genera en `api/firestore.js`.

### Colecciones

| Colección | Documento | Contenido |
|---|---|---|
| `product_cache` | `{barcode}` | Respuesta completa serializada en campo `_data` |
| `ai_cache` | `hash(nombre+ingredientes)` | Respuesta JSON del análisis IA |
| `products_ocr` | `{barcode}` | `{ ingredients_ocr, name, brand, approved, createdAt }` — `name`/`brand` solo se guardan cuando el producto se dio de alta desde el [asistente de registro](#ocr--captura-de-etiquetas-por-imagen) |
| `products_nutrition` | `{barcode}` | `{ nutritionData: { calories, proteins, ... }, createdAt }` |
| `scan_logs` | auto-ID | Un registro por búsqueda de barcode: OS, fuente(s), confianza IA, geolocalización, duración |
| `reports` | auto-ID | Reportes de usuario (`POST /api/report`): categoría, comentario, imagen opcional, geolocalización |

Las últimas dos (`scan_logs`, `reports`) son las que alimenta el [panel de administración](#panel-de-administración); las cuatro colecciones son visibles/editables ahí vía `/api/admin/:collection`.

---

## API — Endpoints

Todas las rutas bajo `/api/` pasan por un rate limit de 30 req/min por IP (`express-rate-limit`).

### Públicas

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/product/:barcode` | Búsqueda principal de producto (pipeline completo, ver arriba) |
| `POST` | `/api/ai-query?provider=groq\|openrouter\|gemini&model=...` | Análisis IA de un producto con un proveedor/modelo específico |
| `DELETE` | `/api/cache/:barcode` | Invalida caché (L1 + L2) de un producto |
| `POST` | `/api/cache/refresh/:barcode` | Invalida caché y vuelve a buscar el producto en un solo request |
| `POST` | `/api/ocr/process` | Extrae ingredientes de una imagen vía Groq Vision |
| `POST` | `/api/products/ocr` | Guarda los ingredientes OCR editados/confirmados por el usuario |
| `POST` | `/api/nutrition/process` | Extrae tabla nutricional de una imagen vía Groq Vision |
| `POST` | `/api/products/nutrition` | Guarda los datos nutricionales OCR editados/confirmados |
| `DELETE` | `/api/ocr/:barcode` | Elimina datos OCR de ingredientes de un barcode |
| `DELETE` | `/api/nutrition/:barcode` | Elimina datos OCR de nutrición de un barcode |
| `POST` | `/api/report` | Envía un reporte de problema (con validación server-side de imagen) |

### Admin (requieren cookie de sesión `admin_session` o header `x-admin-token`, ver [Panel de administración](#panel-de-administración))

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/admin/login-check` | Valida el token y emite la cookie de sesión HttpOnly |
| `POST` | `/api/admin/logout` | Limpia la cookie de sesión |
| `GET` | `/api/admin/stats` | Estadísticas de escaneo (cacheadas 5 min) |
| `GET` | `/api/admin/cache-all` | Vista unificada de caché L1+L2 por barcode |
| `DELETE` | `/api/admin/cache-all/:type/:key?layer=l1\|l2\|all` | Elimina una entrada de caché específica |
| `GET` | `/api/admin/:collection` | Lista documentos de una colección (`scan_logs`, `reports`, `products_ocr`, `products_nutrition`) |
| `DELETE` | `/api/admin/:collection/:id` | Elimina un documento de una colección |

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

Crea un archivo `.env` en la raíz del proyecto (`.env.example` trae una plantilla mínima con `GROQ_API_KEY` y `USDA_API_KEY`):

```env
# Firebase (Firestore para caché persistente — opcional, ver abajo)
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"...","private_key":"-----BEGIN RSA PRIVATE KEY-----\n...","client_email":"..."}'

# Groq — único requerido: IA de texto (análisis) y visión (OCR)
GROQ_API_KEY=gsk_...

# Google Gemini — fallback de IA (opcional)
GEMINI_API_KEY=AIza...

# OpenRouter — fallback de IA (opcional)
OPENROUTER_API_KEY=sk-or-...

# USDA FoodData Central — fuente adicional de productos (opcional)
USDA_API_KEY=...

# Panel de administración — sin esta variable, /api/admin/* responde 503
ADMIN_TOKEN=elige-un-token-largo-y-aleatorio

# Puerto del servidor local (opcional, default 3000)
PORT=3000
```

Solo `GROQ_API_KEY` es estrictamente requerida para levantar el servidor con funcionalidad completa de búsqueda/análisis. Sin Firebase la caché funciona solo en memoria (L1, se pierde al reiniciar). Sin `USDA_API_KEY` se omite esa fuente de datos. Sin `ADMIN_TOKEN` el panel de administración queda deshabilitado (`503`) en vez de abierto.

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

El servidor Express sirve los archivos estáticos del frontend automáticamente. No hay build step — edita HTML/CSS/JS y recarga el browser (Ctrl+Shift+R para limpiar caché, o desregistra el Service Worker desde DevTools → Application si los cambios no se reflejan).

Requiere **Node.js** (probado con Node 18+; `package.json` no fija un `engines.node` explícito, pero las APIs usadas — `fetch` global, `AbortSignal.timeout` — requieren Node 18 o superior).

---

## Pruebas (tests)

El proyecto usa [Vitest](https://vitest.dev/) con entorno `node` (`vitest.config.js`, setup en `tests/setup.js`). La suite vive en `tests/` y cubre tanto lógica de backend (`api.test.js`, `geo.test.js`, `stats.test.js`) como funciones de frontend extraídas para test (`app.test.js`):

```bash
npm test            # ejecución única (vitest run)
npm run test:watch  # modo watch
```

En un checkout limpio esto corre **4 archivos de test, 71 tests**, todos deterministas (sin llamadas de red reales — los fetches externos se mockean).

---

## Despliegue en Vercel

```bash
npm i -g vercel
vercel --prod
```

Las variables de entorno (incluyendo `ADMIN_TOKEN` si quieres el panel de administración activo en producción) se configuran en Vercel → Settings → Environment Variables — no se leen de `.env` en producción.

`vercel.json` define:
- `builds`: `api/index.js` como función Node (`@vercel/node`); `admin/**`, `assets/**` y `vendor/**` como estático explícito (sin esto, los motores del escáner y los íconos devuelven 404 en producción).
- `routes`: cabeceras de seguridad HTTP en toda ruta, `/api/*` → la función Node, `/admin` y `/admin/` → `admin/index.html`, y el resto servido como estático.

Para desarrollo/preview en Vercel: `vercel` (sin `--prod`) genera una URL de preview con las mismas env vars del proyecto.

---

Desarrollado por **Wadil AI Studio**
