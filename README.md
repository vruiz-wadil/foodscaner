<div align="center">
  <h1>
    <span style="color: #10b981;">yo</span><span style="color: #f8fafc;">mi</span>
  </h1>
  <p><strong>¿Puedo comerlo? Escanea y lo sabes en segundos.</strong></p>
  <p>
    <a href="https://foodscaner.vercel.app" target="_blank">🌐 foodscaner.vercel.app</a>
  </p>
</div>

---

## ¿Qué es Yomi?

Yomi es un identificador nutricional de alimentos que escanea códigos de barras con tu cámara o los ingresa manualmente para obtener al instante:

- ✅ Si el producto es un **alimento** o no
- 🌾 **Gluten** — detecta presencia en ingredientes (etiquetado como "Sin Gluten" automáticamente si OFF lo declara así)
- 🔥 **Calorías** por cada 100g con barra de progreso visual (verde/ámbar/rojo)
- ⚠️ **Alérgenos** — leche, cacahuates, soya, nueces, etc., con etiquetas visuales
- 🔍 **Trazas** — detecta frases "puede contener" en ingredientes
- 🅰️ **Nutri-Score** (próximamente)
- 🧠 **Análisis con IA** — revisión adicional de ingredientes vía Groq (LLaMA 3.3 70B) que detecta gluten y alérgenos adicionales no declarados en la base de datos
- ⚡ **Caché inteligente** — respuestas rápidas para productos ya consultados

## Pipeline de búsqueda

Cada código de barras se consulta en este orden hasta encontrar coincidencia:

1. **Caché local** (en `/tmp/`, validez 1h, consulta ligera `last_modified_t`)
2. **Open Food Facts** (mundial) — `world.openfoodfacts.org`
3. **Open Food Facts** (MX) — `mx.openfoodfacts.org`
4. **UPCItemDb** — fallback global (GTINHub eliminado por redundancia)
5. **Base de Datos Local** (`local_mexican_products.json`) — productos registrados manualmente

> **USDA FoodData Central** se omite automáticamente para códigos que inician con `750` (prefijo mexicano), ahorrando ~8s por consulta.

## Arquitectura

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
     │  /tmp/   │    │ Food Facts │   │ (fallback)│
     │ JSON     │    │ (World/MX) │   └──────────┘
     └──────────┘    └─────┬──────┘
                           │
                    ┌──────▼───────┐
                    │  Groq AI     │
                    │ (LLaMA 3.3)  │
                    │ 70B — gratis │
                    └──────────────┘
```

## Funcionalidades clave

### Análisis Inteligente con IA
- Usa **Groq** (gratuito, sin tarjeta de crédito, 30 RPM, 14,400 req/día)
- Cuando faltan datos de gluten/alérgenos en OFF: análisis completo de ingredientes
- Cuando OFF tiene datos completos: verificación silenciosa de discrepancias
- Las discrepancias solo muestran alérgenos adicionales detectados por IA (no los que están en DB pero IA no encontró)
- Las trazas ("puede contener") se excluyen de las discrepancias

### Registro local de productos
- Si un código no se encuentra, puedes **registrarlo manualmente** con nombre, marca, calorías, gluten y alérgenos
- Los productos registrados se guardan en `local_mexican_products.json` y aparecen en consultas futuras

### Caché
- Archivo JSON en `/tmp/foodscaner_cache.json` (efímero en Vercel)
- Primera consulta: ~2.5s; subsecuentes: ~0.2–0.4s
- Validez de 1 hora; si expiró, consulta ligera `last_modified_t` para verificar cambios
- Caída a 7 días si no hay conexión

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | HTML5, CSS3 (Glassmorphism), JavaScript vanilla |
| Escáner | [html5-qrcode](https://github.com/mebjas/html5-qrcode) |
| Backend | Node.js + Express (serverless en Vercel) |
| APIs externas | Open Food Facts, UPCItemDb, Groq (LLaMA 3.3 70B) |
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

Datos nutricionales: [Open Food Facts](https://world.openfoodfacts.org/) (ODbL) · [UPCItemDb](https://www.upcitemdb.com/) · [Groq](https://groq.com/)
