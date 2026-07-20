// Punto único de inicialización del Firebase JS SDK (Auth) — todo lo demás
// (auth-ui.js, authClient.js) importa DESDE ESTE archivo, nunca directo del
// CDN, para fijar la versión del SDK en un solo lugar y para poder mockear
// esta dependencia con una ruta relativa normal en tests.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app-check.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  getAdditionalUserInfo
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

// Placeholders — los valores reales se inyectan como variables de entorno en
// build/deploy (Vercel). NUNCA reemplazar estos strings con valores reales
// commiteados al repo.
const firebaseConfig = {
  apiKey: "__FIREBASE_API_KEY__",
  authDomain: "__FIREBASE_AUTH_DOMAIN__",
  projectId: "__FIREBASE_PROJECT_ID__",
  storageBucket: "__FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
  appId: "__FIREBASE_APP_ID__"
};
const recaptchaSiteKey = "__RECAPTCHA_V3_SITE_KEY__";

export const firebaseApp = initializeApp(firebaseConfig);

// Placeholder not injected (env var missing at build time) -> skip App Check
// init instead of handing initializeAppCheck a literal "__..._" string.
if (!recaptchaSiteKey.startsWith('__')) {
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaV3Provider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true
  });
}

export const firebaseAuth = getAuth(firebaseApp);

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  getAdditionalUserInfo
};
