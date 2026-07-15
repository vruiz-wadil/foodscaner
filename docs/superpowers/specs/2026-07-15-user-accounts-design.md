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
- Backend: middleware `requireUser` nuevo en `api/index.js`, mismo archivo/patrón que el `requireAdmin` existente (línea ~1257). Verifica el JWT con `crypto.verify` (RS256) contra los certs públicos de Google (cacheados, con rotación) — **sin** `firebase-admin` SDK (decisión deliberada: evita gRPC/protobuf, sigue el comentario existente en `api/firestore.js` "no gRPC dependency", cold starts rápidos en Vercel). Debe validar `exp`, `aud` (= project ID de Firebase), `iss`.
- Si en el futuro se necesita gestión de usuarios server-side (deshabilitar cuenta al cancelar suscripción, revocar sesión), se resuelve con llamadas REST a Identity Toolkit (mismo estilo REST-only), no requiere instalar `firebase-admin`.

## Modelo de datos — `users/{uid}` (Firestore)

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
    "isFounderPricing": false  // precio fundador ($19/mes o $189/año) es
                                 // perpetuo MIENTRAS la suscripción siga activa
                                 // (docs/business §3) — placeholder, la lógica
                                 // real de "se cae si cancela" se define con billing
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

- `POST /api/auth/sync` (requiere `requireUser`) — llamado por el cliente justo después de login. Upsert de `users/{uid}`: crea el doc si no existe (`plan: "free"` por default) o actualiza `lastLoginAt`/`providers` si ya existe. Idempotente.
- `GET /api/me` (requiere `requireUser`) — regresa el perfil completo (incluye `preferences` solo si `plan === "premium"`).
- `PUT /api/me/preferences` (requiere `requireUser`) — actualiza `dietary`/`allergens`/`healthConditions`. Si `plan !== "premium"` → 403 `{error: "premium_required"}`.

## Manejo de errores

- Token ausente/inválido/expirado en `requireUser` → 401 `{error: "unauthorized"}`.
- Falla transitoria de Firestore en `/api/auth/sync` → log warn, no bloquea el login (Firebase Auth del cliente ya autenticó; el doc se reintenta en el próximo sync).
- `PUT /api/me/preferences` en cuenta free → 403 `{error: "premium_required"}`.

## Testing

- Unit: `requireUser` con JWT válido (firmado con keypair RSA de prueba imitando formato de Google) → pasa; JWT expirado/`aud` incorrecto/firma inválida → 401.
- Integración: `POST /api/auth/sync` crea el doc la primera vez; `GET /api/me` regresa `plan: "free"` por default sin `preferences`; `PUT /api/me/preferences` en cuenta free → 403; en cuenta premium (fixture con `plan: "premium"`) → 200 y persiste.
- Sigue el patrón/convenciones ya existentes en `tests/app.test.js` (vitest).
