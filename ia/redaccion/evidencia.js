// ia/redaccion/evidencia.js
// Fuentes de Trabajos relacionados, Introducción y Discusión con Consensus (v3.10).
//
// Antes: el usuario generaba palabras clave y se buscaba en CrossRef por coincidencia de palabras.
// Ahora: la aplicación formula por su cuenta unas pocas búsquedas en lenguaje natural a partir de lo
// guardado de la revisión (título, objetivo, preguntas y, en la Discusión, los hallazgos), Consensus
// devuelve artículos revisados por pares con su resumen, su conclusión principal y (en los planes de
// pago) fragmentos del texto completo, y la IA redacta apoyándose en esa evidencia.
//
// Las fuentes se ofrecen a la IA con claves provisionales ([@cns1]…). Solo las que la IA cita
// entran en el registro de referencias (con los metadatos de CrossRef por su DOI, para que la
// bibliografía salga completa) y las claves provisionales se cambian por las definitivas.
// Sin CONSENSUS_API_KEY, o si Consensus falla, se usa CrossRef como antes y se avisa.
const env = require('../../config/env');
const logger = require('../../core/logger');
const consensus = require('../../infra/consensus');
const academicas = require('../../infra/academicas');
const { callOpenAI } = require('../../infra/openai');
const { parseAiJson } = require('../aiJson');
const registro = require('../../modules/informes/referencias/registro');
const F = require('../../modules/informes/referencias/formato');
const C = require('./comun');

const PREFIJO = 'cns';
const TIPOS_REVISION = ['systematic review', 'literature review', 'meta-analysis'];

/** Qué busca cada sección y cuántas fuentes se dan a la IA. */
const PLAN = {
  trabajos: {
    fuentes: 10,
    pide: [
      'Busca, en este orden: (1) revisiones sistemáticas o de la literatura previas sobre el mismo tema de la revisión; ',
      '(2) estudios sobre el concepto central de la revisión en su población o contexto; (3) estudios sobre el aspecto de las preguntas de investigación menos cubierto por las anteriores.'
    ].join(''),
    revisionesPrimero: true
  },
  introduccion: {
    fuentes: 8,
    pide: [
      'Busca, en este orden: (1) la importancia, el alcance o la adopción del fenómeno que estudia la revisión en su contexto; ',
      '(2) el problema o desafío concreto que motiva la revisión (riesgos, efectos, dificultades); (3) revisiones previas sobre el tema, para señalar el vacío.'
    ].join(''),
    revisionesAlFinal: true
  },
  discusion: {
    fuentes: 8,
    pide: 'Formula una búsqueda por cada uno de los hallazgos principales de la revisión (de los RESULTADOS), redactada como la pregunta o la afirmación que hay que contrastar con estudios previos.'
  }
};

/* ---------- 1. Búsquedas ---------- */

/**
 * Pide a la IA las búsquedas (en inglés, en lenguaje natural) para la sección. Si falla, se arman
 * con el título y los términos clave de la planificación.
 */
async function consultasPara(c, seccion, { preguntas = [], resultados = '' } = {}) {
  const n = env.CONSENSUS_MAX_CONSULTAS;
  const plan = PLAN[seccion];
  const instrucciones = [
    `TAREA: formula ${n} búsquedas para un buscador de artículos científicos revisados por pares (Consensus) que alimenten la sección «${{ trabajos: 'Trabajos relacionados', introduccion: 'Introducción', discusion: 'Discusión' }[seccion]}» de un artículo de revisión sistemática.`,
    '',
    plan.pide,
    '',
    'REGLAS',
    '- En inglés (casi todo lo indexado está en inglés), en lenguaje natural: una pregunta de investigación o una afirmación concreta de 6 a 16 palabras.',
    '- Nombra el fenómeno o la intervención, la población o el contexto y, si procede, el resultado. Nada de operadores booleanos, comillas ni comodines.',
    '- Usa los términos técnicos que usa la literatura del área; no copies el título tal cual.',
    '- Cada búsqueda cubre un aspecto distinto: no repitas la misma con otras palabras.',
    '',
    'DATOS DE LA REVISIÓN',
    C.datosRevision(c, preguntas),
    (c.planificacion?.keywords || []).length
      ? `Términos clave de la planificación: ${c.planificacion.keywords.map(k => [k.palabra, ...(k.sinonimos || []).slice(0, 3)].join(', ')).join('; ')}`
      : '',
    resultados ? `\nRESULTADOS GUARDADOS (hallazgos principales)\n${C.corta(resultados, 6000)}` : '',
    '',
    'Devuelve: { "consultas": [""] }'
  ].filter(l => l !== '').join('\n');

  try {
    const raw = await callOpenAI([
      { role: 'system', content: 'Eres documentalista experto en búsquedas bibliográficas para revisiones sistemáticas. Respondes solo con JSON válido.' },
      { role: 'user', content: instrucciones }
    ], { maxTokens: 600, temperature: 0.2, json: true });
    const v = parseAiJson(raw);
    const lista = (Array.isArray(v?.consultas) ? v.consultas : Array.isArray(v?.queries) ? v.queries : [])
      .map(q => String(q ?? '').replace(/["“”*]/g, '').replace(/\s+/g, ' ').trim()).filter(q => q.length >= 8);
    if (lista.length) return [...new Set(lista)].slice(0, n);
  } catch (e) {
    logger.warn('consensus_consultas_ia_fallo', { message: e.message });
  }
  // Respaldo: términos clave de la planificación (suelen estar en inglés) o el título
  const kws = (c.planificacion?.keywords || []).map(k => k.palabra).filter(Boolean);
  const base = kws.length ? kws.slice(0, 4).join(' ') : C.corta(c.revision?.titulo_revision, 200);
  return [base, kws.length > 1 ? `${kws.slice(0, 2).join(' ')} systematic review` : null].filter(Boolean).slice(0, n);
}

/* ---------- 2. Búsqueda y selección ---------- */

const doiLimpio = registro.doiLimpio;
const limpio = t => String(t ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Fragmentos «Section: Results | texto» → [{ seccion, texto }]. */
function fragmentos(chunks) {
  return (Array.isArray(chunks) ? chunks : []).slice(0, 3).map(ch => {
    const s = String(ch ?? '');
    const i = s.indexOf('|');
    return i > 0
      ? { seccion: s.slice(0, i).replace(/^\s*section\s*:\s*/i, '').trim(), texto: limpio(s.slice(i + 1)) }
      : { seccion: '', texto: limpio(s) };
  }).filter(f => f.texto);
}

/**
 * Busca en Consensus y elige las mejores fuentes para la sección.
 * Devuelve { candidatos: [{ temporal, doi, titulo, autores, anio, revista, ... }], consultas }.
 * Las que ya están en el registro (mismo DOI) no se repiten: se devuelven en `yaEnRegistro` (claves).
 */
async function buscar(c, seccion, opciones = {}) {
  const plan = PLAN[seccion];
  const consultas = await consultasPara(c, seccion, opciones);
  const excluir = new Set((c.estudios?.incluidos || []).map(e => doiLimpio(e.doi)).filter(Boolean));
  const enRegistro = new Map((c.referencias || []).filter(r => r.doi && !r.id_estudios).map(r => [doiLimpio(r.doi), r.clave]));

  const porDoi = new Map();
  const yaEnRegistro = new Set();
  for (const [i, consulta] of consultas.entries()) {
    const revisiones = (plan.revisionesPrimero && i === 0) || (plan.revisionesAlFinal && i === consultas.length - 1 && consultas.length > 1);
    const { results } = await consensus.buscar(consulta, revisiones ? { study_types: TIPOS_REVISION } : {});
    results.forEach((r, pos) => {
      const doi = doiLimpio(r.doi);
      if (!doi || excluir.has(doi) || !limpio(r.title)) return;
      if (enRegistro.has(doi)) { yaEnRegistro.add(enRegistro.get(doi)); return; }
      const puntos = (typeof r.semantic_score === 'number' ? r.semantic_score : 1 - pos / Math.max(results.length, 1))
        + 0.04 * Math.log10(1 + (Number(r.citation_count) || 0))
        + (r.sjr_best_quartile ? (5 - r.sjr_best_quartile) * 0.015 : 0)
        + (TIPOS_REVISION.includes(String(r.study_type || '').toLowerCase()) && seccion !== 'discusion' ? 0.05 : 0);
      const previo = porDoi.get(doi);
      if (previo) { previo.puntos += 0.1; return; }            // aparece en más de una búsqueda
      porDoi.set(doi, {
        doi, consulta, puntos,
        titulo: limpio(r.title),
        autores: (Array.isArray(r.authors) ? r.authors : []).map(limpio).filter(Boolean),
        anio: Number(r.publish_year) || null,
        revista: limpio(r.journal_name) || null,
        volumen: limpio(r.volume) || null,
        paginas: limpio(r.pages) || null,
        editorial: limpio(r.publisher_name) || null,
        tipo_estudio: limpio(r.study_type) || null,
        citas: Number(r.citation_count) || 0,
        sjr: r.sjr_best_quartile ?? null,
        takeaway: limpio(r.takeaway),
        resumen: limpio(r.abstract).slice(0, 2500),
        fragmentos: fragmentos(r.full_text_chunks),
        url: r.url || null
      });
    });
  }
  const candidatos = [...porDoi.values()]
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, plan.fuentes)
    .map((x, i) => ({ ...x, temporal: `${PREFIJO}${i + 1}` }));
  return { candidatos, consultas, yaEnRegistro: [...yaEnRegistro] };
}

/** Bloque de evidencia para el prompt: cada fuente con su clave provisional y lo que dice. */
function bloqueEvidencia(candidatos) {
  if (!candidatos.length) return '';
  return candidatos.map(x => {
    const autores = x.autores.length ? `${apellido(x.autores[0])}${x.autores.length > 2 ? ' et al.' : x.autores.length === 2 ? ` y ${apellido(x.autores[1])}` : ''}` : 'Sin autor';
    const datos = [x.tipo_estudio ? `tipo de estudio: ${x.tipo_estudio}` : '', x.citas ? `${x.citas} citas` : ''].filter(Boolean).join('; ');
    return [
      `[@${x.temporal}] ${autores} (${x.anio || 's. f.'}). ${C.corta(x.titulo, 250)}${x.revista ? `. ${C.corta(x.revista, 120)}` : ''}.${datos ? ` (${datos})` : ''}`,
      x.takeaway ? `   Conclusión principal: ${C.corta(x.takeaway, 400)}` : '',
      x.resumen ? `   Resumen: ${C.corta(x.resumen, 900)}` : '',
      ...x.fragmentos.slice(0, 2).map(f => `   Fragmento del texto completo${f.seccion ? ` (${C.corta(f.seccion, 60)})` : ''}: ${C.corta(f.texto, 450)}`)
    ].filter(Boolean).join('\n');
  }).join('\n');
}
const apellido = nombre => {
  const p = F.parseAutores(nombre)[0];
  return p?.apellido || String(nombre).split(/\s+/).pop();
};

/** Reglas de uso de la evidencia que se añaden al prompt de la sección. */
const REGLAS_EVIDENCIA = [
  'USO DE LA EVIDENCIA',
  '- Cada afirmación con cita debe poder comprobarse en la conclusión principal, el resumen o los fragmentos de esa fuente. No le atribuyas nada más.',
  '- Aprovecha los datos concretos que traen las fuentes (población, contexto, diseño, tamaño de la muestra, resultados): hacen el texto más preciso que una paráfrasis del título.',
  '- Si una fuente es una revisión sistemática o un metaanálisis, dilo; si los resultados son mixtos o limitados, matiza la afirmación.',
  '- No cites una fuente solo porque trata el mismo tema: cítala donde respalde lo que dice la frase. Puedes dejar fuera las que no aporten.'
].join('\n');

/* ---------- 3. Después de redactar: al registro solo lo citado ---------- */

/** Fila del registro para una fuente de Consensus: con los metadatos de CrossRef si el DOI existe. */
async function filaDe(c, x) {
  const extra = {
    fuente: 'consensus', consulta: x.consulta, url: x.url, takeaway: x.takeaway || null,
    resumen: x.resumen ? x.resumen.slice(0, 1500) : null, tipo_estudio: x.tipo_estudio, citas: x.citas, sjr: x.sjr,
    relevancia: Math.round(Math.min(1, Math.max(0, x.puntos)) * 1000) / 1000, coincidencias: []
  };
  let item = null;
  try { item = await academicas.consultarDoi(x.doi); } catch { item = null; }
  if (item?.DOI) return { ...registro.filaDeCrossref(c.idRev, item, extra), origen: 'ia' };
  return {
    id_detalles_revision: c.idRev, doi: x.doi, titulo: x.titulo, autores: F.parseAutores(x.autores.join('; ')),
    anio: x.anio, revista: x.revista, volumen: x.volumen, numero: null, paginas: x.paginas, editorial: x.editorial,
    url: x.url, issn: null, tipo: 'article', origen: 'ia', verificada: 'pendiente', datos_crossref: extra
  };
}

/**
 * Da de alta en el registro las fuentes citadas y devuelve el registro actualizado y el cambio de
 * claves provisionales por definitivas: Map('cns3' → 'lo2023').
 */
async function registrarCitadas(c, candidatos, usadas, lista) {
  const citadas = candidatos.filter(x => usadas.has(x.temporal));
  if (!citadas.length) return { lista, mapa: new Map() };
  const filas = [];
  for (const x of citadas) filas.push(await filaDe(c, x));
  const r = await registro.agregarFilas(c.token, c.idRev, filas, lista);
  const claveDeDoi = new Map(r.lista.filter(f => f.doi).map(f => [doiLimpio(f.doi), f.clave]));
  return { lista: r.lista, mapa: new Map(citadas.map(x => [x.temporal, claveDeDoi.get(x.doi)]).filter(([, k]) => k)) };
}

/** Cambia las claves provisionales del texto ([@cns3], @cns3) por las del registro. */
function aplicarClaves(texto, mapa) {
  if (!mapa.size || !texto) return texto;
  return String(texto).replace(new RegExp(`@(${PREFIJO}\\d+)(?![\\p{L}\\p{N}_-])`, 'gu'), (todo, k) => (mapa.has(k) ? `@${mapa.get(k)}` : todo));
}

const activo = () => consensus.activo();

module.exports = {
  PLAN, PREFIJO, TIPOS_REVISION, REGLAS_EVIDENCIA,
  activo, consultasPara, buscar, bloqueEvidencia, registrarCitadas, aplicarClaves, fragmentos
};

/* ---------- 4. Orquestación para cada sección ---------- */

/**
 * Fuentes externas de la sección: Consensus si está configurado (y responde con al menos `minimo`
 * fuentes); si no, CrossRef con las palabras clave (las del usuario o, si no hay, generadas aquí).
 *
 * @param crossref     async (palabras) => { lista, claves }   búsqueda en CrossRef de la sección
 * @param palabrasAuto async () => 'term 1, term 2'            palabras clave si el usuario no dio
 * @returns { buscador, candidatos, consultas, yaEnRegistro, lista, claves, aviso, palabras }
 */
async function fuentesSeccion(c, seccion, { preguntas = [], resultados = '', keywords = '', minimo = 1, crossref, palabrasAuto }) {
  let aviso = '';
  if (activo()) {
    try {
      const r = await buscar(c, seccion, { preguntas, resultados });
      if (r.candidatos.length + r.yaEnRegistro.length >= minimo) {
        return { buscador: 'consensus', ...r, lista: c.referencias, claves: [], aviso: '' };
      }
      aviso = 'Consensus no devolvió fuentes suficientes para esta sección; se buscaron en CrossRef.';
    } catch (e) {
      aviso = `${e.message} Se buscaron las fuentes en CrossRef.`;
      logger.warn('consensus_respaldo_crossref', { seccion, status: e.status, message: e.message });
    }
  }
  let palabras = String(keywords || '').trim();
  if (!palabras && palabrasAuto) palabras = String(await palabrasAuto() || '').trim();
  const r = palabras && crossref ? await crossref(palabras) : { lista: c.referencias, claves: [] };
  return { buscador: 'crossref', candidatos: [], consultas: palabras ? [palabras] : [], yaEnRegistro: [], ...r, aviso, palabras };
}

/** Bloque FUENTES del prompt: las del registro y, debajo, las de Consensus con su evidencia. */
function bloqueTodas(refs, candidatos) {
  const partes = [refs.length ? C.bloqueFuentes(refs) : '', bloqueEvidencia(candidatos)].filter(Boolean);
  return partes.length ? partes.join('\n') : '(sin fuentes: no cites nada)';
}

/**
 * Tras la respuesta de la IA: registra las fuentes de Consensus citadas, cambia las claves
 * provisionales y quita las que no pudieron registrarse. `usadas` son las claves que dejó
 * validarEnValor. Devuelve { lista, citas, limpiar(texto) }.
 */
async function finalizar(c, f, usadas) {
  const { validarEnValor } = require('../../modules/informes/referencias/citas');
  const { lista, mapa } = await registrarCitadas(c, f.candidatos, usadas, f.lista);
  const temporales = new Set(f.candidatos.map(x => x.temporal));
  const citas = [...new Set([...usadas].map(k => (temporales.has(k) ? mapa.get(k) : k)).filter(Boolean))];
  const validas = new Set(citas);
  const limpiar = texto => {
    if (!temporales.size) return texto;
    const conClaves = aplicarClaves(texto, mapa);
    return validarEnValor(conClaves, validas, { usadas: new Set(), quitadas: new Set() });
  };
  const claveFinal = k => (temporales.has(k) ? mapa.get(k) : k);
  return { lista, citas, limpiar, claveFinal };
}

/** Lo que se devuelve a la pantalla sobre las fuentes usadas. */
const resumenFuentes = (f, citas) => ({
  buscador: f.buscador,
  consultas: f.consultas,
  encontradas: f.buscador === 'consensus' ? f.candidatos.length : f.claves.length,
  citadas: citas.length,
  aviso: f.aviso || null
});

module.exports.fuentesSeccion = fuentesSeccion;
module.exports.bloqueTodas = bloqueTodas;
module.exports.finalizar = finalizar;
module.exports.resumenFuentes = resumenFuentes;
