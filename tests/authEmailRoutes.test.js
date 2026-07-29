import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const emailActionsModule = requireFn('../api/emailActions.js')
const mailerModule = requireFn('../api/mailer.js')
const generateActionLink = vi.fn()
const sendMail = vi.fn()
emailActionsModule.generateActionLink = generateActionLink
mailerModule.sendMail = sendMail

const { passwordResetHandler, verificationEmailHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('passwordResetHandler', () => {
  const ORIGINAL_APP_BASE_URL = process.env.APP_BASE_URL

  beforeEach(() => { generateActionLink.mockReset(); sendMail.mockReset() })
  afterEach(() => {
    if (ORIGINAL_APP_BASE_URL === undefined) delete process.env.APP_BASE_URL
    else process.env.APP_BASE_URL = ORIGINAL_APP_BASE_URL
  })

  it('usa APP_BASE_URL para el continueUrl cuando está configurado (ej. el alias estable de preview)', async () => {
    process.env.APP_BASE_URL = 'https://foodscaner-git-develop-wadil-ai-studio-s-projects.vercel.app'
    generateActionLink.mockResolvedValue('https://foodscaner-git-develop-wadil-ai-studio-s-projects.vercel.app/reset-password.html?oobCode=abc')
    sendMail.mockResolvedValue(undefined)
    const req = { body: { email: 'user@example.com' } }
    const res = makeRes()

    await passwordResetHandler(req, res)

    expect(generateActionLink).toHaveBeenCalledWith('user@example.com', 'PASSWORD_RESET', 'https://foodscaner-git-develop-wadil-ai-studio-s-projects.vercel.app/reset-password.html')
  })

  it('cae a https://yomi.mx cuando APP_BASE_URL no está configurado', async () => {
    delete process.env.APP_BASE_URL
    generateActionLink.mockResolvedValue('https://yomi.mx/reset-password.html?oobCode=abc')
    sendMail.mockResolvedValue(undefined)
    const req = { body: { email: 'user@example.com' } }
    const res = makeRes()

    await passwordResetHandler(req, res)

    expect(generateActionLink).toHaveBeenCalledWith('user@example.com', 'PASSWORD_RESET', 'https://yomi.mx/reset-password.html')
  })

  it('400s en un correo inválido, sin llamar a nada', async () => {
    const req = { body: { email: 'not-an-email' } }
    const res = makeRes()
    await passwordResetHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(generateActionLink).not.toHaveBeenCalled()
  })

  it('genera el link y manda el correo, responde ok:true', async () => {
    generateActionLink.mockResolvedValue('https://yomi.mx/reset-password.html?oobCode=abc')
    sendMail.mockResolvedValue(undefined)
    const req = { body: { email: 'user@example.com' } }
    const res = makeRes()

    await passwordResetHandler(req, res)

    expect(generateActionLink).toHaveBeenCalledWith('user@example.com', 'PASSWORD_RESET', 'https://yomi.mx/reset-password.html')
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'user@example.com' }))
    expect(res.body).toEqual({ ok: true })
  })

  it('responde ok:true SIN mandar correo cuando la cuenta no existe (anti-enumeración)', async () => {
    const err = new Error('EMAIL_NOT_FOUND')
    err.code = 'EMAIL_NOT_FOUND'
    generateActionLink.mockRejectedValue(err)
    const req = { body: { email: 'noexiste@example.com' } }
    const res = makeRes()

    await passwordResetHandler(req, res)

    expect(sendMail).not.toHaveBeenCalled()
    expect(res.body).toEqual({ ok: true })
  })

  it('500s en un fallo real (no EMAIL_NOT_FOUND)', async () => {
    generateActionLink.mockRejectedValue(new Error('network down'))
    const req = { body: { email: 'user@example.com' } }
    const res = makeRes()

    await passwordResetHandler(req, res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'internal_error' })
  })
})

describe('verificationEmailHandler', () => {
  const ORIGINAL_APP_BASE_URL = process.env.APP_BASE_URL

  beforeEach(() => { generateActionLink.mockReset(); sendMail.mockReset() })
  afterEach(() => {
    if (ORIGINAL_APP_BASE_URL === undefined) delete process.env.APP_BASE_URL
    else process.env.APP_BASE_URL = ORIGINAL_APP_BASE_URL
  })

  it('genera el link de VERIFY_EMAIL con continueUrl a verify-email.html (cae a yomi.mx sin APP_BASE_URL) y lo manda', async () => {
    delete process.env.APP_BASE_URL
    generateActionLink.mockResolvedValue('https://yomi.mx/verify-email.html?oobCode=xyz')
    sendMail.mockResolvedValue(undefined)
    const req = { user: { uid: 'uid-1', email: 'user@example.com' } }
    const res = makeRes()

    await verificationEmailHandler(req, res)

    expect(generateActionLink).toHaveBeenCalledWith('user@example.com', 'VERIFY_EMAIL', 'https://yomi.mx/verify-email.html')
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'user@example.com' }))
    expect(res.body).toEqual({ ok: true })
  })

  it('usa APP_BASE_URL para el continueUrl cuando está configurado (ej. el alias estable de preview)', async () => {
    process.env.APP_BASE_URL = 'https://foodscaner-git-develop-wadil-ai-studio-s-projects.vercel.app'
    generateActionLink.mockResolvedValue('https://foodscaner-git-develop-wadil-ai-studio-s-projects.vercel.app/verify-email.html?oobCode=xyz')
    sendMail.mockResolvedValue(undefined)
    const req = { user: { uid: 'uid-1', email: 'user@example.com' } }
    const res = makeRes()

    await verificationEmailHandler(req, res)

    expect(generateActionLink).toHaveBeenCalledWith('user@example.com', 'VERIFY_EMAIL', 'https://foodscaner-git-develop-wadil-ai-studio-s-projects.vercel.app/verify-email.html')
  })

  it('500s si falla generar o mandar el link', async () => {
    generateActionLink.mockRejectedValue(new Error('boom'))
    const req = { user: { uid: 'uid-1', email: 'user@example.com' } }
    const res = makeRes()

    await verificationEmailHandler(req, res)

    expect(res.statusCode).toBe(500)
  })
})
