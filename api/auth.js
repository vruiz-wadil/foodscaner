// Verificación de Firebase ID tokens (JWT RS256) sin firebase-admin — solo crypto nativo + fetch.
const crypto = require('crypto');

// Endpoint JWKS de Google para las llaves de firma de Firebase Auth (formato JWK — misma
// llave de firma que el endpoint X.509 legacy, pero verificable sin parsear certificados).
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// Hardcodeado — NUNCA leer el algoritmo del header del propio token. Si se leyera de ahí,
// un atacante podría mandar alg:"HS256" y firmar con la llave pública de Google (que es
// pública) como si fuera un secreto HMAC, logrando bypass total (algorithm confusion attack).
const REQUIRED_ALG = 'RS256';

let _jwksCache = { keys: null, expiresAt: 0 };

function base64UrlJsonDecode(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function parseMaxAgeSeconds(cacheControlHeader) {
  if (!cacheControlHeader) return 0;
  const match = cacheControlHeader.match(/max-age=(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

async function getGooglePublicKeys() {
  if (_jwksCache.keys && Date.now() < _jwksCache.expiresAt) {
    return _jwksCache.keys;
  }
  // Fail-closed: cualquier error de red/timeout se propaga (throw), nunca se cae a
  // "sin llaves = dejar pasar".
  const resp = await fetch(JWKS_URL, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) throw new Error(`No se pudieron obtener las llaves públicas de Google (status ${resp.status})`);
  const data = await resp.json();
  if (!data || !Array.isArray(data.keys) || data.keys.length === 0) {
    throw new Error('Respuesta de JWKS inválida o vacía');
  }
  // Respeta el TTL real que Google declara — nunca un TTL propio inventado.
  const maxAgeSeconds = parseMaxAgeSeconds(resp.headers.get('cache-control'));
  _jwksCache = { keys: data.keys, expiresAt: Date.now() + Math.max(0, maxAgeSeconds) * 1000 };
  return data.keys;
}

async function verifyFirebaseIdToken(idToken, projectId) {
  if (!idToken || typeof idToken !== 'string') throw new Error('Token ausente');
  if (!projectId) throw new Error('projectId requerido para verificar aud/iss');

  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Formato de token inválido');
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = base64UrlJsonDecode(headerB64);
    payload = base64UrlJsonDecode(payloadB64);
  } catch {
    throw new Error('No se pudo parsear el header/payload del token');
  }

  if (header.alg !== REQUIRED_ALG) {
    throw new Error(`Algoritmo no soportado: se requiere ${REQUIRED_ALG}`);
  }
  if (!header.kid) throw new Error('Token sin kid');

  const keys = await getGooglePublicKeys(); // si falla, se propaga → 401 fail-closed en requireUser
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('No se encontró la llave pública para el kid del token');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signingInput = Buffer.from(headerB64 + '.' + payloadB64);
  const signature = Buffer.from(sigB64, 'base64url');
  const validSignature = crypto.verify('RSA-SHA256', signingInput, publicKey, signature);
  if (!validSignature) throw new Error('Firma inválida');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('Token expirado');
  if (typeof payload.iat !== 'number' || payload.iat > now + 60) throw new Error('Token emitido en el futuro (iat inválido)');

  const expectedIss = `https://securetoken.google.com/${projectId}`;
  if (payload.iss !== expectedIss) throw new Error('Issuer inválido');
  if (payload.aud !== projectId) throw new Error('Audience inválido');
  if (typeof payload.sub !== 'string' || payload.sub.trim() === '') throw new Error('Subject (sub) vacío o ausente');

  return { uid: payload.sub, email: payload.email || null, emailVerified: !!payload.email_verified, phoneNumber: payload.phone_number || null };
}

function _resetJwksCacheForTests() {
  _jwksCache = { keys: null, expiresAt: 0 };
}

module.exports = { verifyFirebaseIdToken, getGooglePublicKeys, _resetJwksCacheForTests };
