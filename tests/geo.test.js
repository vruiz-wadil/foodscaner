import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const { getGeoData } = await import('../api/geo.js')

const headers = {
  'x-vercel-ip-country': 'MX',
  'x-vercel-ip-country-region': 'CMX',
  'x-vercel-ip-city': encodeURIComponent('Ciudad de México')
}

describe('getGeoData', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('returns header fallback when ip is empty', async () => {
    const result = await getGeoData('', headers)
    expect(result).toEqual({ country: 'MX', region: 'CMX', city: 'Ciudad de México' })
  })

  it('calls ipquery.io and maps location fields on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        location: { country_code: 'US', state: 'California', city: 'Mountain View' }
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await getGeoData('8.8.8.8', headers)

    expect(result).toEqual({ country: 'US', region: 'California', city: 'Mountain View' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.ipquery.io/8.8.8.8?format=json', expect.any(Object))
  })

  it('falls back to headers when fetch resolves non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    const result = await getGeoData('1.2.3.4', headers)

    expect(result).toEqual({ country: 'MX', region: 'CMX', city: 'Ciudad de México' })
  })

  it('falls back to headers when fetch throws (network error/timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))

    const result = await getGeoData('1.2.3.4', headers)

    expect(result).toEqual({ country: 'MX', region: 'CMX', city: 'Ciudad de México' })
  })

  it('caches successful lookups for the same ip and does not re-fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ location: { country_code: 'US', state: 'California', city: 'Mountain View' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await getGeoData('9.9.9.9', headers)
    await getGeoData('9.9.9.9', headers)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
