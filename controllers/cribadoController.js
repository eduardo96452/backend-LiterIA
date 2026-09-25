// controllers/cribadoController.js  (Tanda A, mejora 3)
// La IA sugiere Aceptado/Rechazado/Dudoso según los criterios que el usuario definió.
// Guarda la sugerencia con fn_guardar_sugerencia_cribado; la decisión final sigue siendo humana.
const { callOpenAI } = require('../services/openaiService');
const { forUser, rpc, fromSupabaseError } = require('../services/supabaseService');
const { parseAiJson } = require('../utils/aiJson');
const { HttpError } = require('../utils/httpError');

async function sugerirUno(sb, estudio, criterios, objetivo) {
  const lista = criterios.map(c => `[${c.id_criterios}] (${c.tipo}) ${c.descripcion}`).join('\n');
  const prompt = `
Eres un revisor experto en revisiones sistemáticas. Decide si el estudio debe incluirse aplicando ESTRICTAMENTE los criterios.

Objetivo de la revisión: ${objetivo || '(no indicado)'}

Criterios (con su id):
${lista}

Estudio:
- Título: ${estudio.titulo}
- Autores: ${estudio.autores || 'desconocidos'} (${estudio.anio || 's.f.'})
- Revista: ${estudio.revista || 'desconocida'}
- Resumen: ${(estudio.resumen || 'sin resumen').slice(0, 3000)}

Reglas:
1. "Rechazado" si incumple cualquier criterio de exclusión o no cumple alguno de inclusión verificable.
2. "Aceptado" si cumple todos los de inclusión y ninguno de exclusión.
3. "Dudoso" si el resumen no permite verificarlo.
4. Indica el id del criterio determinante y una justificación de 1-2 frases basada en el texto.

Devuelve solo JSON: {"sugerencia":"Aceptado|Rechazado|Dudoso","id_criterio":<id o null>,"confianza":<0..1>,"justificacion":"..."}`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un revisor metodológico riguroso. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { temperature: 0.1, maxTokens: 400, json: true });

  const out = parseAiJson(raw);
  const sugerencia = ['Aceptado', 'Rechazado', 'Dudoso'].includes(out.sugerencia) ? out.sugerencia : 'Dudoso';
  const idCriterio = criterios.some(c => c.id_criterios === Number(out.id_criterio)) ? Number(out.id_criterio) : null;
  const confianza = Math.max(0, Math.min(1, Number(out.confianza) || 0));
  const justificacion = String(out.justificacion || '').slice(0, 1000);

  await rpc(sb, 'fn_guardar_sugerencia_cribado', {
    p_id_estudio: estudio.id_estudios, p_sugerencia: sugerencia, p_id_criterio: idCriterio,
    p_confianza: confianza, p_justificacion: justificacion, p_modelo: process.env.OPENAI_MODEL || 'gpt-4o-mini'
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
