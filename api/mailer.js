// Envío propio de correos transaccionales (reset de contraseña, verificación
// de correo) vía SMTP.com — Firebase Auth no despacha realmente estos
// correos para este proyecto (tier básico, sin SMTP custom real pese a la
// config). Ver docs/superpowers/specs/2026-07-27-custom-auth-emails-design.md.
const nodemailer = require('nodemailer');

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: process.env.SMTPCOM_HOST,
    port: Number(process.env.SMTPCOM_PORT),
    secure: false,
    auth: { user: process.env.SMTPCOM_USERNAME, pass: process.env.SMTPCOM_PASSWORD }
  });
  return _transporter;
}

async function sendMail({ to, subject, html }) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `Yomi <${process.env.SMTPCOM_SENDER_EMAIL}>`,
    to, subject, html
  });
}

module.exports = { sendMail };
