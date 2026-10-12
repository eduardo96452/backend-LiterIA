// modules/revisiones/revisiones.repo.js
// Acceso a datos de revisiones. Todas las consultas van COMO EL USUARIO (sb.forUser): RLS decide
// qué filas ve y cuáles puede cambiar, así que un error aquí no expone datos ajenos.
// Solo consultas: las decisiones (404, 403…) las toma el servicio.
const sb = require('../../infra/supabase');

const COLS = 'id_detalles_revision, id_usuarios, titulo_revision, objetivo, tipo_revision, descripcion, ' +
  'fecha_creacion, fecha_modificacion, alcance, pais, ciudad, area_conocimiento, tipo_investigacion, institucion, id_plantilla';
const COLS_LISTA = 'id_detalles_revision, id_usuarios, titulo_revision, tipo_revision, fecha_creacion, fecha_modificacion';

function datos({ data, error }) {
  if (error) throw sb.fromSupabaseError(error);
  return data;
}

/** Revisiones visibles para el usuario (propias y compartidas); `soloDe` filtra por dueño. */
async function listar(token, { soloDe } = {}) {
  let q = sb.forUser(token).from('detalles_revision').select(COLS_LISTA)
    .order('fecha_modificacion', { ascending: false });
  if (soloDe) q = q.eq('id_usuarios', soloDe);
  return datos(await q);
}

/** Una revisión o null si no existe o el usuario no puede verla. */
async function obtener(token, id) {
  return datos(await sb.forUser(token).from('detalles_revision')
    .select(COLS).eq('id_detalles_revision', id).maybeSingle());
}

async function crear(token, fila) {
  return datos(await sb.forUser(token).from('detalles_revision')
    .insert(fila).select(COLS).single());
}

/** Devuelve la fila actualizada, o null si RLS no dejó tocarla (no existe o es solo lectura). */
async function actualizar(token, id, cambios) {
  return datos(await sb.forUser(token).from('detalles_revision')
    .update(cambios).eq('id_detalles_revision', id).select(COLS).maybeSingle());
}

/** true si se borró; false si RLS no dejó (solo el propietario puede borrar). */
async function eliminar(token, id) {
  const filas = datos(await sb.forUser(token).from('detalles_revision')
    .delete().eq('id_detalles_revision', id).select('id_detalles_revision'));
  return (filas || []).length > 0;
}

/** Ids de los estudios de la revisión que tienen PDF (sus carpetas en el bucket: estudios/<id>/). */
async function idsEstudiosConPdf(token, id) {
  const filas = datos(await sb.forUser(token).from('estudios')
    .select('id_estudios').eq('id_detalles_revision', id).not('url_pdf_articulo', 'is', null));
  return (filas || []).map(f => f.id_estudios);
}

/** ¿Puede el usuario escribir en la revisión (propietario o revisor)? Usa owns_revision() de la base. */
async function puedeEscribir(token, id) {
  return Boolean(await sb.rpc(sb.forUser(token), 'owns_revision', { rev_id: id }));
}

/** Favorita / oculta para el usuario actual. null = no cambiar ese valor. */
async function marcar(token, id, { favorita = null, oculta = null }) {
  return sb.rpc(sb.forUser(token), 'fn_marcar_revision', { p_id_rev: id, p_favorita: favorita, p_oculta: oculta });
}

/** Progreso por fases (jsonb de fn_progreso_revision). La función comprueba que el usuario pueda leerla. */
async function progreso(token, id) {
  return sb.rpc(sb.forUser(token), 'fn_progreso_revision', { p_id_rev: id });
}

async function preferencias(token) {
  return datos(await sb.forUser(token).from('preferencias_revision')
    .select('id_detalles_revision, favorita, oculta')) || [];
}

module.exports = { listar, obtener, crear, actualizar, eliminar, idsEstudiosConPdf, puedeEscribir, marcar, progreso, preferencias, COLS, COLS_LISTA };
