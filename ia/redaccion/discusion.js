// ia/redaccion/discusion.js
// Sección «Discusión», como en los artículos de RSL publicados: síntesis de los hallazgos →
// interpretación por pregunta y contraste con la literatura previa → implicaciones para la
// práctica y la investigación → tabla de vacíos y líneas futuras.
// Fuentes: los estudios incluidos (para referirse a hallazgos), las fuentes ya citadas en
// Trabajos relacionados e Introducción y fuentes nuevas de Consensus, buscadas a partir de los
// hallazgos (o, sin Consensus, de CrossRef con palabras clave).
const C = require('./comun');
const T = require('../../modules/informes/tablas');
const { terminos } = require('./palabras');
const { buscarFuentes, conceptosDeCadena, conceptosDePalabrasClave } = require('./fuentes');
const registro = require('../../modules/informes/referencias/registro');
const { validarEnValor, clavesDe, normalizar } = require('../../modules/informes/referencias/citas');
const { aTexto } = require('../../modules/informes/secciones');
const E = require('./evidencia');

const NOMBRE = 'Discusión';
const piezas = ['planificacion', 'preguntas', 'criterios', 'estudios', 'calidad', 'guardadas', 'referencias'];
const piezasKeywords = ['preguntas', 'guardadas'];

const tieneResultados = g => Object.keys(g?.resultados?.preguntas || {}).length > 0 || (g?.resultados?.reflexion_inicial || []).length > 0;

/** Resultados guardados por pregunta, en texto (sin HTML), recortados. */
function resultadosTexto(g, maxPorPregunta = 3500) {
  const r = g.resultados || {};
  const partes = [];
  if (r.panorama) partes.push(`Panorama: ${C.corta(r.panorama, 1500)}`);
  if (r.calidad) partes.push(`Calidad: ${C.corta(r.calidad, 1000)}`);
  for (const [p, ps] of Object.entries(r.preguntas || {})) {
    const tabla = r.tablas_preguntas?.[p] ? ` Tabla: ${C.corta(aTexto(r.tablas_preguntas[p]), 1200)}` : '';
    partes.push(`${p}\n${C.corta((ps || []).join(' '), maxPorPregunta)}${tabla}`);
  }
  return partes.join('\n\n');
}

async function keywords(c) {
  C.exigir(tieneResultados(c.guardadas), NOMBRE, 'primero guarda la sección «Resultados»');
  const preguntas = C.preguntasConCodigo(c.preguntas, c.idioma);
  return { resultado: await terminos('discusion', `${C.datosRevision(c, preguntas)}\n${resultadosTexto(c.guardadas, 1500)}`) };
}

/** CrossRef con palabras clave (sin Consensus o si falla). */
async function porCrossref(c, preguntas, terminosBusqueda) {
  const g = conceptosDeCadena(c.planificacion?.global_search);
  const fuentes = await buscarFuentes({
    consultas: [terminosBusqueda],
    grupos: g.length >= 2 ? g : conceptosDePalabrasClave(c.planificacion?.keywords),
    perfil: [c.revision.titulo_revision, c.revision.objetivo, ...preguntas.map(p => p.pregunta)].filter(Boolean).join('. '),
    excluirDois: c.estudios.incluidos.map(e => e.doi),
    limite: 6
  });
  return registro.agregarCrossref(c.token, c.idRev, fuentes, c.referencias);
}

async function texto(c, { keywords: kw }) {
  C.exigir(tieneResultados(c.guardadas), NOMBRE, 'primero guarda la sección «Resultados»');
  const preguntas = C.preguntasConCodigo(c.preguntas, c.idioma);

  // Fuentes externas: las ya citadas en Trabajos relacionados e Introducción + nuevas (Consensus o CrossRef)
  const yaCitadas = new Set([...clavesDe(c.guardadas.trabajos_relacionados?.texto), ...clavesDe(c.guardadas.introduccion?.texto)]);
  const f = await E.fuentesSeccion(c, 'discusion', {
    preguntas, resultados: resultadosTexto(c.guardadas, 1500), keywords: kw, minimo: 1,
    crossref: palabras => porCrossref(c, preguntas, palabras),
    palabrasAuto: async () => (await keywords(c)).resultado.keywords
  });
  const nuevas = new Set(f.buscador === 'consensus' ? f.yaEnRegistro : f.claves);
  const lista = f.lista;
  const externas = lista.filter(r => !r.id_estudios && ['crossref', 'ia', 'manual'].includes(r.origen) && (yaCitadas.has(r.clave) || nuevas.has(r.clave)));
  const incluidos = lista.filter(r => r.id_estudios);
  const permitidas = new Set([...externas, ...incluidos].map(r => r.clave).concat(f.candidatos.map(x => x.temporal)));

  const q = c.calidad;
  const instrucciones = [
    `TAREA: redacta la sección «${NOMBRE}» del artículo de revisión sistemática y la lista de vacíos de investigación.`,
    '',
    'ESTRUCTURA DE "discusion" (5 a 7 párrafos, entre 700 y 1100 palabras):',
    '1. Síntesis de los hallazgos principales en relación con el objetivo, sin repetir las cifras de Resultados.',
    '2-4. Interpretación por pregunta de investigación (menciona su código): qué significan los hallazgos, posibles explicaciones y contraste con la literatura previa (FUENTES EXTERNAS): coincidencias, diferencias y por qué. Para referirte a hallazgos concretos cita los estudios incluidos.',
    '5. Implicaciones para la práctica (docentes, profesionales, instituciones o responsables, según el tema).',
    '6. Implicaciones para la investigación, que enlacen con los vacíos.',
    'No repitas las limitaciones del método (van en su propia sección).',
    '',
    'VACÍOS ("vacios", entre 3 y 5): cada uno debe desprenderse de los resultados (categorías con pocos estudios, contextos o poblaciones ausentes, debilidades de calidad, falta de evaluaciones longitudinales, etc.).',
    '- "vacio": nombre breve; "explicacion": 1-2 oraciones con la evidencia que lo muestra; "linea_futura": una propuesta concreta de investigación; "estudios": claves (sin @) de los estudios incluidos que lo ilustran, si procede.',
    '',
    'DATOS DE LA REVISIÓN',
    C.datosRevision(c, preguntas),
    c.prisma ? `Estudios incluidos: ${c.prisma.incluidos}` : '',
    q && q.preguntas.length ? `Calidad: ${q.superan} de ${q.evaluados} estudios evaluados superaron el umbral; aspectos más débiles: ${q.preguntas
      .map(x => ({ x, bajo: x.distribucion.filter(d => d.peso < Math.max(...q.escala.map(e => e.peso))).reduce((n, d) => n + d.n, 0) }))
      .sort((a, b) => b.bajo - a.bajo).slice(0, 2).map(({ x }) => `${x.codigo} (${C.corta(x.pregunta, 100)})`).join('; ')}` : '',
    '',
    'RESULTADOS GUARDADOS',
    resultadosTexto(c.guardadas),
    '',
    f.candidatos.length ? E.REGLAS_EVIDENCIA : '',
    '',
    'FUENTES EXTERNAS (literatura previa con la que contrastar)',
    E.bloqueTodas(externas, f.candidatos),
    '',
    'ESTUDIOS INCLUIDOS (cítalos para referirte a hallazgos concretos)',
    incluidos.map(r => `[@${r.clave}] ${(r.autores || []).slice(0, 2).map(a => a.apellido).join(', ')}${(r.autores || []).length > 2 ? ' et al.' : ''} (${r.anio || 's. f.'}). ${C.corta(r.titulo, 140)}`).join('\n'),
    '',
    'Devuelve: { "discusion": "<párrafos separados por una línea en blanco>", "vacios": [ { "vacio": "", "explicacion": "", "linea_futura": "", "estudios": ["clave"] } ] }'
  ].filter(s => s !== '').join('\n');

  const r = await C.pedirJson(c.idioma, instrucciones, { maxTokens: 8000, indicaciones: c.indicaciones });
  const acumulado = { usadas: new Set(), quitadas: new Set() };
  const provisional = validarEnValor(C.texto(r.discusion), permitidas, acumulado);
  const vaciosProv = (Array.isArray(r.vacios) ? r.vacios : []).slice(0, 6).map(v => ({
    vacio: C.corta(validarEnValor(String(v.vacio || ''), permitidas, acumulado), 160),
    explicacion: C.corta(validarEnValor(String(v.explicacion || ''), permitidas, acumulado), 600),
    linea_futura: C.corta(validarEnValor(String(v.linea_futura || ''), permitidas, acumulado), 400),
    claves: [...new Set((Array.isArray(v.estudios) ? v.estudios : []).map(normalizar).filter(k => permitidas.has(k)))]
  })).filter(v => v.vacio && v.explicacion);
  vaciosProv.forEach(v => v.claves.forEach(k => acumulado.usadas.add(k)));
  const fin = await E.finalizar(c, f, acumulado.usadas);
  const cuerpo = fin.limpiar(provisional);
  const vacios = vaciosProv.map(v => ({
    vacio: fin.limpiar(v.vacio), explicacion: fin.limpiar(v.explicacion), linea_futura: fin.limpiar(v.linea_futura),
    claves: [...new Set(v.claves.map(fin.claveFinal).filter(Boolean))]
  }));
  return {
    resultado: { discusion: cuerpo, tabla_vacios: T.vacios(vacios, c.idioma), vacios, citas: fin.citas, referencias: C.referenciasDe(fin.lista, fin.citas, c) },
    citas: fin.citas, quitadas: [...acumulado.quitadas], fuentes: E.resumenFuentes(f, fin.citas)
  };
}

module.exports = { NOMBRE, piezas, piezasKeywords, keywords, texto, tieneResultados, resultadosTexto };
