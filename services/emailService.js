// services/emailService.js
const nodemailer = require('nodemailer');
const env = require('../config/env');
const { HttpError } = require('../utils/httpError');

let transporter = null; // se crea UNA vez, no por petición

function getTransporter() {
  if (!env.mailEnabled) throw new HttpError(503, 'El servicio de contacto no está configurado.');
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_PASS },
      pool: true,
      maxConnections: 2
    });
  }
  return transporter;
}

// Evita inyección de cabeceras SMTP
const stripHeaderChars = s => String(s).replace(/[\r\n]+/g, ' ').trim();

async function sendContactMail({ name, email, message }) {
  const t = getTransporter();
  await t.sendMail({
    from: `"Contacto Literia" <${env.GMAIL_USER}>`, // remitente fijo: el usuario NO controla "from"
    replyTo: email,
    to: env.CONTACT_TO,
    subject: stripHeaderChars(`Nuevo mensaje de contacto de ${name}`),
    text: `Nombre: ${name}\nEmail: ${email}\n\n${message}`
  });
}

async function sendInvitationMail({ to, invitadoPor, tituloRevision, rol, enlace }) {
  const t = getTransporter();
  await t.sendMail({
    from: `"LiterIA" <${env.GMAIL_USER}>`,
    to,
    subject: stripHeaderChars(`Invitación a colaborar en la revisión "${tituloRevision}"`),
    text: `${invitadoPor} te ha invitado a participar como ${rol} en la revisión sistemática "${tituloRevision}" en LiterIA.\n\n` +
          `Para aceptar, inicia sesión (o crea tu cuenta con este mismo correo) y abre el enlace:\n${enlace}\n\n` +
          `El enlace caduca en 14 días.`
  });
}

module.exports = { sendContactMail, sendInvitationMail };
