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
  soja: { emoji: '🫘', label: 'Soya' }
};

export const SEVERITY_LABELS = { mild: 'Aviso', severe: 'Estricto' };

const CATEGORY_META = {
  dietary:   { emoji: '🌱', singular: 'dietético', plural: 'dietéticos' },
  allergens: { emoji: '⚠️', singular: 'alergia', plural: 'alergias' },
  health:    { emoji: '❤️', singular: 'condición', plural: 'condiciones' }
};

function lookupOrFallback(map, code) {
  return Object.prototype.hasOwnProperty.call(map, code) ? map[code] : { emoji: '', label: code };
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
      const knownSeverity = Object.prototype.hasOwnProperty.call(SEVERITY_LABELS, severity);
      const extra = knownSeverity ? SEVERITY_LABELS[severity] : null;
      chips.push({ category: 'allergens', emoji, label, extra, severity: knownSeverity ? severity : null });
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
