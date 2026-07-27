# Plan de Producto y Comercial — Yomi

**Versión**: 1.0 | **Última actualización**: Julio 2026 | **Equipo**: 1-2 devs + founder

---

## 1. Visión y Posicionamiento

> *Yomi te dice si puedes comerlo — no con un score genérico, sino según TUS condiciones de salud.*

**Propuesta de valor única**: Yomi es el único escáner de alimentos en México que responde preguntas específicas por segmento: ¿esto tiene gluten?, ¿esto me sube el azúcar?, ¿esto tiene sello NOM-051? No es una calificación universal estilo Yuka — es una respuesta personalizada para cada usuario. En español mexicano, con productos mexicanos reales.

### Diferenciación vs Yuka

| Dimensión | Yuka | Yomi |
|-----------|------|------|
| Score | Genérico (universal) | Por condición de salud |
| Cobertura MX | Recién llegada (jul 2026) | OFF + USDA + datos locales |
| NOM-051 | No | Sí |
| IA multi-provider | No | 3-4 providers |
| Precio | ~$109 MXN/mes | $29 MXN/mes |
| Segmentación | Generalista | 3 segmentos específicos |

**Ventana competitiva**: 6 meses antes de que Yuka agregue NOM-051 y segmentación.

---

## 2. Segmentos Objetivo

### Segmento 1 — Diabéticos (14M adultos + 22M prediabetes)
- **Necesidad**: Saber si un producto dispara el azúcar. Carbohidratos netos, azúcares añadidos.
- **Comportamiento**: Uso diario, alta lealtad, dispuestos a pagar.
- **Tono**: Serio, informativo, respaldado por datos.

### Segmento 2 — Alérgicos / Celíacos (8-10M)
- **Necesidad**: Detección confiable de gluten, trazas, alérgenos ocultos.
- **Comportamiento**: Superusuarios. Escanean todo. Recomiendan en comunidades.
- **Tono**: Empático, riguroso, sin margen de error.

### Segmento 3 — Keto / Veganos (5M+)
- **Necesidad**: Verificación rápida de carbohidratos netos, ingredientes de origen animal.
- **Comportamiento**: Uso en compras, alta rotación. Menos urgentes pero más volumen.
- **Tono**: Directo, datos duros, comparaciones.

**Priorización**: Fase 1 → Diabéticos + Alérgicos. Fase 2 → Keto/Veganos.

---

## 3. Modelo de Monetización

| Feature | Free | Yomi+ ($29 MXN/mes o $249/año) |
|---------|------|--------------------------------|
| Escaneos/día | 5 | Ilimitado |
| Proveedores IA | 1 (más rápido) | 3 (Groq + Gemini + GPT-4o-mini) |
| Análisis de salud | Básico (gluten + alérgenos) | Completo (diabetes, hipertensión) |
| Historial | Offline (localStorage) | Cloud completo |
| Perfil de salud | No | Sí (análisis personalizado) |
| Exportar | No | PDF/CSV |
| Soporte | — | Prioritario |

### Unit Economics (por suscriptor/mes)

| Concepto | Costo |
|----------|-------|
| AI API calls (~25 escaneos × 3 providers) | ~$6.75 MXN |
| Firestore + Vercel | ~$2.00 MXN |
| Stripe fees | ~$3.84 MXN |
| **Total** | **~$12.59 MXN** |
| **Margen bruto** | **$16.41 MXN (56.6%)** |

### Paywall Progresivo
- Escaneo 1-3: Experiencia completa sin restricciones
- Escaneo 4: Banner sutil
- Escaneo 5: Modal "Llegaste al límite diario"

---

## 4. Roadmap 12 Semanas

### Fase 0: Preparación (Semanas 1-2)
| Tarea | Esfuerzo | Impacto |
|-------|----------|---------|
| Analytics (Firestore counters) | 2 días | Alto |
| Web Share API | 1 día | Alto |
| SEO landing pages (5) | 3 días | Medio |
| Guía NOM-051 | 1 día | Medio |
| Rate limiting tiered | 1 día | Medio |
| Firestore models prep | 2 días | Alto |
| **Total** | **10 días** | |

### Fase 1: Auth + Yomi+ (Semanas 3-5)
| Tarea | Esfuerzo | Dependencias |
|-------|----------|-------------|
| Google OAuth (Firebase Auth) | 4 días | Firestore models |
| Stripe Checkout + Webhooks | 3 días | Auth |
| Scan limit gate | 2 días | Auth + Stripe |
| Provider gating | 1 día | Auth |
| Perfil de salud UI | 2 días | Auth |
| Historial cloud | 2 días | Auth |
| Análisis personalizado | 2 días | Perfil |
| Página de precios | 1 día | Stripe |
| **Total** | **17 días** | |

### Fase 2: Lanzamiento (Semanas 6-8)
| Tarea | Esfuerzo | Responsable |
|-------|----------|-------------|
| TikTok (21 videos) | 7 días | Fundador |
| Instagram (9 posts) | 3 días | Fundador |
| Twitter play vs Yuka | 1 día | Fundador |
| Partnerships outreach | 2 días | Fundador |
| Ads setup ($50 USD/semana) | 2 días | Fundador |
| Product Hunt | 1 día | Fundador |
| **Total** | **16 días** | |

### Fase 3: Optimizar (Semanas 9-12)
| Experimento | Esfuerzo | Semana |
|-------------|----------|--------|
| Logros y gamificación | 1 día | 9 |
| A/B testing paywall | 1 día | 9 |
| Onboarding mejorado | 2 días | 10 |
| Comparador productos | 2 días | 10 |
| Push notifications | 3 días | 11 |
| Email semanal | 2 días | 11 |
| SMS sharing | 1 día | 12 |
| **Total** | **12 días** | |

---

## 5. OKRs y Métricas

### Fase 0 — Preparación
- 100% escaneos trackeados en Firestore analytics
- Web Share API implementado en resultados
- 5 landing pages indexadas en Google

### Fase 1 — Auth + Monetización
- Auth flow funcional (Google OAuth)
- Stripe checkout funcional
- Free users capped a 5 escaneos/día + 1 provider
- <2% usuarios abandonan en el primer escaneo

### Fase 2 — Lanzamiento
- 1,000 MAU
- 30 suscriptores Yomi+
- MRR $870 MXN
- TikTok: 500 seguidores, 10K vistas/semana

### Fase 3 — Optimizar
- 3,000 MAU
- 120 suscriptores ($3,480 MRR)
- D7 retention > 40%, D30 > 25%
- Free → Yomi+ > 3%
- NPS > 40

### Métricas Clave

| Métrica | Target Fase 2 | Target Fase 3 | Target Año 1 |
|---------|---------------|---------------|--------------|
| DAU | 50 | 200 | 500 |
| MAU | 1,000 | 3,000 | 8,000 |
| Retención D7 | 30% | 40% | 45% |
| Retención D30 | 18% | 25% | 30% |
| Free→Yomi+ | 2% | 3% | 4% |
| Churn mensual | <12% | <8% | <6% |
| MRR | $870 MXN | $3,480 MXN | $7,975 MXN |

---

## 6. Recursos Necesarios

| Recurso | Costo/mes |
|---------|----------|
| Developer (senior full-stack, MX) | $45K-65K MXN |
| Stripe | 2.9% + $3 fijo |
| Firebase/Supabase | Gratis hasta 50K MAU |
| Firestore | Gratis hasta 1GB/día |
| Vercel | Gratis o $20 USD/mes |
| AI APIs | ~$10 MXN/suscriptor/mes |
| **Total infra (sin dev)** | **~$500 MXN/mes** |

---

## 7. Riesgos y Mitigaciones

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|--------|-------------|---------|------------|
| R1 | Yuka agrega NOM-051 y segmentación | Media (6 meses) | Alto | Lanzar Fase 1 en <5 semanas |
| R2 | Conversión free→pago < 2% | Media | Alto | A/B test pricing, pay-per-scan como plan B |
| R3 | Churn alto (>15%) por falta de engagement | Alta | Alto | Push, email semanal, logros |
| R4 | Costo AI APIs se dispara | Media | Medio | Cache agresivo, rate limiting |
| R5 | Google/Firebase cambia TOS | Baja | Alto | Backups semanales, schema exportable |

---

## 8. Proyección Financiera (12 Meses)

### Escenarios

| Escenario | Supuestos | MRR Mes 12 | Neto Anual |
|-----------|----------|-----------|-----------|
| Pesimista | 1.5% conv, 15% churn, 4K MAU | $2,840 MXN | -$12,000 MXN |
| **Base** | **2.5% conv, 10%→6% churn, 8K MAU** | **$7,975 MXN** | **+$8,800 MXN** |
| Optimista | 4% conv, 8%→5% churn, 12K MAU | $17,520 MXN | +$45,000 MXN |

### Señales para decidir

| Señal | Decisión |
|-------|---------|
| Mes 3: < 200 MAU o < 5 suscriptores | Evaluar producto vs distribución |
| Mes 6: MRR < $1,000 MXN | Activar Plan B (pay-per-scan) |
| Mes 6: MRR > $3,000 MXN | Doblar en ads + contratar dev |
| Mes 12: MRR < $3,000 MXN | Considerar open-source o venta |
| Mes 12: MRR > $15,000 MXN | Buscar ronda semilla ($100K-250K USD) |

---

## Decisiones Técnicas Clave

- **Firebase Auth**: Ya tienes Firestore, integración directa. Gratis hasta 50K MAU.
- **Stripe Checkout Hosted**: Cero PCI scope, implementación en 3 horas.
- **PWA, no app nativa**: El 80% del valor funciona en web. Evaluar nativa en Fase 4 si retención D30 < 25%.
- **3 providers IA (no 7)**: Rendimiento decreciente después de 3-4. Cache L1+L2 existente reduce costos ~40%.

### Lo que NO construimos

- App nativa iOS/Android (PWA cubre 90%)
- Chat con nutriólogo (requiere regulación Cofepris)
- Coach AI personalizado (para después de tracción)
- Multi-idioma (México primero)
- Integración MyFitnessPal / Apple Health (cuando MRR > $5,000 MRR)
