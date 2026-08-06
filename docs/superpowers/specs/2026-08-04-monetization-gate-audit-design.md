# Cierre de gate de monetización + rate-limit para endpoints costosos

## Contexto

Yomi es freemium: escanear, buscar productos por código de barras, y procesar OCR/AI son gratis para todos los usuarios, incluso anónimos. Lo pago es la personalización (`/api/me/preferences`) y el historial en la nube (`/api/me/history`), ambos protegidos hoy por el middleware `requireActiveMembership`.

Se auditaron las 45 rutas registradas en `api/index.js`. La auditoría confirmó que el resto del modelo freemium está implementado correctamente — no hay más rutas premium sin gatear. Se encontraron dos problemas puntuales, no relacionados entre sí:

1. Un bug de gate inconsistente en `/api/ocr/process`.
2. Ausencia de rate-limit específico en los 3 endpoints que consumen APIs de visión/IA de pago (Groq), que hoy solo comparten el límite global de la app.

## Cambio 1 — Bug: gate inconsistente en `/api/ocr/process`

**Problema.** `ocrProcessHandler` (api/index.js:1239-1271) contiene:

```js
if (req.user) {
  const profile = await fireGetUser(req.user.uid);
  const membershipStatus = profile ? profile.membershipStatus : 'pending';
  if (membershipStatus !== 'active') {
    return res.status(402).json({ error: membershipStatus === 'expired' ? 'membership_expired' : 'membership_required' });
  }
}
```

Este chequeo solo se ejecuta cuando `req.user` está poblado (usuario logueado). El resultado es que un usuario **logueado sin membresía activa recibe 402** al intentar usar OCR de ingredientes, mientras que un usuario **anónimo (sin token) puede usar el mismo endpoint sin restricción**. Esto castiga a quien creó una cuenta y favorece a quien no la creó — contradice el modelo freemium ya confirmado, donde OCR de ingredientes debería ser gratis para todos por igual.

El endpoint hermano `/api/nutrition/process` (mismo tipo de feature: OCR con vision-LLM) no tiene ningún chequeo de membresía — es el comportamiento correcto y ya vigente.

**Fix.** Eliminar por completo el bloque `if (req.user) { ... }` de `ocrProcessHandler`. El endpoint queda gratis para todos, sin distinción entre anónimo/logueado/miembro, igual que `/api/nutrition/process`. No se toca `optionalUser` como middleware (sigue poblando `req.user` cuando hay token, por si en el futuro se necesita para otra cosa como logging), solo se remueve el uso que hace el handler de esa membresía.

## Cambio 2 — Rate-limit dedicado para endpoints costosos

**Problema.** La app aplica un rate-limit global (api/index.js:116-117):

```js
const limiter = rateLimit({ windowMs: 60000, max: 60, message: {...} });
app.use('/api/', limiter);
```

60 req/min por IP a *todo* `/api/*`. Los 3 endpoints que llaman servicios de pago (Groq vision) — `/api/ocr/process`, `/api/nutrition/process`, `/api/ai-query` — no tienen ningún límite adicional. Bajo el modelo freemium (gratis para todos, incluso anónimos), esto deja la factura de Groq expuesta a abuso automatizado sin fricción de pago de por medio.

**Fix.** Nuevo limiter, más estricto, apilado sobre el global solo en esas 3 rutas:

```js
const expensiveLimiter = rateLimit({
  windowMs: 60000,
  max: 20,
  message: { error: "Demasiadas solicitudes. Intenta de nuevo en 1 minuto." }
});
```

Aplicado como middleware adicional (no reemplaza el global) en:
- `app.post('/api/ocr/process', expensiveLimiter, optionalUser, ocrProcessHandler)`
- `app.post('/api/nutrition/process', expensiveLimiter, ...)`
- `app.post('/api/ai-query', expensiveLimiter, ...)`

20/min por IP es suficiente para uso normal (nadie escanea 20 productos con OCR en un minuto) y corta scripts de abuso rápido. `/api/products/ocr` y `/api/products/nutrition` (los endpoints que *guardan* el resultado ya procesado en cache/Firestore) no llaman APIs externas de pago — quedan fuera de este cambio, bajo el límite global existente.

## Testing

- `tests/ocrQuota.test.js` (o el archivo que cubra `ocrProcessHandler`): eliminar/actualizar los casos que hoy esperan 402 para usuario logueado sin membresía activa — ese comportamiento deja de existir.
- Nuevo test de rate-limit: verificar que la request número 21 en la misma ventana a uno de los 3 endpoints devuelve 429, y que el endpoint sigue respondiendo normalmente por debajo del límite. Mockear o reducir la ventana/max en el test para no depender de 20 llamadas reales, siguiendo el patrón que ya use el proyecto para testear middlewares de rate-limit si existe alguno, o instanciando el limiter con valores bajos dentro del test.

## Fuera de alcance

- Analytics / instrumentación de funnel — sub-proyecto separado, a brainstormar después de este.
- Cualquier cambio al modelo de negocio (límites de escaneos gratis, etc.) — no pedido, freemium sin límite de cantidad se mantiene tal cual.
- `/api/products/ocr` y `/api/products/nutrition` — no llaman APIs de pago, no requieren rate-limit adicional.
