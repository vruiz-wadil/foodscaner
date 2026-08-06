// Reemplaza los placeholders __FIREBASE_*__ de firebase-init.js con env vars
// reales en build time (Vercel). No falla el build si faltan — solo avisa y
// deja los placeholders, para no tumbar el resto del sitio por Auth.
const fs = require('fs');
const path = require('path');

const projectId = process.env.FIREBASE_PROJECT_ID;
const apiKey = process.env.FIREBASE_WEB_API_KEY;
const appId = process.env.FIREBASE_WEB_APP_ID;
const messagingSenderId = process.env.FIREBASE_WEB_MESSAGING_SENDER_ID;
const recaptchaSiteKey = process.env.FIREBASE_RECAPTCHA_SITE_KEY;

if (!projectId || !apiKey || !appId || !messagingSenderId) {
  console.warn('[inject-firebase-config] Faltan FIREBASE_PROJECT_ID / FIREBASE_WEB_API_KEY / FIREBASE_WEB_APP_ID / FIREBASE_WEB_MESSAGING_SENDER_ID — firebase-init.js queda con placeholders (Auth no funcionará hasta configurarlas en Vercel).');
  process.exit(0);
}

const filePath = path.join(__dirname, '..', 'firebase-init.js');
let code = fs.readFileSync(filePath, 'utf8');
code = code
  .replace('__FIREBASE_API_KEY__', apiKey)
  .replace('__FIREBASE_AUTH_DOMAIN__', `${projectId}.firebaseapp.com`)
  .replace('__FIREBASE_PROJECT_ID__', projectId)
  .replace('__FIREBASE_STORAGE_BUCKET__', `${projectId}.firebasestorage.app`)
  .replace('__FIREBASE_MESSAGING_SENDER_ID__', messagingSenderId)
  .replace('__FIREBASE_APP_ID__', appId);

if (recaptchaSiteKey) {
  code = code.replace('__RECAPTCHA_V3_SITE_KEY__', recaptchaSiteKey);
} else {
  console.warn('[inject-firebase-config] Falta FIREBASE_RECAPTCHA_SITE_KEY — App Check queda deshabilitado (no bloquea el build).');
}

fs.writeFileSync(filePath, code);
console.log('[inject-firebase-config] firebase-init.js listo para el proyecto', projectId);
