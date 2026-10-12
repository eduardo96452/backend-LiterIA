// legacy/controllers/cribadoController.js  (Tanda A, mejora 3)
// La IA sugiere Aceptado/Rechazado/Dudoso según los criterios que el usuario definió.
// Guarda la sugerencia con fn_guardar_sugerencia_cribado; la decisión final sigue siendo humana.
const env = require('../../config/env');
const { forUser, rpc, fromSupabaseError } = require('../../infra/supabase');
const { sugerirCribado } = require('../../ia/cribado');
const { HttpError } = require('../../core/httpError');

async function sugerirUno(sb, estudio, criterios, objetivo) {
  const { sugerencia, id_criterio: idCriterio, confianza, justificacion } = await sugerirCribado(estudio, criterios, objetivo);

  await rpc(sb, 'fn_guardar_sugerencia_cribado', {
    p_id_estudio: estudio.id_estudios, p_sugerencia: sugerencia, p_id_criterio: idCriterio,
    p_confianza: confianza, p_justificacion: justificacion, p_modelo: env.OPENAI_MODEL
  });
  return { id_estudios: estudio.id_estudios, sugerencia, id_criterio: idCriterio, confianza, justificacion };
}

/** POST /api/cribado/sugerir  { id_detalles_revision, ids_estudios?: [] , solo_sin_clasificar?: true, max?: 20 } */
async function sugerir(req, res) {
  const { id_detalles_revision, ids_estudios, solo_sin_clasificar, max } = req.body;
  const sb = forUser(req.token);

  const [{ data: rev, error: e1 }, { data: criterios, error: e2 }] = await Promise.all([
    sb.from('detalles_revision').select('objetivo').eq('id_detalles_revision', id_detalles_revision).single(),
    sb.from('criterios').select('id_criterios, descripcion, tipo').eq('id_detalles_revision', id_detalles_revision)
  ]);
  if (e1) throw fromSupabaseError(e1);
  if (e2) throw fromSupabaseError(e2);
  if (!criterios?.length) throw new HttpError(400, 'La revisión no tiene criterios de inclusión/exclusión definidos.');

  let q = sb.from('estudios').select('id_estudios, titulo, resumen, autores, anio, revista, estado')
    .eq('id_detalles_revision', id_detalles_revision).order('id_estudios');
  if (ids_estudios?.length) q = q.in('id_estudios', ids_estudios);
  if (solo_sin_clasificar) q = q.ilike('estado', 'sin clasificar');
  const { data: estudios, error: e3 } = await q.limit(max);
  if (e3) throw fromSupabaseError(e3);
  if (!estudios?.length) return res.json({ procesados: 0, sugerencias: [] });

  // Concurrencia limitada para no disparar el rate limit de OpenAI
  const resultados = [];
  const errores = [];
  const LOTE = 4;
  for (let i = 0; i < estudios.length; i += LOTE) {
    const parte = await Promise.allSettled(estudios.slice(i, i + LOTE).map(e => sugerirUno(sb, e, criterios, rev?.objetivo)));
    parte.forEach((r, j) => r.status === 'fulfilled'
      ? resultados.push(r.value)
      : errores.push({ id_estudios: estudios[i + j].id_estudios, error: r.reason?.message || 'error' }));
  }
  res.json({ procesados: resultados.length, sugerencias: resultados, errores });
}

module.exports = { sugerir };
