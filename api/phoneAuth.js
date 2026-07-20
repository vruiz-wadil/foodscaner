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

function createFirebaseCustomToken(uid) {
  const sa = getServiceAccount();
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY no configurada');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email, sub: sa.client_email, aud: CUSTOM_TOKEN_AUD,
    uid, iat: now, exp: now + 3600
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(sa.private_key, 'base64url');
  return `${signingInput}.${signature}`;
}

module.exports = { sendVerificationCode, checkVerificationCode, createFirebaseCustomToken };
