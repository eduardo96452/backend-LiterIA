// ia/redaccion/introduccion.js
// Sección «Introducción», con la estructura de los artículos de RSL publicados: contexto e
// importancia → problema → revisiones previas y vacío → objetivo y preguntas → contribuciones →
// organización del artículo (esta última la escribe la aplicación).
// Fuentes: las revisiones previas ya citadas en Trabajos relacionados y literatura de contexto
// de Consensus (o, sin Consensus, de CrossRef con palabras clave).
const C = require('./comun');
const { terminos } = require('./palabras');
const { buscarFuentes, conceptosDeCadena, conceptosDePalabrasClave } = require('./fuentes');
const registro = require('../../modules/informes/referencias/registro');
const { validarEnValor, clavesDe } = require('../../modules/informes/referencias/citas');
const E = require('./evidencia');

const NOMBRE = 'Introducción';
const piezas = ['planificacion', 'preguntas', 'criterios', 'estudios', 'guardadas', 'referencias'];
const piezasKeywords = ['planificacion', 'preguntas'];

async function keywords(c) {
  const preguntas = C.preguntasConCodigo(c.preguntas, c.idioma);
  return { resultado: await terminos('introduccion', `${C.datosRevision(c, preguntas)}\nCadena de búsqueda: ${c.planificacion?.global_search || ''}`) };
}

/** Lo que ya dicen las secciones guardadas, resumido, para escribir las contribuciones. */
function resumenGuardado(c) {
  const g = c.guardadas || {};
  const res = g.resultados || {};
  const porPregunta = Object.entries(res.preguntas || {}).map(([p, ps]) => `- ${C.corta(p, 200)}: ${C.corta((ps || []).join(' '), 700)}`);
  return [
    porPregunta.length ? `Resultados guardados por pregunta:\n${porPregunta.join('\n')}` : '',
    g.conclusion ? `Conclusiones guardadas: ${C.corta(g.conclusion, 1500)}` : ''
  ].filter(Boolean).join('\n');
}

/** CrossRef con palabras clave (sin Consensus o si falla). */
async function porCrossref(c, terminosBusqueda) {
  const grupos = (() => { const g = conceptosDeCadena(c.planificacion?.global_search); return g.length >= 2 ? g : conceptosDePalabrasClave(c.planificacion?.keywords); })();
  const fuentes = await buscarFuentes({
    consultas: [terminosBusqueda],
    grupos: grupos.length > 2 ? grupos.slice(0, 2) : grupos,      // para el contexto basta con tocar los dos conceptos principales
    perfil: [c.revision.titulo_revision, c.revision.objetivo].filter(Boolean).join('. '),
    excluirDois: c.estudios.incluidos.map(e => e.doi),
    limite: 6
  });
  return registro.agregarCrossref(c.token, c.idRev, fuentes, c.referencias);
}

async function texto(c, { keywords: kw }) {
  const preguntas = C.preguntasConCodigo(c.preguntas, c.idioma);
  C.exigir(preguntas.length, NOMBRE, 'la revisión no tiene preguntas de investigación (Planificación)');

  // Revisiones previas: las que ya cita Trabajos relacionados
  const previas = new Set(clavesDe(c.guardadas?.trabajos_relacionados?.texto));
  const f = await E.fuentesSeccion(c, 'introduccion', {
    preguntas, keywords: kw, minimo: 1,
    crossref: palabras => porCrossref(c, palabras),
    palabrasAuto: async () => (await keywords(c)).resultado.keywords
  });
  const nuevas = f.buscador === 'consensus' ? f.yaEnRegistro : f.claves;
  const delRegistro = new Set([...nuevas, ...[...previas].filter(k => f.lista.some(r => r.clave === k))]);
  const refs = f.lista.filter(r => delRegistro.has(r.clave));
  const permitidas = new Set([...delRegistro, ...f.candidatos.map(x => x.temporal)]);
  C.exigir(permitidas.size, NOMBRE, 'no se encontraron fuentes que citar: genera antes Trabajos relacionados o inténtalo de nuevo');

  const p = c.prisma;
  const bases = (c.planificacion?.bibliografias || []).map(b => b.nombre).filter(Boolean);
  const metodo = [
    bases.length ? `Bases de datos consultadas: ${bases.join(', ')}` : '',
    p ? `Estudios incluidos: ${p.incluidos} de ${p.identificados} registros identificados` : ''
  ].filter(Boolean).join('\n');

  const instrucciones = [
    `TAREA: redacta la sección «${NOMBRE}» del artículo de revisión sistemática.`,
    '',
    'ESTRUCTURA (5 o 6 párrafos, entre 600 y 900 palabras):',
    '1-2. Contexto e importancia del tema, con citas.',
    '3. Problema o desafío concreto que motiva la revisión, con citas.',
    '4. Revisiones previas y vacío: qué han revisado otros trabajos y qué queda sin cubrir respecto al objetivo de esta revisión (cita las revisiones previas de FUENTES).',
    `5. Objetivo de la revisión y sus preguntas de investigación, formuladas en el texto con sus códigos (${preguntas.map(q => q.codigo).join(', ')}).`,
    '6. Contribuciones: una oración introductoria seguida de tres contribuciones concretas en la misma oración, enumeradas como (i), (ii) y (iii). ' +
      'Si hay resultados guardados, apóyalas en ellos sin dar cifras; si no, descríbelas en función de lo que hace la revisión (mapear, sintetizar, identificar vacíos).',
    'No escribas el párrafo de organización del artículo: lo añade la aplicación.',
    '',
    'DATOS DE LA REVISIÓN',
    C.datosRevision(c, preguntas),
    metodo,
    resumenGuardado(c),
    '',
    f.candidatos.length ? E.REGLAS_EVIDENCIA : '',
    '',
    'FUENTES (las únicas que puedes citar)',
    E.bloqueTodas(refs, f.candidatos),
    '',
    'Devuelve: { "introduction": "<párrafos separados por una línea en blanco>" }'
  ].filter(s => s !== undefined).join('\n');

  const r = await C.pedirJson(c.idioma, instrucciones, { maxTokens: 6000, indicaciones: c.indicaciones });
  const acumulado = { usadas: new Set(), quitadas: new Set() };
  const provisional = validarEnValor(C.texto(r.introduction), permitidas, acumulado);
  const fin = await E.finalizar(c, f, acumulado.usadas);
  const cuerpo = fin.limpiar(provisional);
  return {
    resultado: { introduction: `${cuerpo}\n\n${C.frasesOrganizacion(c.idioma)}`, citas: fin.citas, references: C.referenciasDe(fin.lista, fin.citas, c) },
    citas: fin.citas, quitadas: [...acumulado.quitadas], fuentes: E.resumenFuentes(f, fin.citas)
  };
}

module.exports = { NOMBRE, piezas, piezasKeywords, keywords, texto };
