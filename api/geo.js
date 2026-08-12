const geoCache = {}; // ip -> { data, cachedAt }
const GEO_CACHE_TTL = 3600; // 1h, seconds

function headerGeo(headers) {
  const decCity = c => { try { return decodeURIComponent(c || ''); } catch { return c || ''; } };
  return {
    country:   headers['x-vercel-ip-country'] || '',
    region:    headers['x-vercel-ip-country-region'] || '',
    city:      decCity(headers['x-vercel-ip-city']),
    latitude:  headers['x-vercel-ip-latitude'] || '',
    longitude: headers['x-vercel-ip-longitude'] || ''
  };
}

async function ipqueryGeo(ip) {
  const now = Math.floor(Date.now() / 1000);
  const cached = geoCache[ip];
  if (cached && (now - cached.cachedAt) <= GEO_CACHE_TTL) return cached.data;

  const resp = await fetch(`https://api.ipquery.io/${ip}?format=json`, { signal: AbortSignal.timeout(3000) });
  if (!resp.ok) throw new Error('ipquery non-200');
  const json = await resp.json();
  const data = {
    country:   json.location?.country_code || '',
    region:    json.location?.state || '',
    city:      json.location?.city || '',
    latitude:  json.location?.latitude || '',
    longitude: json.location?.longitude || ''
  };
  geoCache[ip] = { data, cachedAt: now };
  return data;
}

// Vercel's edge geo headers are the primary source (free, no extra latency,
// no third-party dependency). ipquery.io is only a fallback for environments
// without those headers (e.g. local dev / non-Vercel hosting).
async function getGeoData(ip, headers) {
  const fromHeaders = headerGeo(headers);
  if (fromHeaders.country) return fromHeaders;
  if (!ip) return fromHeaders;

  try {
    return await ipqueryGeo(ip);
  } catch {
    return fromHeaders;
  }
}

module.exports = { getGeoData };
