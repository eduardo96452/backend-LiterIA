// modules/planificacion/planificacion.repo.js
// Consultas de la pantalla de Planificación. Todas como el usuario (sb.forUser): RLS decide qué ve
// y qué puede cambiar. Cada consulta filtra además por la revisión de la URL, para que un id de
// otra revisión (aunque el usuario también la edite) no se toque por la ruta equivocada.
// Las operaciones de varios pasos van en funciones SQL (sql/005): una sola transacción.
const sb = require('../../infra/supabase');

function datos({ data, error }) {
  if (error) throw sb.fromSupabaseError(error);
  return data;
}
const cliente = token => sb.forUser(token);
const rpc = (token, fn, params) => sb.rpc(cliente(token), fn, params);

/* ---------- Lectura de la planificación ---------- */

/** Filas del framework guardado, con el componente y su framework. */
async function componentesRevision(token, idRev) {
  return datos(await cliente(token).from('componente_revision')
    .select('id_componente_revision, id_componente, palabra_clave, componente(id_metodologia)')
    .eq('id_revision', idRev).order('id_componente_revision')) || [];
}

async function preguntas(token, idRev) {
  return datos(await cliente(token).from('preguntas_investigacion')
    .select('id_preguntas_investigacion, pregunta')
    .eq('id_detalles_revision', idRev).order('id_preguntas_investigacion')) || [];
}

async function palabrasClave(token, idRev) {
  return datos(await cliente(token).from('palabras_clave')
    .select('id_palabras_clave, palabra_clave, sinonimos(id_sinonimos, sinonimo), ' +
            'componente_revision(id_componente, componente(id_componente, nombre, sigla))')
    .eq('id_detalles_revision', idRev).order('id_palabras_clave')) || [];
}

async function bases(token, idRev) {
  return datos(await cliente(token).from('bases_bibliograficas')
    .select('id_base_bibliografica, nombre, url')
    .eq('id_revision', idRev).order('id_base_bibliografica')) || [];
}

async function cadenas(token, idRev) {
  return datos(await cliente(token).from('cadenas_busqueda')
    .select('id_cadenas_busqueda, fuente, cadena_busqueda')
    .eq('id_detalles_revision', idRev).order('id_cadenas_busqueda')) || [];
}

/** Con cuántos estudios usa cada criterio (para avisar antes de borrarlo). */
async function criterios(token, idRev) {
  return datos(await cliente(token).from('criterios')
    .select('id_criterios, descripcion, tipo, estudios(count)')
    .eq('id_detalles_revision', idRev).order('fecha_ingreso').order('id_criterios')) || [];
}

async function preguntasCalidad(token, idRev) {
  return datos(await cliente(token).from('evaluacion_calidad_preguntas')
    .select('id_pregunta, descripcion, calidad_estudios(count)')
    .eq('id_detalles_revision', idRev).order('id_pregunta')) || [];
}

async function respuestasCalidad(token, idRev) {
  return datos(await cliente(token).from('evaluacion_calidad_respuestas')
    .select('id_respuesta, descripcion, peso, calidad_estudios(count)')
    .eq('id_detalles_revision', idRev).order('id_respuesta')) || [];
}

async function umbral(token, idRev) {
  return datos(await cliente(token).from('puntuaciones_evaluacion')
    .select('puntuacion_limite, puntuacion_maxima')
    .eq('id_detalles_revision', idRev).maybeSingle());
}

/** ¿El error es una columna que no existe? (sql/010 sin ejecutar) */
const faltaColumna = e => e?.code === '42703' || e?.code === 'PGRST204' || /column .* does not exist|could not find the '.*' column/i.test(e?.message || '');

/**
 * Campos de extracción con la pregunta de investigación a la que responden (sql/010). Si el
 * script aún no se ejecutó, se leen sin ella.
 */
async function campos(token, idRev) {
  const consulta = cols => cliente(token).from('campos_extraccion').select(cols)
    .eq('id_revision', idRev).order('orden').order('id_campo_extraccion');
  let r = await consulta('id_campo_extraccion, descripcion, tipo, orden, id_pregunta_investigacion, respuestas_extraccion(count)');
  if (r.error && faltaColumna(r.error)) r = await consulta('id_campo_extraccion, descripcion, tipo, orden, respuestas_extraccion(count)');
  return datos(r) || [];
}

/* ---------- Escritura simple (una fila, una sentencia) ---------- */

/** Inserta y devuelve la fila. */
async function insertar(token, tabla, fila, columnas) {
  return datos(await cliente(token).from(tabla).insert(fila).select(columnas).single());
}

/** Como insertar/actualizar, pero devuelve el error de Supabase en vez de lanzarlo (para reintentar). */
async function insertarCrudo(token, tabla, fila, columnas) {
  return cliente(token).from(tabla).insert(fila).select(columnas).single();
}
async function actualizarCrudo(token, tabla, { idCol, id, revCol, idRev }, cambios, columnas) {
  return cliente(token).from(tabla).update(cambios).eq(idCol, id).eq(revCol, idRev).select(columnas).maybeSingle();
}

/** Actualiza la fila `id` de la revisión. Devuelve la fila o null si no existe en esa revisión (o RLS no deja). */
async function actualizar(token, tabla, { idCol, id, revCol, idRev }, cambios, columnas) {
  return datos(await cliente(token).from(tabla).update(cambios)
    .eq(idCol, id).eq(revCol, idRev).select(columnas).maybeSingle());
}

/** Borra la fila `id` de la revisión. true si se borró. */
async function borrar(token, tabla, { idCol, id, revCol, idRev }) {
  const filas = datos(await cliente(token).from(tabla).delete()
    .eq(idCol, id).eq(revCol, idRev).select(idCol)) || [];
  return filas.length > 0;
}

async function borrarCadena(token, idRev, fuente) {
  const filas = datos(await cliente(token).from('cadenas_busqueda').delete()
    .eq('id_detalles_revision', idRev).eq('fuente', fuente).select('id_cadenas_busqueda')) || [];
  return filas.length > 0;
}

/* ---------- Operaciones de varios pasos (funciones SQL de sql/005) ---------- */

const guardarMetodologia = (token, idRev, idMetodologia, componentes) =>
  rpc(token, 'fn_guardar_metodologia', { p_id_rev: idRev, p_id_metodologia: idMetodologia, p_componentes: componentes });

const guardarPalabra = (token, idRev, idPalabra, { palabra_clave, id_componente, sinonimos }) =>
  rpc(token, 'fn_guardar_palabra_clave', {
    p_id_rev: idRev, p_id: idPalabra ?? null, p_palabra: palabra_clave, p_id_componente: id_componente, p_sinonimos: sinonimos
  });

const guardarBase = (token, idRev, idBase, { nombre, url }) =>
  rpc(token, 'fn_guardar_base', { p_id_rev: idRev, p_id: idBase ?? null, p_nombre: nombre, p_url: url });

const borrarBase = (token, idRev, idBase) => rpc(token, 'fn_borrar_base', { p_id_rev: idRev, p_id: idBase });

const guardarCadena = (token, idRev, fuente, texto) =>
  rpc(token, 'fn_guardar_cadena', { p_id_rev: idRev, p_fuente: fuente, p_cadena: texto });

const guardarUmbral = (token, idRev, limite) => rpc(token, 'fn_guardar_umbral_calidad', { p_id_rev: idRev, p_limite: limite });

const ordenarCampos = (token, idRev, ids) => rpc(token, 'fn_ordenar_campos_extraccion', { p_id_rev: idRev, p_ids: ids });

module.exports = {
  componentesRevision, preguntas, palabrasClave, bases, cadenas, criterios,
  preguntasCalidad, respuestasCalidad, umbral, campos, faltaColumna, insertarCrudo, actualizarCrudo,
  insertar, actualizar, borrar, borrarCadena,
  guardarMetodologia, guardarPalabra, guardarBase, borrarBase, guardarCadena, guardarUmbral, ordenarCampos
};
