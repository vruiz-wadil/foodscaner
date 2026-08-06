import { describe, it, expect } from 'vitest'

function makeReqRes() {
  const app = { get: (k) => (k === 'trust proxy' ? false : undefined) }
  const req = { ip: '127.0.0.1', headers: {}, socket: { remoteAddress: '127.0.0.1' }, method: 'GET', app }
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
    send(payload) { this.body = payload; return this },
    setHeader() {}, getHeader() { return undefined }, end() {}
  }
  return { req, res }
}

function runLimiter(limiter, req, res) {
  return new Promise((resolve) => {
    res.json = (payload) => { res.body = payload; resolve(); return res }
    res.send = (payload) => { res.body = payload; resolve(); return res }
    res.end = () => resolve()
    limiter(req, res, resolve)
  })
}

describe('expensiveLimiter (rate limit shape for costly AI/OCR endpoints)', () => {
  it('real expensiveLimiter instance: allows 20 requests, blocks 21st with 429', async () => {
    const { expensiveLimiter } = await import('../api/index.js')
    for (let i = 0; i < 20; i++) {
      const { req, res } = makeReqRes()
      await runLimiter(expensiveLimiter, req, res)
      expect(res.statusCode).toBe(200)
    }
    const { req, res } = makeReqRes()
    await runLimiter(expensiveLimiter, req, res)
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
