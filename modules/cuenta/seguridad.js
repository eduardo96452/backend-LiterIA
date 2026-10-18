// modules/cuenta/seguridad.js
// Cambiar la contraseña y el correo de la cuenta.
//
// Contraseña: se pide la actual, salvo si la sesión se abrió hace poco con el enlace de «Olvidé mi
// contraseña» (el token lo dice en su claim amr: método «recovery»). La actual se comprueba abriendo
// una sesión nueva en Supabase Auth y el cambio se hace con ella (es reciente, como exige «Secure
// password change»). Supabase cierra al cambiar la contraseña las demás sesiones de la cuenta, así
// que esa sesión nueva se devuelve al navegador, que la adopta en lugar de la suya (que se cierra).
//
// Correo: también pide la contraseña actual. Supabase envía el enlace de confirmación al correo
// nuevo (y, si «Secure email change» está activado, también al actual); el cambio se hace al
// confirmarlo. El perfil (usuarios.correo_electronico) se actualiza solo por el disparador de sql/002.
const env = require('../../config/env');
const logger = require('../../core/logger');
const authRest = require('../../infra/authRest');
const { HttpError } = require('../../core/httpError');

/** Métodos con los que entra quien llega desde un enlace del correo (no sabe la contraseña). */
const METODOS_ENLACE = new Set(['recovery', 'otp', 'magiclink']);
/** Tiempo que vale el enlace de recuperación para cambiar la contraseña sin la actual. */
const VENTANA_RECUPERACION_S = 60 * 60;

function vieneDeRecuperacion(user, ahora = Math.floor(Date.now() / 1000)) {
  return (user?.amr || []).some(a => METODOS_ENLACE.has(a?.method)
    && Number.isFinite(Number(a?.timestamp)) && ahora - Number(a.timestamp) <= VENTANA_RECUPERACION_S);
}

/** GET /cuenta/contrasena: si hay que escribir la contraseña actual. */
function estadoContrasena(ctx) {
  const recuperacion = vieneDeRecuperacion(ctx.user);
  return { requiere_actual: !recuperacion, recuperacion };
}

function exigirCorreo(ctx) {
  if (!ctx.user?.email) throw new HttpError(400, 'Tu sesión no trae el correo de la cuenta; vuelve a iniciar sesión.');
  return ctx.user.email;
}

/** PUT /cuenta/contrasena {actual?, nueva} */
async function cambiarContrasena(ctx, { actual, nueva }) {
  const recuperacion = vieneDeRecuperacion(ctx.user);
  if (!recuperacion && !actual) throw new HttpError(400, 'Escribe tu contraseña actual.');
  if (actual && actual === nueva) throw new HttpError(400, 'La nueva contraseña debe ser distinta de la actual.');

  if (recuperacion) {
    // La sesión del enlace es reciente: se cambia con ella y sigue abierta
    await authRest.actualizarUsuario(ctx.token, { password: nueva });
    logger.info('contrasena_cambiada', { usuario: ctx.user.id, recuperacion });
    return { cambiada: true, recuperacion, sesion: null };
  }

  const sesionNueva = await authRest.comprobarContrasena(exigirCorreo(ctx), actual);
  try {
    await authRest.actualizarUsuario(sesionNueva.access_token, { password: nueva }, { contrasenaActual: actual });
  } catch (e) {
    await authRest.cerrarSesionToken(sesionNueva.access_token);
    throw e;
  }
  // La sesión con la que llegó la petición se cierra (si Supabase no lo hizo ya): el navegador sigue con la nueva
  await authRest.cerrarSesionToken(ctx.token);
  logger.info('contrasena_cambiada', { usuario: ctx.user.id, recuperacion });
  return { cambiada: true, recuperacion, sesion: sesionNueva };
}

/** POST /cuenta/correo {nuevo, actual} */
async function cambiarCorreo(ctx, { nuevo, actual }) {
  const correoActual = exigirCorreo(ctx);
  const destino = String(nuevo).trim().toLowerCase();
  if (destino === correoActual.trim().toLowerCase()) throw new HttpError(400, 'Ese ya es el correo de tu cuenta.');

  // Una sesión solo para este cambio (pedir el cambio de correo no cierra otras sesiones): después se cierra
  const { access_token: temporal } = await authRest.comprobarContrasena(correoActual, actual);
  let usuario;
  try {
    usuario = await authRest.actualizarUsuario(temporal, { email: destino }, { redirigirA: `${env.FRONTEND_URL}/Perfil?correo=confirmado` });
  } finally {
    await authRest.cerrarSesionToken(temporal);
  }
  logger.info('cambio_correo_pedido', { usuario: ctx.user.id });
  // Con la confirmación de correos desactivada en Supabase, el cambio es inmediato
  if (String(usuario?.email || '').toLowerCase() === destino) return { cambiado: true, correo: destino, pendiente: null };
  return { cambiado: false, correo: correoActual, pendiente: usuario?.new_email || destino };
}

/** Correo nuevo que espera confirmación (o null). Si Auth no responde, null: no estorba al perfil. */
async function correoPendiente(ctx) {
  try {
    return (await authRest.leerUsuario(ctx.token))?.new_email || null;
  } catch {
    return null;
  }
}

module.exports = { estadoContrasena, cambiarContrasena, cambiarCorreo, correoPendiente, vieneDeRecuperacion, VENTANA_RECUPERACION_S };
