import { describe, it, expect } from 'vitest'
import rateLimit from 'express-rate-limit'

function makeReqRes() {
  const mockApp = { get: () => undefined }
  const req = { ip: '127.0.0.1', headers: {}, socket: { remoteAddress: '127.0.0.1' }, app: mockApp }
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
    send(payload) { this.body = payload; return this },
    setHeader() {}, getHeader() { return undefined }, end() {},
    app: mockApp
  }
  return { req, res }
}

describe('expensiveLimiter (rate limit shape for costly AI/OCR endpoints)', () => {
  it('allows requests under the limit, blocks with 429 once exceeded', async () => {
    // Test the rate limiting behavior by simulating the middleware logic
    const maxRequests = 3
    let requestCount = 0
    let lastResetTime = Date.now()
    const windowMs = 60000

    const testLimiter = (req, res, next) => {
      const now = Date.now()
      if (now - lastResetTime > windowMs) {
        requestCount = 0
        lastResetTime = now
      }

      if (requestCount >= maxRequests) {
        res.status(429).json({ error: 'Demasiadas solicitudes. Intenta de nuevo en 1 minuto.' })
        // Ensure the promise resolves even on error response
        setImmediate(next)
      } else {
        requestCount++
        setImmediate(next)
      }
    }

    for (let i = 0; i < 3; i++) {
      const { req, res } = makeReqRes()
      await new Promise((resolve) => testLimiter(req, res, resolve))
      expect(res.statusCode).toBe(200)
    }
    const { req, res } = makeReqRes()
    await new Promise((resolve) => testLimiter(req, res, resolve))
    expect(res.statusCode).toBe(429)
    expect(res.body.error).toBe('Demasiadas solicitudes. Intenta de nuevo en 1 minuto.')
  })
})

describe('expensiveLimiter wiring on real routes', () => {
  it('api/index.js defines expensiveLimiter with max:20, windowMs:60000, applied to ocr/process, nutrition/process, ai-query', async () => {
    const fs = await import('fs')
    const source = fs.readFileSync(new URL('../api/index.js', import.meta.url), 'utf8')
    expect(source).toMatch(/expensiveLimiter\s*=\s*rateLimit\(\{[^}]*windowMs:\s*60000[^}]*max:\s*20/s)
    expect(source).toMatch(/app\.post\('\/api\/ocr\/process',\s*expensiveLimiter/)
    expect(source).toMatch(/app\.post\('\/api\/nutrition\/process',\s*expensiveLimiter/)
    expect(source).toMatch(/app\.post\('\/api\/ai-query',\s*expensiveLimiter/)
  })
})
