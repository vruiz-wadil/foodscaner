# Localización "Soja" → "Soya" (terminología mexicana)

## Contexto

La app usa "Soja" en toda la UI visible al usuario, pero en México el término común es "Soya". El código interno (`soja` como código de alérgeno en `ALLOWED_ALLERGEN_CODES`, preferencias guardadas en Firestore, arrays de detección `match: [...]`) usa "soja" como identificador — eso no cambia, solo lo que se le muestra al usuario.

3 fuentes de texto identificadas:
1. **Labels estáticos** (5 lugares) — texto fijo en el código, cambio directo.
2. **Texto libre generado por IA** (`notRecommended.grupo`/`razon` del análisis de Groq) — la IA puede escribir "soja" en su respuesta.
3. **Texto de ingredientes mostrado tal cual** (`app.js:2142`, `ingredientsTextEl.textContent`) — viene de Open Food Facts o de OCR de la etiqueta física.

Decisión: para (2) y (3) se usa una única función compartida `normalizeSoyTerm(text)` — reemplazo case-preserving de la palabra completa "soja"→"soya" — en vez de duplicar la lógica. No se toca el código interno del alérgeno (`soja` como key) ni los arrays de detección `match: [...]` (que ya incluyen "soya" como sinónimo reconocido, la detección ya funciona con cualquiera de los dos términos).

## Cambio

### 1. Labels estáticos → "Soya" (5 archivos)

- `app.js:88` — `COMMON_ALLERGENS`: `{ emoji: "🫘", label: "Soya", match: ["soja", "soya", "soy", "soybean"] }` (el `match` array no cambia, sigue reconociendo ambos términos en texto fuente).
- `app.js:1286` — `allergensMap["en:soybeans"] = "Soya"` (antes `"Soja"`).
- `preference-labels.js:35` — `soja: { emoji: '🫘', label: 'Soya' }` (la key del objeto `soja` no cambia, solo el `label`).
- `preferences.html:150-151` — texto visible del botón `<span class="label">Soya</span>` y `aria-label="Severidad para Soya"` (el `id`/`data-allergen="soja"` no cambian).
- `onboarding-membership-ui.js` — `ALLERGEN_LABELS.soja = 'soya'` (usado en sentencias tipo "Cuidado con soya, sin adivinar").

### 2. Función compartida `normalizeSoyTerm`

Nueva función pequeña, en `app.js` (frontend, usada en el punto 4 de renderizado de ingredientes) y una copia equivalente en `api/index.js` (backend, usada en el punto 3 para normalizar la respuesta de la IA antes de guardarla — el backend y el frontend no comparten módulos hoy, mismo patrón que duplicaciones ya existentes en el codebase, ej. `ALLERGEN_LABELS` duplicado en `onboarding-membership-ui.js`):

```js
function normalizeSoyTerm(text) {
  if (!text) return text;
  return text.replace(/\bsoja\b/gi, (match) => {
    if (match === 'SOJA') return 'SOYA';
    if (match === 'Soja') return 'Soya';
    return 'soya';
  });
}
```

`\bsoja\b` (word boundary) evita tocar palabras que contengan "soja" como substring (no hay casos conocidos en español, pero es la práctica defensiva correcta). Preserva mayúsculas/minúsculas del match original en los 3 casos comunes (todo mayúsculas, capitalizado, minúsculas) — un caso mixto raro (ej. "SoJa") cae al fallback minúsculas, aceptable.

### 3. Prompt de IA + normalización de la respuesta (`api/index.js`)

En el prompt (`api/index.js:1161-1184`), agregar una regla más a la lista de REGLAS:

```
- Terminología: usa "soya" (no "soja") en toda respuesta — términos mexicanos
```

Además, después de parsear la respuesta JSON (`api/index.js:1213`, donde ya se filtra `parsed.notRecommended`), aplicar `normalizeSoyTerm` sobre `grupo` y `razon` de cada item como red de seguridad (la IA no garantiza cumplir instrucciones al 100%):

```js
parsed.notRecommended = parsed.notRecommended.map(nr => ({
  ...nr,
  grupo: normalizeSoyTerm(nr.grupo),
  razon: normalizeSoyTerm(nr.razon)
}));
```

Se aplica DESPUÉS del filtro existente (`parsed.notRecommended.filter(...)`), no antes — no cambia qué items se incluyen, solo el texto de los que ya pasaron el filtro.

### 4. Texto de ingredientes mostrado (`app.js:2142`)

```js
ingredientsTextEl.textContent = normalizeSoyTerm(product.ingredientsText);
```

Único call site de renderizado de ingredientes (confirmado — no hay otro lugar donde `product.ingredientsText`/`ingredients_text` se muestre verbatim al usuario).

## Sin cambios

- Códigos internos de alérgeno (`soja` en `ALLOWED_ALLERGEN_CODES`, `ALLERGEN_CODES`, Firestore, `data-allergen="soja"`): sin cambios — evita romper preferencias ya guardadas de usuarios existentes.
- Arrays `match: [...]` de detección (ya incluyen "soja" y "soya" como sinónimos): sin cambios — la detección ya funciona con cualquiera de los dos términos, este spec es puramente de presentación.
- `canonical()` (`app.js:2544`, mapea "soya"→"soja" para matching de sugerencias de IA contra `COMMON_ALLERGENS`): sin cambios — sigue siendo lógica de matching interna, no de display.
- Lógica de detección de alérgenos (`isAllergenDetected`, `computeVerdictReasons`, `computeVerdict`): sin cambios — este spec no toca qué se detecta como alérgeno, solo cómo se nombra en pantalla.
