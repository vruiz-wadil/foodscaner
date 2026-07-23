// Twilio Verify (envío/checo de código SMS) + firma manual de Firebase custom
// tokens (RS256, sin firebase-admin — mismo patrón que api/auth.js) para que
// un teléfono verificado por Twilio termine siendo una sesión Firebase normal.
// Reutiliza la MISMA service account que ya usa api/firestore.js
// (FIREBASE_SERVICE_ACCOUNT_KEY) — ya tiene permiso de firmar tokens para
// este proyecto, no hace falta una credencial nueva.
const crypto = require('crypto');
const { getServiceAccount } = require('./firestore');

const TWILIO_VERIFY_BASE = 'https://verify.twilio.com/v2';
const CUSTOM_TOKEN_AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

function twilioAuthHeader() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
}

async function sendVerificationCode(phone) {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  const resp = await fetch(`${TWILIO_VERIFY_BASE}/Services/${serviceSid}/Verifications`, {
    method: 'POST',
    headers: { Authorization: twilioAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: phone, Channel: 'sms' }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data?.message || `Twilio Verify error (status ${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  return data.status;
}

async function checkVerificationCode(phone, code) {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  const resp = await fetch(`${TWILIO_VERIFY_BASE}/Services/${serviceSid}/VerificationCheck`, {
    method: 'POST',
    headers: { Authorization: twilioAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: phone, Code: code }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data?.message || `Twilio Verify error (status ${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  return data.status;
}

function base64UrlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function createFirebaseCustomToken(uid, claims) {
  const sa = getServiceAccount();
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY no configurada');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email, sub: sa.client_email, aud: CUSTOM_TOKEN_AUD,
    uid, iat: now, exp: now + 3600,
    ...(claims ? { claims } : {})
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(sa.private_key, 'base64url');
  return `${signingInput}.${signature}`;
}

// Credencial del proyecto Auth (foodscaner-dev), DISTINTA de
// FIREBASE_SERVICE_ACCOUNT_KEY (proyecto Firestore/cache) — mismo
// des-escapado que getServiceAccount() en api/firestore.js.
function getAuthServiceAccount() {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_DEV;
  if (!key) return null;
  const raw = key.includes('\\"')
    ? key.replace(/\x5c\x0a/g, '\x5c\x6e').replace(/\x5c\x22/g, '\x22')
    : key;
  return JSON.parse(raw);
}

let _authToken = null;
let _authTokenExpiry = 0;

async function getAuthAccessToken() {
  if (_authToken && Date.now() < _authTokenExpiry) return _authToken;
  const sa = getAuthServiceAccount();
  if (!sa) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
  const payload = base64UrlJson({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now
  });
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(sa.private_key, 'base64url');
  const assertion = `${header}.${payload}.${signature}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  _authToken = data.access_token;
  _authTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _authToken;
}

// Empuja el claim phone_number directo a la cuenta Auth (Identity Toolkit
// accounts:update, customAttributes) — sobrevive el refresh automático del
// ID token, a diferencia de un developer claim de un custom token que ya no
// se vuelve a mintear. Ver spec 2026-07-23-account-editing-design.md.
async function setPhoneNumberClaim(uid, phone) {
  const token = await getAuthAccessToken();
  const sa = getAuthServiceAccount();
  if (!token || !sa) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY_DEV no configurada');
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:update`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify({ phone_number: phone }) })
  });
  if (!resp.ok) throw new Error(`Identity Toolkit accounts:update failed: ${resp.status}`);
}

module.exports = { sendVerificationCode, checkVerificationCode, createFirebaseCustomToken, setPhoneNumberClaim };
