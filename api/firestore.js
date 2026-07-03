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

const ADMIN_COLLECTIONS = ['scan_logs', 'reports', 'products_ocr', 'products_nutrition'];

async function fireListDocs(col, pageToken) {
  const token = await getAccessToken();
  if (!token) return null;
  const url = new URL(`${BASE}/projects/${getProjectId()}/databases/(default)/documents/${col}`);
  url.searchParams.set('pageSize', '50');
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  const resp = await fetch(url.toString(), { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) });
  if (!resp.ok) return null;
  const data = await resp.json();
  const items = (data.documents || []).map(d => {
    const raw = d.name.split('/').pop();
    let id; try { id = decodeURIComponent(raw); } catch { id = raw; }
    let parsed = null;
    try { parsed = JSON.parse(d.fields?._data?.stringValue || 'null'); } catch {}
    if (parsed && d.fields?._notFound?.booleanValue === true) parsed.notFound = true;
    if (parsed && d.fields?._hasOcr?.booleanValue === true) parsed.hasOcr = true;
    if (parsed && d.fields?._hasNutritionOcr?.booleanValue === true) parsed.hasNutritionOcr = true;
    if (parsed && d.fields?._confidence?.stringValue) parsed.confidence = d.fields._confidence.stringValue;
    if (parsed && d.fields?._confidenceNotes?.stringValue) parsed.confidenceNotes = d.fields._confidenceNotes.stringValue;
    if (parsed && d.fields?._source?.stringValue) parsed.source = d.fields._source.stringValue;
    if (parsed && d.fields?._sourcesTried?.arrayValue?.values) {
      parsed.sourcesTried = d.fields._sourcesTried.arrayValue.values.map(v => ({
        source: v.mapValue?.fields?.source?.stringValue || '',
        found: v.mapValue?.fields?.found?.booleanValue || false
      }));
    }
    if (parsed && d.fields?._cacheLevel?.stringValue) parsed.cacheLevel = d.fields._cacheLevel.stringValue;
    if (parsed && d.fields?._ingredientSource?.stringValue) parsed.ingredientSource = d.fields._ingredientSource.stringValue;
    if (parsed && d.fields?._nutritionSource?.stringValue) parsed.nutritionSource = d.fields._nutritionSource.stringValue;
    if (parsed && d.fields?._durationMs?.integerValue) parsed.durationMs = parseInt(d.fields._durationMs.integerValue, 10);
    return { id, data: parsed };
  });
  return { items, nextPageToken: data.nextPageToken || null };
}

// ponytail: full scan paginado; si scan_logs supera ~5000 docs, migrar a contadores incrementales.
async function fireListAll(col, maxPages = 100) {
  let all = [], pageToken = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await fireListDocs(col, pageToken);
    if (!page) return null;
    all = all.concat(page.items);
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  return all;
}

// ponytail: id inverso = orden por nombre da "más reciente primero" sin orderBy/runQuery.
// ponytail: scan_logs crece sin límite; añadir limpieza/TTL si llega a molestar.
async function fireLogScan(entry) {
  const token = await getAccessToken(); if (!token) return;
  const { _id, ...data } = entry;
  const id = _id || String(1e16 - Date.now()).padStart(16, '0') + '_' + Math.random().toString(36).slice(2, 8);
  fetch(docPath('scan_logs', id), {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { _data: { stringValue: JSON.stringify(data) } } }),
    signal: AbortSignal.timeout(5000)
  }).catch(() => {});
}

async function fireMarkScanNotFound(id) {
  const token = await getAccessToken(); if (!token) return;
  fetch(docPath('scan_logs', id) + '?updateMask.fieldPaths=_notFound', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { _notFound: { booleanValue: true } } }),
    signal: AbortSignal.timeout(5000)
  }).catch(() => {});
}

async function fireMarkScanHasOcr(id) {
  const token = await getAccessToken(); if (!token) return;
  fetch(docPath('scan_logs', id) + '?updateMask.fieldPaths=_hasOcr', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { _hasOcr: { booleanValue: true } } }),
    signal: AbortSignal.timeout(5000)
  }).catch(() => {});
}

async function fireMarkScanHasNutrition(id) {
  const token = await getAccessToken(); if (!token) return;
  fetch(docPath('scan_logs', id) + '?updateMask.fieldPaths=_hasNutritionOcr', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { _hasNutritionOcr: { booleanValue: true } } }),
    signal: AbortSignal.timeout(5000)
  }).catch(() => {});
}

async function fireMarkScanConfidence(id, confidence, notes) {
  const token = await getAccessToken(); if (!token) return;
  const fields = { _confidence: { stringValue: confidence } };
  let mask = '?updateMask.fieldPaths=_confidence';
  if (notes) { fields._confidenceNotes = { stringValue: notes }; mask += '&updateMask.fieldPaths=_confidenceNotes'; }
  fetch(docPath('scan_logs', id) + mask, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(5000)
  }).catch(() => {});
}

async function fireMarkScanSource(id, source) {
  const token = await getAccessToken(); if (!token) return;
  fetch(docPath('scan_logs', id) + '?updateMask.fieldPaths=_source', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { _source: { stringValue: source } } }),
    signal: AbortSignal.timeout(5000)
  }).catch(() => {});
}

async function fireMarkScanSources(id, sources, cacheLevel = 'none', ingredientSource = '', nutritionSource = '', durationMs = 0) {
  const token = await getAccessToken(); if (!token) return;
  const arr = (sources || []).map(s => ({
    mapValue: { fields: {
      source: { stringValue: s.source || '' },
      found: { booleanValue: !!s.found }
    }}
  }));
  const fields = {
    _sourcesTried: { arrayValue: { values: arr } },
    _cacheLevel: { stringValue: cacheLevel },
    _ingredientSource: { stringValue: ingredientSource },
    _nutritionSource: { stringValue: nutritionSource },
    _durationMs: { integerValue: String(durationMs) }
  };
  const mask = '?updateMask.fieldPaths=_sourcesTried&updateMask.fieldPaths=_cacheLevel&updateMask.fieldPaths=_ingredientSource&updateMask.fieldPaths=_nutritionSource&updateMask.fieldPaths=_durationMs';
  fetch(docPath('scan_logs', id) + mask, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(5000)
  }).catch(() => {});
}

// ponytail: inline base64 image; migrar a Storage si los docs crecen > 800 KB promedio.
async function fireLogReport(entry) {
  const token = await getAccessToken(); if (!token) return false;
  const id = String(1e16 - Date.now()).padStart(16, '0') + '_' + Math.random().toString(36).slice(2, 8);
  const resp = await fetch(docPath('reports', id), {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { _data: { stringValue: JSON.stringify(entry) } } }),
    signal: AbortSignal.timeout(8000)
  }).catch(() => null);
  return resp?.ok || false;
}

async function fireDeleteDoc(col, id) {
  const token = await getAccessToken();
  if (!token) return false;
  const resp = await fetch(docPath(col, id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000) });
  return resp.ok;
}

module.exports = {
  getAccessToken,
  fireGetCache, fireSetCache, fireRemoveCache, fireGetAiCache, fireSetAiCache,
  fireGetOcrData, fireSetOcrData,
  fireGetNutritionOcr, fireSetNutritionOcr,
  fireListDocs, fireListAll, fireDeleteDoc, fireLogScan, fireMarkScanNotFound, fireMarkScanHasOcr, fireMarkScanHasNutrition, fireMarkScanConfidence, fireMarkScanSource, fireMarkScanSources, fireLogReport, ADMIN_COLLECTIONS
};
