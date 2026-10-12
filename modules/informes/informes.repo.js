// modules/informes/informes.repo.js
// Consultas de la pantalla de Informes. Todas como el usuario (sb.forUser): RLS decide.
const sb = require('../../infra/supabase');

function datos({ data, error }) {
  if (error) throw sb.fromSupabaseError(error);
  return data;
}
const cliente = token => sb.forUser(token);

/* ---------- Secciones ---------- */

async function filaSecciones(token, idRev) {
  return datos(await cliente(token).from('secciones_revision').select('*')
    .eq('id_detalles_revision', idRev).maybeSingle());
}

/** Guarda SOLO esa sección y deja versión (la función no versiona si el contenido no cambió). */
async function guardarVersion(token, idRev, seccion, contenido, origen, modelo) {
  return sb.rpc(cliente(token), 'fn_guardar_version_seccion', {
    p_id_rev: idRev, p_seccion: seccion, p_contenido: contenido, p_origen: origen, p_modelo: modelo ?? null
  });
}

async function idVersion(token, idRev, seccion, version) {
  const fila = datos(await cliente(token).from('secciones_versiones').select('id_version')
    .eq('id_detalles_revision', idRev).eq('seccion', seccion).eq('version', version).maybeSingle());
  return fila?.id_version ?? null;
}

/** Valoración: escribe una sola columna; crea la fila de secciones si aún no existía. */
async function valorar(token, idRev, columna, valor) {
  return datos(await cliente(token).from('secciones_revision')
    .upsert({ id_detalles_revision: idRev, [columna]: valor }, { onConflict: 'id_detalles_revision' })
    .select(columna).single());
}

async function historial(token, idRev, seccion) {
  return (await sb.rpc(cliente(token), 'fn_historial_seccion', { p_id_rev: idRev, p_seccion: seccion })) || [];
}

async function restaurar(token, idVersionGuardada) {
  return sb.rpc(cliente(token), 'fn_restaurar_version_seccion', { p_id_version: idVersionGuardada });
}

/* ---------- Trazabilidad de la IA (generaciones_ia) ---------- */

async function registrarGeneracion(token, p) {
  return sb.rpc(cliente(token), 'fn_registrar_generacion_ia', p);
}

async function generacion(token, idGeneracion) {
  return datos(await cliente(token).from('generaciones_ia')
    .select('id_generacion, id_detalles_revision, seccion, modelo')
    .eq('id_generacion', idGeneracion).maybeSingle());
}

async function vincularGeneracion(token, idGeneracion, idVersionGuardada) {
  return datos(await cliente(token).from('generaciones_ia')
    .update({ id_version: idVersionGuardada }).eq('id_generacion', idGeneracion).select('id_generacion'));
}

/* ---------- Contexto para la IA ---------- */

async function preguntas(token, idRev) {
  return datos(await cliente(token).from('preguntas_investigacion')
    .select('id_preguntas_investigacion, pregunta').eq('id_detalles_revision', idRev)
    .order('id_preguntas_investigacion')) || [];
}

async function criterios(token, idRev) {
  return datos(await cliente(token).from('criterios')
    .select('id_criterios, descripcion, tipo').eq('id_detalles_revision', idRev).order('id_criterios')) || [];
}

/** Planificación agregada (fn_get_ia_context): framework, PICOC, cadenas, bases, criterios. */
async function contextoPlanificacion(token, idRev) {
  const filas = await sb.rpc(cliente(token), 'fn_get_ia_context', { p_id_rev: idRev });
  return (filas || [])[0] ?? null;
}

async function estudiosEstado(token, idRev) {
  return datos(await cliente(token).from('estudios')
    .select('id_estudios, estado, titulo').eq('id_detalles_revision', idRev).order('id_estudios')) || [];
}

async function respuestasExtraccion(token, idRev) {
  return (await sb.rpc(cliente(token), 'fn_get_extraction_responses', { p_id_rev: idRev })) || [];
}

/* ---------- PRISMA ---------- */

async function datosPrisma(token, idRev) {
  const c = cliente(token);
  const [estudios, criteriosExclusion] = await Promise.all([
    c.from('estudios').select('fuente_bibliografica, estado, id_criterio').eq('id_detalles_revision', idRev),
    c.from('criterios').select('id_criterios, descripcion').eq('id_detalles_revision', idRev)
      .eq('tipo', 'exclusion').order('id_criterios')
  ]);
  return { estudios: datos(estudios) || [], criterios: datos(criteriosExclusion) || [] };
}

/* ---------- Informes generados (Word) ---------- */

const COLS_INFORME = 'id_informes_generados, id_detalles_revision, nombre_informe, ruta_archivo, fecha_generacion';

async function listarInformes(token, idRev) {
  return datos(await cliente(token).from('informes_generados').select(COLS_INFORME)
    .eq('id_detalles_revision', idRev).order('fecha_generacion', { ascending: false })) || [];
}

async function informe(token, idRev, idInforme) {
  return datos(await cliente(token).from('informes_generados').select(COLS_INFORME)
    .eq('id_informes_generados', idInforme).eq('id_detalles_revision', idRev).maybeSingle());
}

async function insertarInforme(token, fila) {
  return datos(await cliente(token).from('informes_generados').insert(fila).select(COLS_INFORME).single());
}

/** true si se borró; false si RLS no dejó (lector). */
async function borrarInforme(token, idRev, idInforme) {
  const filas = datos(await cliente(token).from('informes_generados').delete()
    .eq('id_informes_generados', idInforme).eq('id_detalles_revision', idRev).select('id_informes_generados'));
  return (filas || []).length > 0;
}

module.exports = {
  filaSecciones, guardarVersion, idVersion, valorar, historial, restaurar,
  registrarGeneracion, generacion, vincularGeneracion,
  preguntas, criterios, contextoPlanificacion, estudiosEstado, respuestasExtraccion,
  datosPrisma, listarInformes, informe, insertarInforme, borrarInforme
};
