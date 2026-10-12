// modules/extraccion/extraccion.repo.js
// Consultas de la Extracción de datos. Todas como el usuario (sb.forUser): RLS decide.
const sb = require('../../infra/supabase');
const { todas } = require('../estudios/estudios.repo');

function datos({ data, error }) {
  if (error) throw sb.fromSupabaseError(error);
  return data;
}
const cliente = token => sb.forUser(token);

/** Estudios aceptados que alcanzan la puntuación mínima, con su puntuación y su marca de «hecho». */
function estudios(token, idRev) {
  return todas(conteo => cliente(token)
    .rpc('fn_get_studies_with_score_done', { id_revision: idRev }, conteo ? { count: 'exact' } : undefined)
    .order('id_estudios'));
}

async function campos(token, idRev) {
  return datos(await cliente(token).from('campos_extraccion')
    .select('id_campo_extraccion, descripcion, tipo, orden')
    .eq('id_revision', idRev)
    .order('orden', { ascending: true }).order('id_campo_extraccion', { ascending: true })) || [];
}

/** Respuestas de esos campos (una por estudio y campo desde el sql/006). */
function respuestas(token, idsCampos) {
  return todas(conteo => cliente(token).from('respuestas_extraccion')
    .select('id_estudios, id_campo_extraccion, valor, fecha, id_respuesta_extraccion', conteo ? { count: 'exact' } : undefined)
    .in('id_campo_extraccion', idsCampos)
    .order('id_respuesta_extraccion'));
}

async function umbral(token, idRev) {
  const fila = datos(await cliente(token).from('puntuaciones_evaluacion')
    .select('puntuacion_limite').eq('id_detalles_revision', idRev).maybeSingle());
  return Number(fila?.puntuacion_limite) || 0;
}

/** Guarda en una transacción (fn_guardar_extraccion_estudio). Devuelve { respondidas, done }. */
function guardar(token, idRev, idEstudio, respuestasEstudio, done) {
  return sb.rpc(cliente(token), 'fn_guardar_extraccion_estudio', {
    p_id_rev: idRev, p_id_estudio: idEstudio,
    p_respuestas: respuestasEstudio, p_done: done === undefined ? null : done
  });
}

module.exports = { estudios, campos, respuestas, umbral, guardar };
