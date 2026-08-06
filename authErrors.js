const AUTH_ERROR_MESSAGES = {
  'auth/invalid-email': 'Correo inválido.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/popup-closed-by-user': 'Se cerró la ventana de Google antes de terminar.',
  'auth/popup-blocked': 'Tu navegador bloqueó la ventana de Google. Habilítala e inténtalo de nuevo.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
  'auth/network-request-failed': 'Sin conexión a internet. Revisa tu red e inténtalo de nuevo.',
  'auth/account-exists-with-different-credential': 'Ya tienes una cuenta con ese correo usando otro método de acceso (ej. Google). Usa ese método para entrar.',
  'auth/requires-recent-login': 'Por seguridad, vuelve a confirmar tu contraseña actual para continuar.',
  'invalid_phone': 'Número de teléfono inválido.',
  'send_failed': 'No se pudo enviar el código. Intenta más tarde.',
  'invalid_code': 'Código incorrecto o expirado.',
  'verify_failed': 'Ocurrió un error al verificar tu código. Intenta de nuevo.'
};

export function mapAuthError(code) {
  return AUTH_ERROR_MESSAGES[code] || 'Ocurrió un error. Intenta de nuevo.';
}
