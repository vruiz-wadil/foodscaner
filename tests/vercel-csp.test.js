import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'))
const csp = vercelConfig.routes.find(r => r.headers && r.headers['Content-Security-Policy']).headers['Content-Security-Policy']

describe('vercel.json route-level CSP (governs static files like auth.html in production)', () => {
  it('allows reCAPTCHA (google.com) alongside the existing Firebase entries', () => {
    expect(csp).toMatch(/script-src[^;]*https:\/\/www\.gstatic\.com/)
    expect(csp).toMatch(/script-src[^;]*https:\/\/www\.google\.com/)
    expect(csp).toMatch(/connect-src[^;]*https:\/\/www\.google\.com/)
    expect(csp).toMatch(/frame-src[^;]*https:\/\/www\.google\.com/)
  })
})
