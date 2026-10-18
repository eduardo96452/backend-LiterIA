// modules/notificaciones/correo.js
// Envía por correo los avisos que la base pone en la cola notificaciones_correo (sql/012): los que
// cada persona marcó como «Correo» en Preferencias de notificación.
//
// Cuándo se envían:
//   - Unos segundos después de cada acción que escribe en la aplicación (POST, PUT, PATCH, DELETE):
//     es cuando nacen los avisos (guardar una sección, aceptar una invitación, terminar una fase…).
//   - Cada minuto mientras el servidor está activo, y al arrancar: así salen también los recordatorios
//     y lo que quedó pendiente si Render tenía el servidor dormido.
//
// Necesita SUPABASE_SERVICE_ROLE_KEY (la cola no es legible por los usuarios) y GMAIL_USER/GMAIL_PASS.
const env = require('../../config/env');
const sb = require('../../infra/supabase');
const email = require('../../infra/email');
const logger = require('../../core/logger');

const LOTE = 25;
const MAX_INTENTOS = 5;
const DIAS = 3;                         // los avisos más viejos ya no se envían
const ajustes = { esperaMs: 4000, intervaloMs: 60_000 };

let corriendo = false;
let otraVez = false;
let temporizador = null;
let avisadoSinSql = false;

const activo = () => sb.adminDisponible() && email.correoDisponible();
const faltaTabla = e => e?.code === '42P01' || e?.code === 'PGRST205' || /notificaciones_correo/.test(e?.message || '') && /exist|find/i.test(e?.message || '');
const nombreDe = u => [u?.nombre, u?.apellido].filter(Boolean).join(' ').trim() || u?.nombre_usuario || '';
const enlaceDe = e => (e && e.startsWith('/') ? `${env.FRONTEND_URL}${e}` : null);

/** Envía los correos pendientes. Devuelve cuántos se enviaron. Nunca lanza. */
async function enviarPendientes() {
  if (!activo()) return 0;
  if (corriendo) { otraVez = true; return 0; }
  corriendo = true;
  let enviados = 0;
  try {
    const cli = sb.admin();
    const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString();
    const { data: filas, error } = await cli.from('notificaciones_correo')
      .select('id, id_usuarios, tipo, titulo, cuerpo, enlace, id_detalles_revision, intentos')
      .is('enviado_at', null).lt('intentos', MAX_INTENTOS).gte('fecha', desde)
      .order('fecha', { ascending: true }).limit(LOTE);
    if (error) {
      if (faltaTabla(error)) {
        if (!avisadoSinSql) logger.warn('correo_avisos_sin_sql', { message: 'Falta ejecutar sql/012_notificaciones_correo.sql' });
        avisadoSinSql = true;
        return 0;
      }
      throw error;
    }
    if (!filas?.length) return 0;

    const idsUsuarios = [...new Set(filas.map(f => f.id_usuarios))];
    const idsRevisiones = [...new Set(filas.map(f => f.id_detalles_revision).filter(Boolean))];
    const [usuarios, revisiones] = await Promise.all([
      cli.from('usuarios').select('id_usuarios, correo_electronico, nombre, apellido, nombre_usuario').in('id_usuarios', idsUsuarios),
      idsRevisiones.length
        ? cli.from('detalles_revision').select('id_detalles_revision, titulo_revision').in('id_detalles_revision', idsRevisiones)
        : Promise.resolve({ data: [] })
    ]);
    const porUsuario = new Map((usuarios.data || []).map(u => [u.id_usuarios, u]));
    const porRevision = new Map((revisiones.data || []).map(r => [r.id_detalles_revision, r.titulo_revision]));

    for (const f of filas) {
      // Se reserva la fila (si otro proceso ya la tomó, intentos no coincide y se salta)
      const { data: reservada } = await cli.from('notificaciones_correo')
        .update({ intentos: f.intentos + 1 }).eq('id', f.id).is('enviado_at', null).eq('intentos', f.intentos).select('id');
      if (!reservada?.length) continue;

      const u = porUsuario.get(f.id_usuarios);
      if (!u?.correo_electronico) {
        await cli.from('notificaciones_correo').update({ error: 'La persona no tiene correo.', intentos: MAX_INTENTOS }).eq('id', f.id);
        continue;
      }
      try {
        await email.sendNotificationMail({
          to: u.correo_electronico, nombre: nombreDe(u), titulo: f.titulo, cuerpo: f.cuerpo,
          revision: porRevision.get(f.id_detalles_revision) || null, enlace: enlaceDe(f.enlace),
          preferencias: `${env.FRONTEND_URL}/preferencias-notificacion`
        });
        await cli.from('notificaciones_correo').update({ enviado_at: new Date().toISOString(), error: null }).eq('id', f.id);
        enviados++;
      } catch (e) {
        logger.warn('correo_aviso_fallido', { id: f.id, message: e.message });
        await cli.from('notificaciones_correo').update({ error: String(e.message || e).slice(0, 300) }).eq('id', f.id);
      }
    }
    if (enviados) logger.info('correos_avisos_enviados', { enviados });
  } catch (e) {
    logger.warn('correo_avisos_error', { message: e.message });
  } finally {
    corriendo = false;
    if (otraVez) { otraVez = false; setImmediate(() => { enviarPendientes(); }); }
  }
  return enviados;
}

/** Tras una acción que escribe: envía lo pendiente en unos segundos (las rachas se agrupan). */
function avisar() {
  if (!activo()) return;
  if (temporizador) return;
  temporizador = setTimeout(() => { temporizador = null; enviarPendientes(); }, ajustes.esperaMs);
  temporizador.unref?.();
}

/** Arranque del servidor: una pasada ahora y luego cada minuto. */
function programar() {
  if (!activo()) {
    logger.info('correo_avisos_inactivo', { service_role: sb.adminDisponible(), gmail: email.correoDisponible() });
    return;
  }
  setTimeout(() => { enviarPendientes(); }, 5000).unref?.();
  setInterval(() => { enviarPendientes(); }, ajustes.intervaloMs).unref?.();
}

/** Middleware: después de cada petición que escribe, avisa al envío de correos. */
function trasEscritura(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    res.on('finish', () => { if (res.statusCode < 400) avisar(); });
  }
  next();
}

module.exports = { enviarPendientes, avisar, programar, trasEscritura, ajustes, MAX_INTENTOS };
