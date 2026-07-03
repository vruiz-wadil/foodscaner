const geoCache = {}; // ip -> { data, cachedAt }
const GEO_CACHE_TTL = 3600; // 1h, seconds

function headerFallback(headers) {
  const decCity = c => { try { return decodeURIComponent(c || ''); } catch { return c || ''; } };
  return {
    country: headers['x-vercel-ip-country'] || '',
    region:  headers['x-vercel-ip-country-region'] || '',
    city:    decCity(headers['x-vercel-ip-city'])
  };
}

async function getGeoData(ip, headers) {
  if (!ip) return headerFallback(headers);

  const now = Math.floor(Date.now() / 1000);
  const cached = geoCache[ip];
  if (cached && (now - cached.cachedAt) <= GEO_CACHE_TTL) return cached.data;

  try {
    const resp = await fetch(`https://api.ipquery.io/${ip}?format=json`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) throw new Error('ipquery non-200');
    const json = await resp.json();
    const data = {
      country: json.location?.country_code || '',
      region:  json.location?.state || '',
      city:    json.location?.city || ''
    };
    geoCache[ip] = { data, cachedAt: now };
    return data;
  } catch {
    return headerFallback(headers);
  }
}

module.exports = { getGeoData };
