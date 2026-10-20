// core/accesoRevision.js
// Solo el equipo de una revisión entra en ella, también los administradores.
//
// A un usuario normal ya lo frena la base: RLS no le deja leer una revisión de la que no es
// propietario ni colaborador (la API responde 404). Pero la base deja a los administradores LEER
// todas las revisiones (políticas *_admin_select, para el panel de administración), así que un
// administrador podía abrir la de cualquiera cambiando el número en la dirección
// (/detalle-revision?id=5). Este middleware, en todas las rutas /api/v1/revisiones/:id/…,
// comprueba que el administrador sea del equipo con fn_equipo_revision, que en la base exige
// can_read_revision() (propietario o colaborador activo, sin excepción para administradores).
// Si no lo es: 404, lo mismo que ve cualquier otro usuario.
//
// El panel de administración (/api/v1/admin/…) sigue igual: muestra el listado y los datos de
// uso, no el contenido de las revisiones.
const sb = require('../infra/supabase');
const logger = require('./logger');
const { HttpError } = require('./httpError');

const VIGENCIA_MS = 60 * 1000;
/** Comprobaciones superadas (administrador:revisión → hasta cuándo valen). Solo las positivas. */
const permitidos = new Map();
const MAX = 2000;

async function soloEquipo(req, _res, next) {
  try {
    if (req.user?.rol !== 'admin') return next();         // a los demás ya los frena RLS
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return next();   // la ruta valida el id y responde 400
    const clave = `${req.user.id}:${id}`;
    if ((permitidos.get(clave) ?? 0) > Date.now()) return next();

    try {
      await sb.rpc(sb.forUser(req.token), 'fn_equipo_revision', { p_id_rev: id });
    } catch (e) {
      if (e.status === 403 || e.status === 404) {
        logger.warn('revision_ajena_bloqueada', { id_revision: id });
        return next(new HttpError(404, 'No se encontró la revisión o no tienes acceso a ella.'));
      }
      throw e;
    }
    if (permitidos.size >= MAX) permitidos.clear();
    permitidos.set(clave, Date.now() + VIGENCIA_MS);
    next();
  } catch (e) {
    next(e);
  }
}

/** Solo para las pruebas. */
soloEquipo._reiniciar = () => permitidos.clear();

module.exports = { soloEquipo };
