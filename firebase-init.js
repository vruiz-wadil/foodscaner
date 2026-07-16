// Punto único de inicialización del Firebase JS SDK (Auth) — todo lo demás
// (auth-ui.js, authClient.js) importa DESDE ESTE archivo, nunca directo del
// CDN, para fijar la versión del SDK en un solo lugar y para poder mockear
// esta dependencia con una ruta relativa normal en tests.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider
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

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider
};
