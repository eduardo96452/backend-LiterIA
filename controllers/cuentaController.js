// controllers/cuentaController.js
const { sendNewSessionMail } = require('../services/emailService');
const env = require('../config/env');
const logger = require('../utils/logger');

/** Describe el navegador a partir del user agent, solo para que el correo se entienda. */
function describirDispositivo(ua = '') {
  const navegador = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : 'Navegador desconocido';
  const sistema = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux' : '';
  return sistema ? `${navegador} en ${sistema}` : navegador;
}

/**
 * Aviso de nuevo inicio de sesión.
 * Lo llama el propio frontend justo después de entrar: el correo va SIEMPRE a la
 * dirección del token, nunca a una que llegue en el cuerpo de la petición.
 */
async function avisoInicioSesion(req, res) {
  const destino = req.user?.email;
  if (!destino) return res.json({ enviado: false, motivo: 'sin_correo' });
  if (!env.mailEnabled) return res.json({ enviado: false, motivo: 'correo_no_configurado' });

  const dispositivo = describirDispositivo(req.get('user-agent') || '');
  const ip = req.ip;

  try {
    await sendNewSessionMail({
      to: destino,
      dispositivo,
      ip,
      fecha: new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })
    });
    return res.json({ enviado: true });
  } catch (e) {
    // Un fallo de correo no debe romper el inicio de sesión del usuario
    logger.warn('aviso_sesion_fallido', { message: e.message });
    return res.json({ enviado: false, motivo: 'error_envio' });
  }
}

module.exports = { avisoInicioSesion };
