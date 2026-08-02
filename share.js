// Compartir resultado de escaneo — script clásico (no ES module) a propósito:
// app.js (consumidor en scan.html) tampoco es un módulo, así que se expone vía
// window.shareResult, mismo patrón que app.js ya usa para exponerle
// window.getLocalHistory a history-ui.js (un ES module que sí puede leer
// globals de window sin problema).
const SHARE_VERDICT_LABELS = { sano: 'SANO', regular: 'REGULAR', evitar: 'EVITAR' };
const SHARE_BASE_URL = 'https://yomi.mx';
const SHARE_UTM = 'utm_source=share&utm_medium=verdict_card&utm_campaign=scan_result';

const SHARE_TEXT_BY_VERDICT = {
  sano: name => `✅ ${name} está SANO según Yomi. Escanea el tuyo gratis.`,
  regular: name => `⚠️ ${name}: REGULAR. Yomi te dice por qué en 2 segundos.`,
  evitar: name => `🚫 ${name} salió EVITAR en Yomi. ¿El tuyo qué dirá?`
};

function buildShareText(name, verdict) {
  const build = SHARE_TEXT_BY_VERDICT[verdict];
  return build ? build(name) : `${name}: ${SHARE_VERDICT_LABELS[verdict] || verdict} — descúbrelo tú con Yomi`;
}

// Hallazgo UX: el link compartido apuntaba siempre al home (SHARE_URL fija),
// nunca al producto que la persona realmente vio — sin caso de uso real, el
// receptor del share nunca veía el resultado del que le hablaban. scan.html
// ya sabe leer ?barcode= y cargar ese producto solo (ver app.js), así que
// basta con apuntar ahí. Sin barcode (no debería pasar en producción, ningún
// caller actual lo omite) cae al home como antes, nunca revienta.
function buildShareUrl(barcode) {
  return barcode
    ? `${SHARE_BASE_URL}/scan.html?barcode=${encodeURIComponent(barcode)}&${SHARE_UTM}`
    : `${SHARE_BASE_URL}/?${SHARE_UTM}`;
}

async function copyShareFallback(text, url, triggerButton) {
  const full = `${text} ${url}`;
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

async function shareResult({ name, verdict, barcode }, triggerButton) {
  const text = buildShareText(name, verdict);
  const url = buildShareUrl(barcode);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Yomi', text, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // usuario canceló el share sheet, no es error
      // cualquier otro fallo de navigator.share cae a clipboard
    }
  }
  await copyShareFallback(text, url, triggerButton);
}

window.buildShareText = buildShareText;
window.shareResult = shareResult;

const INVITE_TEXT = 'Yo uso Yomi para saber en 2 segundos si un producto me conviene. Pruébalo tú:';
const INVITE_UTM = 'utm_source=share&utm_medium=invite_friend&utm_campaign=account_invite';

async function shareApp(triggerButton) {
  const url = `${SHARE_BASE_URL}/?${INVITE_UTM}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Yomi', text: INVITE_TEXT, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  await copyShareFallback(INVITE_TEXT, url, triggerButton);
}

window.shareApp = shareApp;
