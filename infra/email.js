// infra/email.js
const nodemailer = require('nodemailer');
const env = require('../config/env');
const { HttpError } = require('../core/httpError');
const { correo, LOGO } = require('./correo-plantillas');

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

/** Rol de la invitación explicado en una frase. */
const ROLES = {
  propietario: 'propietario (control total)',
  revisor: 'revisor (puede editar la revisión)',
  lector: 'lector (solo puede consultarla)'
};

/** «Ana Pérez (ana@uni.edu)» si hay nombre; si no, solo el correo. */
const quien = (nombre, correo) => (nombre ? `${nombre} (${correo})` : correo) || 'Un colega';

async function enviar(t, { to, subject, replyTo, contenido, remitente = env.APP_NOMBRE }) {
  await t.sendMail({
    from: `"${stripHeaderChars(remitente)}" <${env.GMAIL_USER}>`,   // remitente fijo: el usuario NO controla "from"
    to,
    ...(replyTo ? { replyTo } : {}),
    subject: stripHeaderChars(subject),
    text: contenido.text,
    html: contenido.html,
    attachments: [LOGO]
  });
}

async function sendContactMail({ name, email, message }) {
  const t = getTransporter();
  const subject = `Nuevo mensaje de contacto de ${name}`;
  await enviar(t, {
    to: env.CONTACT_TO, replyTo: email, subject, remitente: `Contacto ${env.APP_NOMBRE}`,
    contenido: correo({
      asunto: subject,
      resumen: String(message).slice(0, 120),
      titulo: 'Nuevo mensaje desde el formulario de contacto',
      detalles: [['Nombre', name], ['Correo', email]],
      destacado: message,
      parrafos: ['Responde a este correo para contestar directamente a la persona.'],
      pie: `Lo recibes porque es la dirección de contacto configurada en ${env.APP_NOMBRE}.`
    })
  });
}

async function sendInvitationMail({ to, invitadoPor, nombreInvitador, tituloRevision, rol, enlace, dias = 14 }) {
  const t = getTransporter();
  const quienInvita = quien(nombreInvitador, invitadoPor);
  const subject = `${nombreInvitador || invitadoPor || 'Un colega'} te invitó a la revisión "${tituloRevision}"`;
  await enviar(t, {
    to, subject,
    contenido: correo({
      asunto: subject,
      resumen: `Te invitaron como ${rol} en una revisión sistemática de ${env.APP_NOMBRE}.`,
      titulo: 'Te invitaron a colaborar en una revisión',
      saludo: 'Hola:',
      parrafos: [`${quienInvita} te invitó a participar en esta revisión sistemática:`],
      destacado: tituloRevision,
      detalles: [['Tu rol', ROLES[rol] || rol], ['Caduca', `en ${dias} días`]],
      boton: { texto: 'Aceptar la invitación', url: enlace },
      aviso: `Para aceptarla, inicia sesión (o crea tu cuenta) con este mismo correo: ${to}. ` +
             'Si no esperabas esta invitación, puedes ignorar el mensaje: no se creará nada.',
      pie: `Lo recibes porque ${quienInvita} escribió tu dirección en ${env.APP_NOMBRE}.`
    })
  });
}

async function sendNewSessionMail({ to, nombre, dispositivo, ip, fecha, enlaceSesiones }) {
  const t = getTransporter();
  const subject = `Nuevo inicio de sesión en tu cuenta de ${env.APP_NOMBRE}`;
  await enviar(t, {
    to, subject,
    contenido: correo({
      asunto: subject,
      resumen: `${dispositivo} · ${fecha}`,
      titulo: 'Nuevo inicio de sesión',
      saludo: nombre ? `Hola, ${nombre}:` : 'Hola:',
      parrafos: [`Se acaba de iniciar sesión en tu cuenta de ${env.APP_NOMBRE}.`],
      detalles: [['Dispositivo', dispositivo], ['Dirección IP', ip], ['Fecha', fecha]],
      boton: enlaceSesiones ? { texto: 'Revisar sesiones activas', url: enlaceSesiones } : undefined,
      aviso: 'Si fuiste tú, no tienes que hacer nada.\n' +
             '¿No reconoces este acceso? Cierra esa sesión desde «Sesiones activas» y cambia tu contraseña.',
      pie: 'Por seguridad, te avisamos cada vez que se inicia sesión en tu cuenta.'
    })
  });
}

async function sendAdminCodeMail({ to, codigo, destinatario, minutos }) {
  const t = getTransporter();
  const subject = `Código de confirmación: ${codigo}`;
  await enviar(t, {
    to, subject,
    contenido: correo({
      asunto: subject,
      resumen: `Caduca en ${minutos} minutos.`,
      titulo: 'Confirma el cambio de rol',
      parrafos: [`Has pedido dar el rol de administrador a ${destinatario}. Escribe este código en ${env.APP_NOMBRE} para confirmarlo:`],
      destacado: codigo,
      codigo: true,
      aviso: `El código caduca en ${minutos} minutos. Si no lo has pedido tú, no lo uses y revisa quién tiene acceso a tu cuenta.`,
      pie: `Lo recibes porque eres administrador de ${env.APP_NOMBRE}.`
    })
  });
}

/** ¿Se pueden enviar correos de avisos? (basta la cuenta de Gmail; el contacto necesita además CONTACT_TO) */
const correoDisponible = () => Boolean(env.GMAIL_USER && env.GMAIL_PASS);

let transporterAvisos = null;
function getTransporterAvisos() {
  if (!correoDisponible()) throw new HttpError(503, 'El correo no está configurado.');
  if (!transporterAvisos) {
    transporterAvisos = transporter || nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_PASS },
      pool: true,
      maxConnections: 2
    });
  }
  return transporterAvisos;
}

/** Un aviso de la campana enviado por correo (invitaciones, conflictos, fases, recordatorios…). */
async function sendNotificationMail({ to, nombre, titulo, cuerpo, revision, enlace, preferencias }) {
  const t = getTransporterAvisos();
  await enviar(t, {
    to, subject: titulo,
    contenido: correo({
      asunto: titulo,
      resumen: cuerpo || revision || `Aviso de ${env.APP_NOMBRE}`,
      titulo,
      saludo: nombre ? `Hola, ${nombre}:` : 'Hola:',
      parrafos: cuerpo ? [cuerpo] : [],
      detalles: revision ? [['Revisión', revision]] : [],
      boton: enlace ? { texto: `Abrir en ${env.APP_NOMBRE}`, url: enlace } : undefined,
      pie: `Lo recibes porque tienes activados estos avisos por correo en ${env.APP_NOMBRE}.` +
           (preferencias ? ` Puedes cambiarlo en Preferencias de notificación: ${preferencias}` : '')
    })
  });
}

module.exports = { sendContactMail, sendInvitationMail, sendNewSessionMail, sendAdminCodeMail, sendNotificationMail, correoDisponible };
