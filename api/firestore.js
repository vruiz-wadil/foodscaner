// Firestore client using REST API (no gRPC dependency)
// https://firebase.google.com/docs/firestore/reference/rest

let _token = null;
let _tokenExpiry = 0;
let _projectId = null;

async function getAccessToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!key) return null;
  try {
    const sa = JSON.parse(key);
    _projectId = sa.project_id;
    const jwtHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const claim = JSON.stringify({
      iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now
    });
    const jwtPayload = Buffer.from(claim).toString('base64url');
    const { createSign } = require('crypto');
    const sign = createSign('RSA-SHA256');
    sign.update(jwtHeader + '.' + jwtPayload);
    const signature = sign.sign(sa.private_key, 'base64url');
    const assertion = jwtHeader + '.' + jwtPayload + '.' + signature;

    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      }),
      signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    _token = data.access_token;
    _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return _token;
  } catch (e) {
    console.warn('[Firestore] Auth error:', e.message);
    return null;
  }
}

const BASE = 'https://firestore.googleapis.com/v1';

function getProjectId() {
  if (_projectId) return _projectId;
  try {
    const k = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (k) _projectId = JSON.parse(k).project_id;
  } catch {}
  return _projectId || 'foodscaner-cache-v2';
}

async function docPath(col, id) {
  return `${BASE}/projects/${getProjectId()}/databases/(default)/documents/${encodeURIComponent(col)}/${encodeURIComponent(id)}`;
}

async function fireGetCache(barcode) {
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const resp = await fetch(await docPath('product_cache', barcode), {
      headers: { 'Authorization': 'Bearer ' + token },
      signal: AbortSignal.timeout(5000)
    });
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    const data = await resp.json();
    const f = data.fields;
    if (!f || !f._data?.stringValue) return null;
    return JSON.parse(f._data.stringValue);
  } catch (e) {
    console.warn('[Firestore] getCache error:', e.message);
    return null;
  }
}

async function fireSetCache(barcode, response, source, offLastModified = null) {
  try {
    const token = await getAccessToken();
    if (!token) return;
    const payload = JSON.stringify({ response, source, offLastModified, cachedAt: Math.floor(Date.now() / 1000) });
    await fetch(await docPath('product_cache', barcode), {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { _data: { stringValue: payload } } }),
      signal: AbortSignal.timeout(5000)
    });
  } catch (e) {
    console.warn('[Firestore] setCache error:', e.message);
  }
}

async function fireRemoveCache(barcode) {
  try {
    const token = await getAccessToken();
    if (!token) return;
    await fetch(await docPath('product_cache', barcode), {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
      signal: AbortSignal.timeout(5000)
    });
  } catch (e) {
    console.warn('[Firestore] removeCache error:', e.message);
  }
}

async function fireGetAiCache(key) {
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const resp = await fetch(await docPath('ai_cache', key), {
      headers: { 'Authorization': 'Bearer ' + token },
      signal: AbortSignal.timeout(5000)
    });
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    const data = await resp.json();
    const f = data.fields;
    if (!f || !f._data?.stringValue) return null;
    const obj = JSON.parse(f._data.stringValue);
    const age = Math.floor(Date.now() / 1000) - obj.cachedAt;
    if (age > 86400) return null;
    return obj.response || null;
  } catch (e) {
    console.warn('[Firestore] getAiCache error:', e.message);
    return null;
  }
}

async function fireSetAiCache(key, response) {
  try {
    const token = await getAccessToken();
    if (!token) return;
    const payload = JSON.stringify({ response, cachedAt: Math.floor(Date.now() / 1000) });
    await fetch(await docPath('ai_cache', key), {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { _data: { stringValue: payload } } }),
      signal: AbortSignal.timeout(5000)
    });
  } catch (e) {
    console.warn('[Firestore] setAiCache error:', e.message);
  }
}

// New: Verified products (permanent database)
async function fireGetVerifiedProduct(barcode) {
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const resp = await fetch(await docPath('products_verified', barcode), {
      headers: { 'Authorization': 'Bearer ' + token },
      signal: AbortSignal.timeout(5000)
    });
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    const data = await resp.json();
    const f = data.fields;
    if (!f || !f._data?.stringValue) return null;
    return JSON.parse(f._data.stringValue);
  } catch (e) {
    console.warn('[Firestore] getVerifiedProduct error:', e.message);
    return null;
  }
}

// New: Extended cache with AI analysis (expiring)
async function fireGetExtendedCache(barcode) {
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const resp = await fetch(await docPath('products_cache_v2', barcode), {
      headers: { 'Authorization': 'Bearer ' + token },
      signal: AbortSignal.timeout(5000)
    });
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    const data = await resp.json();
    const f = data.fields;
    if (!f || !f._data?.stringValue) return null;
    const cached = JSON.parse(f._data.stringValue);
    const age = Math.floor(Date.now() / 1000) - cached.cachedAt;
    if (age > cached.expiresIn) return null; // Expired
    return cached;
  } catch (e) {
    console.warn('[Firestore] getExtendedCache error:', e.message);
    return null;
  }
}

async function fireSetExtendedCache(barcode, product, source, aiAnalysis, ttlDays = 7) {
  try {
    const token = await getAccessToken();
    if (!token) return;
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      product,
      source,
      aiAnalysis,
      cachedAt: now,
      expiresIn: ttlDays * 24 * 60 * 60,
      analysisModel: process.env.AI_MODEL || 'groq-llama-3.3-70b'
    });
    await fetch(await docPath('products_cache_v2', barcode), {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { _data: { stringValue: payload } } }),
      signal: AbortSignal.timeout(5000)
    });
  } catch (e) {
    console.warn('[Firestore] setExtendedCache error:', e.message);
  }
}

module.exports = {
  fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache,
  fireGetVerifiedProduct, fireGetExtendedCache, fireSetExtendedCache
};
