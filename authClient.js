import { firebaseAuth, onAuthStateChanged } from './firebase-init.js';

let cachedProfile = null;

// profileResolved tracks whether we've ever reached a DEFINITIVE profile
// answer (either a fetched profile, or a confirmed "no session"). Consumers
// like header-badge.js need to distinguish "we don't know yet" from "we know
// there is no profile" — onAuthChange's raw Firebase event fires before
// syncUserProfile() has actually completed, so it can't tell them that (see
// Critical #2 finding, 2026-08-06 review). onProfileChange() below is the
// fix: it notifies subscribers only once the real answer is known, and
// replays the last known answer immediately to any subscriber that attaches
// after resolution already happened (e.g. account.html/preferences.html,
// which call syncUserProfile() explicitly before header-badge.js mounts).
let profileResolved = false;
let profileListeners = [];

function notifyProfileChange(profile) {
  cachedProfile = profile;
  profileResolved = true;
  profileListeners.forEach((cb) => cb(profile));
}

export function onProfileChange(callback) {
  profileListeners.push(callback);
  if (profileResolved) callback(cachedProfile);
  return () => {
    profileListeners = profileListeners.filter((cb) => cb !== callback);
  };
}

export function onAuthChange(callback) {
  return onAuthStateChanged(firebaseAuth, callback);
}

export async function getIdToken(forceRefresh = false) {
  // authStateReady() espera a que Firebase termine de rehidratar la sesión
  // persistida (IndexedDB) — sin esto, en cualquier carga de página fresca
  // (ej. justo después de un redirect post-login) firebaseAuth.currentUser
  // todavía es null por unos ms, así que esta función reportaba "sin sesión"
  // aunque el usuario SÍ estuviera logueado (hallazgo: Perfil redirigía a
  // login incluso recién after signup).
  await firebaseAuth.authStateReady();
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

export async function syncUserProfile() {
  const token = await getIdToken();
  if (!token) {
    notifyProfileChange(null);
    return null;
  }

  await fetch('/api/auth/sync', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });

  const res = await fetch('/api/me', {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    notifyProfileChange(null);
    return null;
  }

  const profile = await res.json();
  notifyProfileChange(profile);
  return profile;
}

export function getCachedProfile() {
  return cachedProfile;
}

let autoSyncSuppressed = false;

// Escape hatch para auth.html: motivado por el flujo de teléfono
// (signInWithCustomToken() dispara este listener ANTES de que el
// usuario nuevo vea el paso de consentimiento de Términos/edad — sin
// suprimir, el auto-sync sin body de abajo crea el doc de Firestore con
// termsAccepted ausente, y la sync explícita con consentimiento real que
// llega después cae en la rama de "usuario ya existe" de fireUpsertUser, que
// nunca escribe termsAccepted*), pero auth-ui.js lo usa para TODA la página,
// no solo teléfono — ver el comentario junto a su import en auth-ui.js.
export function setAutoSyncSuppressed(value) {
  autoSyncSuppressed = value;
}

// Auto-sync al detectar sesión (hallazgo crítico de revisión, 4a ronda): sin
// esto, getCachedProfile() regresa null en cualquier pantalla que no llame
// syncUserProfile() explícitamente por su cuenta — que era el caso de todas
// menos account.html. Esto cubre el caso general; pantallas que necesitan el
// perfil listo DE INMEDIATO al cargar (preferences.html, account.html) además
// hacen su propio `await syncUserProfile()` explícito antes de renderizar,
// porque este callback depende de cuándo Firebase resuelve el auth state y
// no hay garantía de que ya haya corrido en su DOMContentLoaded.
onAuthChange((user) => {
  // `return` (not just a bare call) matters for testability: it lets a test
  // driving the internal onAuthStateChanged callback directly do
  // `await internalCallback(user)` and have that actually wait for the fetch
  // chain inside syncUserProfile() to finish, instead of resolving after a
  // single microtask tick on the callback's own (otherwise undefined) return
  // value. Firebase's real onAuthStateChanged ignores the callback's return
  // value, so this has no effect on production behavior.
  if (user && !autoSyncSuppressed) return syncUserProfile();
  // No user: this IS a definitive answer (confirmed no session) even though
  // syncUserProfile() never runs — notify so onProfileChange subscribers
  // (e.g. an anonymous visitor on index.html) aren't left waiting forever.
  if (!user) notifyProfileChange(null);
});

window.authClient = { getIdToken, onAuthChange, onProfileChange, syncUserProfile, getCachedProfile, setAutoSyncSuppressed };
