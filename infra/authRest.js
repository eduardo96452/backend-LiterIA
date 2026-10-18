// infra/authRest.js
// Llamadas directas a Supabase Auth (GoTrue) para lo que el cliente de supabase-js no hace bien en
// un servidor sin estado: comprobar la contraseña actual sin tocar la sesión del navegador, y
// cambiar la contraseña o el correo con una sesión recién abierta (Supabase exige una sesión
// reciente para esos cambios si está activado «Secure password change»).
//
//   comprobarContrasena(correo, contrasena) → una sesión nueva { access_token, refresh_token } (o HttpError 400)
//   actualizarUsuario(token, cambios, { redirigirA, contrasenaActual })
//   cerrarSesionToken(token)                → cierra esa sesión (la temporal) y nada más
//   leerUsuario(token)                      → el usuario de Auth (para saber si hay un cambio de correo pendiente)
const axios = require('axios');
const env = require('../config/env');
const logger = require('../core/logger');
const { HttpError } = require('../core/httpError');

const http = axios.create({
  baseURL: `${env.SUPABASE_URL}/auth/v1`,
  timeout: 15_000,
  headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }
});
const conToken = token => ({ headers: { Authorization: `Bearer ${token}` } });

/** Código de error de GoTrue (las versiones nuevas usan code; las antiguas, error/msg). */
const codigoDe = e => e?.response?.data?.error_code || e?.response?.data?.code || e?.response?.data?.error || null;
const mensajeDe = e => String(e?.response?.data?.msg || e?.response?.data?.error_description || e?.response?.data?.message || e?.message || '');

function errorDeAuth(e, accion) {
  if (e instanceof HttpError) return e;
  const st = e?.response?.status;
  const codigo = String(codigoDe(e) || '');
  const msg = mensajeDe(e);
  if (st === 429 || /rate_limit/.test(codigo)) {
    return new HttpError(429, /email/.test(codigo) || /email/i.test(msg)
      ? 'Se enviaron demasiados correos en poco tiempo. Espera unos minutos y vuelve a intentarlo.'
      : 'Demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.');
  }
  if (codigo === 'same_password' || /different from the old password/i.test(msg)) {
    return new HttpError(400, 'La nueva contraseña debe ser distinta de la actual.');
  }
  if (codigo === 'weak_password' || /password should|weak password/i.test(msg)) {
    return new HttpError(400, 'Supabase rechazó la contraseña por débil o por aparecer en filtraciones conocidas. Elige otra.');
  }
  if (codigo === 'email_exists' || /already been registered|already registered/i.test(msg)) {
    return new HttpError(409, 'Ya hay una cuenta con ese correo.');
  }
  if (codigo === 'email_address_invalid' || /invalid format|email address .* invalid/i.test(msg)) {
    return new HttpError(400, 'Ese correo no es válido.');
  }
  if (codigo === 'reauthentication_needed' || codigo === 'reauthentication_not_valid') {
    return new HttpError(401, 'Por seguridad, vuelve a iniciar sesión y repite el cambio.');
  }
  if (codigo === 'current_password_mismatch' || codigo === 'current_password_required') {
    return new HttpError(400, 'La contraseña actual no es correcta.');
  }
  logger.warn('auth_rest_error', { accion, status: st, codigo, message: msg.slice(0, 200) });
  if (!st || st >= 500) return new HttpError(503, 'El servicio de cuentas no respondió. Inténtalo de nuevo en unos segundos.');
  return new HttpError(400, `No se pudo ${accion}.`);
}

/** Abre una sesión nueva con la contraseña: si no es la correcta, 400 con un mensaje claro. */
async function comprobarContrasena(correo, contrasena) {
  try {
    const { data } = await http.post('/token?grant_type=password', { email: correo, password: contrasena });
    if (!data?.access_token) throw new Error('sin token');
    return { access_token: data.access_token, refresh_token: data.refresh_token || null };
  } catch (e) {
    const st = e?.response?.status;
    const codigo = String(codigoDe(e) || '');
    if ((st === 400 || st === 401) && (/invalid_grant|invalid_credentials/.test(codigo) || /invalid login credentials/i.test(mensajeDe(e)))) {
      throw new HttpError(400, 'La contraseña actual no es correcta.');
    }
    throw errorDeAuth(e, 'comprobar la contraseña');
  }
}

async function actualizarUsuario(token, cambios, { redirigirA, contrasenaActual } = {}) {
  const cuerpo = { ...cambios };
  // Si en Supabase está activado «Require current password when changing password», lo pide aquí
  if (contrasenaActual && cambios.password) cuerpo.current_password = contrasenaActual;
  try {
    const { data } = await http.put('/user', cuerpo, { ...conToken(token), params: redirigirA ? { redirect_to: redirigirA } : undefined });
    return data;
  } catch (e) {
    throw errorDeAuth(e, cambios.email ? 'cambiar el correo' : 'cambiar la contraseña');
  }
}

/** Cierra solo la sesión de ese token (scope=local). Si falla, no es grave: caduca sola. */
async function cerrarSesionToken(token) {
  try {
    await http.post('/logout', null, { ...conToken(token), params: { scope: 'local' } });
  } catch (e) {
    logger.warn('auth_rest_logout', { status: e?.response?.status, message: e.message });
  }
}

async function leerUsuario(token) {
  const { data } = await http.get('/user', conToken(token));
  return data;
}

module.exports = { comprobarContrasena, actualizarUsuario, cerrarSesionToken, leerUsuario, _http: http };
