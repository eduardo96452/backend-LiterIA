// modules/estudios/cribado.service.js
// Cribado: sugerencias de la IA (la decisión siempre es humana) y cribado independiente entre
// revisores (cada uno decide sin ver al otro; el propietario resuelve los desacuerdos).
const env = require('../../config/env');
const sb = require('../../infra/supabase');
const repo = require('./estudios.repo');
const revisiones = require('../revisiones/revisiones.service');
const { HttpError } = require('../../core/httpError');
const { sugerirCribado } = require('../../ia/cribado');
const { criterioValido } = require('./estudios.service');

const cliente = ctx => sb.forUser(ctx.token);
function datos({ data, error }) {
  if (error) throw sb.fromSupabaseError(error);
  return data;
}

async function estudioDe(ctx, idRev, idEstudio, cols = 'id_estudios') {
  const fila = datos(await cliente(ctx).from('estudios').select(cols)
    .eq('id_estudios', idEstudio).eq('id_detalles_revision', idRev).maybeSingle());
  if (!fila) throw new HttpError(404, 'Estudio no encontrado en esta revisión.');
  return fila;
}

/* ---------- Sugerencias de la IA ---------- */

/** Mismo comportamiento que POST /api/cribado/sugerir, con la revisión en la URL. */
async function sugerir(ctx, idRev, { ids_estudios, solo_sin_clasificar, max }) {
  const revision = await revisiones.exigirEscritura(ctx, idRev);   // antes de gastar tokens
  const criterios = await repo.criterios(ctx.token, idRev);
  if (!criterios.length) throw new HttpError(400, 'La revisión no tiene criterios de inclusión/exclusión definidos.');

  let q = cliente(ctx).from('estudios').select('id_estudios, titulo, resumen, autores, anio, revista, estado')
    .eq('id_detalles_revision', idRev).order('id_estudios');
  if (ids_estudios?.length) q = q.in('id_estudios', ids_estudios);
  if (solo_sin_clasificar) q = q.ilike('estado', 'sin clasificar');
  const estudios = datos(await q.limit(max)) || [];
  if (!estudios.length) return { procesados: 0, sugerencias: [], errores: [] };

  const sugerencias = [], errores = [];
  const LOTE = 4;                                     // concurrencia limitada (límites de OpenAI)
  for (let i = 0; i < estudios.length; i += LOTE) {
    const parte = await Promise.allSettled(estudios.slice(i, i + LOTE).map(async e => {
      const s = await sugerirCribado(e, criterios, revision.objetivo);
      await sb.rpc(cliente(ctx), 'fn_guardar_sugerencia_cribado', {
        p_id_estudio: e.id_estudios, p_sugerencia: s.sugerencia, p_id_criterio: s.id_criterio,
        p_confianza: s.confianza, p_justificacion: s.justificacion, p_modelo: env.OPENAI_MODEL
      });
      return { id_estudios: e.id_estudios, ...s };
    }));
    parte.forEach((r, j) => (r.status === 'fulfilled'
      ? sugerencias.push(r.value)
      : errores.push({ id_estudios: estudios[i + j].id_estudios, error: r.reason?.message || 'error' })));
  }
  return { procesados: sugerencias.length, sugerencias, errores };
}

/* ---------- Cribado independiente ---------- */

/** Estudios de la revisión con la decisión propia ya incorporada. */
async function mio(ctx, idRev) {
  await revisiones.obtener(ctx, idRev);
  const [estudios, mias] = await Promise.all([
    repo.todas(conteo => cliente(ctx).from('estudios')
      .select('id_estudios, titulo, resumen, autores, anio, estado', conteo ? { count: 'exact' } : undefined)
      .eq('id_detalles_revision', idRev).order('id_estudios')),
    repo.todas(conteo => cliente(ctx).from('cribado_revisor')
      .select('id_estudios, decision, id_criterio, comentario, estudios!inner(id_detalles_revision)', conteo ? { count: 'exact' } : undefined)
      .eq('id_usuarios', ctx.user.id).eq('estudios.id_detalles_revision', idRev).order('id_estudios'))
  ]);
  const porEstudio = new Map(mias.map(d => [d.id_estudios, d]));
  return estudios.map(e => {
    const m = porEstudio.get(e.id_estudios);
    return m ? { ...e, miDecision: m.decision, miCriterio: m.id_criterio, miComentario: m.comentario } : e;
  });
}

const ESTADO_DE = { Aceptado: 'Aceptado', Rechazado: 'Rechazado' };

async function decidir(ctx, idRev, { id_estudios, decision, id_criterio, comentario }) {
  await estudioDe(ctx, idRev, id_estudios);
  const criterio = id_criterio == null || !ESTADO_DE[decision]
    ? null
    : criterioValido(await repo.criterios(ctx.token, idRev), ESTADO_DE[decision], id_criterio);
  await sb.rpc(cliente(ctx), 'fn_registrar_cribado_revisor', {
    p_id_estudio: id_estudios, p_decision: decision, p_id_criterio: criterio, p_comentario: comentario || null
  });
  return { id_estudios, decision, id_criterio: criterio, comentario: comentario || null };
}

async function conflictos(ctx, idRev) {
  return (await sb.rpc(cliente(ctx), 'fn_conflictos_cribado', { p_id_rev: idRev })) || [];
}

/** Decisión final del propietario (la base comprueba que lo es). */
async function resolver(ctx, idRev, idEstudio, { decision, id_criterio }) {
  await estudioDe(ctx, idRev, idEstudio);
  const criterio = id_criterio == null ? null : criterioValido(await repo.criterios(ctx.token, idRev), decision, id_criterio);
  await sb.rpc(cliente(ctx), 'fn_resolver_conflicto_cribado', {
    p_id_estudio: idEstudio, p_decision_final: decision, p_id_criterio: criterio
  });
  return { id_estudios: idEstudio, estado: decision, id_criterio: criterio };
}

async function kappa(ctx, idRev, a, b) {
  if (a === b) throw new HttpError(400, 'Elige dos revisores distintos.');
  return sb.rpc(cliente(ctx), 'fn_kappa_cohen', { p_id_rev: idRev, p_revisor_a: a, p_revisor_b: b });
}

module.exports = { sugerir, mio, decidir, conflictos, resolver, kappa };
