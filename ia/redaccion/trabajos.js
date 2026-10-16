// ia/redaccion/trabajos.js
// Sección «Trabajos relacionados»: sitúa la revisión frente a revisiones y estudios previos y
// termina en el vacío que justifica esta RSL (como en los artículos publicados: panorama →
// comparación por temas → vacío). Las fuentes salen de Consensus (con su resumen, su conclusión y
// fragmentos del texto completo) o, sin Consensus, de CrossRef con palabras clave; las citadas
// quedan en el registro de referencias con su clave.
const C = require('./comun');
const { terminos } = require('./palabras');
const { buscarFuentes, conceptosDeCadena, conceptosDePalabrasClave } = require('./fuentes');
const registro = require('../../modules/informes/referencias/registro');
const { validarEnValor } = require('../../modules/informes/referencias/citas');
const E = require('./evidencia');

const NOMBRE = 'Trabajos relacionados';
const piezas = ['planificacion', 'preguntas', 'criterios', 'estudios', 'referencias'];
const piezasKeywords = ['planificacion', 'preguntas'];

/** Perfil de la revisión: lo que se compara con cada fuente para medir su pertinencia. */
function perfil(c, preguntas) {
  return [c.revision.titulo_revision, c.revision.objetivo, ...preguntas.map(p => p.pregunta)].filter(Boolean).join('. ');
}

function grupos(c) {
  const g = conceptosDeCadena(c.planificacion?.global_search);
  return g.length >= 2 ? g : conceptosDePalabrasClave(c.planificacion?.keywords);
}

async function keywords(c) {
  const preguntas = C.preguntasConCodigo(c.preguntas, c.idioma);
  const kws = (c.planificacion?.keywords || []).map(k => [k.palabra, ...(k.sinonimos || [])].join(', ')).join('; ');
  return { resultado: await terminos('trabajos', `${C.datosRevision(c, preguntas)}\nPalabras clave de la planificación: ${kws}\nCadena de búsqueda: ${c.planificacion?.global_search || ''}`) };
}

/** CrossRef con palabras clave (sin Consensus o si falla). */
async function porCrossref(c, preguntas, terminosBusqueda) {
  const fuentes = await buscarFuentes({
    consultas: [`${terminosBusqueda} systematic review`, terminosBusqueda],
    grupos: grupos(c),
    perfil: perfil(c, preguntas),
    excluirDois: c.estudios.incluidos.map(e => e.doi),
    limite: 8
  });
  C.exigir(fuentes.length >= 2, NOMBRE,
    'no se encontraron trabajos pertinentes; prueba con palabras clave más generales o en inglés');
  return registro.agregarCrossref(c.token, c.idRev, fuentes, c.referencias);
}

async function texto(c, { keywords: kw }) {
  const preguntas = C.preguntasConCodigo(c.preguntas, c.idioma);
  const f = await E.fuentesSeccion(c, 'trabajos', {
    preguntas, keywords: kw, minimo: 2,
    crossref: palabras => porCrossref(c, preguntas, palabras),
    palabrasAuto: async () => (await keywords(c)).resultado.keywords
  });
  const refs = f.buscador === 'consensus'
    ? f.lista.filter(r => f.yaEnRegistro.includes(r.clave))
    : f.lista.filter(r => f.claves.includes(r.clave));
  const permitidas = new Set([...refs.map(r => r.clave), ...f.candidatos.map(x => x.temporal)]);

  const instrucciones = [
    `TAREA: redacta la sección «${NOMBRE}» del artículo de revisión sistemática.`,
    '',
    'PROPÓSITO: situar la revisión frente a la literatura previa y justificar por qué hace falta: qué se ha estudiado, cómo, qué se concluyó y qué queda sin cubrir respecto al objetivo y a las preguntas de ESTA revisión.',
    '',
    'ESTRUCTURA (4 a 6 párrafos, entre 450 y 700 palabras):',
    '1. Panorama: cómo se ha abordado el tema en la literatura, con las fuentes más generales.',
    '2-4. Agrupa las fuentes por temas o enfoques (no un párrafo por fuente). En cada grupo compara qué analizaron, con qué alcance (población, contexto, periodo o tipo de estudios, cuando el resumen lo indique) y qué concluyeron; señala coincidencias y diferencias. Si una fuente es una revisión, dilo.',
    '5. Vacío: explica con precisión qué no cubren estos trabajos en relación con el objetivo y las preguntas de esta revisión (periodo, población, contexto, tipo de intervención o enfoque metodológico) y cómo esta revisión lo aborda. No adelantes resultados.',
    '',
    'REQUISITOS:',
    '- Cita cada fuente pertinente al menos una vez; omite las que no aporten al tema.',
    '- Cada afirmación sobre una fuente debe poder comprobarse en su título o en su resumen.',
    f.candidatos.length ? `\n${E.REGLAS_EVIDENCIA}` : '',
    '',
    'DATOS DE LA REVISIÓN',
    C.datosRevision(c, preguntas),
    '',
    'FUENTES (las únicas que puedes citar)',
    E.bloqueTodas(refs, f.candidatos),
    '',
    'Devuelve: { "trabajos_relacionados": "<párrafos separados por una línea en blanco>" }'
  ].join('\n');

  const r = await C.pedirJson(c.idioma, instrucciones, { maxTokens: 5000, indicaciones: c.indicaciones });
  const acumulado = { usadas: new Set(), quitadas: new Set() };
  const provisional = validarEnValor(C.texto(r.trabajos_relacionados), permitidas, acumulado);
  const fin = await E.finalizar(c, f, acumulado.usadas);
  const cuerpo = fin.limpiar(provisional);
  return {
    resultado: { trabajos_relacionados: cuerpo, citas: fin.citas, references: C.referenciasDe(fin.lista, fin.citas, c) },
    citas: fin.citas, quitadas: [...acumulado.quitadas], fuentes: E.resumenFuentes(f, fin.citas)
  };
}

module.exports = { NOMBRE, piezas, piezasKeywords, keywords, texto };
