// modules/planificacion/planificacion.service.js
// Reglas de la pantalla de Planificación: objetivo (vía revisiones), framework, preguntas,
// palabras clave, bases, cadenas, criterios, instrumento de calidad y campos de extracción.
// No conoce req/res: recibe un contexto { token, user }.
const repo = require('./planificacion.repo');
const catalogos = require('../catalogos/catalogos.repo');
const revisiones = require('../revisiones/revisiones.service');
const { HttpError } = require('../../core/httpError');

const conteo = v => Number(Array.isArray(v) ? v[0]?.count : v?.count) || 0;

/* ---------- Lectura ---------- */

/** Catálogo de frameworks con sus componentes ordenados. */
const metodologias = token => catalogos.metodologias(token);

/**
 * Framework guardado en la revisión: el del componente guardado más reciente (si hubiera filas de dos
 * frameworks, que la pantalla vieja podía dejar, manda el último guardado). Todos sus componentes,
 * con el valor guardado o ''.
 */
function frameworkGuardado(filas, catalogo) {
  if (!filas.length) return null;
  const idMet = filas[filas.length - 1].componente?.id_metodologia;
  const met = catalogo.find(m => m.id_metodologia === idMet);
  if (!met) return null;
  const valor = new Map(filas.map(f => [f.id_componente, f.palabra_clave ?? '']));
  return {
    id_metodologia: met.id_metodologia,
    nombre: met.nombre,
    componentes: met.componentes.map(c => ({ ...c, valor: valor.get(c.id_componente) ?? '' }))
  };
}

/**
 * Sinónimos de una palabra clave como lista. La pantalla vieja guardaba todos en una fila separados
 * por comas; ahora va uno por fila. Se leen las dos formas.
 */
function sinonimos(filas) {
  const vistos = new Set();
  return (filas || [])
    .slice().sort((a, b) => a.id_sinonimos - b.id_sinonimos)
    .flatMap(f => String(f.sinonimo ?? '').split(','))
    .map(s => s.trim())
    .filter(s => s && !vistos.has(s.toLowerCase()) && vistos.add(s.toLowerCase()));
}

/** Palabras clave con su componente, en el orden de los componentes del framework. */
function palabras(filas, framework) {
  const posicion = new Map((framework?.componentes || []).map((c, i) => [c.id_componente, i]));
  return filas.map(k => {
    const comp = k.componente_revision?.componente || null;
    return {
      id_palabras_clave: k.id_palabras_clave,
      palabra_clave: k.palabra_clave,
      id_componente: comp?.id_componente ?? null,
      componente: comp?.nombre ?? null,
      sigla: comp?.sigla ?? null,
      sinonimos: sinonimos(k.sinonimos)
    };
  }).sort((a, b) =>
    (posicion.get(a.id_componente) ?? 1e9) - (posicion.get(b.id_componente) ?? 1e9) || a.id_palabras_clave - b.id_palabras_clave);
}

/** Puntuación máxima posible: peso mayor × número de preguntas (lo mismo que calcula la base). */
const maximaCalidad = (preguntas, respuestas) =>
  preguntas.length * respuestas.reduce((m, r) => Math.max(m, Number(r.peso) || 0), 0);

/** Todo lo que muestra la pantalla, en una petición (antes eran unas 20 consultas más una por base). */
async function obtener(ctx, idRev) {
  const t = ctx.token;
  const [revision, catalogo, filasFw, preguntas, filasKw, bases, cadenas, criterios, pc, rc, umbral, campos] = await Promise.all([
    revisiones.obtener(ctx, idRev), metodologias(t), repo.componentesRevision(t, idRev), repo.preguntas(t, idRev),
    repo.palabrasClave(t, idRev), repo.bases(t, idRev), repo.cadenas(t, idRev), repo.criterios(t, idRev),
    repo.preguntasCalidad(t, idRev), repo.respuestasCalidad(t, idRev), repo.umbral(t, idRev), repo.campos(t, idRev)
  ]);
  const metodologia = frameworkGuardado(filasFw, catalogo);
  const preguntasCalidad = pc.map(p => ({ id_pregunta: p.id_pregunta, descripcion: p.descripcion, evaluaciones: conteo(p.calidad_estudios) }));
  const respuestas = rc.map(r => ({ id_respuesta: r.id_respuesta, descripcion: r.descripcion, peso: Number(r.peso) || 0, usos: conteo(r.calidad_estudios) }));
  return {
    revision,
    metodologia,
    preguntas,
    palabras_clave: palabras(filasKw, metodologia),
    bases,
    cadenas,
    criterios: criterios.map(c => ({ id_criterios: c.id_criterios, descripcion: c.descripcion, tipo: c.tipo, estudios: conteo(c.estudios) })),
    calidad: {
      preguntas: preguntasCalidad,
      respuestas,
      umbral: {
        limite: Number(umbral?.puntuacion_limite) || 0,
        maxima: maximaCalidad(preguntasCalidad, respuestas),
        guardado: Boolean(umbral)
      }
    },
    campos: campos.map(f => ({ id_campo_extraccion: f.id_campo_extraccion, descripcion: f.descripcion, tipo: f.tipo, orden: f.orden, respuestas: conteo(f.respuestas_extraccion) }))
  };
}

/* ---------- Ayudas de escritura ---------- */

/** 404 si no la ve, 403 si es lector: antes de escribir, para dar el error correcto. */
const puedeEscribir = (ctx, idRev) => revisiones.exigirEscritura(ctx, idRev);

const NO_ESTA = {
  pregunta: 'Pregunta no encontrada en esta revisión.',
  palabra: 'Palabra clave no encontrada en esta revisión.',
  criterio: 'Criterio no encontrado en esta revisión.',
  respuesta: 'Respuesta no encontrada en esta revisión.',
  campo: 'Campo no encontrado en esta revisión.'
};

/** Actualiza una fila de la revisión; 404 si no existe en ella. */
async function cambiar(ctx, idRev, tabla, ref, cambios, columnas, noEsta) {
  await puedeEscribir(ctx, idRev);
  const fila = await repo.actualizar(ctx.token, tabla, { ...ref, idRev }, cambios, columnas);
  if (!fila) throw new HttpError(404, noEsta);
  return fila;
}

async function quitar(ctx, idRev, tabla, ref, noEsta) {
  await puedeEscribir(ctx, idRev);
  if (!(await repo.borrar(ctx.token, tabla, { ...ref, idRev }))) throw new HttpError(404, noEsta);
}

/* ---------- Framework ---------- */

/** Guarda el framework. Si cambia de framework, la base borra las palabras clave (la pantalla avisa antes). */
async function guardarMetodologia(ctx, idRev, { id_metodologia, componentes }) {
  await puedeEscribir(ctx, idRev);
  const r = await repo.guardarMetodologia(ctx.token, idRev, id_metodologia, componentes);
  const [catalogo, filas] = await Promise.all([metodologias(ctx.token), repo.componentesRevision(ctx.token, idRev)]);
  return { metodologia: frameworkGuardado(filas, catalogo), cambio: Boolean(r?.cambio), palabras_borradas: Number(r?.palabras_borradas) || 0 };
}

/* ---------- Preguntas de investigación ---------- */

const COLS_PREGUNTA = 'id_preguntas_investigacion, pregunta';
const refPregunta = p => ({ idCol: 'id_preguntas_investigacion', id: p, revCol: 'id_detalles_revision' });

async function crearPregunta(ctx, idRev, { pregunta }) {
  await puedeEscribir(ctx, idRev);
  return repo.insertar(ctx.token, 'preguntas_investigacion', { pregunta, id_detalles_revision: idRev }, COLS_PREGUNTA);
}
const cambiarPregunta = (ctx, idRev, p, { pregunta }) =>
  cambiar(ctx, idRev, 'preguntas_investigacion', refPregunta(p), { pregunta }, COLS_PREGUNTA, NO_ESTA.pregunta);
const borrarPregunta = (ctx, idRev, p) => quitar(ctx, idRev, 'preguntas_investigacion', refPregunta(p), NO_ESTA.pregunta);

/* ---------- Palabras clave ---------- */

async function guardarPalabra(ctx, idRev, idPalabra, datos) {
  await puedeEscribir(ctx, idRev);
  return repo.guardarPalabra(ctx.token, idRev, idPalabra, datos);
}
const borrarPalabra = (ctx, idRev, k) =>
  quitar(ctx, idRev, 'palabras_clave', { idCol: 'id_palabras_clave', id: k, revCol: 'id_detalles_revision' }, NO_ESTA.palabra);

/* ---------- Bases y cadenas ---------- */

async function guardarBase(ctx, idRev, idBase, datos) {
  await puedeEscribir(ctx, idRev);
  try {
    return await repo.guardarBase(ctx.token, idRev, idBase, datos);
  } catch (e) {
    if (e.status === 409) throw new HttpError(409, 'Ya hay una base con ese nombre en esta revisión.');
    throw e;
  }
}

async function borrarBase(ctx, idRev, idBase) {
  await puedeEscribir(ctx, idRev);
  return repo.borrarBase(ctx.token, idRev, idBase);
}

async function guardarCadena(ctx, idRev, fuente, { cadena }) {
  await puedeEscribir(ctx, idRev);
  return repo.guardarCadena(ctx.token, idRev, fuente, cadena);
}

async function borrarCadena(ctx, idRev, fuente) {
  await puedeEscribir(ctx, idRev);
  const f = fuente.trim().toLowerCase() === 'global' ? 'global' : fuente.trim();
  if (!(await repo.borrarCadena(ctx.token, idRev, f))) throw new HttpError(404, 'Esa cadena de búsqueda no existe en esta revisión.');
}

/* ---------- Criterios ---------- */

const COLS_CRITERIO = 'id_criterios, descripcion, tipo';
const refCriterio = c => ({ idCol: 'id_criterios', id: c, revCol: 'id_detalles_revision' });

async function crearCriterio(ctx, idRev, { descripcion, tipo }) {
  await puedeEscribir(ctx, idRev);
  return repo.insertar(ctx.token, 'criterios', { descripcion, tipo, id_detalles_revision: idRev }, COLS_CRITERIO);
}
const cambiarCriterio = (ctx, idRev, c, { descripcion }) =>
  cambiar(ctx, idRev, 'criterios', refCriterio(c), { descripcion }, COLS_CRITERIO, NO_ESTA.criterio);
const borrarCriterio = (ctx, idRev, c) => quitar(ctx, idRev, 'criterios', refCriterio(c), NO_ESTA.criterio);

/* ---------- Instrumento de calidad ---------- */

const COLS_PC = 'id_pregunta, descripcion';
const COLS_RC = 'id_respuesta, descripcion, peso';
const refPc = p => ({ idCol: 'id_pregunta', id: p, revCol: 'id_detalles_revision' });
const refRc = r => ({ idCol: 'id_respuesta', id: r, revCol: 'id_detalles_revision' });
const conPeso = r => ({ ...r, peso: Number(r.peso) || 0 });

async function crearPreguntaCalidad(ctx, idRev, { descripcion }) {
  await puedeEscribir(ctx, idRev);
  return repo.insertar(ctx.token, 'evaluacion_calidad_preguntas', { descripcion, id_detalles_revision: idRev }, COLS_PC);
}
const cambiarPreguntaCalidad = (ctx, idRev, p, { descripcion }) =>
  cambiar(ctx, idRev, 'evaluacion_calidad_preguntas', refPc(p), { descripcion }, COLS_PC, NO_ESTA.pregunta);
const borrarPreguntaCalidad = (ctx, idRev, p) => quitar(ctx, idRev, 'evaluacion_calidad_preguntas', refPc(p), NO_ESTA.pregunta);

async function crearRespuesta(ctx, idRev, { descripcion, peso }) {
  await puedeEscribir(ctx, idRev);
  return conPeso(await repo.insertar(ctx.token, 'evaluacion_calidad_respuestas', { descripcion, peso, id_detalles_revision: idRev }, COLS_RC));
}
/** Cambiar el peso actualiza también las evaluaciones ya hechas (disparador de sql/005). */
const cambiarRespuesta = async (ctx, idRev, r, cambios) =>
  conPeso(await cambiar(ctx, idRev, 'evaluacion_calidad_respuestas', refRc(r), cambios, COLS_RC, NO_ESTA.respuesta));
const borrarRespuesta = (ctx, idRev, r) => quitar(ctx, idRev, 'evaluacion_calidad_respuestas', refRc(r), NO_ESTA.respuesta);

async function guardarUmbral(ctx, idRev, { limite }) {
  await puedeEscribir(ctx, idRev);
  const r = await repo.guardarUmbral(ctx.token, idRev, limite);
  return { limite: Number(r?.limite) || 0, maxima: Number(r?.maxima) || 0, guardado: true };
}

/* ---------- Campos de extracción ---------- */

const COLS_CAMPO = 'id_campo_extraccion, descripcion, tipo, orden';
const refCampo = c => ({ idCol: 'id_campo_extraccion', id: c, revCol: 'id_revision' });

async function listarCampos(ctx, idRev) {
  const [, campos] = await Promise.all([revisiones.obtener(ctx, idRev), repo.campos(ctx.token, idRev)]);
  return campos.map(f => ({ id_campo_extraccion: f.id_campo_extraccion, descripcion: f.descripcion, tipo: f.tipo, orden: f.orden, respuestas: conteo(f.respuestas_extraccion) }));
}

async function crearCampo(ctx, idRev, { descripcion, tipo, orden }) {
  await puedeEscribir(ctx, idRev);
  // Sin orden: al final (el mayor + 1).
  const o = orden ?? (await repo.campos(ctx.token, idRev)).reduce((m, f) => Math.max(m, (Number(f.orden) || 0) + 1), 0);
  return repo.insertar(ctx.token, 'campos_extraccion', { descripcion, tipo, orden: o, id_revision: idRev }, COLS_CAMPO);
}
const cambiarCampo = (ctx, idRev, c, cambios) => cambiar(ctx, idRev, 'campos_extraccion', refCampo(c), cambios, COLS_CAMPO, NO_ESTA.campo);
const borrarCampo = (ctx, idRev, c) => quitar(ctx, idRev, 'campos_extraccion', refCampo(c), NO_ESTA.campo);

async function ordenarCampos(ctx, idRev, ids) {
  await puedeEscribir(ctx, idRev);
  await repo.ordenarCampos(ctx.token, idRev, ids);
  return listarCampos(ctx, idRev);
}

module.exports = {
  metodologias, obtener, frameworkGuardado, sinonimos, maximaCalidad,
  guardarMetodologia,
  crearPregunta, cambiarPregunta, borrarPregunta,
  guardarPalabra, borrarPalabra,
  guardarBase, borrarBase, guardarCadena, borrarCadena,
  crearCriterio, cambiarCriterio, borrarCriterio,
  crearPreguntaCalidad, cambiarPreguntaCalidad, borrarPreguntaCalidad,
  crearRespuesta, cambiarRespuesta, borrarRespuesta, guardarUmbral,
  listarCampos, crearCampo, cambiarCampo, borrarCampo, ordenarCampos
};
