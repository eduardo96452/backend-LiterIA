// modules/informes/generacion.js
// Generación con IA de las secciones del artículo, con el contexto leído de la base.
//
// Antes, el navegador armaba el contexto (resultados, metodología, discusión…) con lo que
// tuviera en pantalla y lo enviaba entero; ahora el cliente solo dice qué sección y qué paso,
// y el servidor lee lo GUARDADO. Así no se puede enviar texto arbitrario para gastar tokens,
// y la IA trabaja siempre con la misma versión que saldrá en el Word.
//
// Los prompts son los de ia/prompts (los mismos que usan las rutas /api/generate-*); los datos
// se validan con los mismos esquemas, así que la IA recibe exactamente la forma de siempre.
const env = require('../../config/env');
const logger = require('../../core/logger');
const { HttpError } = require('../../core/httpError');
const { getContext } = require('../../core/requestContext');
const S = require('../../legacy/schemas');
const prompts = {
  introduccion: require('../../ia/prompts/introduccion'),
  trabajos_relacionados: require('../../ia/prompts/trabajos'),
  metodologia: require('../../ia/prompts/metodologia'),
  resultados: require('../../ia/prompts/resultados'),
  discusion: require('../../ia/prompts/discusion'),
  limitaciones: require('../../ia/prompts/limitaciones'),
  conclusion: require('../../ia/prompts/conclusion'),
  resumen: require('../../ia/prompts/resumen')
};
const repo = require('./informes.repo');
const revisiones = require('../revisiones/revisiones.service');
const { NOMBRES, leerGuardadas, tieneContenido, aTexto, parrafos } = require('./secciones');

/** Secciones con un paso previo de palabras clave (que el usuario puede editar). */
const CON_KEYWORDS = new Set(['trabajos_relacionados', 'discusion', 'introduccion']);

/* ---------- Ajuste de tamaño a los límites de los esquemas ---------- */

const corta = (texto, max) => {
  const t = String(texto ?? '');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};
const lista = (arr, maxItems, maxLen) => (arr || []).slice(0, maxItems).map(x => corta(x, maxLen));

/** Un valor que se mide con JSON.stringify (esquema `bounded`): si no cabe, pasa a texto recortado. */
function acotado(valor, max) {
  if (JSON.stringify(valor ?? '').length <= max) return valor;
  let texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
  while (JSON.stringify(texto).length > max) texto = texto.slice(0, Math.floor(texto.length * 0.9));
  return texto + ' …[recortado]';
}

/** Recorta las respuestas por pregunta para que el total no pase de `presupuesto` caracteres. */
function preguntasAcotadas(preguntas, presupuesto, maxItems = 50, maxLen = 5000) {
  const entradas = Object.entries(preguntas).slice(0, 20).map(([p, rs]) => [corta(p, 500), lista(rs, maxItems, maxLen)]);
  const total = entradas.reduce((n, [, rs]) => n + rs.join('').length, 0);
  if (total <= presupuesto) return Object.fromEntries(entradas);
  const factor = presupuesto / total;
  return Object.fromEntries(entradas.map(([p, rs]) => [p, rs.map(r => corta(r, Math.max(80, Math.floor(r.length * factor))))]));
}

/* ---------- Contexto ---------- */

/** Resumen de resultados en la forma que esperan los prompts. */
function resumenResultados(res, presupuesto = 12000) {
  return {
    reflexion_inicial: lista(res.reflexion_inicial, 20, 5000),
    preguntas: preguntasAcotadas(res.preguntas, presupuesto),
    referencias: lista(res.referencias, 50, 1000)
  };
}

/**
 * Entrada de los prompts de discusión: preguntas + reflexión + referencias, sin pasar de
 * 60 000 caracteres (límite del esquema). Si no cabe, se recorta en pasos.
 */
function entradaDiscusion(res, extra = {}) {
  for (const [presupuesto, maxRefs, maxParrafo] of [[40000, 50, 5000], [25000, 30, 3000], [12000, 15, 1500], [5000, 8, 800]]) {
    const datos = {
      ...preguntasAcotadas(res.preguntas, presupuesto),
      reflexion_inicial: lista(res.reflexion_inicial, 20, maxParrafo),
      referencias: lista(res.referencias, maxRefs, 600),
      ...extra
    };
    if (JSON.stringify(datos).length <= 58000) return datos;
  }
  return { reflexion_inicial: lista(res.reflexion_inicial, 5, 500), referencias: [], ...extra };
}

const metodologiaTexto = met => Object.fromEntries(Object.entries(met).map(([k, v]) => [k, corta(v, 5000)]));

function exigirGuardada(guardadas, seccion, para) {
  if (!tieneContenido(guardadas, seccion)) {
    throw new HttpError(400, `Para generar «${NOMBRES[para]}» primero guarda la sección «${NOMBRES[seccion]}».`);
  }
}

/** Mensajes claros para los datos de entrada que suelen faltar. */
const FALTA = {
  title: 'la revisión no tiene título', titulo_revision: 'la revisión no tiene título',
  objective: 'la revisión no tiene objetivo (Planificación)', objetivo: 'la revisión no tiene objetivo (Planificación)',
  keywords: 'faltan las palabras clave: genéralas o escríbelas primero',
  criterios_seleccion: 'la revisión no tiene criterios de inclusión o exclusión (Planificación)',
  global_search: 'falta la cadena de búsqueda global (Planificación)',
  text: 'la revisión no tiene título ni descripción',
  studies_data: 'la revisión no tiene estudios',
  extraction_data: 'aún no hay respuestas en Extracción de datos',
  research_questions: 'la revisión no tiene preguntas de investigación (Planificación)',
  conclusions: 'primero guarda la sección «Conclusiones»',
  word_count: 'indica cuántas palabras debe tener el resumen (entre 50 y 500)'
};

function validar(schema, datos, seccion) {
  const r = schema.safeParse(datos);
  if (r.success) return r.data;
  const campos = [...new Set(r.error.issues.map(i => String(i.path[0] ?? '')))];
  const motivos = [...new Set(campos.map(c => FALTA[c]).filter(Boolean))];
  const detalle = motivos.length ? `: ${motivos.join('; ')}.` : '.';
  throw new HttpError(400, `No se puede generar «${NOMBRES[seccion]}» todavía${detalle}`,
    r.error.issues.map(i => ({ campo: i.path.join('.') || '(raíz)', mensaje: i.message })));
}

/**
 * Para cada sección y paso: qué datos leer y cómo armar la entrada del prompt.
 * `c` trae lo cargado: revision, guardadas, preguntas, criterios, planificacion, estudios, extraccion.
 */
const ARMADO = {
  trabajos_relacionados: {
    keywords: {
      cargar: ['criterios'],
      armar: (c) => [prompts.trabajos_relacionados.keywords, S.trabaRelaKeywords, {
        text: corta([c.revision.titulo_revision, c.revision.descripcion, c.criterios.map(x => x.descripcion).join(', ')]
          .filter(Boolean).join(' '), 20000)
      }]
    },
    texto: {
      cargar: ['criterios', 'guardadas'],
      armar: (c, extra) => [prompts.trabajos_relacionados.texto, S.trabajosRelacionados, {
        title: corta(c.revision.titulo_revision, 300),
        description: corta(c.revision.descripcion, 3000),
        criterios_seleccion: corta(c.criterios.map(x => x.descripcion).join(', '), 3000),
        keywords: corta(extra.keywords ?? c.guardadas.trabajos_relacionados.keywords, 500)
      }]
    }
  },
  metodologia: {
    texto: {
      cargar: ['planificacion'],
      armar: (c) => {
        const p = c.planificacion || {};
        return [prompts.metodologia.texto, S.metodologia, {
          titulo_revision: corta(p.titulo_revision ?? c.revision.titulo_revision, 300),
          objetivo: corta(p.objetivo ?? c.revision.objetivo ?? '', 2000),
          tipo_revision: corta(p.tipo_revision || 'RSL', 100),
          frameworks: lista(p.frameworks, 10, 100),
          keywords: (p.keywords || []).slice(0, 30).map(k => ({
            componente: corta(k.componente ?? '', 100), palabra: corta(k.palabra ?? '', 150), sinonimos: lista(k.sinonimos, 10, 150)
          })),
          global_search: corta(p.global_search ?? '', 3000),
          per_base_search: (p.per_base_search || []).slice(0, 20).map(b => ({ fuente: corta(b.fuente, 100), cadena: corta(b.cadena, 3000) })),
          bibliografias: (p.bibliografias || []).slice(0, 20).map(b => ({ nombre: corta(b.nombre, 100), url: corta(b.url, 500) })),
          inclusion_criteria: lista(p.inclusion_criteria, 20, 500),
          exclusion_criteria: lista(p.exclusion_criteria, 20, 500)
        }];
      }
    }
  },
  resultados: {
    texto: {
      cargar: ['estudios', 'extraccion'],
      armar: (c) => [prompts.resultados.texto, S.resultados, {
        studies_data: c.estudios.slice(0, 500).map(e => ({ status: corta(e.estado ?? '', 50), id_estudios: e.id_estudios, titulo: e.titulo })),
        extraction_data: c.extraccion.slice(0, 500).map(r => ({
          pregunta: corta(r.pregunta, 500), respuesta: corta(aTexto(r.respuesta), 5000), autores: corta(r.autores, 500),
          anio: corta(r.anio, 10), titulo: corta(r.titulo, 500), revista: corta(r.revista, 300), doi: corta(r.doi, 200)
        }))
      }]
    }
  },
  discusion: {
    keywords: {
      cargar: ['guardadas'],
      antes: c => exigirGuardada(c.guardadas, 'resultados', 'discusion'),
      armar: (c) => [prompts.discusion.keywords, S.discussionKeywords, entradaDiscusion(c.guardadas.resultados)]
    },
    texto: {
      cargar: ['guardadas'],
      antes: c => exigirGuardada(c.guardadas, 'resultados', 'discusion'),
      armar: (c, extra) => [prompts.discusion.texto, S.discussion,
        entradaDiscusion(c.guardadas.resultados, { keywords: corta(extra.keywords ?? c.guardadas.discusion.keywords, 500) })]
    }
  },
  limitaciones: {
    texto: {
      cargar: ['guardadas'],
      antes: c => { exigirGuardada(c.guardadas, 'metodologia', 'limitaciones'); exigirGuardada(c.guardadas, 'resultados', 'limitaciones'); },
      armar: (c) => {
        const m = metodologiaTexto(c.guardadas.metodologia);
        const r = resumenResultados(c.guardadas.resultados, 30000);
        return [prompts.limitaciones.texto, S.limitaciones, {
          methodological_issues: {
            enfoque_metodologico: m.enfoque_metodologico, fases_prisma: m.fases_prisma,
            procedimiento_busqueda: m.procedimiento_busqueda, criterios_seleccion: m.criterios_seleccion,
            proceso_cribado: m.proceso_cribado
          },
          search_limitations: r
        }];
      }
    }
  },
  conclusion: {
    texto: {
      cargar: ['guardadas', 'preguntas'],
      antes: c => exigirGuardada(c.guardadas, 'resultados', 'conclusion'),
      armar: (c) => [prompts.conclusion.texto, S.conclusion, {
        results_summary: acotado(resumenResultados(c.guardadas.resultados, 20000), 30000),
        discussion_summary: lista(parrafos(c.guardadas.discusion.texto), 20, 5000),
        objective: corta(c.revision.objetivo || 'No hay objetivo definido.', 2000),
        research_questions: lista(c.preguntas.map(p => p.pregunta), 10, 500)
      }]
    }
  },
  introduccion: {
    keywords: {
      cargar: ['guardadas', 'preguntas'],
      armar: (c) => [prompts.introduccion.keywords, S.introductionKeywords, datosIntroduccion(c)]
    },
    texto: {
      cargar: ['guardadas', 'preguntas'],
      armar: (c, extra) => [prompts.introduccion.texto, S.introduction, {
        ...datosIntroduccion(c),
        keywords: corta(extra.keywords ?? c.guardadas.introduccion.keywords, 500)
      }]
    }
  },
  resumen: {
    texto: {
      cargar: ['guardadas'],
      armar: (c, extra) => [prompts.resumen.texto, S.resumen, {
        title: corta(c.revision.titulo_revision, 300),
        objective: corta(c.revision.objetivo ?? '', 2000),
        methodology: acotado(metodologiaTexto(c.guardadas.metodologia), 15000),
        results_summary: acotado(resumenResultados(c.guardadas.resultados, 20000), 30000),
        discussion_summary: acotado(parrafos(c.guardadas.discusion.texto), 15000),
        conclusions: corta(c.guardadas.conclusion, 8000),
        word_count: extra.palabras
      }]
    }
  }
};

function datosIntroduccion(c) {
  return {
    title: corta(c.revision.titulo_revision, 300),
    description: corta(c.revision.descripcion, 3000),
    objective: corta(c.revision.objetivo ?? '', 2000),
    methodology: acotado(metodologiaTexto(c.guardadas.metodologia), 15000),
    results_summary: acotado(resumenResultados(c.guardadas.resultados, 10000), 15000),
    discussion_summary: lista(parrafos(c.guardadas.discusion.texto), 20, 5000),
    conclusions: corta(c.guardadas.conclusion, 8000),
    research_questions: lista(c.preguntas.map(p => p.pregunta), 10, 500)
  };
}

async function cargar(token, idRev, piezas) {
  const c = {};
  await Promise.all(piezas.map(async pieza => {
    switch (pieza) {
      case 'guardadas': c.guardadas = leerGuardadas(await repo.filaSecciones(token, idRev)); break;
      case 'preguntas': c.preguntas = await repo.preguntas(token, idRev); break;
      case 'criterios': c.criterios = await repo.criterios(token, idRev); break;
      case 'planificacion': c.planificacion = await repo.contextoPlanificacion(token, idRev); break;
      case 'estudios': c.estudios = await repo.estudiosEstado(token, idRev); break;
      case 'extraccion': c.extraccion = await repo.respuestasExtraccion(token, idRev); break;
    }
  }));
  return c;
}

/** Referencias que usó la IA, para guardarlas en generaciones_ia. */
function referenciasUsadas(resultado) {
  const refs = resultado?.references ?? resultado?.referencias ?? [];
  return Array.isArray(refs) ? refs.map(r => aTexto(r)).filter(Boolean).slice(0, 100) : [];
}

/**
 * Genera una sección. Devuelve { seccion, paso, resultado, id_generacion }.
 * `resultado` tiene la misma forma que la respuesta de la ruta antigua equivalente.
 */
async function generar(ctx, idRev, seccion, { paso = 'texto', keywords, palabras } = {}) {
  if (paso === 'keywords' && !CON_KEYWORDS.has(seccion)) {
    throw new HttpError(400, `La sección «${NOMBRES[seccion]}» no tiene paso de palabras clave.`);
  }
  const plan = ARMADO[seccion][paso];

  // Antes de gastar tokens: la revisión existe y el usuario puede escribir en ella.
  const revision = await revisiones.exigirEscritura(ctx, idRev);
  const c = { revision, ...(await cargar(ctx.token, idRev, plan.cargar)) };
  plan.antes?.(c);

  const [fn, schema, entrada] = plan.armar(c, { keywords: keywords || undefined, palabras });
  const resultado = await fn(validar(schema, entrada, seccion));

  // Trazabilidad: solo el texto de la sección (las palabras clave no van al artículo).
  let idGeneracion = null;
  if (paso === 'texto') idGeneracion = await registrar(ctx, idRev, seccion, resultado);

  return { seccion, paso, resultado, id_generacion: idGeneracion };
}

/** Registra la generación en generaciones_ia. Si falla, se avisa en el log y la generación sigue valiendo. */
async function registrar(ctx, idRev, seccion, resultado) {
  const contexto = getContext();
  const uso = contexto?.usage || {};
  try {
    return await repo.registrarGeneracion(ctx.token, {
      p_id_rev: idRev,
      p_seccion: seccion,
      p_id_version: null,                       // se enlaza al guardar la sección (PATCH con id_generacion)
      p_modelo: uso.modelo || env.OPENAI_MODEL,
      p_referencias: referenciasUsadas(resultado),
      p_tokens_in: uso.tokens_entrada || 0,
      p_tokens_out: uso.tokens_salida || 0,
      p_ms: contexto ? Date.now() - contexto.startedAt : null,
      p_endpoint: `POST /api/v1/revisiones/:id/secciones/${seccion}/generar`
    });
  } catch (e) {
    logger.warn('registro_generacion_ia_fallido', { seccion, status: e.status, message: e.message });
    return null;
  }
}

module.exports = { generar, CON_KEYWORDS };
