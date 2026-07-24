import { describe, it, expect } from 'vitest'
import { mapAuthError } from '../authErrors.js'

describe('mapAuthError', () => {
  it('mapea auth/wrong-password a un mensaje genérico de credenciales incorrectas', () => {
    expect(mapAuthError('auth/wrong-password')).toBe('Correo o contraseña incorrectos.')
  })
  it('mapea auth/requires-recent-login a un mensaje de reautenticación', () => {
    expect(mapAuthError('auth/requires-recent-login')).toMatch(/vuelve a confirmar/)
  })
  it('regresa un mensaje genérico para un código desconocido', () => {
    expect(mapAuthError('auth/something-new')).toBe('Ocurrió un error. Intenta de nuevo.')
  })
})
