# Diagnóstico personalizado del veredicto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando un usuario logueado+premium con preferencias configuradas escanea un producto, ve una tarjeta bajo el veredicto explicando exactamente por qué (o por qué no) el producto le conviene, restricción por restricción, ordenada por severidad.

**Architecture:** Una función pura `computeVerdictReasons(product, userPreferences)` en `app.js` centraliza el matching de alérgenos/dieta/salud contra el perfil (una sola fuente de verdad); `computeVerdict` se refactoriza para derivar el veredicto de esa misma lista en vez de reimplementar la lógica. Una función de render `renderPersonalizedReasons` pinta esas filas en una tarjeta nueva bajo el banner de veredicto en `scan.html`, cableada desde `renderProductData`.

**Tech Stack:** Vanilla JS (sin build step), Vitest + jsdom para tests, CSS plano (`styles.css`).

## Global Constraints

- El código de alérgeno de preferencias es `"lacteos"` (sin acento, `preferences.html:108`); `COMMON_ALLERGENS` solo tiene `"lácteos"` (con acento) — normalizar ambos lados con NFD antes de comparar (mismo patrón que `grupoClaveVerdict`, `app.js:1636`).
- Orden de las filas: alérgeno grave (conflicto) → salud (conflicto) → dieta (conflicto) → alérgeno leve (conflicto) → todo `ok:true` → todo `ok:null` (sin dato). Dentro de cada grupo, se preserva el orden de configuración del usuario.
- Tres estados por fila: `ok:true` (cumple), `ok:false` (conflicto), `ok:null` (sin dato — solo aplica a dieta cuando `product.dietary[key]` no es `true` ni `false`). El estado `ok:null` NUNCA afecta el veredicto calculado.
- Comportamiento observable de `computeVerdict` debe ser IDÉNTICO al actual — los tests existentes en `tests/app.test.js` (líneas 504-605) deben seguir pasando sin modificarlos.
- La tarjeta nueva (`#verdict-reasons`) es neutral (blanco, `var(--card)`), NO roja/verde completa — el color de estado vive en el borde izquierdo de cada fila (`.reason-row--ok/--warn/--unknown`), para no competir visualmente con `#card-not-recommended` (ya rojo) apilado justo debajo.
- La tarjeta solo se muestra cuando `userPreferences` no es `null` (mismo gate que `getUserPreferencesForVerdict`) Y `computeVerdictReasons` regresa al menos una fila. Si no, se oculta con la clase `.hidden` (nunca se remueve del DOM — evita saltos de layout con la animación `verdict-reveal` del banner).

---

### Task 1: `computeVerdictReasons` + fix de acentos + refactor de `computeVerdict`

**Files:**
- Modify: `app.js:1651-1708` (`isAllergenDetected`, `computeVerdict`; agrega `computeVerdictReasons`, `DIETARY_LABELS`, `HEALTH_LABELS` justo antes de `computeVerdict`)
- Test: `tests/app.test.js`

**Interfaces:**
- Consumes: `COMMON_ALLERGENS` (app.js:80-89), `grupoClaveVerdict` (app.js:1635), `computeBaseVerdict` (app.js:1667) — todas ya existen, sin cambios de firma.
- Produces: `computeVerdictReasons(product, userPreferences)` → `Array<{ ok: true|false|null, severity: 'grave'|'leve'|null, icon: string, title: string, detail: string }>`. `computeVerdict(product, userPreferences)` mantiene su firma y comportamiento actuales — Task 2 y 3 consumen `computeVerdictReasons`.

- [ ] **Step 1: Escribir los tests que fallan (fix de acentos)**

Agregar a `tests/app.test.js`, en el `describe('computeVerdict — con userPreferences', ...)` existente (después de la línea 604, antes del `})` de cierre en línea 605):

```javascript
  it('detecta alergia a lácteos aunque el code de preferencias no tenga acento ("lacteos" vs "lácteos")', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Lácteos'] }
    const prefs = { allergens: [{ code: 'lacteos', severity: 'severe' }], dietary: [], healthConditions: [] }
    expect(computeVerdict(product, prefs)).toBe('evitar')
  })
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/app.test.js -t "lacteos"`
Expected: FAIL — hoy `computeVerdict` regresa `'sano'` porque `isAllergenDetected('lacteos')` nunca encuentra el alérgeno.

- [ ] **Step 3: Escribir los tests de `computeVerdictReasons` (aún no existe la función — fallan por diseño)**

Agregar a `tests/app.test.js`, después del bloque `describe('computeVerdict — con userPreferences', ...)` (después de la línea 605):

```javascript
// ─── computeVerdictReasons (filas de diagnóstico personalizado) ───

describe('computeVerdictReasons', () => {
  it('regresa array vacío si userPreferences es null/undefined', () => {
    const product = { sellos: [], notRecommended: [] }
    expect(computeVerdictReasons(product, null)).toEqual([])
    expect(computeVerdictReasons(product)).toEqual([])
  })

  it('regresa array vacío si el usuario no configuró ninguna restricción', () => {
    const product = { sellos: [], notRecommended: [] }
    const prefs = { allergens: [], dietary: [], healthConditions: [] }
    expect(computeVerdictReasons(product, prefs)).toEqual([])
  })

  it('alérgeno grave detectado: ok:false, severity:"grave"', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Cacahuate'] }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'severe' }], dietary: [], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ ok: false, severity: 'grave', title: 'Contiene Cacahuate' })
    expect(reasons[0].detail).toMatch(/alergia grave a cacahuate/i)
  })

  it('alérgeno leve NO detectado: ok:true, severity:"leve"', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Huevo'] }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'mild' }], dietary: [], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ ok: true, severity: 'leve', title: 'Sin Cacahuate', detail: 'No detectamos tu alergia' })
  })

  it('dieta violada: ok:false, title "No es {label}"', () => {
    const product = { sellos: [], notRecommended: [], dietary: { vegan: false } }
    const prefs = { allergens: [], dietary: ['vegan'], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ ok: false, severity: null, title: 'No es Vegano', detail: 'El producto no cumple esta preferencia' })
  })

  it('dieta cumplida: ok:true, title "Es {label}"', () => {
    const product = { sellos: [], notRecommended: [], dietary: { glutenFree: true } }
    const prefs = { allergens: [], dietary: ['glutenFree'], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ ok: true, title: 'Es Sin gluten', detail: 'Cumple esta preferencia' })
  })

  it('dieta sin dato (undefined): ok:null, título "Sin datos: {label}"', () => {
    const product = { sellos: [], notRecommended: [], dietary: {} }
    const prefs = { allergens: [], dietary: ['keto'], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ ok: null, title: 'Sin datos: Keto' })
  })

  it('dieta con dato null se trata igual que undefined: ok:null', () => {
    const product = { sellos: [], notRecommended: [], dietary: { vegan: null } }
    const prefs = { allergens: [], dietary: ['vegan'], healthConditions: [] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons[0].ok).toBe(null)
  })

  it('condición de salud con match certain:true: ok:false, detail = razon del producto', () => {
    const product = { sellos: [], notRecommended: [{ grupo: 'Diabéticos', razon: 'Alto en azúcares', certain: true }] }
    const prefs = { allergens: [], dietary: [], healthConditions: ['diabet'] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ ok: false, title: 'Diabetes', detail: 'Alto en azúcares' })
  })

  it('condición de salud sin match: ok:true', () => {
    const product = { sellos: [], notRecommended: [] }
    const prefs = { allergens: [], dietary: [], healthConditions: ['celiac'] }
    const reasons = computeVerdictReasons(product, prefs)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ ok: true, title: 'Celiaquía', detail: 'No encontramos alertas para esta condición' })
  })

  it('orden: alérgeno grave conflicto, salud conflicto, dieta conflicto, alérgeno leve conflicto, luego ok:true, luego ok:null', () => {
    const product = {
      sellos: [], allergens: ['Cacahuate', 'Lácteos'],
      notRecommended: [{ grupo: 'Diabéticos', razon: 'Alto en azúcares', certain: true }],
      dietary: { vegan: false, organic: true }
    }
    const prefs = {
      allergens: [
        { code: 'lacteos', severity: 'mild' },   // leve, conflicto
        { code: 'cacahuate', severity: 'severe' } // grave, conflicto
      ],
      dietary: ['vegan', 'organic', 'keto'], // vegan conflicto, organic ok, keto sin dato
      healthConditions: ['diabet'] // conflicto
    }
    const reasons = computeVerdictReasons(product, prefs)
    const titles = reasons.map(r => r.title)
    expect(titles).toEqual([
      'Contiene Cacahuate',   // alérgeno grave conflicto
      'Diabetes',             // salud conflicto
      'No es Vegano',         // dieta conflicto
      'Contiene Lácteos',     // alérgeno leve conflicto
      'Es Orgánico',          // ok:true
      'Sin datos: Keto'       // ok:null
    ])
  })
})
```

- [ ] **Step 4: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/app.test.js -t "computeVerdictReasons"`
Expected: FAIL — `computeVerdictReasons is not a function` (aún no existe).

- [ ] **Step 5: Implementación**

En `app.js`, reemplazar `isAllergenDetected` (líneas 1651-1661) por la versión con normalización de acentos:

```javascript
// Normaliza acentos igual que grupoClaveVerdict — el code de preferencias
// ("lacteos") no lleva acento pero COMMON_ALLERGENS sí ("lácteos"), y sin
// esto la alergia a lácteos (la más común) nunca se detectaba.
function normalizeAccents(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function isAllergenDetected(product, code) {
  if (!product.allergens || !Array.isArray(product.allergens)) return false;
  const codeNorm = normalizeAccents(code);
  const entry = COMMON_ALLERGENS.find(ca =>
    ca.match.some(m => normalizeAccents(m) === codeNorm) || normalizeAccents(ca.label) === codeNorm
  );
  const namesToMatch = entry
    ? [normalizeAccents(entry.label), ...entry.match.map(normalizeAccents)]
    : [codeNorm];
  return product.allergens.some(a => namesToMatch.includes(normalizeAccents(a)));
}
```

Luego, justo antes de `computeVerdict` (línea 1685), agregar los mapas de labels y `computeVerdictReasons`:

```javascript
const DIETARY_LABELS = {
  vegan: 'Vegano', vegetarian: 'Vegetariano', keto: 'Keto', glutenFree: 'Sin gluten',
  caseinFree: 'Sin caseína', organic: 'Orgánico', kosher: 'Kosher', halal: 'Halal',
  nonGmo: 'Sin OGM', noAdditives: 'Sin aditivos', palmOilFree: 'Sin palma', fairTrade: 'C. justo'
};

const HEALTH_LABELS = { diabet: 'Diabetes', celiac: 'Celiaquía', hipert: 'Hipertensión', ninos: 'Niños en casa' };

function allergenLabel(code) {
  const codeNorm = normalizeAccents(code);
  const entry = COMMON_ALLERGENS.find(ca =>
    ca.match.some(m => normalizeAccents(m) === codeNorm) || normalizeAccents(ca.label) === codeNorm
  );
  return entry ? entry.label : code;
}

function allergenEmoji(code) {
  const codeNorm = normalizeAccents(code);
  const entry = COMMON_ALLERGENS.find(ca =>
    ca.match.some(m => normalizeAccents(m) === codeNorm) || normalizeAccents(ca.label) === codeNorm
  );
  return entry ? entry.emoji : '🍽️';
}

// Filas de diagnóstico personalizado: una por cada restricción configurada
// por el usuario, con el estado ok/conflicto/sin-dato y el texto para
// mostrar en la UI. computeVerdict deriva el veredicto de esta misma lista
// (una sola fuente de verdad para el matching perfil-vs-producto).
function computeVerdictReasons(product, userPreferences) {
  if (!userPreferences) return [];

  const allergens = userPreferences.allergens || [];
  const dietary = userPreferences.dietary || [];
  const healthConditions = userPreferences.healthConditions || [];

  const allergenRows = allergens.filter(Boolean).map(a => {
    const detected = isAllergenDetected(product, a.code);
    const label = allergenLabel(a.code);
    const severity = a.severity === 'severe' ? 'grave' : 'leve';
    return detected
      ? { ok: false, severity, icon: allergenEmoji(a.code), title: `Contiene ${label}`, detail: `Registraste alergia ${severity} a ${label}` }
      : { ok: true, severity, icon: allergenEmoji(a.code), title: `Sin ${label}`, detail: 'No detectamos tu alergia' };
  });

  const dietaryRows = dietary.map(key => {
    const label = DIETARY_LABELS[key] || key;
    const value = product.dietary ? product.dietary[key] : undefined;
    if (value === false) return { ok: false, severity: null, icon: '🍽️', title: `No es ${label}`, detail: 'El producto no cumple esta preferencia' };
    if (value === true) return { ok: true, severity: null, icon: '🍽️', title: `Es ${label}`, detail: 'Cumple esta preferencia' };
    return { ok: null, severity: null, icon: '🍽️', title: `Sin datos: ${label}`, detail: 'No tenemos información sobre esta preferencia para este producto' };
  });

  const healthRows = healthConditions.map(cond => {
    const label = HEALTH_LABELS[cond] || cond;
    const match = (product.notRecommended || []).find(n => n.certain === true && grupoClaveVerdict(n.grupo) === cond);
    return match
      ? { ok: false, severity: null, icon: '⚕️', title: label, detail: String(match.razon || '').slice(0, 140) }
      : { ok: true, severity: null, icon: '⚕️', title: label, detail: 'No encontramos alertas para esta condición' };
  });

  const isConflict = r => r.ok === false;
  const severeAllergenConflict = allergenRows.filter(r => isConflict(r) && r.severity === 'grave');
  const healthConflict = healthRows.filter(isConflict);
  const dietConflict = dietaryRows.filter(isConflict);
  const mildAllergenConflict = allergenRows.filter(r => isConflict(r) && r.severity === 'leve');
  const okRows = [...allergenRows, ...dietaryRows, ...healthRows].filter(r => r.ok === true);
  const unknownRows = dietaryRows.filter(r => r.ok === null);

  return [...severeAllergenConflict, ...healthConflict, ...dietConflict, ...mildAllergenConflict, ...okRows, ...unknownRows];
}
```

Reemplazar `computeVerdict` (líneas 1685-1708 antes del refactor) por:

```javascript
function computeVerdict(product, userPreferences) {
  const base = computeBaseVerdict(product);
  if (!userPreferences) return base;

  const reasons = computeVerdictReasons(product, userPreferences);
  const isConflict = r => r.ok === false;

  if (reasons.some(r => isConflict(r) && r.severity === 'grave')) return 'evitar';
  if (reasons.some(r => isConflict(r) && r.icon === '⚕️')) return 'evitar';
  if (reasons.some(r => isConflict(r) && r.icon === '🍽️')) return 'evitar';
  if (base === 'sano' && reasons.some(r => isConflict(r) && r.severity === 'leve')) return 'regular';

  return base;
}
```

Nota: distinguir salud vs dieta por `icon` (`'⚕️'` vs `'🍽️'`) es frágil si el icon cambia — pero mantiene `computeVerdict` sin necesitar un campo `type` adicional en la fila, que no lo pide ningún consumidor de UI. Si al implementar se siente forzado, es válido agregar `type: 'allergen'|'dietary'|'health'` a cada fila en vez de inferir por icon — ajustar ambas funciones consistentemente.

- [ ] **Step 6: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/app.test.js`
Expected: PASS — toda la suite de `app.test.js`, incluyendo los tests de `computeVerdict` ya existentes (líneas 504-605) sin modificarlos, más los nuevos de `computeVerdictReasons` y el de acentos.

- [ ] **Step 7: Exportar `computeVerdictReasons` para tests**

En `tests/app.test.js`, agregar `computeVerdictReasons` a la lista de `let` (línea 13) y al string de la `Function` (línea 16) y a la asignación (después de línea 24):

```javascript
let parseApiProduct, isGlutenRelated, extractDietaryFromLabels, eanChecksum, expandUpcE, validateBarcode, computeVerdict, computeVerdictReasons, hasNoRealData, getUserPreferencesForVerdict, renderPersonalizedDisclaimer, logScanToCloudHistory, incrementScanCounter, buildCameraConstraints, processOcrImage
```

(mismo patrón en la `new Function(...)` y `computeVerdictReasons = exports.computeVerdictReasons`).

- [ ] **Step 8: Correr toda la suite una vez más**

Run: `npx vitest run tests/app.test.js`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add app.js tests/app.test.js
git commit -m "feat(verdict): agrega computeVerdictReasons, fix acento lacteos, refactor computeVerdict"
```

---

### Task 2: `renderPersonalizedReasons` — render de la tarjeta

**Files:**
- Modify: `scan.html` (después de línea 226, el `<p id="verdict-disclaimer">`)
- Modify: `app.js` (agrega `renderPersonalizedReasons`, después de `renderPersonalizedDisclaimer`)
- Modify: `styles.css` (nuevas clases `.reason-*`)
- Test: `tests/app.test.js`

**Interfaces:**
- Consumes: `computeVerdictReasons(product, userPreferences)` de Task 1 — mismo shape `{ok, severity, icon, title, detail}`.
- Produces: `renderPersonalizedReasons(product, userPreferences)` — función sin retorno, pinta/oculta `#verdict-reasons` en el DOM. Task 3 la llama desde `renderProductData`.

- [ ] **Step 1: Agregar el HTML en `scan.html`**

Insertar después de la línea 226 (`<p id="verdict-disclaimer">...</p>`):

```html
<div id="verdict-reasons" class="reason-card hidden" role="status">
  <h3 id="verdict-reasons-title"></h3>
  <ul id="verdict-reasons-list"></ul>
</div>
```

- [ ] **Step 2: Agregar el CSS en `styles.css`**

Agregar al final del archivo (o junto a las reglas de `.verdict-banner`/`.verdict-sano` alrededor de la línea 867):

```css
.reason-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; margin: 0 0 12px; }
.reason-card.hidden { display: none; }
.reason-card h3 { font-size: 14px; margin: 0 0 10px; color: #374151; }
#verdict-reasons-list { list-style: none; margin: 0; padding: 0; max-height: 340px; overflow-y: auto; }
.reason-row { display: flex; gap: 8px; align-items: flex-start; padding: 9px 6px; border-left: 3px solid transparent; }
.reason-row + .reason-row { border-top: 1px solid rgba(0,0,0,0.06); }
.reason-row--warn { border-left-color: #ac1e1e; }
.reason-row--ok { border-left-color: #107535; }
.reason-row--unknown { border-left-color: #9ca3af; }
.reason-row .reason-icon { font-size: 20px; flex-shrink: 0; width: 24px; text-align: center; }
.reason-row .reason-state { font-size: 13px; flex-shrink: 0; margin-top: 2px; }
.reason-row .reason-text { flex: 1; min-width: 0; }
.reason-row .reason-text strong { display: block; font-size: 14px; color: #1f2937; }
.reason-row .reason-text span { font-size: 12.5px; color: #5b6472; }
.reason-severity { flex-shrink: 0; align-self: center; font-size: 0.65rem; font-weight: 700; padding: 1px 6px; border-radius: 8px; background: rgba(220,38,38,0.15); color: #ac1e1e; text-transform: uppercase; }
```

- [ ] **Step 3: Escribir los tests que fallan**

Agregar a `tests/app.test.js`, después del `describe('renderPersonalizedDisclaimer', ...)` (después de línea 660, antes del cierre del describe en línea ~661 — revisar el archivo real para no romper un describe existente, insertar como bloque hermano nuevo):

```javascript
// ─── renderPersonalizedReasons (tarjeta de diagnóstico) ─────

describe('renderPersonalizedReasons', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="verdict-reasons" class="reason-card hidden" role="status">
        <h3 id="verdict-reasons-title"></h3>
        <ul id="verdict-reasons-list"></ul>
      </div>
    `
  })

  it('oculta la tarjeta si userPreferences es null', () => {
    renderPersonalizedReasons({ sellos: [], notRecommended: [] }, null)
    expect(document.getElementById('verdict-reasons').classList.contains('hidden')).toBe(true)
  })

  it('oculta la tarjeta si no hay ninguna restricción configurada', () => {
    const prefs = { allergens: [], dietary: [], healthConditions: [] }
    renderPersonalizedReasons({ sellos: [], notRecommended: [] }, prefs)
    expect(document.getElementById('verdict-reasons').classList.contains('hidden')).toBe(true)
  })

  it('muestra la tarjeta con título de conflicto cuando hay al menos un ok:false', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Cacahuate'] }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'severe' }], dietary: [], healthConditions: [] }
    renderPersonalizedReasons(product, prefs)
    const card = document.getElementById('verdict-reasons')
    expect(card.classList.contains('hidden')).toBe(false)
    expect(document.getElementById('verdict-reasons-title').textContent).toBe('Tu perfil vs. este producto')
  })

  it('muestra título positivo cuando todas las filas son ok:true', () => {
    const product = { sellos: [], notRecommended: [], dietary: { organic: true } }
    const prefs = { allergens: [], dietary: ['organic'], healthConditions: [] }
    renderPersonalizedReasons(product, prefs)
    expect(document.getElementById('verdict-reasons-title').textContent).toBe('Cumple con tu perfil')
  })

  it('renderiza una fila <li> por cada reason, con clase de estado y severidad visible cuando aplica', () => {
    const product = { sellos: [], notRecommended: [], allergens: ['Cacahuate'] }
    const prefs = { allergens: [{ code: 'cacahuate', severity: 'severe' }], dietary: ['organic'], healthConditions: [] }
    renderPersonalizedReasons(product, prefs)
    const rows = document.querySelectorAll('#verdict-reasons-list li.reason-row')
    expect(rows.length).toBe(2)
    expect(rows[0].classList.contains('reason-row--warn')).toBe(true)
    expect(rows[0].querySelector('.reason-severity').textContent).toBe('grave')
    expect(rows[0].querySelector('.reason-text strong').textContent).toBe('Contiene Cacahuate')
    expect(rows[1].querySelector('.reason-severity')).toBeNull()
  })

  it('fila ok:null usa la clase --unknown y el ícono ❔', () => {
    const product = { sellos: [], notRecommended: [], dietary: {} }
    const prefs = { allergens: [], dietary: ['keto'], healthConditions: [] }
    renderPersonalizedReasons(product, prefs)
    const row = document.querySelector('#verdict-reasons-list li.reason-row')
    expect(row.classList.contains('reason-row--unknown')).toBe(true)
    expect(row.querySelector('.reason-state').textContent).toBe('❔')
  })
})
```

- [ ] **Step 4: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/app.test.js -t "renderPersonalizedReasons"`
Expected: FAIL — `renderPersonalizedReasons is not a function`.

- [ ] **Step 5: Implementación**

En `app.js`, agregar después de `renderPersonalizedDisclaimer` (justo después de su cierre, antes de `logScanToCloudHistory`):

```javascript
function escReasons(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function reasonStateGlyph(ok) {
  if (ok === true) return '✅';
  if (ok === false) return '❌';
  return '❔';
}

function reasonRowClass(ok) {
  if (ok === true) return 'reason-row--ok';
  if (ok === false) return 'reason-row--warn';
  return 'reason-row--unknown';
}

// Pinta/oculta la tarjeta de diagnóstico personalizado bajo el banner de
// veredicto. userPreferences null (sin personalización activa) u
// computeVerdictReasons vacío (usuario premium sin restricciones
// configuradas) ocultan la tarjeta sin removerla del DOM — así su layout
// ya está estable antes de que corra la animación verdict-reveal del
// banner (evita un salto de layout simultáneo).
function renderPersonalizedReasons(product, userPreferences) {
  const card = document.getElementById('verdict-reasons');
  if (!card) return;
  const reasons = computeVerdictReasons(product, userPreferences);
  if (!reasons.length) {
    card.classList.add('hidden');
    return;
  }

  const hasConflict = reasons.some(r => r.ok === false);
  const titleEl = document.getElementById('verdict-reasons-title');
  if (titleEl) titleEl.textContent = hasConflict ? 'Tu perfil vs. este producto' : 'Cumple con tu perfil';

  const list = document.getElementById('verdict-reasons-list');
  if (list) {
    list.innerHTML = reasons.map(r => `
      <li class="reason-row ${reasonRowClass(r.ok)}">
        <span class="reason-icon">${escReasons(r.icon)}</span>
        <span class="reason-state" aria-hidden="true">${reasonStateGlyph(r.ok)}</span>
        <span class="reason-text"><strong>${escReasons(r.title)}</strong><span>${escReasons(r.detail)}</span></span>
        ${r.severity === 'grave' ? '<span class="reason-severity">grave</span>' : ''}
      </li>
    `).join('');
  }

  card.classList.remove('hidden');
}
```

- [ ] **Step 6: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/app.test.js`
Expected: PASS

- [ ] **Step 7: Exportar `renderPersonalizedReasons` para tests**

Mismo patrón que Task 1 Step 7 — agregar `renderPersonalizedReasons` a la lista de `let`, al string de `new Function(...)`, y a la asignación en `tests/app.test.js`.

- [ ] **Step 8: Correr toda la suite**

Run: `npx vitest run tests/app.test.js`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add scan.html app.js styles.css tests/app.test.js
git commit -m "feat(verdict): agrega tarjeta renderPersonalizedReasons"
```

---

### Task 3: Cablear `renderPersonalizedReasons` en `renderProductData`

**Files:**
- Modify: `app.js:1833-1838` (dentro de `renderProductData`, justo después de que se calcula `verdict`)

**Interfaces:**
- Consumes: `renderPersonalizedReasons(product, userPreferences)` de Task 2, `userPreferences` y `verdict` ya calculados en ese punto de `renderProductData`.
- Produces: nada — es el punto de integración final, no lo consume nadie más.

- [ ] **Step 1: Agregar la llamada**

En `app.js`, en `renderProductData`, justo después de la línea `renderPersonalizedDisclaimer(userPreferences);` (línea 1837) y antes de `logScanToCloudHistory(...)` (línea 1838):

```javascript
  const userPreferences = getUserPreferencesForVerdict();
  const verdict = computeVerdict(product, userPreferences);
  renderPersonalizedDisclaimer(userPreferences);
  renderPersonalizedReasons(product, userPreferences);
  logScanToCloudHistory(barcode, product.name, verdict, product.image);
```

- [ ] **Step 2: Correr toda la suite de tests para confirmar que nada se rompió**

Run: `npx vitest run`
Expected: PASS (mismos resultados que el baseline previo a este plan — sin nuevos fallos; los 4 fallos preexistentes de `tests/ocrQuota.test.js` son ajenos y no cambian).

- [ ] **Step 3: Verificación manual en navegador**

Esta es la única pieza no cubierta por tests unitarios (`renderProductData` no está exportada ni testeada directamente, mismo patrón que el resto de esa función). Levantar el server local y probar en navegador real:

```bash
node api/index.js
```

Con un usuario premium logueado con preferencias configuradas (al menos un alérgeno grave o leve, una dieta, una condición de salud), escanear un producto que:
1. Contenga el alérgeno grave → confirmar veredicto "evítalo", banner rojo, tarjeta de razones visible con la fila del alérgeno grave primero y el badge "grave".
2. No tenga conflictos → confirmar veredicto "sano", tarjeta de razones con título "Cumple con tu perfil", todas las filas con borde verde.
3. Producto sin campo `dietary` para alguna preferencia configurada → confirmar fila "Sin datos: {label}" con borde gris y glifo ❔.

Confirmar visualmente: la tarjeta no empuja el resto de la pantalla fuera de vista con 6+ filas (scroll interno funciona), y no compite visualmente con la tarjeta roja existente de `#card-not-recommended` (si el producto tiene notRecommended).

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat(verdict): cablea renderPersonalizedReasons en renderProductData"
```

---

## Self-Review Notes

- **Cobertura del spec:** Sección 1 (computeVerdictReasons) → Task 1. Sección 2 (refactor computeVerdict) → Task 1. Sección 3 (fix acentos) → Task 1. Sección 4 (HTML/wiring) → Task 2 + Task 3. Sección 5 (CSS) → Task 2. Fuera de alcance del spec no requiere tareas.
- **Sin placeholders:** todos los steps tienen código completo y ejecutable.
- **Consistencia de tipos:** `computeVerdictReasons` regresa el mismo shape `{ok, severity, icon, title, detail}` en Task 1, consumido sin transformación por `renderPersonalizedReasons` en Task 2. `renderPersonalizedReasons(product, userPreferences)` en Task 2 coincide exactamente con la llamada en Task 3.
- **Riesgo señalado explícitamente:** la inferencia de "tipo de fila" por `icon` (`'⚕️'`/`'🍽️'`) en el `computeVerdict` refactorizado (Task 1) es un poco frágil — el plan deja la alternativa (`type` explícito) documentada como ajuste válido si al implementar se siente forzado, sin bloquear el resto del plan por esa decisión menor.
