# Yomi — Propuesta de Modelo de Negocio

**Fecha:** 9 de julio de 2026
**Alcance:** México + LATAM · **Metodología:** 6 agentes especializados (estudio de mercado, producto, modelo de negocio, pricing, lanzamiento, QA/seguridad pre-beta)
**Contexto:** Beta cerrada con amigos/familia inminente → beta pública → lanzamiento con tier premium $29 MXN/mes

Informes fuente completos: `01-estudio-mercado.md` a `07-seguridad.md` (scratchpad de la sesión).

---

## 0. Veredicto de lanzamiento de beta

**LISTO para beta con amigos/familia**, tras aplicar 1 fix de seguridad de ~5 minutos (ya aplicado en esta sesión).

| Auditoría | Resultado |
|---|---|
| QA funcional (Playwright, 9 flujos, móvil 390×844) | **LISTO** — sin flujos rotos, sin pantallas en blanco |
| Seguridad pre-beta | **LISTO** tras fix — admin panel autenticado correctamente, cliente nunca toca Firestore directo, sin keys expuestas en cliente |
| Test suite | 71/71 tests pasan |

**Fix de seguridad aplicado esta sesión:** `api/index.js:1128` y `:1151` (`DELETE /api/ocr/:barcode` y `DELETE /api/nutrition/:barcode`) no tenían `requireAdmin`, a diferencia de `/api/cache/:barcode`. Cualquiera en internet podía borrar datos OCR/nutrición de cualquier producto sin login. Corregido con el mismo patrón ya usado en el resto del archivo. Verificado con la suite de tests (71/71 pasan) sin romper nada.

**Backlog no bloqueante para después de la beta cerrada** (antes de abrir a público más amplio):
- Validar contenido en `/api/products/ocr` y `/api/products/nutrition` (texto libre sin límite, alimenta detección de alérgenos — riesgo de integridad de datos, no solo spam)
- Throttle dedicado para Groq Vision (hoy solo protegido por el rate limit genérico de 60/min/IP — riesgo de costo si el link circula más allá del círculo cercano)
- `error.message` expuesto al cliente en 4 endpoints; falta validación de tamaño/formato de imagen en 2 rutas OCR
- Bug de código real: `ReferenceError: scanHintEl is not defined` en `app.js:615`, dispara 187+ veces durante escaneo activo (sin impacto visual)
- Panel de detalle dietético no se limpia al cambiar de producto sin recargar
- Sin filtro de sensatez para valores nutricionales imposibles heredados de Open Food Facts (ej. sodio 30000mg/100g)

---

## 1. Estudio de mercado — México + LATAM

### Alerta competitiva: Yuka lanzó en México el mismo día de este estudio

**Yuka anunció su lanzamiento oficial en México y Brasil el 8 de julio de 2026**, con ~500-600k productos mexicanos al arranque y 85M de usuarios globales de respaldo. Llega con prensa masiva y va a educar al mercado sobre "escanear alimentos" — una ola que Yomi puede surfear en vez de combatir de frente.

**Debilidades estructurales de Yuka en México** (ninguna cubierta por ningún competidor):
- Sin sellos NOM-051 nativos (usa score genérico 0-100 puntos)
- Sin alérgenos mexicanos (maíz, frijol, chile)
- Sin OCR con IA para altas instantáneas de productos locales no catalogados
- Sin datos oficiales de gobierno (PROFECO)
- App nativa (fricción de descarga) vs Yomi 100% web

### Competencia

| App | Precio | Presencia MX/LATAM |
|---|---|---|
| Yuka | ~€15/año ("paga lo justo") | Lanzó 8-jul-2026, ~500-600k productos MX |
| MyRealFood | 59,99€/año | Foco España |
| MyFitnessPal | US$79.99/año | Caro para MX (~$1,450 MXN/año) |
| Fitia (Perú) | Trial 3 días, precio regional | **Rival regional más serio** — +10M usuarios, español nativo, enfoque calorías no etiquetas |
| Open Food Facts | Gratis | BD mexicana pobre; es fuente de datos de Yomi |

### Tamaño de mercado

- 104.9M de usuarios de internet en México (86.1%), 97.3% se conecta por smartphone
- ~13M de usuarios de apps de fitness/salud en MX
- Mercado global de apps de nutrición: US$2.76B (2024) → US$9.58B (2033), CAGR 14-20%
- Benchmarks MXN: Spotify $139/mes, Netflix $119-329/mes → **$29 MXN es 21% de Spotify**, precio de "impulso" bien calibrado

### Tendencias que favorecen a Yomi

- NOM-051 validada por la SCJN (2024); **Fase 3 entra en vigor en 2026** — nueva ola de prensa y confusión aprovechable
- México es el mercado vegano #1 de LATAM (9% veganos, 19% vegetarianos, 30% flexitarianos)
- Mercado sin gluten MX: US$172M (2025), CAGR 10.5%
- Leyes de etiquetado similares en Chile, Perú, Uruguay, Argentina (cautela: riesgo de derogación), Colombia — ruta de expansión LATAM natural

### Segmentos con mayor disposición a pagar (orden de prioridad)

1. **Padres de niños con alergias** (hasta 22% de hogares con niños) — motivación médica + emocional, mejor conversión
2. **Celíacos** (~2.7M, prevalencia 2.17%, superior a la mundial)
3. **Alérgicos alimentarios adultos** (7.6-11.4M)
4. **Diabéticos** (14.6M) / **Hipertensos** (22.8M)
5. **Veganos/vegetarianos/flexitarianos** (1.9M-28M) — volumen para el funnel gratuito, no ancla de conversión

### Benchmarks freemium

Conversión free→paid mediana **2.2%** (salud/nutrición), trial→pago mediana **39.9%**. Meta de beta: superar 2% a 6 meses; por debajo de 1%, revisar el paywall, no el precio.

---

## 2. Producto — Free vs. Premium ($29 MXN/mes)

### Principio rector

> El core loop es sagrado: escanear → veredicto completo sigue 100% gratis. Se cobra lo que cuesta dinero por uso (OCR) y lo que es personal (perfiles, historial, alertas). Premium no responde "¿qué tiene este producto?" — responde **"¿puedo comerlo YO / mi hijo?"**

### Permanece 100% FREE

Escaneo + búsqueda ilimitados, resultado completo (nutrición, alérgenos, 12 badges dietéticos, sellos NOM-051, riesgos de salud, veredicto SANO/REGULAR/EVITAR), análisis IA, alta manual de producto, reportes, PWA offline, historial local de 5 escaneos.

### Se limita en free / se desbloquea en premium

| Feature | Free | Premium |
|---|---|---|
| Capturas OCR (Groq Vision) | 5 fotos/día por usuario | Ilimitado |
| Refresco manual de caché | 1/producto/día | Ilimitado |

### Features NUEVAS premium (por prioridad)

| # | Feature | Esfuerzo | Veredicto |
|---|---|---|---|
| 1 | **Alertas personalizadas por perfil dietético/alérgico** | 2-3 sp | **Ancla del premium** — convierte datos ya calculados en respuesta personal |
| 2 | **Historial ilimitado en la nube** | 2 sp (sobre auth) | Paywall más fácil de comunicar ("tu historial se llenó") |
| 3 | **Perfiles familiares múltiples** | 1-2 sp (fast-follow de #1) | Captura la disposición a pagar más alta (padres) |
| 4 | **Comparador de productos** | 2-3 sp | Q2 |
| 5 | **Integración PROFECO** (badge "Evaluado por PROFECO" + detalle del Estudio de Calidad) | 3-4 sp | **Diferenciador único** — dato oficial mexicano que ningún competidor usa. Badge visible free como gancho, detalle premium |
| 6 | Listas de compras seguras | 3-4 sp | Validar demanda en beta con entrevistas antes de construir |
| 7 | Exportar informe PDF | 1 sp | Relleno barato del bundle premium |
| — | Comparador de precios (datos QQP de PROFECO) | 5+ sp | Diferido — condicionado a que el mapeo marca→barcode de #5 funcione |
| — | Recomendaciones de alternativas más sanas | 6+ sp | Diferido a spike T2 — riesgo de recomendar mal en categoría de salud |
| — | Modo offline completo / publicidad | — | **Kill** — la PWA ya escanea offline; ads erosionan confianza en app de salud |

### Sobre PROFECO (candidato agregado por el usuario)

No existe API REST de PROFECO. Sí hay 2 fuentes de datos abiertos usables:
- **Estudios de Calidad** (~23/año, PDFs de la Revista del Consumidor) — requiere pipeline de extracción con IA (Groq, ya en el stack) + mapeo marca→barcode con **curación manual obligatoria** en el panel admin existente (los estudios no traen GTINs; es el riesgo real del feature — un match erróneo es daño reputacional serio en una app de salud)
- **"Quién es Quién en los Precios"** (CSV de precios por producto/marca/establecimiento) — habilita comparador de precios, diferido hasta validar que el mapeo de Estudios de Calidad funciona

Modelo: badge "Evaluado por PROFECO" visible para todos (gancho de marketing/confianza), detalle completo del estudio solo premium.

### Prerequisito bloqueante para todo el premium

**Cuentas de usuario** (Firebase Auth) — hoy la app no tiene login ni pagos; todo estado vive en localStorage. Sin identidad no hay cuota OCR real por usuario, historial nube, perfiles ni suscripción. Es lo primero que se construye post-beta.

### Roadmap (2 trimestres)

**T1 (fundación + lanzamiento premium):** estabilización beta → cuentas de usuario → perfil/alertas personalizadas → pagos + paywall → exportar informe → **lanzamiento premium con precio fundador**.

**T2 (ensanchar valor + retener):** perfiles familiares → comparador de productos → integración PROFECO v1 → listas de compras (si validado) → discovery de alternativas sanas.

---

## 3. Pricing

### Veredicto sobre $29 MXN/mes

**Correcto como ancla mensual — el producto real es el plan anual.** 71-77% por debajo de MyRealFood/MyFitnessPal en MXN; el anual queda 18% debajo del nivel típico de Yuka (~$305 MXN/año), que acaba de fijar el ancla de categoría en México.

### Tabla de precios recomendada

| Plan | Precio | Cuándo |
|---|---|---|
| Free | $0 — core loop completo, OCR 5 fotos/día | Ya |
| Premium Mensual | **$29 MXN/mes** (ancla, sin trial) | Lanzamiento premium |
| **Premium Anual ⭐** | **$249 MXN/año** (-28%, preseleccionado, trial 7 días) | Lanzamiento premium |
| Fundador (beta) | **$19/mes o $189/año**, congelado mientras la suscripción siga activa; ventana 30 días | Anunciado semana 3 de beta |
| Familiar | **$49/mes o $399/año**, hasta 5 perfiles | T2 (con multi-perfil) |
| B2B Analytics | $30k-500k MXN/año según producto | Futuro, con 100k+ escaneos/mes |

### Decisiones clave de diseño

- Trial de 7 días **solo en el plan anual**, con perfil alérgico configurado antes de iniciarlo (el mensual de $29 ya funciona como trial de bajo riesgo)
- Precio fundador **perpetuo mientras la suscripción siga activa** (no "6 meses") — evita pico de churn artificial y retiene a los power users que alimentan el flywheel de datos
- Framing de venta: "menos de $1 al día", "menos que un refresco al mes" — nunca "paga lo que quieras" como Yuka (sin marca establecida, esa táctica complica el cobro recurrente)
- Cobro mensual pierde ~14% en comisiones de pasarela vs ~5% el anual — razón estructural adicional para jerarquizar el anual
- No descuentos estacionales el primer año, no publicidad en free

### Métricas de gobierno (revisar a 30/60/90 días)

| Métrica | Verde | Alarma |
|---|---|---|
| Conversión free→paid | ≥2% MAU a 6 meses | <1% → rediseñar paywall, no bajar precio |
| Mix anual en altas nuevas | ≥60% | <40% → re-jerarquizar paywall |
| Churn mensual | <8% | >15% → problema de valor, no de precio |

---

## 4. Modelo de negocio

### Estructura de costos — la infraestructura nunca es el cuello de botella

| Concepto | 1,000 MAU | 10,000 MAU | 100,000 MAU |
|---|---:|---:|---:|
| Total infraestructura/mes (Vercel + Firestore + Groq + dominio) | ~$475 MXN | ~$633 MXN | ~$1,600 MXN |
| Costo por MAU/mes | $0.48 | $0.06 | $0.016 |

Costo variable por usuario, free o premium, tiende a cero por el stack elegido (caché comunal L1/L2, fuentes gratuitas, Groq a centavos de dólar por millón de tokens).

### Unit economics

| Métrica | Valor |
|---|---|
| Margen de contribución por suscriptor | 85-94% del precio de lista |
| ARPU blended (60% anual / 40% mensual) | $24.05 MXN/mes bruto |
| LTV blended (rango churn 5-10%) | $295-503 MXN, base $347 MXN |
| **CAC máximo tolerable (suscriptor pagador)** | **$100-130 MXN** |
| **CAC máximo por registro gratuito** (a conversión 2.2%) | **~$2.55 MXN** |

**Hallazgo crítico:** ese CAC descarta la pauta paga masiva como canal primario — el CPI típico de apps de salud en México ($5-15 MXN) es 2-6x superior al CAC máximo tolerable por usuario free. Confirma cuantitativamente la tesis del estudio de mercado: **SEO, viralidad del veredicto compartible y comunidades de nicho deben ser el motor de crecimiento**, no ads.

### Escenarios de conversión (MRR bruto)

| MAU | Pesimista 1% | Base 2.2% | Optimista 4% |
|---:|---:|---:|---:|
| 10,000 | $2,405 | $5,291 | $9,620 |
| 50,000 | $12,025 | $26,455 | $48,100 |
| 100,000 | $24,050 | $52,910 | $96,200 |

Punto de equilibrio de infraestructura: se cubre con **menos de 30 suscriptores** en cualquier escenario modelado. El equilibrio real del negocio depende de costos no incluidos aquí (equipo, marketing) y se sitúa razonablemente entre 10,000-50,000 MAU con conversión ≥2.2%.

### Ingresos futuros

✅ **Sí:** Plan Familiar (T2), B2B analytics de marca (solo con ≥50-100k escaneos/mes, $30k-500k MXN/año por cliente, solo datos agregados/anónimos)
❌ **No:** Afiliación con supermercados (desajuste de momento de uso, comisiones bajas, riesgo reputacional serio en app de salud), publicidad en free

### Riesgos principales

1. Yuka captura el posicionamiento de categoría → mitigar con contraste NOM-051/PROFECO/alérgenos MX, no competir en volumen de catálogo
2. Dependencia de Open Food Facts (ONG sin SLA) y Groq (proveedor único de vision) — el flywheel OCR propio es el seguro natural
3. Churn superior al modelado — instrumentar desde mes 1, priorizar la feature ancla (alertas de perfil) que sostiene retención
4. **Tentación de subir precio para financiar CAC pagado — decisión explícita de NO hacerlo.** La respuesta correcta a un CAC insostenible es orgánico/SEO/viral, no precio

---

## 5. Estrategia de lanzamiento y posicionamiento

### Tesis central

Yuka acaba de gastar millones educando al mercado mexicano sobre "escanear alimentos". Esa ola es el mejor regalo de adquisición gratuito que Yomi recibirá — **no se compite por la categoría, se surfea**. Ventana crítica: **8-12 semanas**, antes de que Yuka complete su catálogo mexicano.

### Posicionamiento: flanquear, no atacar de frente

Yuka gana el top-of-mind genérico esta semana con presupuesto que Yomi no tiene. Yomi gana donde Yuka es estructuralmente débil: NOM-051 nativo, alérgenos mexicanos, PROFECO, OCR-IA local, cero fricción (web).

**Excepción táctica:** sí nombrar a Yuka en SEO/contenido comparativo — Yomi (web) puede capturar el tráfico de búsqueda que genera la propia prensa de Yuka, algo que una app nativa no puede replicar.

**Tagline maestro:** *"Escanea como mexicano."*

### Acción más urgente (esta semana)

Publicar el artículo SEO "Yuka en México: qué hace bien y qué no cubre" para capturar el pico de búsquedas mientras dura la ola de prensa de Yuka. SEO tarda semanas en indexar — sembrarlo ahora es crítico.

### Plan de beta (semanas 1-4)

- Meta: 200-300 testers (mínimo viable 120), ≥50% de nichos médicos
- Reclutamiento priorizado: ACELMEX, Celíacos de México, grupos de Facebook de padres alérgicos/APLV, México Sin Alérgenos, Reddit (r/mexico, r/Celiac)
- Precio fundador anunciado en semana 3 (no antes, para no contaminar el feedback)
- Loop de feedback diario sobre el sistema de reportes a Firebase ya existente

### Lanzamiento público (semanas 5-12)

- Semana 5-6: coincide con la cola de cobertura de Yuka, cuando medios buscan el ángulo de seguimiento ("la respuesta mexicana a Yuka")
- PR directo (sin agencia) a Xataka México, Unocero, El Financiero Tech, medios de salud
- TikTok/Reels: formato ancla "escaneo en vivo de productos icónicos mexicanos" (Gansito, Sabritas, Chocomilk)
- **Ventaja estructural subestimada:** páginas públicas indexables `yomi.mx/producto/{barcode}` — SEO programático que ninguna app nativa competidora puede replicar
- Partnerships con nutriólogos, ACELMEX, Federación Mexicana de Diabetes

### Loops de crecimiento

**El más urgente de construir:** botón de compartir (imagen + link con Open Graph optimizado para WhatsApp) — el resultado de un escaneo es un link web que abre sin instalar nada. Debe estar listo **antes** del lanzamiento público; es el desarrollo de growth de mayor ROI de todo el plan.

Complementado con: flywheel OCR hecho visible/emocional ("eres el usuario #X en construir la base de datos de México"), referidos post-cuentas ("regala un mes, recibe un mes"), UGC con hashtag propio.

### Métricas norte

North Star: escaneos con veredicto por usuario activo semanal.

| Métrica | 3 meses | 6 meses |
|---|---:|---:|
| MAU | 10,000 | 40,000 |
| Retención D7 / D30 | ≥30% / ≥15% | ≥35% / ≥20% |
| Conversión premium | ≥1% | ≥2% (~800 subs, MRR ~$23k MXN) |

### Presupuesto

Con $0: todo el plan base funciona (SEO, comunidades, PR directo, TikTok con celular, botón compartir). Con $10,000 MXN/mes: micro-influencers de nicho médico ($4,000), ads quirúrgicos solo amplificando lo orgánico validado ($3,000, apagar si CAC >$30 MXN), edición de video ($1,500), herramientas ($1,500).

---

## 6. Resumen ejecutivo — próximos pasos inmediatos

1. **Ya:** fix de seguridad aplicado — beta puede lanzarse
2. **Esta semana:** publicar artículo SEO comparativo vs Yuka (ventana de búsqueda se cierra rápido)
3. **Semanas 1-4:** reclutar 200-300 beta testers priorizando comunidades médicas (celíacos, alérgicos, padres)
4. **Semana 3 de beta:** anunciar precio fundador ($19/mes)
5. **Semanas 4-6:** construir botón de compartir + páginas de producto indexables (SEO) antes del lanzamiento público
6. **Semanas 5-6:** lanzamiento público coincidiendo con la cola mediática de Yuka
7. **T1 post-beta:** cuentas de usuario → perfil/alertas personalizadas → pagos → lanzamiento premium ($29/$249 MXN)
8. **T2:** perfiles familiares, integración PROFECO, comparador de productos
