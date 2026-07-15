# Cuentas de usuario + personalización premium — diseño

Fecha: 2026-07-15
Ambiente objetivo: `develop` (Firebase project `foodscaner-dev`). Se replica a prod cuando se promueva.

## Contexto

Yomi hoy no tiene cuentas de usuario — el escaneo es anónimo. Se necesita login para:
1. Dar identidad persistente al usuario (base para el futuro plan premium $29 MXN/mes).
2. Permitir que un usuario premium configure preferencias dietéticas/alergias/condiciones de salud, y que el veredicto de cada producto (`computeVerdict()` en `app.js:1599`) se personalice automáticamente según esas preferencias — hoy el veredicto es genérico, igual para todos.

Fuera de alcance de este diseño: el checkout/billing en sí (Stripe/Mercado Pago/Conekta — se decide cuando se construya), y planes familiares multi-perfil (se deja la estructura preparada, no se construye).

## Arquitectura

**Firebase Authentication** (mismo proyecto Firebase que ya usa Firestore), providers: email/password + Google.

- Frontend: Firebase JS SDK vía CDN (sin bundler nuevo). Maneja login/signup/persistencia de sesión. Tras login, obtiene el ID token (JWT) y lo manda como `Authorization: Bearer <token>` en llamadas a la API que requieran usuario.
- Backend: middleware `requireUser` nuevo en `api/index.js`, mismo archivo/patrón que el `requireAdmin` existente (línea ~1257). Verifica el JWT con `crypto.verify` (RS256) contra los certs públicos de Google (cacheados, con rotación) — **sin** `firebase-admin` SDK (decisión deliberada: evita gRPC/protobuf, sigue el comentario existente en `api/firestore.js` "no gRPC dependency", cold starts rápidos en Vercel).
- Si en el futuro se necesita gestión de usuarios server-side (deshabilitar cuenta al cancelar suscripción, revocar sesión), se resuelve con llamadas REST a Identity Toolkit (mismo estilo REST-only), no requiere instalar `firebase-admin`.

### Requisitos de verificación del JWT (no negociables — hallazgo de revisión de seguridad)

Una verificación manual mal hecha es peor que no tener una — estos puntos deben implementarse exactamente así, no son sugerencias:

- **`alg` hardcodeado a `RS256` en el código**, nunca leído del header del token. Si el verificador usa el `alg` que el propio token declara, un atacante puede mandar `alg: HS256` y firmar el token con la clave pública de Google (que es pública) como si fuera un secreto HMAC → bypass total de auth. Esto es un ataque conocido (algorithm confusion), no hipotético.
- **`iss` debe ser el string completo** `https://securetoken.google.com/<project-id>`, no solo comparar el project ID suelto.
- **`aud` debe ser exactamente el project ID de Firebase** del ambiente correspondiente (`foodscaner-dev` en dev, el de prod en prod — no cross-aceptar tokens de un proyecto en el otro).
- **`sub` debe existir y no ser string vacío** antes de usarlo como `uid` en `users/{uid}` — un `sub` vacío colisionaría con un documento real.
- **Cacheo de certs de Google**: respetar el header `Cache-Control`/`max-age` de la respuesta del endpoint de certs, no inventar un TTL propio. Certs rotan; un TTL propio mal calibrado puede aceptar certs ya revocados por más tiempo del debido.
- **Fail-closed**: si la petición a los certs de Google falla (timeout, red, cold start de Vercel), el resultado debe ser "token no verificado" (401), nunca "dejar pasar".

## Modelo de datos — `users/{uid}` (Firestore)

**Desviación deliberada del patrón existente en `api/firestore.js`**: las funciones de caché (`fireSetCache`, `fireSetOcrData`, etc.) serializan el objeto entero como JSON dentro de un solo campo string (`_data.stringValue`). `users/{uid}` **NO debe seguir ese patrón** — debe usar campos Firestore nativos reales (maps/strings/ints tipados, no un blob). Razón (hallazgo de revisión técnica): un blob único significa que CUALQUIER escritura (ej. incrementar `usage.ocrCount` en cada foto OCR) reemplaza el documento entero, pudiendo pisar una edición concurrente de `preferences` que ocurra en la misma ventana. Con campos nativos, cada `PATCH` puede usar `updateMask.fieldPaths` para tocar solo `usage` sin rozar `preferences`/`billing`, y habilita usar field transforms nativos (`increment`) más adelante si se decide migrar de precondición a eso.

```jsonc
{
  "email": "...", "emailVerified": true,
  "displayName": "...", "photoURL": "...",
  "providers": ["password", "google.com"],
  "createdAt": "...", "lastLoginAt": "...", "disabled": false,

  "plan": "free",              // "free" | "premium" — campo plano, no subcolección
  "planUpdatedAt": "...",

  "billing": {                 // placeholder — no se usa hasta implementar checkout
    "stripeCustomerId": null, "subscriptionId": null,
    "subscriptionStatus": null, "currentPeriodEnd": null,
    "isFounderPricing": false, // precio fundador ($19/mes o $189/año) es
                                 // perpetuo MIENTRAS la suscripción siga activa
                                 // (docs/business §3) — placeholder, la lógica
                                 // real de "se cae si cancela" se define con billing
    "billingCycle": null       // "monthly" | "annual" | null — el doc de negocio
                                 // define Premium Mensual ($29) y Premium Anual
                                 // ($249) como planes DISTINTOS con la misma
                                 // `plan: "premium"`; sin este campo no hay forma
                                 // de medir la métrica de gobierno "mix anual en
                                 // altas nuevas ≥60%" (docs/business §3, línea 166)
  },

  // usage: contador de cuotas diarias free — MVP, no fase 2. Es la razón de
  // negocio explícita por la que existen las cuentas (docs/business/2026-07-propuesta-modelo-negocio.md
  // §2, "Prerequisito bloqueante para todo el premium"): OCR 5 fotos/día free
  // vs ilimitado premium, refresco de caché 1/producto/día free vs ilimitado
  // premium. Se embebe en el mismo doc (no subcolección aparte) porque el
  // middleware que decide "plan" y el que decide "cuota" leen el mismo doc en
  // la misma request — una subcolección duplicaría el read sin necesidad.
  "usage": {
    "date": "2026-07-15",       // YYYY-MM-DD, se resetea a hoy + counts en 0
                                  // la primera vez que se lee y date !== hoy
    "ocrCount": 0,
    "cacheRefreshCount": 0
  },

  // preferences: AUSENTE del doc si plan === "free" (no objeto vacío — la
  // ausencia del campo ES la señal para el backend/frontend de "sin personalización")
  "preferences": {
    "dietary": ["vegan", "glutenFree"],
    // subset de: vegan, vegetarian, keto, kosher, halal, organic, nonGmo,
    // noAdditives, palmOilFree, fairTrade, caseinFree, glutenFree
    // (mismas claves que ya usa app.js — extractDietaryFromLabels, etc.)

    "allergens": [
      { "code": "cacahuate", "severity": "severe" },
      { "code": "leche", "severity": "mild" }
    ],
    // code = mismas labels canónicas que COMMON_ALLERGENS en app.js
    // (lácteos, cacahuate, nueces, trigo, huevo, pescado, mariscos, soja)
    // severity: "severe" | "mild"

    "healthConditions": ["diabet", "celiac"],
    // subset de las claves normalizadas que YA calcula grupoClave() en
    // app.js:2094 sobre product.notRecommended: diabet, hipert, lactos,
    // fenilc, celiac, gluten, ninos ("ninos" = "también compro para niños
    // en casa", preferencia propia del titular, no un perfil aparte)

    "updatedAt": "..."
  }
}
```

Decisiones:
- `plan` campo simple (no subcolección) — evita un GET extra por verificación de acceso; no hay historial de suscripciones que versionar todavía.
- `dietary`/`allergens`/`healthConditions` como arrays, no objeto de booleanos ni subcolección — baratos de escribir/leer, se leen siempre juntos con el resto del perfil, intersectan directo contra las constantes que ya existen en `app.js` sin tabla de traducción.
- Sin índices compuestos necesarios — `preferences` solo se lee por `uid` (get directo).
- **Extensibilidad para plan familiar (no se construye ahora):** cuando exista, la extensión natural es una subcolección `users/{uid}/familyProfiles/{profileId}` con la misma forma que `preferences`. Cero migración al campo actual.
- **`usage` embebido, no subcolección:** el middleware que verifica `plan` (free/premium) y el que verifica cuota leen el mismo doc en la misma request — separar en subcolección duplicaría el read por nada.

### Historial de escaneos — `users/{uid}/history/{scanId}` (subcolección, MVP)

Free: historial local (localStorage, 5 escaneos, sin cambio — ya funciona así). Premium: historial ilimitado en la nube. Requiere una subcolección (no el doc principal) porque es una lista que crece sin tope — cada escaneo premium hace `POST` de un doc `{barcode, productName, verdict, scannedAt}`. Solo se escribe si `plan === "premium"`; free no toca esta subcolección (evita costo de escritura innecesario y mantiene el paywall simple: "tu historial se llenó" es literal en free, no aplica en premium).

### Nota de flujo (no es cambio de schema, es UX a considerar en el plan de implementación)

El documento de negocio especifica que el trial de 7 días (plan anual) requiere **perfil alérgico configurado antes de iniciarlo**. Esto implica que el flujo de "activar trial" debe forzar/ofrecer completar `preferences` como parte del onboarding, no dejarlo opcional post-pago. Se resuelve en el plan de implementación, no cambia el modelo de datos de arriba.

## Privacidad de datos de salud (hallazgo de revisión de seguridad)

`healthConditions` y `allergens` son datos de salud. En México, la LFPDPPP los clasifica como "datos sensibles" (Art. 3, fracción VI) y exige **consentimiento expreso** (no tácito) para su tratamiento. Esto no es opcional ni cosmético:

- El flujo de onboarding premium debe incluir un paso de consentimiento explícito (checkbox separado del signup genérico, no implícito en "aceptar términos") antes de guardar `healthConditions`/`allergens` por primera vez.
- El Aviso de Privacidad del sitio necesita mención específica de estos datos y su finalidad (esto es una tarea de producto/legal, no de código — se deja anotado aquí para que no se pierda).
- Debe existir un endpoint `DELETE /api/me/preferences` (derechos ARCO — cancelación) independiente de borrar la cuenta completa.
- Al loguear errores de Firestore relacionados con `users/{uid}` (ej. en `/api/auth/sync`), **loguear solo el `uid`, nunca el documento completo** — evita que datos de salud terminen en logs de Vercel.

## Mitigación de bypass de cuota (hallazgo de revisión de seguridad)

Firebase Auth con email/password permite registro de cuentas nuevas sin fricción. Sin ninguna mitigación, alguien puede automatizar `signup → 5 OCRs gratis → signup de cuenta nueva` indefinidamente, anulando el límite de negocio. Mitigación mínima para MVP (no se busca eliminar el abuso al 100%, solo subir el costo de explotarlo):

- `usage.ocrCount` solo empieza a aplicar el límite si `emailVerified === true` (Firebase Auth ya tiene el flujo de verificación de email nativo — se reusa, no se construye).
- Rate-limit de creación de cuentas por IP en `POST /api/auth/sync`, reusando el `express-rate-limit` que ya existe en `api/index.js` (línea 41) — no se necesita una librería nueva.
- No se construye fingerprinting de dispositivo ni verificación telefónica ahora — sería sobre-ingeniería para un límite de 5 fotos/día en beta.

## Preguntas abiertas (no resolver en este spec — marcarlas para T2)

- **Plan Familiar ($49/mes, hasta 5 perfiles, docs/business §3):** el doc de negocio no aclara si son sub-perfiles gestionados por un solo titular logueado (ej. papá configura alergias de sus hijos, un solo `uid`), o si cada miembro de la familia necesita su propia cuenta Firebase Auth vinculada a una suscripción compartida (ej. esposa/hijo adolescente escaneando solos desde su propio celular). Son arquitecturas distintas — la segunda requiere una entidad tipo "household" con múltiples `uid` vinculados a una sola suscripción, no una subcolección bajo un único `uid` como propone hoy este spec. **No se resuelve aquí** — se deja como decisión bloqueante para cuando se planee T2 (plan Familiar), y por ahora la subcolección `familyProfiles` propuesta arriba asume la interpretación simple (un titular, sub-perfiles) sin comprometerse a que sea la correcta.

## Personalización del veredicto

Extender `computeVerdict(product, userPreferences)` en `app.js:1599` — segundo parámetro opcional; si es `null`/`undefined` (usuario free o no logueado), comportamiento idéntico al actual.

Reglas (en orden, la primera que aplique gana):
1. Alérgeno `severity: "severe"` en `userPreferences.allergens` que el producto marca `detected` → `evitar`.
2. `healthConditions` del usuario que matchea un grupo `certain: true` en `product.notRecommended` (vía el mismo `grupoClave()` normalizer ya existente) → `evitar`.
3. Dieta en `userPreferences.dietary` que el producto declara explícitamente violada (ej. `dietary.vegan === false`) → `evitar`.
4. Alérgeno `severity: "mild"` detectado → tope `regular` (no sube a `sano` aunque nutricionalmente lo sea).
5. Sin conflictos → verdict normal (reglas actuales de sellos/notRecommended).

`userPreferences` se obtiene una vez al cargar sesión (`GET /api/me`), se cachea en variable JS de frontend — no pega a Firestore en cada escaneo.

## Endpoints nuevos (`api/index.js`)

- `POST /api/auth/sync` (requiere `requireUser`) — llamado por el cliente justo después de login. Upsert de `users/{uid}`: crea el doc si no existe (`plan: "free"` por default) o actualiza `lastLoginAt`/`providers` si ya existe. Idempotente. Rate-limited por IP (reusa el limiter existente).
- `GET /api/me` (requiere `requireUser`) — regresa el perfil completo (incluye `preferences` solo si `plan === "premium"`).
- `PUT /api/me/preferences` (requiere `requireUser`) — actualiza `dietary`/`allergens`/`healthConditions`. Si `plan !== "premium"` → 403 `{error: "premium_required"}`. **El PATCH a Firestore debe usar `updateMask.fieldPaths` explícito sobre esos 3 campos** — nunca aceptar/mergear el body crudo del cliente como estado nuevo del doc (previene que un payload futuro con `plan` incluido lo sobreescriba por accidente).
- `DELETE /api/me/preferences` (requiere `requireUser`) — borra `preferences` del doc (derechos ARCO sobre datos de salud), independiente de borrar la cuenta completa.

## Manejo de errores

- Token ausente/inválido/expirado en `requireUser` → 401 `{error: "unauthorized"}` (fail-closed también si falla el fetch de certs de Google).
- Falla transitoria de Firestore en `/api/auth/sync` → log warn **con solo el `uid`, nunca el doc completo** (contiene datos de salud), no bloquea el login (Firebase Auth del cliente ya autenticó; el doc se reintenta en el próximo sync).
- `PUT /api/me/preferences` en cuenta free → 403 `{error: "premium_required"}`.
- **Concurrencia en `usage.ocrCount`**: el patrón es GET → incrementar en memoria → PATCH con precondición `currentDocument.updateTime=<el del GET>` (optimistic concurrency vía la REST API de Firestore, no requiere transacción completa ni `firebase-admin`). Si Firestore responde 409 (otro request ya escribió), reintentar el ciclo GET→PATCH 2-3 veces con backoff corto (10-50ms). Cubre el caso de doble-tap o 2 tabs sin perder/duplicar el conteo. El reset de `usage.date` usa UTC (no zona horaria del usuario) — documentado así a propósito, no vale la pena resolver por-usuario para un límite de 5/día.

## Testing

- Unit: `requireUser` con JWT válido (firmado con keypair RSA de prueba imitando formato de Google) → pasa; JWT expirado/`aud` incorrecto/firma inválida → 401.
- Integración: `POST /api/auth/sync` crea el doc la primera vez; `GET /api/me` regresa `plan: "free"` por default sin `preferences`; `PUT /api/me/preferences` en cuenta free → 403; en cuenta premium (fixture con `plan: "premium"`) → 200 y persiste.
- Sigue el patrón/convenciones ya existentes en `tests/app.test.js` (vitest).
