# Estrategia de Precios y Monetización — Yomi

## 1. Evaluación de $29 USD/mes vs Competencia (original)

| Producto | Modelo | Precio | Notas |
|----------|--------|-------|-------|
| **Yomi+ (original)** | Mensual | $29 USD/mes (~$522 MXN) | 7 IA, análisis detallados, historial |
| **Yuka Premium** | Anual | $10-20/año (~$4-8/mes MXN) | Historial, offline, búsqueda |
| **Fooducate Pro** | Mensual/Vitalicio | $2.99/mes (~$54 MXN) | Escaneo, grading, diet tracking |
| **Open Food Facts** | Gratuito | $0 | Donaciones voluntarias |

$29 USD/mes es **17-35x más caro que Yuka**, más caro que Netflix, Spotify o Disney+ en México.

---

## 2. Modelo de Pricing Recomendado (con $29 MXN/mes)

| Componente | Precio | Estrategia |
|-----------|--------|-----------|
| **Gratuito** | $0 | Escaneo básico, 1 AI provider, 5 escaneos/día |
| **Yomi+ mensual** | $29 MXN/mes (~$1.60 USD) | Suscripción accesible |
| **Yomi+ anual** | $249 MXN/año (~$20.75/mes) | 28% descuento vs mensual |

**Por qué $29 MXN/mes funciona:**
- Un café en MX cuesta ~$35-50 MXN
- Un pasaje de metro: ~$5 MXN
- Consulta nutriólogo: ~$300-800 MXN
- Yomi+ es más barato que un café. Decisión de compra de baja fricción.

**Margen a $29 MXN/mes (con 3 providers IA, no 7):**

| Concepto | Costo |
|----------|-------|
| AI API calls (~25 escaneos/mes × 3 providers) | ~$6.75 MXN |
| Firestore ops | ~$1.50 MXN |
| Vercel edge functions | ~$0.50 MXN |
| Stripe fees (2.9% + $3 fijo) | ~$3.84 MXN |
| **Total** | **~$12.59 MXN** |
| **Margen bruto** | **$16.41 MXN (56.6%)** |

### Comparativa pricing original vs ajustado

| | Original ($29 USD/mes) | Ajustado ($29 MXN/mes) | Recomendado ($59 MXN/mes) |
|---|---|---|---|
| Precio mensual | $522 MXN | $29 MXN | $59 MXN |
| vs Yuka Premium | 62-124x más caro | 3.5-7x más caro | 7-15x más caro |
| vs Netflix MX | 1.7-3.7x más caro | 0.1x (10x más barato) | 0.2-0.4x |
| Conversión estimada | <0.5% | 12% | 7% |
| Churn estimado | >15% | 10% | <8% |

---

## 3. Análisis de Valor Percibido

| Feature | Plan | Valor percibido |
|---------|------|----------------|
| Escaneo de código de barras | Gratis | Alto (core utility) |
| Datos nutricionales básicos | Gratis | Alto (esperado) |
| Gluten: clasificación "declarado" | Gratis | Muy alto (para celíacos) |
| Alérgenos: "contiene/libre" | Gratis | Muy alto (para alérgicos) |
| Veredicto IA básico (1 provider) | Gratis | Alto |
| **Análisis IA 3-4 proveedores** | **Yomi+** | **Diferenciador clave** |
| **Historial ilimitado en cloud** | **Yomi+** | Medio (sticky) |
| **Perfil de usuario / preferencias** | **Yomi+** | Medio (personalización) |
| **Alertas personalizadas** | **Yomi+** | Medio (para nichos) |
| **Comparación de productos** | **Yomi+** | Medio-alto |

**Insight clave:** Yomi Free ya ofrece más que Yuka Free (gluten + IA básico). Yomi+ necesita justificar $29 MXN/mes con features de memoria y personalización.

---

## 4. Elasticidad Estimada

Basado en benchmarks de apps de salud en LATAM:
- **Segmento "health-critical"** (celíacos, alérgicos, diabéticos T1): Elasticidad baja (-0.3 a -0.5)
- **Segmento "health-conscious"** (keto, veganos, fitness): Elasticidad media (-0.7 a -1.0)
- **Segmento "curious"** (usuarios generales): Elasticidad alta (-1.5 a -2.5)

### Curva de demanda estimada (base: 10,000 MAU)

| Precio mensual | Conversión | Suscriptores | Ingreso mensual |
|---------------|-----------|-------------|----------------|
| $29 MXN | 12% | 1,200 | $34,800 MXN |
| $59 MXN | 7% | 700 | $41,300 MXN |
| $79 MXN | 4.5% | 450 | $35,550 MXN |
| $99 MXN | 3% | 300 | $29,700 MXN |
| $199 MXN | 1.2% | 120 | $23,880 MXN |

**Punto dulce de ingresos: $49-69 MXN/mes**, pero $29 MXN/maximiza volumen y adopción.

---

## 5. Recomendaciones de Packaging

### Prueba Gratuita
- **7 días gratis** sin requerir tarjeta (si es viable)
- Métrica de activación: "5+ escaneos en primeros 7 días → 40% más probabilidad de convertir"

### Descuento Anual
| Plan | Mensual | Anual | Ahorro |
|------|---------|-------|--------|
| Yomi+ Mensual | $29 MXN | — | — |
| Yomi+ Anual | — | $249 MXN | 28% |

### Timing del Paywall
- **No mostrar en el primer escaneo** — el usuario necesita experimentar valor primero
- **Mostrar Yomi+ card después del 3er escaneo** en un mismo día
- **Frustration gate**: al tocar "Análisis detallado" o "Historial" → paywall
- **Score gate**: después de 3 veredictos → "¿Quieres 7 IAs para mayor precisión?"

### Copy del Paywall
- "Yomi+ consulta **inteligencias artificiales** para darte el análisis más completo"
- "No confíes en una sola opinión — compara análisis de Groq, GPT-4o y Gemini"
- Para celíacos: "Precisión máxima en detección de gluten con verificación multi-IA"

---

## 6. Proyección de Unit Economics

### Supuestos (a $29 MXN/mes)

| Variable | Free | Yomi+ |
|----------|------|-------|
| Usuarios activos mensuales | 10,000 (año 1) | — |
| Tasa de conversión a pago | — | 12% |
| Suscriptores Yomi+ | — | 1,200 |
| Escaneos promedio/usuario/mes | 15 | 25 (menos por perfil personalizado) |
| Costo AI por escaneo (3 providers) | — | ~$0.27 MXN |
| Costo AI por escaneo (1 provider, free) | ~$0.05 MXN | — |
| Costos infra/escaneo | ~$0.05 MXN | ~$0.05 MXN |

### Proyección Mensual (año 1, mes típico)

| Concepto | Free (8,800) | Yomi+ (1,200) | Total |
|----------|-------------|--------------|-------|
| Ingresos | $0 | $34,800 MXN | $34,800 MXN |
| Costos IA | $6,600 MXN | $8,100 MXN | $14,700 MXN |
| Costos infra | $6,600 MXN | $1,500 MXN | $8,100 MXN |
| Stripe fees | — | $4,009 MXN | $4,009 MXN |
| **Margen** | **-$13,200 MXN** | **$21,191 MXN** | **$7,991 MXN** |

### Proyección a 12 meses

| Mes | MAU | Suscriptores | MRR | Margen neto |
|-----|-----|-------------|-----|------------|
| 1 | 500 | 15 | $435 MXN | -$2,500 MXN |
| 3 | 3,000 | 150 | $4,350 MXN | $500 MXN |
| 6 | 8,000 | 560 | $16,240 MXN | $4,800 MXN |
| 12 | 25,000 | 1,750 | $50,750 MXN | $18,000 MXN |

### Break-even
~450 suscriptores (~$13K MXN/mes) cubren costos de infra + APIs.

---

## 7. Alternativas de Monetización

| Alternativa | Ingreso potencial | Complejidad | Riesgo | Recomendación |
|------------|------------------|------------|--------|-------------|
| **Suscripción ($29 MXN/mes)** | Alto | Media | Bajo | **Plan A** |
| **Pay-per-scan** ($5 MXN/escaneo extra) | Medio | Baja | Bajo | **Plan B** |
| **Anual + Afiliados** | Medio-Alto | Alta | Medio | ⏳ Post-tracción |
| **Sponsoreo marcas** | Medio | Media | Alto | ⏳ Solo con separación clara |
| **Publicidad** | Bajo | Baja | Alto | ❌ No implementar |

---

## Resumen Ejecutivo

| Decisión | Recomendación |
|----------|--------------|
| **Precio** | $29 MXN/mes (~$1.60 USD) con 3 providers IA (no 7) |
| **Modelo** | Freemium: Free con 1 provider + Yomi+ con 3 providers |
| **Packaging** | Mensual ($29) + Anual ($249) |
| **Prueba** | 7 días gratis |
| **Paywall** | Mostrar después del 3er escaneo |
| **Diferenciación** | Vender "precisión multi-IA", no features genéricas |
| **Plan B** | Pay-per-scan si conversión <5% |
| **Riesgo principal** | Suscriptores que escanean 50+ veces/més reducen margen |

**Riesgo principal:** El mercado mexicano no está acostumbrado a pagar por apps de escaneo cuando Yuka (gratis + $15/año) cubre el 80% de necesidades. Yomi+ se justifica para el segmento que necesita máxima precisión (celíacos severos, alérgenos complejos, diabéticos). La conversión estará en ese nicho.
