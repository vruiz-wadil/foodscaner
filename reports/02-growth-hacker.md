# Estrategia de Growth para Yomi

## Diagnóstico rápido

Yomi tiene un producto sólido técnicamente, pero carece de los tres pilares de growth: **cero analítica**, **cero loops virales**, **cero canales de adquisición activos**. No hay sharing, no hay analytics, no hay blog, no hay onboarding gamificado. La buena noticia: el "aha moment" existe (scan → veredicto en <10s) y el producto ya entrega valor real.

---

## 1. Canales de Adquisición Priorizados

### Tier 1 — Sin presupuesto (semanas 1-4)

| Canal | Táctica | Impacto estimado |
|-------|---------|------------------|
| **SEO** | Página por cada sello NOM-051 + guías "¿Puedo comer X si soy keto/diabético/vegano?" | Alto. Búsquedas de salud alimentaria en México tienen volumen enorme y poca competencia |
| **Instagram Reels** | Escaneos sorpresa: escanear productos "saludables" de marca mexicana y revelar resultados | Alto. Contenido nativo, alto engagement. 2-3 Reels/semana |
| **WhatsApp** | Compartir resultado vía Web Share API → WhatsApp es el canal #1 en México | Altísimo. Cada scan puede generar 1+ shares |
| **Facebook Groups** | Grupos de keto, diabetes, alergias, madres saludables | Medio-alto. Comunidades muy activas |

### Tier 2 — Presupuesto bajo (semanas 4-12)

| Canal | Táctica | Costo |
|-------|---------|-------|
| **Micro-influencers** | Nutriólogos en TikTok/IG (5k-20k seguidores) | $50-200 USD/video |
| **Google Ads** | Keywords: "escáner de alimentos", "sellos NOM-051", "gluten alimentos" | $0.10-0.50 CPC MX |
| **Partnerships** | Gimnasios (Smart Fit): poster + QR en recepción | Trueque |

### Tier 3 — Estratégico (meses 3-6)

| Canal | Táctica |
|-------|---------|
| **Nutriólogos** | Whitelabel o referral: "Tu nutrióloga recomienda Yomi" |
| **Supermercados** | Shelf-talkers en pasillo de "saludables" |
| **Seguros médicos** | GNP, AXA como herramienta de prevención |

---

## 2. Loop Viral

### El loop de escaneo → WhatsApp

```
Usuario escanea producto → ve veredicto SHOCK → 
tap "Compartir" → se genera card/imagen con:
  [Foto producto] [Veredicto SANO/REGULAR/EVITAR] 
  "Escaneado con Yomi" + deep-link scan.html?barcode=XXX →
  Receptor abre → escanea su primer producto → loop
```

**Mecánica concreta**:
- Botón "Compartir en WhatsApp" en cada resultado (navigator.share() con fallback)
- La imagen compartida incluye: foto del producto, nombre, veredicto, sellos NOM-051, CTA
- Deep link: `yomi.mx/scan.html?barcode=XXX`

**K-factor estimado**: cada 5 escaneos → 1 share → 0.3 conversiones → k=0.06

### Loop de referidos (post-Yomi+)
```
Usuario comparte código de referido → amigo escanea 3 productos → 
ambos reciben 1 semana de Yomi+ gratis
```

### Loop de escaneo colaborativo
```
Usuario escanea producto sin datos completos → 
"¿Ayúdanos? Sube foto de ingredientes" → 
sube foto → datos se guardan → próximo usuario recibe datos completos
```

---

## 3. Growth Hacks Low-Cost (Primeros 90 Días)

### Semana 1-2: Fundamentos
1. **Instalar analytics** — Plausible o GA4
2. **Botón "Compartir resultado"** en cada scan (Web Share API)
3. **Meta tags SEO** por producto escaneado (`yomi.mx/scan.html?barcode=X`)

### Semana 3-4: Contenido
4. **Página "¿Puedo comer [producto famoso]?"** — Top 50 productos México
5. **Guía "Sellos NOM-051 explicados"**
6. **Instagram Reel de "Escaneando mi despensa"** — 3/semana

### Semana 5-8: Comunidad
7. **"El Reto Yomi"**: escanea tu despensa en 24h
8. **Encuesta Instagram**: "¿Qué producto crees saludable pero no lo es?"
9. **Embeds para blogs de salud**: Badge "Verificado con Yomi"

### Semana 9-12: Crecimiento
10. **Colaboración con nutriólogos** con link de referido único
11. **Google Ads con keyword "Yuka México"**
12. **WhatsApp sticker pack** "¿Puedo comerlo?"

---

## 4. Conversión Free → Yomi+

### Lo que DEBE incluir Yomi+ para justificar el pago

**Core**:
- Escaneos ilimitados
- Historial en cloud
- Perfil de dieta personalizable

**Sticky**:
- "Mi dieta" tracker diario
- Alertas personalizadas
- Batch scan

**Premium**:
- Export PDF
- Sin publicidad
- Soporte prioritario

### Tácticas de conversión

1. **Paywall suave**: Después del escaneo #5 del día
2. **Momento de dolor**: Producto con datos incompletos → "Con Yomi+, sube fotos"
3. **Momento de logro**: 50 escaneos → "Estadísticas avanzadas con Yomi+"
4. **Anclaje de precio**: $29/mes vs $99/mes consulta nutriólogo

---

## 5. Embudo de Usuario

```
ADQUISICIÓN → ACTIVACIÓN → RETENCIÓN → MONETIZACIÓN → VIRALIDAD
```

### Etapa 1: ADQUISICIÓN
| Entrada | CTx esperada |
|---------|-------------|
| Búsqueda orgánica | 2-5% |
| Instagram Reels | 1-3% |
| WhatsApp share | 20-30% |
| Referido nutriólogo | 30-50% |
| Google Ads | 5-10% |

### Etapa 2: ACTIVACIÓN (Aha! Moment)
Definición: Usuario escanea ≥3 productos en su primera sesión.
Meta: >40% de nuevos usuarios escanean ≥3 productos en sesión inicial.

### Etapa 3: RETENCIÓN
| Timeframe | Táctica |
|-----------|---------|
| Día 1 | Push: "¿Ya cenaste? Escanéalo" |
| Día 3 | "Productos que podrías tener en tu refrigerador" |
| Día 7 | "Top 3 de tus escaneos de la semana" |
| Día 14 | "Llevas 14 días sin escanear" |
| Día 30 | "Este mes escaneaste X productos" |

**Métricas objetivo**: D1 40%, D7 20%, D30 10%, D90 5%

### Etapa 4: MONETIZACIÓN
CTR esperado: 2-5% paywall suave, 8-12% prueba gratuita.

### Etapa 5: VIRALIDAD
Métrica: % de escaneos que generan un share.

---

## 6. Métricas de Growth

### North Star
```
# Escaneos totales por día
```

### Dashboard de Growth

**Adquisición**: Usuarios nuevos/día (+20% mes a mes), tráfico orgánico (50% a los 6 meses), CAC (<$5 USD)

**Activación**: % primer scan (>80%), % ≥3 en primera sesión (>40%), tiempo a primer veredicto (<15s)

**Retención**: D1 >40%, D7 >20%, D30 >10%, DAU/MAU >15%, escaneos/semana >3

**Monetización**: CTR upsell >3%, trial start >5%, trial→paid >20%, churn <10%, LTV >$87 USD

**Viralidad**: Share rate >5%, invites per user >0.2, k >0.3 a los 6 meses

### Pipeline de Experimentos (4/semana)

| # | Hipótesis | Métrica |
|---|-----------|---------|
| 1 | Botón "Compartir WhatsApp" como primario aumenta shares | Share rate |
| 2 | Contador "Has escaneado X productos" aumenta retención | D7 retention |
| 3 | Rating después del 3er scan mejora ASO | Rating rate |
| 4 | Push "¿Qué desayunaste?" aumenta DAU | DAU |
| 5 | Comparación nutricional entre 2 productos | Escaneos/sesión |
| 6 | Disclaimer reducido a 1 línea | Tasa abandono primer scan |
| 7 | Scan rápido sin animación | Escaneos/sesión |
| 8 | Historial reciente muestra 10 vs 4 productos | Tasa re-escaneo |

---

## 7. Community Building (UGC)

**Fase 1: Siembra (meses 1-2)**
- "Analizando mi despensa" — 10 Reels
- "Mitos alimenticios" — semanal
- "¿Puedo comerlo?" — Encuestas IG Stories

**Fase 2: UGC incentivado (meses 2-4)**
- "El peor producto que he escaneado" — concurso
- "Mi despensa Yomi" — transformación
- Reportes de error gamificados

**Fase 3: Comunidad autosostenible (meses 4+)**
- Facebook Group "Comunidad Yomi"
- Hashtag #YomiChallenge
- Colaboraciones con nutriólogos

### Canales de comunidad priorizados

| Canal | Táctica inicial |
|-------|----------------|
| **Instagram** | 3 Reels/semana + Stories diarias |
| **WhatsApp** | Canal de difusión |
| **Facebook Group** | Grupo cerrado, 1 publicación/día |
| **TikTok** | Repurpose de Reels |

---

## Roadmap de Implementación

| Sprint | Qué |
|--------|-----|
| S0 (sem 1) | Analytics, botón "Compartir", meta tags SEO |
| S1 (sem 2) | Páginas NOM-051, guía keto/diabetes, 5 landing pages |
| S2 (sem 3) | Instagram Reels (3/semana) |
| S3 (sem 4) | WhatsApp sticker pack, encuesta IG, "Reto Yomi" |
| S4 (sem 5) | Partnerships 10 nutriólogos, embeds blogs |
| S5 (sem 6) | Google Ads ($500 MX/semana), tracking |
| S6 (sem 7) | Facebook Group, sorteo UGC |
| S7 (sem 8) | Primeros experimentos A/B |
| S8 (sem 9) | Preparación Yomi+: waitlist + email |
| S9 (sem 10) | Partnership gimnasio (Smart Fit) |
| S10 (sem 11) | Segundo batch experimentos |
| S11 (sem 12) | Review: duplicar ganadores, matar perdedores |

---

## TL;DR

**Lo que Yomi necesita AHORA** (sin presupuesto, sin código pesado):

1. ❌ Analytics → GA4 o Plausible (día 1)
2. ❌ Compartir WhatsApp → `navigator.share()` (día 1)
3. ❌ SEO → páginas NOM-051 + "¿Puedo comer [producto]?" (semana 1-2)
4. ❌ Contenido → 3 Reels/semana Instagram (semana 1+)
5. ❌ Retención → push notifications (semana 2-3)
6. ❌ Loop viral → deep link en cada share (semana 1)
7. ❌ Comunidad → Facebook Group + #YomiChallenge (semana 4)

**Lo que NO necesita**: Auth (no hasta Yomi+), rediseño, más features, presupuesto grande.
