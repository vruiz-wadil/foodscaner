# Resumen visual del perfil alimenticio en Mi cuenta — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el texto crudo "Tu perfil: organic, lacteos, celiac..." en Mi cuenta por un resumen visual traducido (conteos por categoría, expandible a chips con emoji + etiqueta en español).

**Architecture:** Nuevo módulo `preference-labels.js` (código→{emoji,label}, sin DOM, sin dependencias) consumido por `account-ui.js`, que reemplaza el párrafo de resumen actual por una línea de conteos colapsada + un toggle que expande chips agrupados por categoría (mismo patrón ya usado en el archivo: variable de módulo + `renderAccountHub()` completo en cada cambio de estado).

**Tech Stack:** vanilla JS (ES modules), vitest, CSS en `home.css` (donde ya viven `.row-card`/`.stat-tile`, los estilos reales de la página Mi cuenta).

## Global Constraints

- Códigos sin match en los mapas de labels se muestran tal cual (label = código crudo, sin emoji) — nunca rompe el render.
- Categorías con 0 items no aparecen ni en la línea colapsada ni en la vista expandida.
- Sin persistencia entre cargas de página — el toggle siempre arranca colapsado (variable de módulo, se resetea con cada import/carga de página).
- Colores de severidad de alergia reusan las variables CSS ya existentes en `styles.css`: `--chile`/`--chile-light`/`--chile-border` (severo), `--amber-light`/`--amber-border` (aviso) — no se inventan colores nuevos.
- `preference-labels.js` no importa nada de `account-ui.js` ni de ningún módulo con DOM — es lógica pura, testeable sin jsdom.

---

### Task 1: `preference-labels.js` — mapas de traducción + `buildPreferenceSummary`

**Files:**
- Create: `preference-labels.js` (raíz del proyecto, junto a `country-codes.js`/`toast.js`)
- Test: `tests/preference-labels.test.js` (nuevo)

**Interfaces:**
- Consumes: nada (módulo puro, sin dependencias).
- Produces: `buildPreferenceSummary(prefs: {dietary?: string[], allergens?: {code:string, severity:string}[], healthConditions?: string[]} | null): {counts: {emoji:string, text:string}[], chips: {category:'dietary'|'allergens'|'health', emoji:string, label:string, extra:string|null, severity:string|null}[]}`. Exportado desde `preference-labels.js`.

- [ ] **Step 1: Escribir el test que falla**

Crea `tests/preference-labels.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { buildPreferenceSummary } from '../preference-labels.js'

describe('buildPreferenceSummary', () => {
  it('devuelve counts y chips vacíos cuando prefs es null', () => {
    expect(buildPreferenceSummary(null)).toEqual({ counts: [], chips: [] })
  })

  it('devuelve counts y chips vacíos cuando prefs no tiene ninguna categoría', () => {
    expect(buildPreferenceSummary({ dietary: [], allergens: [], healthConditions: [] })).toEqual({ counts: [], chips: [] })
  })

  it('cuenta en singular cuando hay exactamente 1 item por categoría', () => {
    const result = buildPreferenceSummary({
      dietary: ['vegan'],
      allergens: [{ code: 'cacahuate', severity: 'severe' }],
      healthConditions: ['celiac']
    })
    expect(result.counts).toEqual([
      { emoji: '🌱', text: '1 dietético' },
      { emoji: '⚠️', text: '1 alergia' },
      { emoji: '❤️', text: '1 condición' }
    ])
  })

  it('cuenta en plural cuando hay más de 1 item por categoría', () => {
    const result = buildPreferenceSummary({
      dietary: ['vegan', 'keto'],
      allergens: [{ code: 'cacahuate', severity: 'mild' }, { code: 'soja', severity: 'severe' }],
      healthConditions: ['celiac', 'diabet']
    })
    expect(result.counts).toEqual([
      { emoji: '🌱', text: '2 dietéticos' },
      { emoji: '⚠️', text: '2 alergias' },
      { emoji: '❤️', text: '2 condiciones' }
    ])
  })

  it('omite categorías con 0 items de counts', () => {
    const result = buildPreferenceSummary({ dietary: ['vegan'], allergens: [], healthConditions: [] })
    expect(result.counts).toEqual([{ emoji: '🌱', text: '1 dietético' }])
  })

  it('arma chips con emoji, label y (para alergias) severidad traducida', () => {
    const result = buildPreferenceSummary({
      dietary: ['organic'],
      allergens: [{ code: 'lacteos', severity: 'severe' }],
      healthConditions: ['celiac']
    })
    expect(result.chips).toEqual([
      { category: 'dietary', emoji: '🌿', label: 'Orgánico', extra: null, severity: null },
      { category: 'allergens', emoji: '🥛', label: 'Lácteos', extra: 'Estricto', severity: 'severe' },
      { category: 'health', emoji: '🌾', label: 'Celiaquía', extra: null, severity: null }
    ])
  })

  it('código sin match en el mapa se muestra tal cual, sin emoji, sin romper', () => {
    const result = buildPreferenceSummary({ dietary: ['codigo_inventado'], allergens: [], healthConditions: [] })
    expect(result.chips).toEqual([
      { category: 'dietary', emoji: '', label: 'codigo_inventado', extra: null, severity: null }
    ])
    expect(result.counts).toEqual([{ emoji: '🌱', text: '1 dietético' }])
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/preference-labels.test.js`
Expected: FAIL — no se puede resolver `../preference-labels.js`

- [ ] **Step 3: Implementar `preference-labels.js`**

Crea `preference-labels.js` en la raíz del proyecto:

```js
// Traducción código→{emoji,label} para dietético/salud/alérgenos. Códigos
// idénticos a los data-dietary/data-health/data-allergen de preferences.html —
// única fuente de verdad para mostrar estos códigos fuera de esa página.

export const DIETARY_LABELS = {
  vegan: { emoji: '🌱', label: 'Vegano' },
  vegetarian: { emoji: '🥦', label: 'Vegetariano' },
  keto: { emoji: '🥑', label: 'Keto' },
  glutenFree: { emoji: '🌾', label: 'Sin gluten' },
  caseinFree: { emoji: '🥛', label: 'Sin caseína' },
  organic: { emoji: '🌿', label: 'Orgánico' },
  kosher: { emoji: '🏷️', label: 'Kosher' },
  halal: { emoji: '📛', label: 'Halal' },
  nonGmo: { emoji: '🧬', label: 'Sin OGM' },
  noAdditives: { emoji: '🧪', label: 'Sin aditivos' },
  palmOilFree: { emoji: '🌴', label: 'Sin palma' },
  fairTrade: { emoji: '🤝', label: 'C. justo' }
};

export const HEALTH_LABELS = {
  diabet: { emoji: '🩸', label: 'Diabetes' },
  celiac: { emoji: '🌾', label: 'Celiaquía' },
  hipert: { emoji: '❤️', label: 'Hipertensión' },
  ninos: { emoji: '👶', label: 'Niños en casa' }
};

export const ALLERGEN_LABELS = {
  cacahuate: { emoji: '🥜', label: 'Cacahuate' },
  lacteos: { emoji: '🥛', label: 'Lácteos' },
  nueces: { emoji: '🌰', label: 'Nueces' },
  trigo: { emoji: '🌾', label: 'Trigo' },
  huevo: { emoji: '🥚', label: 'Huevo' },
  pescado: { emoji: '🐟', label: 'Pescado' },
  mariscos: { emoji: '🦐', label: 'Mariscos' },
  soja: { emoji: '🫘', label: 'Soja' }
};

export const SEVERITY_LABELS = { mild: 'Aviso', severe: 'Estricto' };

const CATEGORY_META = {
  dietary:   { emoji: '🌱', singular: 'dietético', plural: 'dietéticos' },
  allergens: { emoji: '⚠️', singular: 'alergia', plural: 'alergias' },
  health:    { emoji: '❤️', singular: 'condición', plural: 'condiciones' }
};

function lookupOrFallback(map, code) {
  return map[code] || { emoji: '', label: code };
}

export function buildPreferenceSummary(prefs) {
  const dietary = (prefs && prefs.dietary) || [];
  const allergens = (prefs && prefs.allergens) || [];
  const health = (prefs && prefs.healthConditions) || [];

  const counts = [];
  const chips = [];

  if (dietary.length) {
    const meta = CATEGORY_META.dietary;
    counts.push({ emoji: meta.emoji, text: `${dietary.length} ${dietary.length === 1 ? meta.singular : meta.plural}` });
    dietary.forEach(code => {
      const { emoji, label } = lookupOrFallback(DIETARY_LABELS, code);
      chips.push({ category: 'dietary', emoji, label, extra: null, severity: null });
    });
  }

  if (allergens.length) {
    const meta = CATEGORY_META.allergens;
    counts.push({ emoji: meta.emoji, text: `${allergens.length} ${allergens.length === 1 ? meta.singular : meta.plural}` });
    allergens.forEach(({ code, severity }) => {
      const { emoji, label } = lookupOrFallback(ALLERGEN_LABELS, code);
      chips.push({ category: 'allergens', emoji, label, extra: SEVERITY_LABELS[severity] || null, severity: severity || null });
    });
  }

  if (health.length) {
    const meta = CATEGORY_META.health;
    counts.push({ emoji: meta.emoji, text: `${health.length} ${health.length === 1 ? meta.singular : meta.plural}` });
    health.forEach(code => {
      const { emoji, label } = lookupOrFallback(HEALTH_LABELS, code);
      chips.push({ category: 'health', emoji, label, extra: null, severity: null });
    });
  }

  return { counts, chips };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run tests/preference-labels.test.js`
Expected: PASS (7/7 tests)

- [ ] **Step 5: Commit**

```bash
git add preference-labels.js tests/preference-labels.test.js
git commit -m "feat(account): agrega preference-labels.js con traducción código→emoji/label"
```

---

### Task 2: Resumen colapsado/expandible en `account-ui.js`

**Files:**
- Modify: `account-ui.js` (import línea 5; variable de módulo ~línea 47; `summaryHtml` ~líneas 231-233; nuevas funciones de render; `wireAccountHubEvents` ~línea 284)
- Modify: `home.css` (nuevas reglas CSS después de `.stat-tile .stat-label`, ~línea 720)
- Test: `tests/account-ui.test.js` (modifica el test existente que ya no aplica; agrega 4 tests nuevos)

**Interfaces:**
- Consumes: `buildPreferenceSummary(prefs)` (Task 1, de `preference-labels.js`) — devuelve `{counts, chips}` con la forma exacta documentada en Task 1.

- [ ] **Step 1: Escribir/actualizar los tests que fallan**

En `tests/account-ui.test.js`, el test existente (línea 111-120) asume que el código crudo (`vegan`) aparece en el texto — eso ya no es cierto con el resumen traducido. Reemplázalo:

```js
  it('muestra el resumen del perfil dietético/alérgico y botón editar preferencias para membresía activa', () => {
    getCachedProfile.mockReturnValue({
      email: 'a@b.com', membershipStatus: 'active',
      preferences: { dietary: ['vegan'], allergens: [{ code: 'cacahuate', severity: 'severe' }], healthConditions: [] }
    })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.textContent).toMatch(/1 dietético/)
    expect(root.textContent).toMatch(/1 alergia/)
    expect(root.querySelector('a[href="preferences.html"]').textContent).toMatch(/[Ee]ditar preferencias/)
  })
```

Agrega estos 4 tests nuevos justo después (mismo `describe` que el test anterior):

```js
  it('el resumen de preferencias arranca colapsado, sin chips visibles', () => {
    getCachedProfile.mockReturnValue({
      email: 'a@b.com', membershipStatus: 'active',
      preferences: { dietary: ['vegan'], allergens: [], healthConditions: [] }
    })
    renderAccountHub()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.account-preference-chip')).toBeNull()
    expect(document.getElementById('btn-toggle-preference-summary').textContent).toMatch(/Ver todo/)
  })

  it('click en el toggle expande los chips agrupados por categoría', () => {
    getCachedProfile.mockReturnValue({
      email: 'a@b.com', membershipStatus: 'active',
      preferences: { dietary: ['organic'], allergens: [{ code: 'lacteos', severity: 'severe' }], healthConditions: [] }
    })
    renderAccountHub()
    document.getElementById('btn-toggle-preference-summary').click()
    const root = document.getElementById('account-root')
    const chips = Array.from(root.querySelectorAll('.account-preference-chip')).map(el => el.textContent)
    expect(chips.some(t => t.includes('Orgánico'))).toBe(true)
    expect(chips.some(t => t.includes('Lácteos') && t.includes('Estricto'))).toBe(true)
    expect(document.getElementById('btn-toggle-preference-summary').textContent).toMatch(/Ocultar/)
  })

  it('click en el toggle otra vez vuelve a colapsar', () => {
    getCachedProfile.mockReturnValue({
      email: 'a@b.com', membershipStatus: 'active',
      preferences: { dietary: ['vegan'], allergens: [], healthConditions: [] }
    })
    renderAccountHub()
    document.getElementById('btn-toggle-preference-summary').click()
    document.getElementById('btn-toggle-preference-summary').click()
    const root = document.getElementById('account-root')
    expect(root.querySelector('.account-preference-chip')).toBeNull()
  })

  it('el chip de una alergia con severidad "mild" usa la clase severity-mild, no severity-severe', () => {
    getCachedProfile.mockReturnValue({
      email: 'a@b.com', membershipStatus: 'active',
      preferences: { dietary: [], allergens: [{ code: 'soja', severity: 'mild' }], healthConditions: [] }
    })
    renderAccountHub()
    document.getElementById('btn-toggle-preference-summary').click()
    const chip = document.querySelector('.account-preference-chip')
    expect(chip.classList.contains('severity-mild')).toBe(true)
    expect(chip.classList.contains('severity-severe')).toBe(false)
  })
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/account-ui.test.js`
Expected: FAIL — `btn-toggle-preference-summary` no existe, `.account-preference-chip` no existe

- [ ] **Step 3: Implementar en `account-ui.js`**

Cambia la línea 5 (agrega el import nuevo después del de `toast.js`):

```js
import { showPendingToast } from './toast.js';
import { buildPreferenceSummary } from './preference-labels.js';
```

Cambia la línea 47 (agrega la variable de módulo junto a `editingRow`):

```js
let editingRow = null; // 'name' | 'phone' | 'email' | null
let preferenceSummaryExpanded = false;
```

Agrega estas 2 funciones nuevas en cualquier punto del archivo antes de `renderAccountHub` (por ejemplo, justo después de `renderEmailVerificationBanner`, ~línea 46):

```js
const CATEGORY_SECTION_LABEL = { dietary: 'Dietético', allergens: 'Alergias', health: 'Condiciones' };

function renderPreferenceChips(chips) {
  const byCategory = { dietary: [], allergens: [], health: [] };
  chips.forEach(chip => byCategory[chip.category].push(chip));
  return ['dietary', 'allergens', 'health']
    .filter(cat => byCategory[cat].length)
    .map(cat => `
      <div class="account-preference-group">
        <div class="account-preference-group-label">${CATEGORY_SECTION_LABEL[cat]}</div>
        <div class="account-preference-chips">
          ${byCategory[cat].map(chip => {
            const severityClass = chip.severity ? ` severity-${chip.severity}` : '';
            const text = chip.extra ? `${chip.label} · ${chip.extra}` : chip.label;
            return `<span class="account-preference-chip${severityClass}">${chip.emoji} ${escapeHtml(text)}</span>`;
          }).join('')}
        </div>
      </div>`).join('');
}

function renderPreferenceSummary({ counts, chips }) {
  const countsLine = counts.map(c => `${c.emoji} ${escapeHtml(c.text)}`).join(' · ');
  const toggleLabel = preferenceSummaryExpanded ? 'Ocultar ▲' : 'Ver todo ▾';
  const expandedHtml = preferenceSummaryExpanded ? renderPreferenceChips(chips) : '';
  return `
    <div class="account-preference-summary">
      <div class="account-preference-summary-line">
        <span>${countsLine}</span>
        <button type="button" id="btn-toggle-preference-summary" class="account-link-btn">${toggleLabel}</button>
      </div>
      ${expandedHtml}
    </div>`;
}
```

Cambia el bloque `summaryHtml` (dentro de `renderAccountHub`, ~línea 231-233) de:

```js
  const summaryHtml = hasPrefs
    ? `<p class="account-summary">Tu perfil: ${[...(prefs.dietary || []), ...(prefs.allergens || []).map(a => a.code), ...(prefs.healthConditions || [])].join(', ')}</p>`
    : '<p class="account-empty">Aún no configuraste tus preferencias.</p>';
```

a:

```js
  const summaryHtml = hasPrefs
    ? renderPreferenceSummary(buildPreferenceSummary(prefs))
    : '<p class="account-empty">Aún no configuraste tus preferencias.</p>';
```

En `wireAccountHubEvents` (~línea 284), agrega esta línea junto a los demás `getElementById(...).addEventListener('click', ...)`:

```js
  document.getElementById('btn-toggle-preference-summary')?.addEventListener('click', () => {
    preferenceSummaryExpanded = !preferenceSummaryExpanded;
    renderAccountHub();
  });
```

- [ ] **Step 4: Agregar CSS en `home.css`**

Agrega estas reglas después de `.stat-tile .stat-label { font-size: 10px; color: var(--ink-3); }` (~línea 720), antes del comentario sobre `preferences.html`:

```css
.account-preference-summary-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.account-preference-group { margin-top: 8px; }
.account-preference-group-label { font-size: 0.72rem; font-weight: 600; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 4px; }
.account-preference-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.account-preference-chip { display: inline-flex; align-items: center; gap: 4px; background: #f3f3f3; border-radius: 999px; padding: 4px 10px; font-size: 0.8rem; }
.account-preference-chip.severity-mild { background: var(--amber-light); color: #8a5a00; border: 1px solid var(--amber-border); }
.account-preference-chip.severity-severe { background: var(--chile-light); color: var(--chile); border: 1px solid var(--chile-border); }
```

- [ ] **Step 5: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/account-ui.test.js`
Expected: PASS (todos los tests del archivo, incluyendo los 4 nuevos y el actualizado)

- [ ] **Step 6: Commit**

```bash
git add account-ui.js home.css tests/account-ui.test.js
git commit -m "feat(account): reemplaza el resumen crudo de preferencias por chips visuales expandibles"
```

---

## Verificación final (tras las 2 tasks)

Correr la suite completa: `npx vitest run` — debe dar el mismo resultado base ya conocido en este repo (todos los tests de vitest en verde; el único archivo que falla es `tests/e2e/scan-cycle.spec.js`, un problema de configuración de Playwright preexistente y no relacionado). Verificar visualmente en el navegador: entrar a Mi cuenta con preferencias configuradas, confirmar que la línea colapsada se ve bien, expandir/colapsar funciona, y los chips de alergia muestran el color correcto según severidad.
