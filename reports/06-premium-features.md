# Yomi+ — Estrategia de Funcionalidades Premium

**Contexto**: Beta gratuita con escaneo, datos OFF/USDA, gluten, alérgenos, sellos NOM-051, veredicto IA, badges de dieta. Yomi+ a $29 MXN/mes ($249/año).

**Principio rector**: El tier gratis debe ser completamente funcional. Yomi+ no es "desbloquear lo básico", es una capa de inteligencia, memoria y personalización.

**Lo que NO haremos**: Quitar funcionalidad existente del tier gratis.

---

## P1 — Fundacional (el gancho de conversión)

### 1.1 Historial inteligente de escaneos
Cada producto escaneado se guarda permanentemente con fecha, veredicto, nutrientes y foto. Perfil "Mi Historia" con búsqueda, filtros (por veredicto, por fecha, por alérgeno, por sello NOM-051), y vista de calendario.

- **Segmento**: Universal
- **Complejidad**: Media (auth + Firestore + UI)
- **Por qué justifica el pago**: Es el feature más pegajoso posible. Después de 30 días de escaneos, perder ese historial duele más que los $29.
- **Ya existe en base**: Home ya muestra recientes (localStorage). Tab "Profile" deshabilitado.

### 1.2 Estadísticas semanales/mensuales personalizadas
Dashboard automático: "Esta semana escaneaste 45 productos, tu promedio de azúcar fue 18g/100g, tus 3 productos más escaneados fueron X, Y, Z." Gráficas de tendencias.

- **Segmento**: Diabéticos, keto, fitness, health-conscious
- **Complejidad**: Media (agregación + visualización)
- **Por qué justifica el pago**: El "Why am I paying?" visual que se recibe cada lunes.
- **Ya existe en base**: Tab "Análisis" en navegación, deshabilitado.

### 1.3 Alertas personalizadas inteligentes
- Alerta de alérgeno: "Escaneaste X → contiene LACTOSA. 🚨 Has marcado intolerancia."
- Alerta de cambio en producto: "El producto X cambió sus ingredientes. Ya no es libre de gluten."
- Alerta de umbral diario: "Hoy ya escaneaste 3 productos con sello EXCESO AZÚCARES."
- Alerta de producto mejor puntuado: "¿Sabías que [marca Y] tiene 40% menos azúcar que [marca X]?"

- **Segmento**: Alérgicos, celíacos, diabéticos
- **Complejidad**: Alta (push notifications, background jobs)
- **Por qué justifica el pago**: Un alérgico paga $29/mes solo por esto.

### 1.4 Perfil de salud configurable y veredicto personalizado
Usuario configura edad, sexo, condiciones (diabetes, hipertensión, celiaquía, alergias, keto, vegano). El veredicto se recalcula en función de su perfil.

- **Segmento**: Diabéticos, alérgicos, hipertensos, celíacos
- **Complejidad**: Media-alta
- **Por qué justifica el pago**: Transforma Yomi de "veredicto genérico" a "veredicto para MÍ".

---

## P2 — Diferenciación por segmento

### 2.1 Modo Diabético — Carga glucémica estimada + tracker
Estimación de carga glucémica basada en azúcar + fibra + carbohidratos. Tracker diario contra límite OMS (25g azúcar añadida). Sugerencias de sustitutos.

- **Segmento**: Diabéticos (14M), prediabetes (22M)
- **Complejidad**: Alta
- **Por qué justifica el pago**: 14M de diabéticos en MX, sin app mexicana que haga esto. $29 vs $200+ consulta nutriólogo.

### 2.2 Modo Celíaco — Mapa de productos seguros + alerta de trazas
Base de datos seleccionada de productos "Comprobados Sin Gluten" con validación comunitaria. Score de confianza combinando 5 fuentes (OFF, IA, OCR, reportes usuarios, certificaciones).

- **Segmento**: Celíacos, sensibilidad al gluten (8-10M)
- **Complejidad**: Media
- **Por qué justifica el pago**: Un celíaco vive con miedo de contaminación. Lista curada de productos seguros = certeza.

### 2.3 Clasificación NOVA de ultraprocesados
Clasificación NOVA (1: natural, 2: ingrediente culinario, 3: procesado, 4: ultraprocesado). Dashboard mensual: "60% de tus escaneos son NOVA 4."

- **Segmento**: Fitness, keto, nutriólogos
- **Complejidad**: Media
- **Por qué justifica el pago**: Estándar que usan nutriólogos. Yuka no lo implementa bien.

### 2.4 Scanner vegano profundo
Detección de ingredientes animales no obvios: gelatina (E441), carmín (E120), glicerina, vitamina D3 (lanolina). Explicación de cada uno.

- **Segmento**: Veganos (3-5M), vegetarianos, religiosos
- **Complejidad**: Baja
- **Por qué justifica el pago**: Hoy dependen de grupos de Facebook. Base curada = servicio por el que pagan con su tiempo.

---

## P3 — Virales y de red

### 3.1 Tarjeta de veredicto compartible
Imagen tipo card: foto del producto, logo Yomi, veredicto, sellos NOM-051, QR a yomi.mx. Lista para WhatsApp/IG/FB.

- **Complejidad**: Baja
- **Efecto**: Viral. Cada card compartida = anuncio gratis.

### 3.2 Crowdsourcing de fotos reales
Usuarios premium suben fotos reales del empaque. Sistema de reputación. Las fotos se muestran en lugar de (o además de) imagen OFF.

- **Complejidad**: Media
- **Efecto**: Network effect. Mejora la base para todos.

### 3.3 Sistema de referidos
"Invita a un amigo → ambos 1 semana Yomi+ gratis." Si traes 5 amigos, tu mes es gratis.

- **Complejidad**: Baja
- **Efecto**: CAC ~$0, viralidad orgánica.

### 3.4 Leaderboards anónimos
"Top 10 productos más escaneados en México esta semana." "Descubrimientos" con productos que otros premium aprobaron.

- **Complejidad**: Media
- **Efecto**: Gamificación + comunidad.

### 3.5 Comunidad de verificadores
Usuarios premium reportan cambios en productos. 3+ confirmaciones ajustan la base de datos. Insignias de Verificador (bronce, plata, oro).

- **Complejidad**: Media
- **Efecto**: Network effect real. Datos mexicanos curados por mexicanos.

---

## P4 — B2B ligero (nutriólogos)

### 4.1 Dashboard para profesionales
Nutriólogo agrega pacientes, ve historial de escaneos, genera PDF. Función "recomendar desde el consultorio".

- **Complejidad**: Alta
- **Modelo**: Nutriólogo paga $249/mes por hasta 20 pacientes.

### 4.2 Exportación de datos (PDF/CSV)
Historial personal exportable para mostrar al médico.

- **Complejidad**: Baja
- **Valor**: Diabético lleva reporte a consulta mensual.

### 4.3 Moderación de alertas por profesional
Nutriólogo configura alertas para pacientes. Las alertas llegan como si Yomi+ las enviara.

- **Complejidad**: Alta
- **Modelo**: Herramienta de adherencia al tratamiento.

---

## P5 — Calidad de vida

### 5.1 Comparación lado a lado
Seleccionar 2-3 productos y ver tabla comparativa: calorías, azúcar, proteína, sellos, veredicto.

- **Complejidad**: Baja

### 5.2 Listas personalizadas
"Mi despensa saludable", "Productos que no debo comprar", "Favoritos del mes". Compartibles.

- **Complejidad**: Baja
- **Sticky**: Una vez con 5 listas y 50 productos, no te cambias de app.

### 5.3 Scanner batch / modo compras
Escanea múltiples productos en fila. Modo "lista del super".

- **Complejidad**: Media

### 5.4 Reconocimiento de certificaciones por foto
Identificar sellos en empaque desde la cámara: "Sin Gluten" COFEPRIS, Orgánico, Kosher, Halal.

- **Complejidad**: Alta
- **Diferenciador**: Ninguna app lo hace. Se siente mágico.

### 5.5 Estimación de costo-beneficio nutricional
Usuario ingresa precio del producto. Yomi+ calcula "costo por 100g de proteína".

- **Complejidad**: Baja
- **Valor**: Para familias que cuidan presupuesto.

---

## Resumen de Priorización (RICE estimado)

| Feature | Complejidad | Impacto conversión | Stickyness | Viral | Prioridad |
|---------|------------|-------------------|------------|-------|-----------|
| Historial inteligente | Media | 🔥 Alto | 🔥🔥🔥 | Bajo | **P1** |
| Estadísticas semanales | Media | 🔥 Alto | 🔥🔥🔥 | Bajo | **P1** |
| Alertas personalizadas | Alta | 🔥🔥 Muy alto | 🔥🔥🔥 | Medio | **P1** |
| Perfil de salud configurable | Media-Alta | 🔥🔥 Muy alto | 🔥🔥🔥 | Alto | **P1** |
| Modo Diabético | Alta | 🔥🔥 Nicho alto | 🔥🔥🔥 | Medio | **P2** |
| Modo Celíaco | Media | 🔥 Nicho alto | 🔥🔥🔥 | Alto | **P2** |
| NOVA ultraprocesados | Media | 🔥 Medio | 🔥🔥 | Medio | **P2** |
| Tarjeta compartible | Baja | 🔥 Medio | Bajo | 🔥🔥🔥 | **P3** |
| Batch scan / compras | Media | 🔥 Medio | 🔥🔥🔥 | Bajo | **P5** |
| B2B Dashboard | Alta | 🔥🔥 B2B alto | 🔥🔥🔥 | Bajo | **P4** |

---

## Estrategia de rollout

| Fase | Timeline | Features |
|------|----------|---------|
| **1 — El gancho** | Mes 1 | Perfil salud + veredicto personalizado, historial 90 días, alerta alérgenos |
| **2 — El hábito** | Mes 2-3 | Estadísticas semanales, tarjeta compartible, listas, batch scan |
| **3 — El diferenciador** | Mes 3-6 | Modo diabético, modo celíaco, NOVA |
| **4 — La red** | Mes 6+ | Crowdsourcing, verificadores, B2B nutriólogos, referidos |

### Métricas de éxito por fase

- **Fase 1**: 5% de usuarios activos semanales convertidos a Yomi+
- **Fase 2**: Retención D30 de Yomi+ > 60%
- **Fase 3**: NPS de Yomi+ > 50
- **Fase 4**: MRR Yomi+ > $50K MXN

---

## Lo que deliberadamente NO hacemos

| No hacemos | Razón |
|-----------|-------|
| Límite de escaneos diarios gratis | Mata la propuesta de valor. Lo gratis debe ser útil. |
| Quitar funcionalidad existente | Traiciona la confianza de early adopters. |
| Más providers IA (7+) | Rendimiento decreciente. El usuario no percibe la diferencia. |
| Chat con IA ilimitado | Demasiado caro en inferencia. |
| Plan familiar | Complejidad de billing alta para etapa inicial. |
| Plan Enterprise / API | No hay demanda validada. Especulación pura. |
| App nativa iOS/Android | PWA funciona. $29/mes no justifica el costo. |
