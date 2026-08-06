import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'

const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn()
  const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }))
  return { sendMailMock, createTransportMock }
})

const requireFn = createRequire(import.meta.url)

// Inject mock nodemailer into require cache before importing mailer
requireFn.cache[requireFn.resolve('nodemailer')] = {
  exports: { createTransport: createTransportMock },
  loaded: true
}

const { sendMail } = await import('../api/mailer.js')

describe('sendMail', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    sendMailMock.mockReset()
    createTransportMock.mockClear()
    process.env.SMTPCOM_HOST = 'smtp.com'
    process.env.SMTPCOM_PORT = '80'
    process.env.SMTPCOM_USERNAME = 'smtp@yomi.mx'
    process.env.SMTPCOM_PASSWORD = 'secret'
    process.env.SMTPCOM_SENDER_EMAIL = 'noreply@yomi.mx'
  })

  afterEach(() => { process.env = { ...ORIGINAL_ENV } })

  it('crea el transport con host/puerto/credenciales de SMTPCOM_* y envía con el remitente configurado', async () => {
    sendMailMock.mockResolvedValueOnce(undefined)

    await sendMail({ to: 'user@example.com', subject: 'Asunto', html: '<p>Hola</p>' })

    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.com', port: 80, auth: { user: 'smtp@yomi.mx', pass: 'secret' }
    }))
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      from: expect.stringContaining('noreply@yomi.mx'),
      to: 'user@example.com', subject: 'Asunto', html: '<p>Hola</p>'
    }))
  })
})
