import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const phoneAuthModule = requireFn('../api/phoneAuth.js')
const getAuthAccessToken = vi.fn()
const getAuthServiceAccount = vi.fn()
phoneAuthModule.getAuthAccessToken = getAuthAccessToken
phoneAuthModule.getAuthServiceAccount = getAuthServiceAccount

const { generateActionLink } = await import('../api/emailActions.js')

describe('generateActionLink', () => {
  beforeEach(() => {
    getAuthAccessToken.mockReset()
    getAuthServiceAccount.mockReset()
    getAuthAccessToken.mockResolvedValue('fake-oauth-token')
    getAuthServiceAccount.mockReturnValue({ project_id: 'foodscaner-dev' })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('con continueUrl, construye el link con NUESTRO dominio usando el oobCode — Identity Toolkit (vía OAuth) siempre regresa oobLink apuntando a su propia página hosteada, continueUrl ahí es solo un query param de "continuar después", nunca reemplaza el dominio del link (confirmado en vivo)', async () => {
    let capturedBody
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      capturedBody = JSON.parse(options.body)
      return {
        ok: true,
        json: async () => ({
          oobCode: 'abc123',
          oobLink: 'https://foodscaner-dev.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=abc123&continueUrl=https://yomi.mx/reset-password.html'
        })
      }
    }))

    const link = await generateActionLink('user@example.com', 'PASSWORD_RESET', 'https://yomi.mx/reset-password.html')

    expect(link).toBe('https://yomi.mx/reset-password.html?oobCode=abc123')
    expect(capturedBody).toEqual({
      requestType: 'PASSWORD_RESET', email: 'user@example.com', returnOobLink: true,
      continueUrl: 'https://yomi.mx/reset-password.html', canHandleCodeInApp: true
    })
  })

  it('no incluye continueUrl/canHandleCodeInApp cuando no se pasa continueUrl (caso VERIFY_EMAIL)', async () => {
    let capturedBody
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      capturedBody = JSON.parse(options.body)
      return { ok: true, json: async () => ({ oobLink: 'https://foodscaner-dev.firebaseapp.com/__/auth/action?oobCode=xyz' }) }
    }))

    await generateActionLink('user@example.com', 'VERIFY_EMAIL')

    expect(capturedBody).toEqual({ requestType: 'VERIFY_EMAIL', email: 'user@example.com', returnOobLink: true })
  })

  it('lanza un error con .code = EMAIL_NOT_FOUND cuando la cuenta no existe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 400,
      json: async () => ({ error: { message: 'EMAIL_NOT_FOUND' } })
    })))

    const err = await generateActionLink('noexiste@example.com', 'PASSWORD_RESET').catch(e => e)

    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('EMAIL_NOT_FOUND')
  })
})
