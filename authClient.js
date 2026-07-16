import { firebaseAuth, onAuthStateChanged } from './firebase-init.js';

let cachedProfile = null;

export function onAuthChange(callback) {
  return onAuthStateChanged(firebaseAuth, callback);
}

export async function getIdToken(forceRefresh = false) {
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

export async function syncUserProfile() {
  const token = await getIdToken();
  if (!token) {
    cachedProfile = null;
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
    cachedProfile = null;
    return null;
  }

  cachedProfile = await res.json();
  return cachedProfile;
}

export function getCachedProfile() {
  return cachedProfile;
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
  if (user) return syncUserProfile();
});

window.authClient = { getIdToken, onAuthChange, syncUserProfile, getCachedProfile };
