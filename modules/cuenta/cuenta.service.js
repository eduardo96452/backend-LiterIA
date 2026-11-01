// modules/cuenta/cuenta.service.js
// La cuenta del usuario de la sesión: perfil, foto, preferencias de notificación y sesiones abiertas.
// Todo como el usuario (RLS y las funciones fn_mis_* deciden). service_role solo para lo que lo
// necesita de verdad: bloquear unos segundos el inicio de sesión tras cerrar otra sesión y, si las
// políticas de Storage no lo permiten al usuario, guardar la foto en SU carpeta del bucket.
const env = require('../../config/env');
const logger = require('../../core/logger');
const sb = require('../../infra/supabase');
const storage = require('../../infra/storage');
const email = require('../../infra/email');
const { HttpError } = require('../../core/httpError');
const seguridad = require('./seguridad');

const COLS = 'id_usuarios, nombre_usuario, correo_electronico, nombre, apellido, institucion, ruta_imagen, orcid, profesion, pais';
const BUCKET_AVATARS = 'avatars';
const MAX_AVATAR = 2 * 1024 * 1024;
/** Segundos que la cuenta queda bloqueada tras cerrar una sesión ajena. */
const BLOQUEO_TRAS_CIERRE = '10s';

const cliente = ctx => sb.forUser(ctx.token);
function datos({ data, error }) {
  if (error) throw sb.fromSupabaseError(error);
  return data;
}

/* ---------- Perfil ---------- */

async function perfil(ctx) {
  const [r, pendiente] = await Promise.all([
    cliente(ctx).from('usuarios').select(COLS).eq('id_usuarios', ctx.user.id).maybeSingle(),
    seguridad.correoPendiente(ctx)
  ]);
  const fila = datos(r);
  if (!fila) throw new HttpError(404, 'Tu perfil todavía no existe.');
  return { ...fila, correo_pendiente: pendiente };
}

async function actualizarPerfil(ctx, cambios) {
  const fila = datos(await cliente(ctx).from('usuarios').update(cambios)
    .eq('id_usuarios', ctx.user.id).select(COLS).maybeSingle());
  if (!fila) throw new HttpError(404, 'Tu perfil todavía no existe.');
  return fila;
}

/* ---------- Foto de perfil ---------- */

/** Tipo real de la imagen por sus primeros bytes (no por lo que diga el navegador). */
function tipoDeImagen(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

/** Ruta dentro del bucket de una foto guardada por este backend (siempre en la carpeta del usuario). */
function rutaPropia(uid, url) {
  const marca = `/${BUCKET_AVATARS}/`;
  const s = String(url || '');
  const i = s.indexOf(marca);
  if (i < 0) return null;
  let ruta = s.slice(i + marca.length).split('?')[0];
  try { ruta = decodeURIComponent(ruta); } catch { return null; }
  const prefijo = `${uid}/`;
  if (!ruta.startsWith(prefijo) || ruta.includes('..') || ruta.slice(prefijo.length).includes('/')) return null;
  return ruta;
}

/** URL pública del bucket avatars (la misma que arma getPublicUrl de supabase-js, sin pedir nada). */
const urlPublica = ruta => `${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET_AVATARS}/${ruta.split('/').map(encodeURIComponent).join('/')}`;

async function subirAvatar(ctx, ruta, buf, mime) {
  try {
    await storage.subir(cliente(ctx), ruta, buf, mime, BUCKET_AVATARS);
  } catch (e) {
    // La ruta la elige el servidor y es la carpeta del propio usuario
    if (e.status !== 403 || !sb.adminDisponible()) throw e;
    logger.warn('avatar_subido_con_service_role', { ruta });
    await storage.subir(sb.admin(), ruta, buf, mime, BUCKET_AVATARS);
  }
}

/**
 * PUT /cuenta/avatar con la imagen en el cuerpo (PNG, JPG o WEBP de hasta 2 MB).
 * Antes el navegador la subía directo a `path/to/file/` del bucket; ahora va a `<uid>/` y la
 * foto anterior (si era de esa carpeta) se borra.
 */
async function cambiarAvatar(ctx, buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new HttpError(415, 'La imagen debe ser PNG, JPG o WEBP.');
  if (buf.length > MAX_AVATAR) throw new HttpError(413, 'La imagen no debe superar los 2 MB.');
  const tipo = tipoDeImagen(buf);
  if (!tipo) throw new HttpError(415, 'La imagen debe ser PNG, JPG o WEBP.');

  const anterior = (await perfil(ctx)).ruta_imagen;
  const ruta = `${ctx.user.id}/${Date.now()}.${tipo.ext}`;
  await subirAvatar(ctx, ruta, buf, tipo.mime);

  const url = urlPublica(ruta);
  let fila;
  try {
    fila = await actualizarPerfil(ctx, { ruta_imagen: url });
  } catch (e) {
    await storage.borrar(storage.clienteLimpieza(ctx.token), [ruta], BUCKET_AVATARS);   // no dejar la nueva huérfana
    throw e;
  }
  const vieja = rutaPropia(ctx.user.id, anterior);
  if (vieja && vieja !== ruta) await storage.borrar(storage.clienteLimpieza(ctx.token), [vieja], BUCKET_AVATARS);
  return { ruta_imagen: fila.ruta_imagen };
}

/* ---------- Preferencias de notificación ---------- */

function preferencias(ctx) {
  return sb.rpc(cliente(ctx), 'fn_mis_preferencias_notificacion');
}

function guardarPreferencias(ctx, valores) {
  return sb.rpc(cliente(ctx), 'fn_guardar_preferencias_notificacion', { p_valores: valores });
}

/* ---------- Sesiones ---------- */

async function sesiones(ctx) {
  return (await sb.rpc(cliente(ctx), 'fn_mis_sesiones')) || [];
}

/** ¿Sigue existiendo en el servidor la sesión de este token? (la vigila cada dispositivo) */
async function sesionVigente(ctx) {
  return { vigente: (await sb.rpc(cliente(ctx), 'fn_sesion_vigente')) !== false };
}

/**
 * Cierra una sesión (o todas las demás) y bloquea la cuenta unos segundos.
 *
 * Borrar la fila de auth.sessions impide renovar el token, pero el token de acceso que ya tenga
 * ese dispositivo sigue siendo válido hasta que caduca. Por eso además se bloquea la cuenta con
 * service_role: durante esos segundos nadie puede volver a entrar, que es el tiempo para cambiar
 * la contraseña. El dispositivo afectado lo detecta con GET /cuenta/sesion-vigente.
 */
async function cerrarSesion(ctx, { id, todas }) {
  const cl = cliente(ctx);
  let cerradas = 0;
  if (todas) {
    cerradas = Number(await sb.rpc(cl, 'fn_cerrar_otras_sesiones')) || 0;
  } else {
    if (!id) throw new HttpError(400, 'Falta el identificador de la sesión.');
    cerradas = (await sb.rpc(cl, 'fn_cerrar_sesion', { p_id: id })) ? 1 : 0;
  }

  let bloqueada = false;
  if (cerradas > 0 && env.adminEnabled) {
    try {
      // ban_duration bloquea el inicio de sesión y la renovación de tokens
      await sb.admin().auth.admin.updateUserById(ctx.user.id, { ban_duration: BLOQUEO_TRAS_CIERRE });
      bloqueada = true;
    } catch (e) {
      logger.warn('bloqueo_tras_cierre_fallido', { message: e.message });
    }
  }
  return { cerradas, bloqueo: bloqueada ? BLOQUEO_TRAS_CIERRE : null };
}

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
 * IP para leerla en el correo: sin el prefijo IPv4-en-IPv6 (::ffff:) y, si es la propia máquina
 * (al probar en local), dicho con palabras en lugar de «::1».
 */
function ipLegible(ip) {
  const limpia = String(ip ?? '').trim().replace(/^::ffff:/i, '');
  if (!limpia) return 'No disponible';
  if (limpia === '::1' || limpia === '127.0.0.1') return 'Este mismo equipo (conexión local)';
  return limpia;
}

/** «lunes, 12 de octubre de 2026, 15:20 (hora de Ecuador)». */
function fechaLegible(fecha = new Date()) {
  const texto = new Intl.DateTimeFormat('es-EC', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Guayaquil'
  }).format(fecha);
  return `${texto} (hora de Ecuador)`;
}

/**
 * Aviso de nuevo inicio de sesión. Lo pide el frontend justo después de entrar: el correo va
 * SIEMPRE a la dirección del token, nunca a una que llegue en la petición.
 */
async function avisoInicioSesion(ctx, { userAgent, ip }) {
  const destino = ctx.user?.email;
  if (!destino) return { enviado: false, motivo: 'sin_correo' };
  if (!env.mailEnabled) return { enviado: false, motivo: 'correo_no_configurado' };
  try {
    await email.sendNewSessionMail({
      to: destino,
      nombre: ctx.user?.nombre || null,
      dispositivo: describirDispositivo(userAgent || ''),
      ip: ipLegible(ip),
      fecha: fechaLegible(),
      enlaceSesiones: `${env.FRONTEND_URL}/sesiones-activas`
    });
    return { enviado: true };
  } catch (e) {
    // Un fallo de correo no debe romper el inicio de sesión del usuario
    logger.warn('aviso_sesion_fallido', { message: e.message });
    return { enviado: false, motivo: 'error_envio' };
  }
}

/* ---------- Eliminar la cuenta ---------- */

/** ¿Hay otro administrador además de este usuario? (el rol va en app_metadata) */
async function hayOtroAdmin(idPropio) {
  const cli = sb.admin();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await cli.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw sb.fromSupabaseError(error);
    const usuarios = data?.users ?? [];
    if (usuarios.some(u => u.id !== idPropio && u.app_metadata?.rol === 'admin')) return true;
    if (usuarios.length < 1000) return false;
  }
  return false;
}

/** Lo que se perdería: las revisiones propias (con cuántas personas más tienen) y las colaboraciones. */
async function resumenEliminacion(ctx) {
  const cli = cliente(ctx);
  const [propias, colaboraciones] = await Promise.all([
    cli.from('detalles_revision').select('id_detalles_revision, titulo_revision, colaboradores_revision(count)')
      .eq('id_usuarios', ctx.user.id).order('id_detalles_revision'),
    cli.from('colaboradores_revision').select('id_detalles_revision', { count: 'exact', head: true })
      .eq('id_usuarios', ctx.user.id).eq('estado', 'activo')
  ]);
  const filas = datos(propias) || [];
  return {
    disponible: sb.adminDisponible(),
    revisiones: filas.map(r => ({
      id: r.id_detalles_revision, titulo: r.titulo_revision,
      colaboradores: Number(r.colaboradores_revision?.[0]?.count) || 0
    })),
    colaboraciones: Number(colaboraciones?.count) || 0,
    admin: ctx.user?.rol === 'admin'
  };
}

/**
 * Borra la cuenta: primero las revisiones propias (con sus archivos), después la foto y por último
 * el usuario de Supabase Auth (la base borra en cascada el perfil, las colaboraciones, las
 * notificaciones y las preferencias). Exige escribir el correo de la cuenta para confirmar.
 */
async function eliminarCuenta(ctx, { confirmacion }) {
  if (!sb.adminDisponible()) {
    throw new HttpError(503, 'Eliminar cuentas no está activado en el servidor (falta SUPABASE_SERVICE_ROLE_KEY).');
  }
  const correo = String(ctx.user?.email || '').trim().toLowerCase();
  if (!correo || String(confirmacion || '').trim().toLowerCase() !== correo) {
    throw new HttpError(400, 'Escribe el correo de tu cuenta para confirmar.');
  }
  if (ctx.user?.rol === 'admin' && !(await hayOtroAdmin(ctx.user.id))) {
    throw new HttpError(409, `Eres el único administrador de ${env.APP_NOMBRE}: da el rol de administrador a otra persona antes de eliminar tu cuenta.`);
  }

  // Revisiones propias, una a una (así se borran también sus PDF e informes del almacenamiento)
  const revisiones = require('../revisiones/revisiones.service');
  const propias = datos(await cliente(ctx).from('detalles_revision').select('id_detalles_revision').eq('id_usuarios', ctx.user.id)) || [];
  for (const r of propias) await revisiones.eliminar(ctx, r.id_detalles_revision);

  await storage.borrarCarpeta(sb.admin(), ctx.user.id, BUCKET_AVATARS);

  const { error } = await sb.admin().auth.admin.deleteUser(ctx.user.id);
  if (error) {
    logger.error('eliminar_cuenta_fallido', { message: error.message });
    throw new HttpError(502, 'No se pudo eliminar la cuenta. Inténtalo de nuevo en unos minutos.');
  }
  logger.info('cuenta_eliminada', { revisiones: propias.length });
  return { revisiones: propias.length };
}

module.exports = {
  perfil, actualizarPerfil, cambiarAvatar, tipoDeImagen, rutaPropia, resumenEliminacion, eliminarCuenta,
  preferencias, guardarPreferencias, sesiones, sesionVigente, cerrarSesion, avisoInicioSesion,
  describirDispositivo, ipLegible, fechaLegible, MAX_AVATAR, BLOQUEO_TRAS_CIERRE
};
