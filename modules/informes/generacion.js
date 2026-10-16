// modules/informes/generacion.js
// Generación con IA de las secciones del artículo (v3.8.0).
//
// El cliente solo dice qué sección y qué paso; el servidor lee de la base todo lo que la sección
// necesita (planificación, cifras PRISMA, estudios incluidos, calidad, extracción, secciones
// guardadas…) y se lo da al prompt correspondiente de ia/redaccion. La IA cita solo con claves del
// registro de referencias ([@clave]); las que no existen se quitan antes de devolver la propuesta.
//
// Los prompts antiguos (ia/prompts) siguen ahí para las rutas /api/generate-* del frontend anterior.
const env = require('../../config/env');
const logger = require('../../core/logger');
const { HttpError } = require('../../core/httpError');
const { getContext } = require('../../core/requestContext');
const repo = require('./informes.repo');
const revisiones = require('../revisiones/revisiones.service');
const contexto = require('./contexto');
const { NOMBRES } = require('./secciones');

const SECCIONES_IA = {
  trabajos_relacionados: require('../../ia/redaccion/trabajos'),
  introduccion: require('../../ia/redaccion/introduccion'),
  metodologia: require('../../ia/redaccion/metodologia'),
  resultados: require('../../ia/redaccion/resultados'),
  discusion: require('../../ia/redaccion/discusion'),
  limitaciones: require('../../ia/redaccion/limitaciones'),
  conclusion: require('../../ia/redaccion/conclusion'),
  resumen: require('../../ia/redaccion/resumen')
};

/**
 * Secciones con un paso previo de palabras clave (términos para buscar fuentes en CrossRef). Con
 * Consensus configurado ya no hace falta: las búsquedas las formula la aplicación.
 */
const CON_KEYWORDS = new Set(Object.entries(SECCIONES_IA).filter(([, m]) => m.keywords).map(([s]) => s));

/**
 * Genera una sección. Devuelve { seccion, paso, resultado, id_generacion, citas, citas_quitadas }.
 * `citas` son las claves del registro que usa la propuesta; `citas_quitadas`, las que la IA
 * escribió y no existían (se borraron del texto).
 */
async function generar(ctx, idRev, seccion, { paso = 'texto', keywords, palabras, indicaciones } = {}) {
  const modulo = SECCIONES_IA[seccion];
  if (paso === 'keywords' && !modulo.keywords) {
    throw new HttpError(400, `La sección «${NOMBRES[seccion]}» no tiene paso de palabras clave.`);
  }

  // Antes de gastar tokens: la revisión existe y el usuario puede escribir en ella.
  const revision = await revisiones.exigirEscritura(ctx, idRev);
  const piezas = paso === 'keywords' ? modulo.piezasKeywords : modulo.piezas;
  const c = await contexto.cargar(ctx.token, revision, piezas);
  c.token = ctx.token;
  c.indicaciones = paso === 'texto' ? String(indicaciones ?? '').trim() : '';

  const salida = paso === 'keywords'
    ? await modulo.keywords(c, { keywords })
    : await modulo.texto(c, { keywords, palabras });

  let idGeneracion = null;
  if (paso === 'texto') idGeneracion = await registrar(ctx, idRev, seccion, salida.citas || []);
  if (salida.quitadas?.length) logger.info('citas_inventadas_quitadas', { seccion, n: salida.quitadas.length });

  return {
    seccion, paso,
    resultado: salida.resultado,
    id_generacion: idGeneracion,
    idioma: c.idioma,
    citas: salida.citas || [],
    citas_quitadas: salida.quitadas || [],
    // Trabajos relacionados, Introducción y Discusión: dónde se buscaron las fuentes (Consensus o CrossRef)
    ...(salida.fuentes ? { fuentes: salida.fuentes } : {})
  };
}

/** Registra la generación en generaciones_ia. Si falla, se avisa en el log y la generación sigue valiendo. */
async function registrar(ctx, idRev, seccion, citas) {
  const ctxPeticion = getContext();
  const uso = ctxPeticion?.usage || {};
  try {
    return await repo.registrarGeneracion(ctx.token, {
      p_id_rev: idRev,
      p_seccion: seccion,
      p_id_version: null,                       // se enlaza al guardar la sección (PATCH con id_generacion)
      p_modelo: uso.modelo || env.OPENAI_MODEL,
      p_referencias: citas.slice(0, 200),
      p_tokens_in: uso.tokens_entrada || 0,
      p_tokens_out: uso.tokens_salida || 0,
      p_ms: ctxPeticion ? Date.now() - ctxPeticion.startedAt : null,
      p_endpoint: `POST /api/v1/revisiones/:id/secciones/${seccion}/generar`
    });
  } catch (e) {
    logger.warn('registro_generacion_ia_fallido', { seccion, status: e.status, message: e.message });
    return null;
  }
}

module.exports = { generar, CON_KEYWORDS, SECCIONES_IA };
