// Compartir resultado de escaneo — script clásico (no ES module) a propósito:
// app.js (consumidor en scan.html) tampoco es un módulo, así que se expone vía
// window.shareResult, mismo patrón que app.js ya usa para exponerle
// window.getLocalHistory a history-ui.js (un ES module que sí puede leer
// globals de window sin problema).
const SHARE_VERDICT_LABELS = { sano: 'SANO', regular: 'REGULAR', evitar: 'EVITAR' };
const SHARE_URL = 'https://yomi.mx/?utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result';

function buildShareText(name, verdict) {
  return `${name}: ${SHARE_VERDICT_LABELS[verdict]} — descúbrelo tú con Yomi`;
}

async function copyShareFallback(text, triggerButton) {
  const full = `${text} ${SHARE_URL}`;
  try {
    await navigator.clipboard.writeText(full);
    if (triggerButton) {
      const original = triggerButton.textContent;
      triggerButton.textContent = 'Copiado';
      setTimeout(() => { triggerButton.textContent = original; }, 2000);
    }
  } catch (e) {
    console.warn('[share] clipboard fallback failed:', e.message);
  }
}

async function shareResult({ name, verdict }, triggerButton) {
  const text = buildShareText(name, verdict);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Yomi', text, url: SHARE_URL });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // usuario canceló el share sheet, no es error
      // cualquier otro fallo de navigator.share cae a clipboard
    }
  }
  await copyShareFallback(text, triggerButton);
}

window.buildShareText = buildShareText;
window.shareResult = shareResult;
