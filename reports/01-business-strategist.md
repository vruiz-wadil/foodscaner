# Estrategia GTM y de Monetización — Yomi

## Resumen Ejecutivo

Yomi tiene un producto sólido (7 proveedores de IA, detección de gluten, NOM-051, análisis de riesgos de salud) pero **no tiene modelo de negocio**. Los $29/mes planteados para Yomi+ no son sostenibles en el mercado mexicano sin cambios fundamentales en la propuesta de valor. La prioridad inmediata no es cobrar — es **validar tracción, definir segmentos, y construir el embudo** antes de monetizar.

---

## 1. Análisis Competitivo

| Factor | Yomi | Yuka | Open Food Facts App | Fooducate |
|--------|------|------|-------------------|-----------|
| **Modelo** | Gratis (planea $29/mes) | Freemium + Yuka Pro $39.99/año | Donación / gratuita | Freemium $9.99/mes |
| **Idioma** | Español (MX) | Francés/Inglés/Español | Multilenguaje | Inglés |
| **Cobertura** | OFF + USDA | Bases propias + contribuciones | OFF (comunitaria) | USDA + datos propios |
| **Diferenciador** | 7 IAs + NOM-051 + riesgos salud | Score nutricional único | Open data, crowdsourcing | Tracking de dieta |
| **Autenticación** | No | Sí (cuentas) | Sí (contribuidores) | Sí |
| **Offline** | Sí (PWA + SW) | Parcial | No | No |
| **Mercado** | México | Francia / Europa / US | Global | US |
| **Ventaja Yomi** | **IA multi-proveedor, NOM-051, gluten, PWA offline, precio $0 hoy** | Marca, datos curados, comunidad | Datos, contribución | Ecosistema dieta |

**Conclusión competitiva:** Yomi no puede ganar siendo "un Yuka mexicano más barato". Yuka tiene 10+ años de datos curados, marca establecida y presupuesto de marketing. Yomi debe competir en el nicho donde Yuka es débil: **análisis profundo por IA, regulación local (NOM-051), y segmentos específicos de salud** (diabéticos, keto, alérgicos).

---

## 2. Segmentos de Usuario Prioritarios

| Prioridad | Segmento | Tamaño MX | DAP* | Ajuste Yomi | Estrategia |
|-----------|----------|-----------|------|-------------|------------|
| **1** | **Diabéticos / prediabéticos** | ~14M adultos | Alta | Excelente (riesgo diabetes, azúcares, carbohidratos netos, NOM-051 sellos) | Segmento ancla. El que más necesita la app a diario. |
| **2** | **Personas con alergias/intolerancias** (gluten, lactosa, frutos secos) | ~8-10M estimado | Alta | Excelente (detección gluten, alérgenos, trazas) | Dolor más intenso. Switch cost alto si resuelve bien. |
| **3** | **Keto / baja en carbohidratos** | ~2-3M activo | Media-Alta | Bueno (carbohidratos netos, badges dieta) | Nicho ruidoso, alto engagement en redes. |
| **4** | **Veganos / vegetarianos** | ~3-5M | Media | Bueno (badge vegano, ingredientes) | Volumen, pero menor DAP. |
| **5** | **Madres de familia** (compran para hijos) | ~15M hogares | Media | Medio (alérgenos, sellos, gluten) | Volumen grande, necesita UX simple. |
| **6** | **Hipertensos / salud cardiovascular** | ~20M adultos | Media | Bueno (riesgo hipertensión, sodio) | Subsegmento de diabéticos. |

*\*DAP = Disposición a pagar*

**Recomendación:** Enfocar los primeros 90 días en **diabéticos + alérgicos** como segmentos duales.

---

## 3. Estrategia GTM — Canales, Timing y Posicionamiento

### 3.1 Posicionamiento

**Frase de posicionamiento (tentativa):**

> *"¿Puedo comerlo? Yomi te responde al instante con inteligencia artificial — ingredientes, gluten, alérgenos y sellos NOM-051."*

**Diferenciación vs. Yuka:**
- Yuka = "qué tan saludable es este producto en una escala de 0-100"
- Yomi = "¿puedo comer esto con mi condición de salud específica?"
- Yomi gana en **respuesta personalizada a condiciones**, no en score genérico

### 3.2 Canales (priorizados)

| Canal | Por qué | Inversión |
|-------|---------|-----------|
| **1. SEO orgánico** | Búsquedas: "¿puedo comer esto si soy diabético?", "gluten en [producto]", "sellos NOM-051" | $0 (contenido) |
| **2. TikTok / Instagram** | Demos rápidas: escanea producto → IA dice si es keto/diabético. Contenido generado por usuarios. | $0 (orgánico) + $5K/mes ads |
| **3. WhatsApp / grupos de salud** | Cadenas virales: "escanea cualquier producto antes de comprarlo". Madres, diabéticos, celíacos. | $0 (viral) |
| **4. Google Ads** | Keywords: "app escáner alimentos méxico", "verificar gluten producto" | $3-5K/mes |
| **5. Facebook/Instagram Ads** | Segmentación: intereses en diabetes, keto, alergias, maternidad. | $3-5K/mes |
| **6. Colaboraciones** | Nutriólogos, diabetólogos, influencers keto/veganos MX | Trueque / $1-3K/mes |
| **7. Ferias / eventos salud** | Expo Salud, Fit Fest, tiendas orgánicas | $2-5K/mes |

### 3.3 Timing (primeros 90 días)

| Semana | Actividad |
|--------|-----------|
| **1-2** | **Lanzamiento silencioso.** Publicar en Product Hunt, Reddit r/mexico, r/keto, grupos de Facebook de diabetes/gluten. Medir: tasa de conversión escaneo, errores, feedback. |
| **3-4** | **Correcciones rápidas** basadas en feedback. Activar Yomi+ como funcionalidad real (no solo CSS). Habilitar Authentication básica (Google OAuth, la más simple). |
| **5-6** | **Campaña TikTok/Instagram.** 10 videos: "Escaneé [producto conocido] y la IA me dijo que..." + casos reales de diabéticos y celíacos. |
| **7-8** | **Google Ads + Facebook Ads.** Segmentar diabéticos + alérgicos. CPC estimado MX: $3-8 MXN. |
| **9-10** | **Colaboraciones con nutriólogos/influencers.** Código de descuento Yomi+. |
| **11-12** | **Evaluación.** ¿Qué segmentos están trayendo más tráfico? ¿Qué keywords convierten? ¿Está listo Yomi+ para activar cobros? |

---

## 4. Recomendación de Modelo de Monetización

### 4.1 Análisis de $29/mes

**Respuesta corta: $29/mes es demasiado alto para el mercado mexicano sin un diferencial claro.**

Benchmarks:
| App | Precio MX equivalente | Usuarios estimados |
|-----|----------------------|-------------------|
| Yuka Pro | ~$100 MXN/año ($8/mes) | ~2M pagando |
| Fooducate | ~$200 MXN/mes | ~500K |
| MyFitnessPal Premium | ~$250 MXN/mes | ~5M |
| **Yomi+ propuesto** | **~$590 MXN/mes** | — |

$29 USD/mes (~$590 MXN) es 3x Fooducate, 6x Yuka Pro, y 2x MyFitnessPal Premium.

### 4.2 Modelo recomendado: Freemium de tres niveles

| Nivel | Precio MX | Qué incluye |
|-------|-----------|-------------|
| **Free** | $0 | Escaneos ilimitados, datos OFF/USDA, gluten, alérgenos básicos, NOM-051 sellos, 1 AI provider |
| **Yomi+** | $69 MXN/mes (~$3.50 USD) | 7 AI providers, análisis de riesgos salud, badges de dieta, historial guardado, sin anuncios |
| **Yomi Pro** | $149 MXN/mes (~$7.50 USD) | Todo + OCR ingredientes, exportación PDF/CSV, reportes semanales, modo familia (5 perfiles) |

### 4.3 Drivers de conversión a pago

1. **Límite de AI providers**: Free usa 1 provider. Yomi+ usa los 7.
2. **Historial guardado**: Sin auth no hay historial persistente.
3. **Análisis de riesgos de salud**: Diabetes, hipertensión, colesterol — solo en Yomi+.
4. **OCRs**: Subir foto de ingredientes — solo en Yomi Pro.

---

## 5. KPIs Clave

### 5.1 Adquisición
- Usuarios nuevos por semana, fuente de tráfico, CAC, scans por usuario nuevo

### 5.2 Activación
- % usuarios que escanean >3 productos en primera sesión
- Tasa de éxito de escaneo, tiempo hasta primer resultado (<3s)

### 5.3 Retención
- D1 / D7 / D30 retención, scans semanales por usuario activo
- % de usuarios que vuelven a escanear en 7 días

### 5.4 Monetización
- Conversión Free → Yomi+, MRR, churn mensual (<10%), LTV/CAC (>3x)

---

## 6. Implementación Prioritaria (Pre-Monetización)

| Prioridad | Qué | Por qué |
|-----------|-----|---------|
| 🔴 Crítica | **Autenticación de usuarios** | Sin auth no hay historial, no hay cuenta que cobrar, no hay retención medible |
| 🔴 Crítica | **Yomi+ funcional (no solo CSS)** | Gating de features, checkout, trial |
| 🟡 Alta | **Perfil de usuario** | Configuración de condiciones de salud |
| 🟡 Alta | **Análisis tab** | Historial con analytics semanales |
| 🟢 Media | **OCR de ingredientes funcional** | Diferenciador clave vs Yuka |
| 🟢 Media | **Página de precios / checkout** | Stripe + webhooks |

---

## 7. Riesgos Principales

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Datos OFF/USDA incompletos en MX | Alta | Alto | Crowdsourcing de usuarios |
| IA da respuestas incorrectas | Media | Crítico | Disclaimer fuerte, reporte, revisión humana |
| Yuka lanza versión MX agresiva | Media | Alto | Defender con funcionalidad local |
| Baja conversión a pago | Alta | Alto | Probar anual o drops gratuitos |
| Costo APIs IA escala mal | Media | Medio | Free usa solo Groq, cache agresivo |

---

## 8. Roadmap de Monetización (12 Meses)

| Mes | Hito |
|-----|------|
| M1 | Auth (Google OAuth). Yomi+ real (gating, Stripe a $69 MXN/mes) |
| M2 | Perfil de usuario con condiciones. Tab Análisis con historial. |
| M3 | Yomi Pro ($149 MXN/mes) con OCR. Google Ads a diabéticos. |
| M4 | Medir conversión. Si <3%, probar descuento anual. |
| M5 | Colaboraciones nutriólogos. Códigos referral. |
| M6 | Evaluación financiera. Si MRR <$10K, pivotar a modelo gratuito con ads. |
| M9 | Modo familia (Yomi Pro). |
| M12 | Expansión LATAM (Argentina, Colombia). |

---

## 9. Short-term Wins

1. **SEO inmediato**: 5 artículos con keywords "¿puedo comer esto si soy diabético?", "app gluten México", "sellos NOM-051"
2. **Viral loop WhatsApp**: "Escanea cualquier producto y te dice si tiene gluten"
3. **Registro de productos mexicanos verificados**: Curación manual de top 500 productos
4. **CTA en análisis**: "¿Quieres 7 IAs? Prueba Yomi+ 7 días gratis"
