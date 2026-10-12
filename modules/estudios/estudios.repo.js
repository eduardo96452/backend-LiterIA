// modules/estudios/estudios.repo.js
// Consultas de la pantalla de Estudios. Todas como el usuario (sb.forUser): RLS decide.
const sb = require('../../infra/supabase');
const { COLS } = require('./campos');

function datos({ data, error }) {
  if (error) throw sb.fromSupabaseError(error);
  return data;
}
const cliente = token => sb.forUser(token);

const POR_PAGINA = 1000;

/**
 * Todas las filas de una consulta, por páginas. Supabase corta en 1000 filas por petición
 * (antes, una revisión con más de 1000 estudios se veía incompleta sin avisar).
 * `construir(conteo)` debe devolver la consulta sin .range().
 */
async function todas(construir) {
  const filas = [];
  let total = null;
  for (let desde = 0; desde < 200_000;) {
    const r = await construir(desde === 0).range(desde, desde + POR_PAGINA - 1);
    const lote = datos(r) || [];
    if (desde === 0 && typeof r.count === 'number') total = r.count;
    filas.push(...lote);
    desde += lote.length;
    if (!lote.length) break;
    if (total !== null ? filas.length >= total : lote.length < POR_PAGINA) break;
  }
  return filas;
}

const SUGERENCIA = 'cribado_sugerencias(sugerencia, id_criterio, confianza, justificacion, revisada, fecha)';

/* ---------- Estudios ---------- */

function listar(token, idRev) {
  return todas(conteo => cliente(token).from('estudios')
    .select(`${COLS}, ${SUGERENCIA}`, conteo ? { count: 'exact' } : undefined)
    .eq('id_detalles_revision', idRev).order('id_estudios'));
}

/** Título y DOI de todos los estudios de la revisión, para marcar duplicados. */
function claves(token, idRev) {
  return todas(conteo => cliente(token).from('estudios')
    .select('id_estudios, titulo, doi, estado', conteo ? { count: 'exact' } : undefined)
    .eq('id_detalles_revision', idRev).order('id_estudios'));
}

async function uno(token, idRev, idEstudio) {
  return datos(await cliente(token).from('estudios')
    .select(`${COLS}, ${SUGERENCIA}`)
    .eq('id_estudios', idEstudio).eq('id_detalles_revision', idRev).maybeSingle());
}

async function insertar(token, filas) {
  return datos(await cliente(token).from('estudios').insert(filas).select(COLS)) || [];
}

/** Devuelve la fila actualizada, o null si RLS no dejó (lector). */
async function actualizar(token, idRev, idEstudio, cambios) {
  const filas = datos(await cliente(token).from('estudios').update(cambios)
    .eq('id_estudios', idEstudio).eq('id_detalles_revision', idRev).select(COLS)) || [];
  return filas[0] ?? null;
}

/** true si se borró; false si RLS no dejó (lector). */
async function borrar(token, idRev, idEstudio) {
  const filas = datos(await cliente(token).from('estudios').delete()
    .eq('id_estudios', idEstudio).eq('id_detalles_revision', idRev).select('id_estudios')) || [];
  return filas.length > 0;
}

async function criterios(token, idRev) {
  return datos(await cliente(token).from('criterios').select('id_criterios, descripcion, tipo')
    .eq('id_detalles_revision', idRev).order('fecha_ingreso', { ascending: true })) || [];
}

/** Marca la sugerencia de la IA como revisada y si se aceptó (para medir la precisión del cribado). */
async function aplicarDecision(token, idEstudio, estado, idCriterio) {
  return sb.rpc(cliente(token), 'fn_aplicar_decision_cribado', {
    p_id_estudio: idEstudio, p_estado_final: estado, p_id_criterio: idCriterio ?? null
  });
}

/* ---------- Calidad ---------- */

async function preguntasCalidad(token, idRev) {
  return datos(await cliente(token).from('evaluacion_calidad_preguntas').select('id_pregunta, descripcion')
    .eq('id_detalles_revision', idRev).order('id_pregunta')) || [];
}

async function respuestasCalidad(token, idRev) {
  return datos(await cliente(token).from('evaluacion_calidad_respuestas').select('id_respuesta, descripcion, peso')
    .eq('id_detalles_revision', idRev).order('id_respuesta')) || [];
}

async function umbral(token, idRev) {
  return datos(await cliente(token).from('puntuaciones_evaluacion').select('puntuacion_limite, puntuacion_maxima')
    .eq('id_detalles_revision', idRev).maybeSingle());
}

/** Respuestas guardadas de todos los estudios de la revisión, en una consulta (antes, una por estudio). */
function evaluaciones(token, idRev) {
  return todas(conteo => cliente(token).from('calidad_estudios')
    .select('id_calidad, id_estudios, id_pregunta, id_respuesta, peso, fecha_evaluacion, estudios!inner(id_detalles_revision)',
      conteo ? { count: 'exact' } : undefined)
    .eq('estudios.id_detalles_revision', idRev).order('id_calidad'));
}

async function evaluacionEstudio(token, idEstudio) {
  return datos(await cliente(token).from('calidad_estudios')
    .select('id_calidad, id_estudios, id_pregunta, id_respuesta, peso, fecha_evaluacion')
    .eq('id_estudios', idEstudio).order('id_calidad')) || [];
}

async function guardarCalidad(token, idEstudio, respuestas) {
  return sb.rpc(cliente(token), 'fn_guardar_calidad_estudio', { p_id_estudio: idEstudio, p_respuestas: respuestas });
}

/* Sin la función de 004_fase3_estudios.sql: borrar e insertar (no es atómico, pero sí correcto). */
async function borrarCalidad(token, idEstudio) {
  return datos(await cliente(token).from('calidad_estudios').delete().eq('id_estudios', idEstudio).select('id_calidad'));
}
async function insertarCalidad(token, filas) {
  return datos(await cliente(token).from('calidad_estudios').insert(filas).select('id_pregunta, id_respuesta, peso')) || [];
}

module.exports = {
  todas, listar, claves, uno, insertar, actualizar, borrar, criterios, aplicarDecision,
  preguntasCalidad, respuestasCalidad, umbral, evaluaciones, evaluacionEstudio, guardarCalidad, borrarCalidad, insertarCalidad
};
