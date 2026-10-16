// modules/informes/contexto.js
// Todo lo que la IA necesita saber de la revisión para redactar una sección, leído de la base
// COMO EL USUARIO (RLS decide). Cada sección pide solo las piezas que usa.
const sb = require('../../infra/supabase');
const { todas } = require('../estudios/estudios.repo');
const repo = require('./informes.repo');
const registro = require('./referencias/registro');
const P = require('./prisma');
const { leerGuardadas } = require('./secciones');

const cliente = token => sb.forUser(token);
function datos({ data, error }) {
  if (error) throw sb.fromSupabaseError(error);
  return data;
}

const COLS_INCLUIDO = 'id_estudios, titulo, resumen, autores, anio, revista, doi, document_type, volumen, paginas, url, ' +
  'publisher, issn, fuente_bibliografica, keywords, author_keywords, estado, id_criterio';

/* ---------- Piezas ---------- */

async function estudios(token, idRev) {
  const todos = await todas(conteo => cliente(token).from('estudios')
    .select('id_estudios, estado, id_criterio, fuente_bibliografica, doi', conteo ? { count: 'exact' } : undefined)
    .eq('id_detalles_revision', idRev).order('id_estudios'));
  const incluidos = await todas(conteo => cliente(token).from('estudios')
    .select(COLS_INCLUIDO, conteo ? { count: 'exact' } : undefined)
    .eq('id_detalles_revision', idRev).ilike('estado', 'aceptado').order('anio', { ascending: true, nullsFirst: false })
    .order('id_estudios'));
  return { todos, incluidos };
}

async function calidad(token, idRev, idsIncluidos) {
  const c = cliente(token);
  const [preguntas, respuestas, umbral] = await Promise.all([
    c.from('evaluacion_calidad_preguntas').select('id_pregunta, descripcion').eq('id_detalles_revision', idRev).order('id_pregunta'),
    c.from('evaluacion_calidad_respuestas').select('id_respuesta, descripcion, peso').eq('id_detalles_revision', idRev).order('peso', { ascending: false }),
    c.from('puntuaciones_evaluacion').select('puntuacion_limite, puntuacion_maxima').eq('id_detalles_revision', idRev).maybeSingle()
  ]);
  let evaluaciones = [];
  for (let i = 0; i < idsIncluidos.length; i += 300) {
    const lote = idsIncluidos.slice(i, i + 300);
    evaluaciones.push(...(datos(await c.from('calidad_estudios').select('id_estudios, id_pregunta, id_respuesta, peso').in('id_estudios', lote)) || []));
  }
  return { preguntas: datos(preguntas) || [], respuestas: datos(respuestas) || [], umbral: datos(umbral), evaluaciones };
}

/** Campos de extracción con la pregunta de investigación a la que responden (sql/010; sin él, sin vínculo). */
async function campos(token, idRev) {
  const c = cliente(token);
  let r = await c.from('campos_extraccion').select('id_campo_extraccion, descripcion, tipo, orden, id_pregunta_investigacion')
    .eq('id_revision', idRev).order('orden').order('id_campo_extraccion');
  if (r.error && registro.faltaColumna(r.error)) {
    r = await c.from('campos_extraccion').select('id_campo_extraccion, descripcion, tipo, orden')
      .eq('id_revision', idRev).order('orden').order('id_campo_extraccion');
  }
  return datos(r) || [];
}

async function importaciones(token, idRev) {
  const { data, error } = await cliente(token).from('importaciones')
    .select('fuente, cadena_busqueda, filtros, total_encontrados, total_importados, total_duplicados, estado, fecha_inicio, fecha_fin')
    .eq('id_detalles_revision', idRev).order('fecha_inicio');
  return error ? [] : (data || []);
}

/** Equipo y cribado: revisores, cribado independiente, kappa entre los dos que más cribaron y uso de la IA. */
async function equipo(token, idRev) {
  const c = cliente(token);
  const [colaboradores, decisiones, sugerencias] = await Promise.all([
    c.from('colaboradores_revision').select('rol, estado').eq('id_detalles_revision', idRev).eq('estado', 'activo'),
    todas(conteo => c.from('cribado_revisor').select('id_usuarios, estudios!inner(id_detalles_revision)', conteo ? { count: 'exact' } : undefined)
      .eq('estudios.id_detalles_revision', idRev).order('id_cribado')).catch(() => []),
    todas(conteo => c.from('cribado_sugerencias').select('revisada, aceptada, sugerencia, estudios!inner(id_detalles_revision)', conteo ? { count: 'exact' } : undefined)
      .eq('estudios.id_detalles_revision', idRev).order('id_sugerencia')).catch(() => [])
  ]);
  const porRevisor = new Map();
  for (const d of decisiones) porRevisor.set(d.id_usuarios, (porRevisor.get(d.id_usuarios) ?? 0) + 1);
  const revisores = [...porRevisor].sort((a, b) => b[1] - a[1]);
  let kappa = null;
  if (revisores.length >= 2) {
    try {
      kappa = await sb.rpc(c, 'fn_kappa_cohen', { p_id_rev: idRev, p_revisor_a: revisores[0][0], p_revisor_b: revisores[1][0] });
    } catch { kappa = null; }
  }
  const revisadas = sugerencias.filter(s => s.revisada);
  return {
    colaboradores: (colaboradores.data || []).length,
    revisores_cribado: revisores.length,
    kappa: kappa?.kappa != null ? { valor: Number(kappa.kappa), interpretacion: kappa.interpretacion, n: kappa.n, porcentaje_acuerdo: kappa.porcentaje_acuerdo } : null,
    ia: {
      sugerencias: sugerencias.length,
      revisadas: revisadas.length,
      aceptadas: revisadas.filter(s => s.aceptada === true).length
    }
  };
}

/* ---------- Carga ---------- */

/**
 * Carga las piezas pedidas. Siempre trae la revisión (ya leída), el idioma y la plantilla.
 * Piezas: planificacion, preguntas, criterios, estudios, calidad, extraccion, campos, importaciones,
 * equipo, guardadas, referencias.
 */
async function cargar(token, revision, piezas) {
  const idRev = revision.id_detalles_revision;
  const quiere = p => piezas.includes(p);
  const c = { revision, idRev };
  [c.idioma, c.plantilla] = await Promise.all([registro.idioma(token, idRev), registro.plantilla(token, revision)]);

  const tareas = [];
  if (quiere('planificacion')) tareas.push(repo.contextoPlanificacion(token, idRev).then(v => { c.planificacion = v || {}; }));
  if (quiere('preguntas')) tareas.push(repo.preguntas(token, idRev).then(v => { c.preguntas = v; }));
  if (quiere('criterios')) tareas.push(repo.criterios(token, idRev).then(v => { c.criterios = P.codigosCriterios(v); }));
  if (quiere('estudios') || quiere('calidad') || quiere('extraccion')) tareas.push(estudios(token, idRev).then(v => { c.estudios = v; }));
  if (quiere('extraccion')) tareas.push(repo.respuestasExtraccion(token, idRev).then(v => { c.extraccion = v; }));
  if (quiere('extraccion') || quiere('campos')) tareas.push(campos(token, idRev).then(v => { c.campos = v; }));
  if (quiere('importaciones')) tareas.push(importaciones(token, idRev).then(v => { c.importaciones = v; }));
  if (quiere('equipo')) tareas.push(equipo(token, idRev).then(v => { c.equipo = v; }));
  if (quiere('guardadas')) tareas.push(repo.filaSecciones(token, idRev).then(v => { c.guardadas = leerGuardadas(v); }));
  await Promise.all(tareas);

  if (c.estudios) {
    if (!c.criterios) c.criterios = P.codigosCriterios(await repo.criterios(token, idRev));
    c.prisma = P.contarPrisma(c.estudios.todos, c.criterios);
    c.panorama = P.panorama(c.estudios.incluidos);
  }
  if (quiere('calidad') && c.estudios) {
    const q = await calidad(token, idRev, c.estudios.incluidos.map(e => e.id_estudios));
    c.calidad = P.resumenCalidad({ incluidos: c.estudios.incluidos, ...q });
  }
  if (quiere('referencias')) {
    let lista = await registro.filas(token, idRev);
    if (c.estudios) lista = await registro.asegurarEstudios(token, idRev, c.estudios.incluidos, lista);
    c.referencias = lista;
  }
  return c;
}

module.exports = { cargar, estudios, calidad, campos, importaciones, equipo };
