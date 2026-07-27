// Genera links de acción de Firebase Auth (reset de contraseña, verificación
// de correo) vía Identity Toolkit con returnOobLink:true, en vez de dejar
// que Firebase los mande él mismo — el envío de correo de Firebase Auth está
// roto para este proyecto. Ver docs/superpowers/specs/2026-07-27-custom-auth-emails-design.md.
const { getAuthAccessToken, getAuthServiceAccount } = require('./phoneAuth');

async function generateActionLink(email, requestType, continueUrl) {
  const token = await getAuthAccessToken();
  const sa = getAuthServiceAccount();
  if (!token || !sa) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY_DEV no configurada');

  const body = { requestType, email, returnOobLink: true };
  if (continueUrl) {
    body.continueUrl = continueUrl;
    body.canHandleCodeInApp = true;
  }

  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:sendOobCode`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data?.error?.message || `Identity Toolkit sendOobCode failed: ${resp.status}`);
    err.code = data?.error?.message;
    throw err;
  }
  return data.oobLink;
}

module.exports = { generateActionLink };
