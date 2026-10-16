// ia/redaccion/resumen.js
// «Resumen» (abstract) según la lista PRISMA 2020 para resúmenes: objetivo, métodos (fuentes,
// fecha de búsqueda, criterios, evaluación de la calidad, síntesis), resultados (número de
// estudios y hallazgos principales) y conclusiones. Un solo párrafo, sin citas, y además las
// palabras clave del artículo. Como piden muchas revistas, también el título, el resumen y las
// palabras clave en el otro idioma (inglés si el artículo está en español, y al revés).
const C = require('./comun');
const { validarCitas } = require('../../modules/informes/referencias/citas');
const { tieneResultados, resultadosTexto } = require('./discusion');
const { basesConDatos } = require('./metodologia');

const NOMBRE = 'Resumen';
const piezas = ['planificacion', 'preguntas', 'criterios', 'estudios', 'calidad', 'importaciones', 'guardadas'];

async function texto(c, { palabras }) {
  C.exigir(Number(palabras) >= 50 && Number(palabras) <= 500, NOMBRE, 'indica cuántas palabras debe tener el resumen (entre 50 y 500)');
  C.exigir(tieneResultados(c.guardadas), NOMBRE, 'primero guarda la sección «Resultados»');
  const preguntas = C.preguntasConCodigo(c.preguntas, c.idioma);
  const p = c.prisma;
  const q = c.calidad;
  const g = c.guardadas;
  const bases = basesConDatos(c);
  const fechas = bases.map(b => b.fecha).filter(Boolean);

  const datos = [
    C.datosRevision(c, preguntas),
    `Bases de datos: ${bases.map(b => b.nombre).join(', ') || 'sin dato'}${fechas.length ? `; última búsqueda: ${fechas.at(-1)}` : ''}`,
    `Criterios principales: ${c.criterios.slice(0, 6).map(k => k.descripcion).join('; ')}`,
    p ? `Selección: ${p.identificados} registros identificados; ${p.incluidos} estudios incluidos.` : '',
    q && q.preguntas.length ? `Calidad: evaluada con ${q.preguntas.length} preguntas; ${q.superan} estudios superaron el umbral.` : '',
    c.panorama?.desde ? `Periodo de publicación de los estudios: ${c.panorama.desde}-${c.panorama.hasta}.` : '',
    `\nRESULTADOS GUARDADOS\n${resultadosTexto(g, 1500)}`,
    g.conclusion ? `\nCONCLUSIONES GUARDADAS\n${C.corta(g.conclusion, 3000)}` : ''
  ].filter(Boolean).join('\n');

  const otro = c.idioma === 'en' ? 'español' : 'inglés';
  const instrucciones = [
    `TAREA: redacta el «${NOMBRE}» (abstract) del artículo de revisión sistemática y sus palabras clave, y su versión en ${otro}.`,
    '',
    `- "resumen": un solo párrafo de ${palabras} palabras (±10 %), sin títulos, sin citas y sin siglas sin definir, con este orden:`,
    '  contexto (1 oración) → objetivo → métodos (revisión sistemática según PRISMA 2020, bases y fecha de búsqueda, criterios principales, evaluación de la calidad, tipo de síntesis) →',
    '  resultados (número de estudios incluidos y hallazgos principales para cada pregunta, con alguna cifra clave) → conclusiones e implicaciones.',
    '- "palabras_clave": entre 4 y 6 términos que no repitan literalmente el título, en el idioma del artículo.',
    `- "titulo_traducido": el título de la revisión en ${otro} académico (traducción fiel, sin añadir ni quitar contenido).`,
    `- "resumen_traducido": el mismo resumen en ${otro} académico, con las mismas cifras y el mismo orden (no es un resumen nuevo).`,
    `- "palabras_clave_traducidas": las mismas palabras clave en ${otro}, en el mismo orden.`,
    '',
    'DATOS',
    datos,
    '',
    'Devuelve: { "resumen": "", "palabras_clave": [""], "titulo_traducido": "", "resumen_traducido": "", "palabras_clave_traducidas": [""] }'
  ].join('\n');

  const r = await C.pedirJson(c.idioma, instrucciones, { maxTokens: Math.min(8000, Number(palabras) * 10 + 800), indicaciones: c.indicaciones });
  const limpio = validarCitas(C.enParrafos(r.resumen).join(' '), []);
  const lista = v => (Array.isArray(v) ? v : String(v || '').split(/[;,]/)).map(k => C.corta(k, 60)).filter(Boolean).slice(0, 6);
  const traducido = validarCitas(C.enParrafos(r.resumen_traducido).join(' '), []);
  return {
    resultado: {
      resumen: limpio.texto,
      palabras_clave: lista(r.palabras_clave),
      titulo_traducido: C.corta(r.titulo_traducido, 400),
      resumen_traducido: traducido.texto,
      palabras_clave_traducidas: lista(r.palabras_clave_traducidas)
    },
    citas: [], quitadas: [...new Set([...limpio.quitadas, ...traducido.quitadas])]
  };
}

module.exports = { NOMBRE, piezas, texto };
