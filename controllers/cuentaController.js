// controllers/cuentaController.js
const { sendNewSessionMail } = require('../services/emailService');
const { forUser, admin, rpc } = require('../services/supabaseService');
const { HttpError } = require('../utils/httpError');
const env = require('../config/env');
const logger = require('../utils/logger');

/** Minutos/segundos que la cuenta queda bloqueada tras cerrar una sesión ajena. */
const BLOQUEO_TRAS_CIERRE = '10s';

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

/**
 * Cierra una sesión (o todas las demás) y bloquea la cuenta unos segundos.
 *
 * Borrar la fila de auth.sessions impide renovar el token, pero el token de acceso que
 * ya tenga ese dispositivo sigue siendo válido hasta que caduca. Por eso además se
 * bloquea la cuenta con service_role: durante esos segundos nadie puede volver a
 * entrar, que es el tiempo para cambiar la contraseña. El frontend, por su parte,
 * comprueba fn_sesion_vigente() y expulsa al dispositivo afectado.
 */
async function cerrarSesion(req, res) {
  const { id, todas } = req.body || {};
  const cliente = forUser(req.token);

  let cerradas = 0;
  if (todas) {
    cerradas = Number(await rpc(cliente, 'fn_cerrar_otras_sesiones')) || 0;
  } else {
    if (!id) throw new HttpError(400, 'Falta el identificador de la sesión.');
    const ok = await rpc(cliente, 'fn_cerrar_sesion', { p_id: id });
    cerradas = ok ? 1 : 0;
  }

  let bloqueada = false;
  if (cerradas > 0 && env.adminEnabled) {
    try {
      // ban_duration bloquea el inicio de sesión y la renovación de tokens
      await admin().auth.admin.updateUserById(req.user.id, { ban_duration: BLOQUEO_TRAS_CIERRE });
      bloqueada = true;
    } catch (e) {
      logger.warn('bloqueo_tras_cierre_fallido', { message: e.message });
    }
  }

  res.json({ cerradas, bloqueo: bloqueada ? BLOQUEO_TRAS_CIERRE : null });
}

module.exports = { avisoInicioSesion, cerrarSesion };
