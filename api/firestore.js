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
    // dotenvx leaves \" for quotes and \+LF for PEM line breaks
    const raw = key.includes('\\"')
      ? key.replace(/\x5c\x0a/g, '\x5c\x6e').replace(/\x5c\x22/g, '\x22')
      : key;
    const sa = JSON.parse(raw);
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
    if (k) { const raw = k.includes('\\"') ? k.replace(/\x5c\x0a/g, '\x5c\x6e').replace(/\x5c\x22/g, '\x22') : k; _projectId = JSON.parse(raw).project_id; }
  } catch {}
  return _projectId || 'foodscaner-cache-v2';
}

function docPath(col, id) {
  return `${BASE}/projects/${getProjectId()}/databases/(default)/documents/${encodeURIComponent(col)}/${encodeURIComponent(id)}`;
}

async function fireGetCache(barcode) {
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const resp = await fetch(docPath('product_cache', barcode), {
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
    await fetch(docPath('product_cache', barcode), {
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
    await fetch(docPath('product_cache', barcode), {
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
    const resp = await fetch(docPath('ai_cache', key), {
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
    await fetch(docPath('ai_cache', key), {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { _data: { stringValue: payload } } }),
      signal: AbortSignal.timeout(5000)
    });
  } catch (e) {
    console.warn('[Firestore] setAiCache error:', e.message);
  }
}

async function fireGetOcrData(barcode) {
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const resp = await fetch(docPath('products_ocr', barcode), {
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
    console.warn('[Firestore] getOcrData error:', e.message);
    return null;
  }
}

async function fireGetNutritionOcr(barcode) {
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const resp = await fetch(docPath('products_nutrition', barcode), {
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
    console.warn('[Firestore] getNutritionOcr error:', e.message);
    return null;
  }
}

async function fireSetNutritionOcr(barcode, nutritionData) {
  try {
    const token = await getAccessToken();
    if (!token) return;
    const payload = JSON.stringify({ barcode, nutritionData, createdAt: Math.floor(Date.now() / 1000) });
    await fetch(docPath('products_nutrition', barcode), {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { _data: { stringValue: payload } } }),
      signal: AbortSignal.timeout(5000)
    });
  } catch (e) {
    console.warn('[Firestore] setNutritionOcr error:', e.message);
  }
}

async function fireSetOcrData(barcode, ingredients) {
  try {
    const token = await getAccessToken();
    if (!token) {
      console.error('[OCR] No Firebase token available');
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      barcode,
      ingredients_ocr: ingredients,
      approved: true,
      approvedBy: 'auto-initial-approval',
      createdAt: now
    });
    console.log('[OCR] Saving to Firebase:', barcode);
    const response = await fetch(docPath('products_ocr', barcode), {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          _data: { stringValue: payload }
        }
      }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) {
      const error = await response.text();
      console.error('[OCR] Firebase save failed:', response.status, error);
    } else {
      console.log('[OCR] Saved successfully to Firebase');
    }
  } catch (e) {
    console.error('[Firestore] setOcrData error:', e.message);
  }
}

module.exports = {
  getAccessToken,
  fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache,
  fireGetOcrData, fireSetOcrData,
  fireGetNutritionOcr, fireSetNutritionOcr
};
