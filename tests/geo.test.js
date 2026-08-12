import { describe, it, expect, vi, afterEach } from 'vitest'

const { getGeoData } = await import('../api/geo.js')

const headers = {
  'x-vercel-ip-country': 'MX',
  'x-vercel-ip-country-region': 'CMX',
  'x-vercel-ip-city': encodeURIComponent('Ciudad de México'),
  'x-vercel-ip-latitude': '19.4326',
  'x-vercel-ip-longitude': '-99.1332'
}

const noHeaders = {}

describe('getGeoData', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('prefers Vercel edge headers over ipquery.io when present', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await getGeoData('8.8.8.8', headers)

    expect(result).toEqual({ country: 'MX', region: 'CMX', city: 'Ciudad de México', latitude: '19.4326', longitude: '-99.1332' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns header fallback when ip is empty and headers have no country', async () => {
    const result = await getGeoData('', noHeaders)
    expect(result).toEqual({ country: '', region: '', city: '', latitude: '', longitude: '' })
  })

  it('calls ipquery.io and maps location fields when headers lack country', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        location: { country_code: 'US', state: 'California', city: 'Mountain View', latitude: '37.386', longitude: '-122.084' }
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await getGeoData('8.8.8.8', noHeaders)

    expect(result).toEqual({ country: 'US', region: 'California', city: 'Mountain View', latitude: '37.386', longitude: '-122.084' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.ipquery.io/8.8.8.8?format=json', expect.any(Object))
  })

  it('falls back to header geo when fetch resolves non-ok and headers lack country', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    const result = await getGeoData('1.2.3.4', noHeaders)

    expect(result).toEqual({ country: '', region: '', city: '', latitude: '', longitude: '' })
  })

  it('falls back to header geo when fetch throws (network error/timeout) and headers lack country', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))

    const result = await getGeoData('1.2.3.4', noHeaders)

    expect(result).toEqual({ country: '', region: '', city: '', latitude: '', longitude: '' })
  })

  it('caches successful ipquery.io lookups for the same ip and does not re-fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ location: { country_code: 'US', state: 'California', city: 'Mountain View' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await getGeoData('9.9.9.9', noHeaders)
    await getGeoData('9.9.9.9', noHeaders)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
