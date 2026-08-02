import { getIdToken } from './authClient.js';

const PENDING_PREFS_KEY = 'yomi_pending_preferences';

const ALLERGEN_LABELS = {
  cacahuate: 'cacahuate', lacteos: 'lácteos', nueces: 'nueces', trigo: 'trigo',
  huevo: 'huevo', pescado: 'pescado', mariscos: 'mariscos', soja: 'soja'
};
function allergenLabel(code) { return ALLERGEN_LABELS[code] || code; }

const DIETARY_LABELS = {
  vegan: 'vegano', vegetarian: 'vegetariano', keto: 'keto', glutenFree: 'sin gluten',
  caseinFree: 'sin caseína', organic: 'orgánico', kosher: 'kosher', halal: 'halal',
  nonGmo: 'sin OGM', noAdditives: 'sin aditivos', palmOilFree: 'sin palma', fairTrade: 'comercio justo'
};
function dietaryLabel(key) { return DIETARY_LABELS[key] || key; }

// Personaliza el heading de la pantalla de membresía usando el payload de
// preferencias que el usuario acaba de llenar (guardado por
// continueOnboardingPreferences en preferences-ui.js, vía sessionStorage —
// no hay lectura de backend acá). Prioridad: alergia grave > cualquier
// alergia > condición de salud > dieta — misma jerarquía de severidad que
// computeVerdictReasons en app.js. Sin payload (o los 3 arrays vacíos) →
// null, la pantalla se queda con el copy genérico actual.
function pickHeadline() {
  let payload = null;
  try {
    payload = JSON.parse(sessionStorage.getItem(PENDING_PREFS_KEY) || 'null');
  } catch (_) {
    payload = null;
  }
  if (!payload) return null;

  const severeAllergen = (payload.allergens || []).find(a => a.severity === 'severe');
  if (severeAllergen) {
    return {
      title: `No más sustos con ${allergenLabel(severeAllergen.code)}`,
      sub: 'Premium te avisa automáticamente cuando un producto lo contiene.'
    };
  }
  const anyAllergen = (payload.allergens || [])[0];
  if (anyAllergen) {
    return {
      title: `Cuidado con ${allergenLabel(anyAllergen.code)}, sin adivinar`,
      sub: 'Premium revisa cada producto contra tu alergia automáticamente.'
    };
  }
  const healthCondition = (payload.healthConditions || [])[0];
  if (healthCondition) {
    return {
      title: 'Cuida tu salud sin adivinar',
      sub: 'Cada escaneo revisa el producto contra tu perfil de salud.'
    };
  }
  const dietary = (payload.dietary || [])[0];
  if (dietary) {
    return {
      title: `Come ${dietaryLabel(dietary)} sin leer etiquetas`,
      sub: 'Premium filtra automáticamente lo que no encaja con tu dieta.'
    };
  }
  return null;
}

// Aplica el heading personalizado (si hay uno) al título/subtítulo y al
// texto del botón primario. Usa innerHTML (no textContent) en el botón para
// no perder el <img class="btn-icon"> de Stripe que ya vive adentro.
function applyPersonalizedHeadline() {
  const headline = pickHeadline();
  if (!headline) return;

  const titleEl = document.querySelector('.heading-title');
  if (titleEl) titleEl.textContent = headline.title;

  const subEl = document.querySelector('.heading-sub');
  if (subEl) subEl.textContent = headline.sub;

  const btn = document.getElementById('btn-confirm-payment');
  if (btn) {
    const icon = btn.querySelector('.btn-icon');
    btn.innerHTML = '';
    if (icon) btn.appendChild(icon);
    btn.appendChild(document.createTextNode('Sí, quiero Premium — $29.90/mes'));
  }
}

function showError(message) {
  const el = document.getElementById('membership-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

export async function confirmMembershipPayment() {
  const checkbox = document.getElementById('pay-checkbox');
  if (!checkbox?.checked) {
    showError('Marca la casilla para continuar.');
    throw new Error('pay_checkbox_required');
  }

  const btn = document.getElementById('btn-confirm-payment');
  const originalBtnHtml = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Procesando…'; }
  try {
    const token = await getIdToken();
    const res = await fetch('/api/me/membership/pay', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      showError('No se pudo iniciar el pago. Intenta de nuevo.');
      throw new Error('pay_failed');
    }
    const data = await res.json();
    window.location.href = data.checkoutUrl;
  } catch (err) {
    if (btn) { btn.disabled = false; btn.innerHTML = originalBtnHtml; }
    throw err;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  applyPersonalizedHeadline();
  document.getElementById('btn-confirm-payment')?.addEventListener('click', () => {
    confirmMembershipPayment().catch(() => {});
  });
  document.getElementById('btn-skip-membership')?.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
});
