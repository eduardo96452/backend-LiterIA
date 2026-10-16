// ia/redaccion/comun.js
// Piezas comunes de los prompts de redacción del artículo de revisión sistemática.
//
// Principios (sacados de artículos de RSL publicados y de los fallos de los prompts anteriores):
//  - La IA redacta; las cifras, las tablas y la bibliografía las pone la aplicación con los datos
//    de la base. Así el texto dice lo mismo que el diagrama PRISMA y que las tablas.
//  - La IA solo cita con claves del registro ([@clave]); las que no existen se quitan. Ninguna
//    herramienta basada en LLM es fiable escribiendo referencias por su cuenta.
//  - Cada sección tiene una estructura explícita, como la de los artículos de RSL publicados.
const { callOpenAI } = require('../../infra/openai');
const { parseAiJson } = require('../aiJson');
const { HttpError } = require('../../core/httpError');
const F = require('../../modules/informes/referencias/formato');

const corta = (t, max) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };
const lista = arr => (arr || []).filter(Boolean);

const NOMBRE_IDIOMA = { es: 'español', en: 'inglés' };

/** Prefijo de las preguntas de investigación: PI1… en español, RQ1… en inglés. */
const prefijoPregunta = idioma => (idioma === 'en' ? 'RQ' : 'PI');

/** Preguntas con su código, en el orden de Planificación. */
const preguntasConCodigo = (preguntas, idioma) =>
  (preguntas || []).map((p, i) => ({ id: p.id_preguntas_investigacion, codigo: `${prefijoPregunta(idioma)}${i + 1}`, pregunta: String(p.pregunta || '').trim() }))
    .filter(p => p.pregunta);

/** Instrucciones de sistema comunes a todas las secciones. */
function sistema(idioma) {
  const en = idioma === 'en';
  return [
    'Eres coautor/a de artículos de revisión sistemática de la literatura (RSL) publicados en revistas indexadas y conoces a fondo PRISMA 2020.',
    'Redactas UNA sección de un artículo de RSL a partir de los datos reales de la revisión que te da la aplicación.',
    '',
    'REGLAS',
    `1. Idioma de salida: ${en ? 'inglés académico formal (ortografía estadounidense)' : 'español académico formal'}. Voz impersonal o pasiva refleja ` +
      `(${en ? '"this review examined", "studies were screened"' : '«se analizaron», «se incluyeron»'}); pasado para lo que se hizo y presente para lo que muestran los datos. Nunca primera persona del singular.`,
    '2. Usa SOLO la información de DATOS y FUENTES. No inventes estudios, autores, cifras, porcentajes, fechas, bases de datos, herramientas ni hallazgos. ' +
      'Si un dato no está, omítelo sin decir que falta (nada de «[completar]», «no se especifica» o «N/A»).',
    '3. CITAS: solo con las claves de FUENTES.',
    '   - Entre corchetes cuando la fuente respalda una afirmación: «… en la evaluación formativa [@lo2023]». Varias: [@lo2023; @burke2023].',
    '   - Narrativa cuando el autor es el sujeto: «@lo2023 sintetizó…» (la aplicación escribirá «Lo (2023) sintetizó…» o «Lo [3] sintetizó…»).',
    '   - Nunca escribas apellidos con año, números entre corchetes, DOI ni listas de referencias: la bibliografía la genera la aplicación con la plantilla de la revisión.',
    '   - No atribuyas a una fuente nada que no diga su título o su resumen.',
    '4. Copia exactas las cifras de DATOS. Porcentajes con un decimal y siempre sobre el total que se indica.',
    '5. Párrafos de 4 a 7 oraciones separados por una línea en blanco. Sin títulos, viñetas ni negritas dentro del texto salvo que se pidan. ' +
      'Evita frases de relleno («cabe destacar», «en el mundo actual»), adjetivos promocionales («revolucionario», «sin precedentes») y conclusiones genéricas.',
    '6. Llama a las cosas con los mismos nombres que aparecen en DATOS (bases de datos, criterios, preguntas, categorías).',
    '7. Responde únicamente con un objeto JSON válido con las claves indicadas.'
  ].join('\n');
}

/** Encabezado de los datos generales de la revisión. */
function datosRevision(c, preguntas) {
  const r = c.revision || {};
  return [
    `Título de la revisión: ${corta(r.titulo_revision, 300)}`,
    r.objetivo ? `Objetivo: ${corta(r.objetivo, 1500)}` : '',
    r.descripcion ? `Descripción: ${corta(r.descripcion, 1500)}` : '',
    r.area_conocimiento ? `Área de conocimiento: ${corta(r.area_conocimiento, 200)}` : '',
    r.alcance ? `Alcance: ${corta(r.alcance, 300)}` : '',
    preguntas?.length ? `Preguntas de investigación:\n${preguntas.map(p => `  ${p.codigo}. ${p.pregunta}`).join('\n')}` : ''
  ].filter(Boolean).join('\n');
}

/**
 * Bloque FUENTES: una entrada por referencia del registro, con su clave, una cita legible y, si
 * se tiene, el resumen (de CrossRef o del estudio incluido) para que la IA sepa qué dice.
 */
function bloqueFuentes(refs, { resumenes = new Map(), maxResumen = 900 } = {}) {
  if (!refs.length) return '(sin fuentes: no cites nada)';
  return refs.map(r => {
    const autores = (r.autores || []).slice(0, 3).map(a => a.apellido).join(', ') + ((r.autores || []).length > 3 ? ' et al.' : '');
    const resumen = resumenes.get(r.clave) || r.datos_crossref?.resumen || '';
    const conclusion = r.datos_crossref?.takeaway || '';          // fuentes de Consensus
    return [`[@${r.clave}] ${autores || 'Sin autor'} (${r.anio || 's. f.'}). ${corta(r.titulo, 250)}${r.revista ? `. ${corta(r.revista, 120)}` : ''}.`,
      conclusion ? `   Conclusión principal: ${corta(conclusion, 400)}` : '',
      resumen ? `   Resumen: ${corta(resumen, maxResumen)}` : ''].filter(Boolean).join('\n');
  }).join('\n');
}

/** Llama al modelo y devuelve el JSON. Si la respuesta no es JSON válido, lo intenta una vez más. */
/**
 * Indicaciones que escribe el equipo en el Asistente de Redacción («tono más formal», «cita solo
 * revisiones previas»…). Van al final, como preferencia: no pueden saltarse las reglas (inventar
 * datos o citar fuentes que no están en la lista).
 */
function bloqueIndicaciones(indicaciones) {
  const t = String(indicaciones ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!t) return '';
  return [
    '',
    '',
    'INDICACIONES DEL EQUIPO PARA ESTA PROPUESTA (aplícalas siempre que no contradigan las reglas anteriores:',
    'no permiten inventar datos, cambiar cifras, citar fuentes que no están en la lista ni cambiar el formato JSON pedido)',
    `<<<${t.replace(/<<<|>>>/g, '')}>>>`
  ].join('\n');
}

async function pedirJson(idioma, instrucciones, { maxTokens = 6000, temperature = 0.3, indicaciones } = {}) {
  const mensajes = [{ role: 'system', content: sistema(idioma) }, { role: 'user', content: instrucciones + bloqueIndicaciones(indicaciones) }];
  for (let intento = 0; intento < 2; intento++) {
    const raw = await callOpenAI(mensajes, { maxTokens, temperature, json: true });
    try {
      return parseAiJson(raw);
    } catch (e) {
      if (intento === 1) throw e;
    }
  }
  return {};
}

/** Texto → párrafos limpios separados por una línea en blanco. */
function enParrafos(valor) {
  const arr = Array.isArray(valor) ? valor : String(valor ?? '').split(/\n\s*\n/);
  return arr.map(p => String(p ?? '').replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
}
const texto = valor => enParrafos(valor).join('\n\n');

/** Error 400 con un motivo claro, antes de gastar tokens. */
function exigir(condicion, seccion, motivo) {
  if (!condicion) throw new HttpError(400, `No se puede generar «${seccion}» todavía: ${motivo}.`);
}

/** Referencias formateadas (para mostrar en la pantalla junto a la propuesta). */
function referenciasDe(refs, claves, c) {
  const porClave = new Map(refs.map(r => [r.clave, r]));
  return claves.map(k => porClave.get(k)).filter(Boolean)
    .map(r => `[@${r.clave}] ${F.formatear(r, { estilo: c.plantilla?.estilo, idioma: c.idioma }).texto}`);
}

/** Frase con el orden del artículo, en el idioma pedido (la añade la aplicación, no la IA). */
function frasesOrganizacion(idioma) {
  return idioma === 'en'
    ? 'The remainder of this article is organized as follows. Section 2 reviews related work. Section 3 describes the review methodology. ' +
      'Section 4 presents the results for each research question. Section 5 discusses the findings and their implications. ' +
      'Section 6 addresses the limitations and threats to validity, and Section 7 concludes the article.'
    : 'El resto del artículo se organiza de la siguiente manera. La sección 2 revisa los trabajos relacionados. La sección 3 describe la metodología de la revisión. ' +
      'La sección 4 presenta los resultados para cada pregunta de investigación. La sección 5 discute los hallazgos y sus implicaciones. ' +
      'La sección 6 aborda las limitaciones y amenazas a la validez, y la sección 7 presenta las conclusiones.';
}

module.exports = {
  bloqueIndicaciones,
  corta, lista, NOMBRE_IDIOMA, prefijoPregunta, preguntasConCodigo, sistema, datosRevision, bloqueFuentes,
  pedirJson, enParrafos, texto, exigir, referenciasDe, frasesOrganizacion
};
