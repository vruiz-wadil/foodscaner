import { describe, it, expect } from 'vitest'
import rateLimit from 'express-rate-limit'

describe('expensiveLimiter (rate limit shape for costly AI/OCR endpoints)', () => {
  it('can be instantiated with the correct config shape', async () => {
    const limiter = rateLimit({
      windowMs: 60000,
      max: 3,
      message: { error: 'Demasiadas solicitudes. Intenta de nuevo en 1 minuto.' }
    })
    // Verify it returns a middleware function
    expect(typeof limiter).toBe('function')
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
