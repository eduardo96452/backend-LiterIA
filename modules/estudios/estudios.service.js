// modules/estudios/estudios.service.js
// Estudios de una revisión: lista, alta (uno o un lote, con duplicados marcados en el servidor),
// edición, borrado, PDF y evaluación de calidad.
const repo = require('./estudios.repo');
const revisiones = require('../revisiones/revisiones.service');
const storage = require('../../infra/storage');
const sb = require('../../infra/supabase');
const logger = require('../../core/logger');
const { HttpError } = require('../../core/httpError');
const { EDITABLES, TIPO_CRITERIO, normalizarTitulo, limpiarDoi, claveDoi, aPublico } = require('./campos');

const SOLO_LECTURA = 'Tu rol en esta revisión es de solo lectura.';
const DOI_REPETIDO = 'Ya hay otro estudio con ese DOI en esta revisión.';

/* ---------- Ayudas ---------- */

async function estudioDe(ctx, idRev, idEstudio) {
  const fila = await repo.uno(ctx.token, idRev, idEstudio);
  if (!fila) throw new HttpError(404, 'Estudio no encontrado en esta revisión.');
  return fila;
}

/**
 * Comprueba el criterio de un estado: tiene que ser de esta revisión y del tipo que toca
 * (inclusión para Aceptado, exclusión para Rechazado). Los demás estados no llevan criterio.
 */
function criterioValido(criterios, estado, idCriterio, prefijo = '') {
  const tipo = TIPO_CRITERIO[estado];
  if (!tipo || idCriterio == null) return null;
  const c = criterios.find(x => Number(x.id_criterios) === Number(idCriterio));
  if (!c) throw new HttpError(400, `${prefijo}El criterio elegido no pertenece a esta revisión.`);
  if (c.tipo !== tipo) {
    throw new HttpError(400, `${prefijo}Para ${estado === 'Aceptado' ? 'incluir' : 'descartar'} un estudio hace falta un criterio de ${tipo === 'inclusion' ? 'inclusión' : 'exclusión'}.`);
  }
  return Number(idCriterio);
}

const esDoiRepetido = e => e?.status === 409;

/* ---------- Lista ---------- */

async function listar(ctx, idRev) {
  const [, filas] = await Promise.all([revisiones.obtener(ctx, idRev), repo.listar(ctx.token, idRev)]);
  return filas.map(aPublico);
}

/* ---------- Alta ---------- */

/**
 * Crea uno o varios estudios. Un estudio es duplicado si ya hay otro en la revisión (o antes en
 * el mismo lote) con el mismo título —sin tener en cuenta mayúsculas, tildes ni signos— o con el
 * mismo DOI. Los duplicados se guardan con estado «Duplicado» (cuentan en PRISMA).
 */
async function crear(ctx, idRev, estudios) {
  await revisiones.exigirEscritura(ctx, idRev);
  const [existentes, criterios] = await Promise.all([repo.claves(ctx.token, idRev), repo.criterios(ctx.token, idRev)]);

  const titulos = new Set(existentes.map(e => normalizarTitulo(e.titulo)).filter(Boolean));
  const dois = new Set(existentes.map(e => claveDoi(e.doi)).filter(Boolean));

  let duplicados = 0;
  const filas = estudios.map((est, i) => {
    const t = normalizarTitulo(est.titulo);
    const d = claveDoi(est.doi);
    const repetido = (t && titulos.has(t)) || (d && dois.has(d));
    if (t) titulos.add(t);
    if (d) dois.add(d);

    const estado = repetido ? 'Duplicado' : est.estado;
    if (repetido) duplicados++;
    const prefijo = estudios.length > 1 ? `Estudio ${i + 1}: ` : '';

    const fila = { id_detalles_revision: idRev, estado, id_criterio: criterioValido(criterios, estado, est.id_criterio, prefijo) };
    for (const k of EDITABLES) if (est[k] !== undefined) fila[k] = est[k];
    fila.doi = limpiarDoi(est.doi);
    return fila;
  });

  const creados = [];
  for (let i = 0; i < filas.length; i += 500) creados.push(...await insertarLote(ctx.token, filas.slice(i, i + 500)));
  return { creados: creados.length, duplicados, estudios: creados.map(aPublico) };
}

/**
 * Inserta un lote. Si choca con el índice único de DOI y la base todavía no tiene
 * sql/004_fase3_estudios.sql (que excluye los duplicados del índice), se reintenta guardando
 * los duplicados sin DOI. Si aun así choca, otra persona añadió el mismo DOI a la vez.
 */
async function insertarLote(token, filas) {
  try {
    return await repo.insertar(token, filas);
  } catch (e) {
    if (!esDoiRepetido(e) || !filas.some(f => f.estado === 'Duplicado' && f.doi)) {
      if (esDoiRepetido(e)) throw new HttpError(409, 'Alguno de estos estudios tiene un DOI que ya está en la revisión (quizá alguien del equipo lo añadió a la vez). Vuelve a cargar la lista e inténtalo de nuevo.');
      throw e;
    }
    logger.warn('estudios_duplicados_sin_doi', { motivo: 'falta sql/004_fase3_estudios.sql' });
    try {
      return await repo.insertar(token, filas.map(f => (f.estado === 'Duplicado' ? { ...f, doi: null } : f)));
    } catch (e2) {
      if (esDoiRepetido(e2)) throw new HttpError(409, 'Alguno de estos estudios tiene un DOI que ya está en la revisión (quizá alguien del equipo lo añadió a la vez). Vuelve a cargar la lista e inténtalo de nuevo.');
      throw e2;
    }
  }
}

/* ---------- Edición ---------- */

async function actualizar(ctx, idRev, idEstudio, cambios) {
  const actual = await estudioDe(ctx, idRev, idEstudio);
  const fila = {};
  for (const k of EDITABLES) if (cambios[k] !== undefined) fila[k] = cambios[k];
  if (cambios.doi !== undefined) fila.doi = limpiarDoi(cambios.doi);

  if (cambios.estado !== undefined || cambios.id_criterio !== undefined) {
    const estado = cambios.estado ?? actual.estado;
    if (cambios.estado !== undefined) fila.estado = estado;
    if (!TIPO_CRITERIO[estado]) {
      fila.id_criterio = null;                       // Sin clasificar o Duplicado no llevan criterio
    } else {
      const propuesto = cambios.id_criterio !== undefined ? cambios.id_criterio : actual.id_criterio;
      const criterios = propuesto == null ? [] : await repo.criterios(ctx.token, idRev);
      fila.id_criterio = criterioValido(criterios, estado, propuesto);
    }
  }

  let actualizado;
  try {
    actualizado = await repo.actualizar(ctx.token, idRev, idEstudio, fila);
  } catch (e) {
    if (esDoiRepetido(e)) throw new HttpError(409, DOI_REPETIDO);
    throw e;
  }
  if (!actualizado) throw new HttpError(403, SOLO_LECTURA);

  // Si la IA había sugerido algo para este estudio, queda registrado si se siguió su sugerencia
  const tieneSugerencia = Array.isArray(actual.cribado_sugerencias) ? actual.cribado_sugerencias.length > 0 : Boolean(actual.cribado_sugerencias);
  if (fila.estado !== undefined && fila.estado !== actual.estado && tieneSugerencia) {
    try { await repo.aplicarDecision(ctx.token, idEstudio, fila.estado, actualizado.id_criterio); }
    catch (e) { logger.warn('aplicar_decision_cribado_fallido', { id_estudios: idEstudio, message: e.message }); }
  }
  return aPublico(actualizado);
}

/* ---------- Borrado ---------- */

async function eliminar(ctx, idRev, idEstudio) {
  await estudioDe(ctx, idRev, idEstudio);
  if (!(await repo.borrar(ctx.token, idRev, idEstudio))) throw new HttpError(403, SOLO_LECTURA);
  // Antes el PDF se quedaba en el almacenamiento. La base ya confirmó el borrado.
  await storage.borrarCarpeta(storage.clienteLimpieza(ctx.token), `estudios/${Number(idEstudio)}`);
}

/* ---------- PDF ---------- */

/**
 * Ruta del PDF dentro del bucket a partir de lo guardado. Las filas antiguas guardaban una URL
 * pública (…/documentos/<ruta>). Solo vale una ruta dentro de estudios/<id del estudio>/: una
 * fila manipulada no puede hacer que el servidor lea o borre archivos de otro estudio.
 */
function rutaDelPdf(idEstudio, guardado) {
  let ruta = String(guardado || '');
  if (/^https?:\/\//i.test(ruta)) {
    const i = ruta.indexOf('/documentos/');
    if (i < 0) return null;
    ruta = ruta.slice(i + '/documentos/'.length).split('?')[0];
    try { ruta = decodeURIComponent(ruta); } catch { return null; }
  }
  const prefijo = `estudios/${Number(idEstudio)}/`;
  if (!ruta.startsWith(prefijo) || ruta.includes('..') || ruta.slice(prefijo.length).includes('/') || ruta === prefijo) return null;
  return ruta;
}

/** Enlace externo (no es un archivo del bucket): se abre tal cual, como hacía la pantalla. */
const esEnlaceExterno = v => /^https?:\/\//i.test(String(v || '')) && !String(v).includes('/documentos/');

function nombreSeguro(nombre) {
  const base = String(nombre).split(/[\\/]/).pop()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[._]+|[._]+$/g, '')
    .slice(0, 100);
  return `${base || 'articulo'}.pdf`;
}

/** Paso 1 de la subida: el backend autoriza y entrega una URL firmada para esa ruta. */
async function prepararSubidaPdf(ctx, idRev, idEstudio, { nombre }) {
  await revisiones.exigirEscritura(ctx, idRev);
  await estudioDe(ctx, idRev, idEstudio);
  const ruta = `estudios/${Number(idEstudio)}/${Date.now()}_${nombreSeguro(nombre)}`;
  return storage.urlDeSubida(sb.forUser(ctx.token), ruta);   // como el usuario: aplican las políticas de Storage
}

/** Paso 2: el navegador ya subió el archivo; se comprueba que está y se asocia al estudio. */
async function confirmarPdf(ctx, idRev, idEstudio, { ruta }) {
  await revisiones.exigirEscritura(ctx, idRev);
  const actual = await estudioDe(ctx, idRev, idEstudio);
  if (rutaDelPdf(idEstudio, ruta) !== ruta || !/\.pdf$/i.test(ruta)) {
    throw new HttpError(400, 'La ruta del PDF no corresponde a este estudio.');
  }
  if (!(await storage.existe(storage.clienteLimpieza(ctx.token), ruta))) {
    throw new HttpError(400, 'No se encontró el PDF subido. Vuelve a intentarlo.');
  }
  const actualizado = await repo.actualizar(ctx.token, idRev, idEstudio, { url_pdf_articulo: ruta });
  if (!actualizado) throw new HttpError(403, SOLO_LECTURA);

  const anterior = rutaDelPdf(idEstudio, actual.url_pdf_articulo);   // al reemplazar, el anterior se borra
  if (anterior && anterior !== ruta) await storage.borrar(storage.clienteLimpieza(ctx.token), [anterior]);
  return aPublico(actualizado);
}

/** URL temporal para abrir el PDF (el bucket es privado). */
async function urlPdf(ctx, idRev, idEstudio) {
  const actual = await estudioDe(ctx, idRev, idEstudio);
  if (!actual.url_pdf_articulo) throw new HttpError(404, 'Este estudio no tiene PDF.');
  if (esEnlaceExterno(actual.url_pdf_articulo)) return { url: actual.url_pdf_articulo, externo: true };

  const ruta = rutaDelPdf(idEstudio, actual.url_pdf_articulo);
  if (!ruta) throw new HttpError(404, 'El PDF de este estudio no está disponible.');
  try {
    return { url: await storage.urlDeLectura(sb.forUser(ctx.token), ruta) };
  } catch (e) {
    // Mismo criterio que con los informes: la fila ya pasó RLS y la ruta es de este estudio
    if (![403, 404].includes(e.status) || !sb.adminDisponible()) throw e;
    logger.warn('pdf_leido_con_service_role', { id_estudios: Number(idEstudio), ruta });
    return { url: await storage.urlDeLectura(sb.admin(), ruta) };
  }
}

async function borrarPdf(ctx, idRev, idEstudio) {
  const actual = await estudioDe(ctx, idRev, idEstudio);
  if (!actual.url_pdf_articulo) return;
  const actualizado = await repo.actualizar(ctx.token, idRev, idEstudio, { url_pdf_articulo: null });
  if (!actualizado) throw new HttpError(403, SOLO_LECTURA);
  const ruta = rutaDelPdf(idEstudio, actual.url_pdf_articulo);
  if (ruta) await storage.borrar(storage.clienteLimpieza(ctx.token), [ruta]);
}

/* ---------- Calidad ---------- */

/** Una respuesta por estudio y pregunta: si hubiera repetidas (datos antiguos), la más reciente. */
function agruparEvaluaciones(filas) {
  const ultima = new Map();
  for (const f of filas) {
    const k = `${f.id_estudios}:${f.id_pregunta}`;
    const prev = ultima.get(k);
    if (!prev || String(f.fecha_evaluacion) > String(prev.fecha_evaluacion)
        || (String(f.fecha_evaluacion) === String(prev.fecha_evaluacion) && f.id_calidad > prev.id_calidad)) {
      ultima.set(k, f);
    }
  }
  const porEstudio = {};
  for (const f of ultima.values()) {
    (porEstudio[f.id_estudios] ??= []).push({ id_pregunta: f.id_pregunta, id_respuesta: f.id_respuesta, peso: Number(f.peso) || 0 });
  }
  return porEstudio;
}

/** Todo lo de la pestaña de calidad en una petición (antes eran 3 + una por estudio). */
async function calidad(ctx, idRev) {
  const [, preguntas, respuestas, umbral, filas] = await Promise.all([
    revisiones.obtener(ctx, idRev),
    repo.preguntasCalidad(ctx.token, idRev),
    repo.respuestasCalidad(ctx.token, idRev),
    repo.umbral(ctx.token, idRev),
    repo.evaluaciones(ctx.token, idRev)
  ]);
  const conPeso = respuestas.map(r => ({ ...r, peso: Number(r.peso) || 0 }));
  return {
    preguntas,
    respuestas: conPeso,
    // La máxima se calcula con lo que hay ahora (peso mayor × preguntas): la guardada en
    // puntuaciones_evaluacion se quedaba vieja al añadir preguntas o cambiar pesos.
    umbral: { limite: Number(umbral?.puntuacion_limite) || 0, maxima: preguntas.length * conPeso.reduce((m, r) => Math.max(m, r.peso), 0) },
    evaluaciones: agruparEvaluaciones(filas)
  };
}

/**
 * Guarda la evaluación COMPLETA de un estudio (sustituye la anterior). El peso lo pone la base
 * a partir de la respuesta elegida; el cliente no lo envía.
 */
async function guardarCalidad(ctx, idRev, idEstudio, respuestas) {
  await estudioDe(ctx, idRev, idEstudio);
  try {
    const r = await repo.guardarCalidad(ctx.token, idEstudio, respuestas);
    const filas = await evaluacionDe(ctx, idRev, idEstudio);
    return { respondidas: r?.respondidas ?? filas.length, total: Number(r?.total ?? 0), evaluacion: filas };
  } catch (e) {
    if (e.status !== 501) throw e;
    logger.warn('guardar_calidad_sin_funcion', { motivo: 'falta sql/004_fase3_estudios.sql' });
    return guardarCalidadSinFuncion(ctx, idRev, idEstudio, respuestas);
  }
}

async function evaluacionDe(ctx, idRev, idEstudio) {
  return agruparEvaluaciones(await repo.evaluacionEstudio(ctx.token, idEstudio))[idEstudio] ?? [];
}

async function guardarCalidadSinFuncion(ctx, idRev, idEstudio, respuestas) {
  const [preguntas, opciones] = await Promise.all([repo.preguntasCalidad(ctx.token, idRev), repo.respuestasCalidad(ctx.token, idRev)]);
  const vistas = new Set();
  const filas = respuestas.map(({ id_pregunta, id_respuesta }) => {
    const opcion = opciones.find(o => Number(o.id_respuesta) === Number(id_respuesta));
    if (vistas.has(id_pregunta) || !preguntas.some(p => Number(p.id_pregunta) === Number(id_pregunta)) || !opcion) {
      throw new HttpError(400, 'Alguna pregunta o respuesta no pertenece a esta revisión o está repetida');
    }
    vistas.add(id_pregunta);
    return { id_estudios: Number(idEstudio), id_pregunta, id_respuesta, peso: Number(opcion.peso) || 0, fecha_evaluacion: new Date().toISOString() };
  });
  await revisiones.exigirEscritura(ctx, idRev);
  await repo.borrarCalidad(ctx.token, idEstudio);
  const guardadas = await repo.insertarCalidad(ctx.token, filas);
  return {
    respondidas: guardadas.length,
    total: guardadas.reduce((s, f) => s + (Number(f.peso) || 0), 0),
    evaluacion: guardadas.map(f => ({ id_pregunta: f.id_pregunta, id_respuesta: f.id_respuesta, peso: Number(f.peso) || 0 }))
  };
}

module.exports = {
  listar, crear, actualizar, eliminar,
  prepararSubidaPdf, confirmarPdf, urlPdf, borrarPdf, rutaDelPdf, nombreSeguro, esEnlaceExterno, estudioDe,
  calidad, guardarCalidad, criterioValido
};
