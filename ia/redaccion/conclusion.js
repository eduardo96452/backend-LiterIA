// ia/redaccion/conclusion.js
// Sección «Conclusiones»: retoma el objetivo, responde explícitamente a cada pregunta de
// investigación, resume la contribución y propone líneas futuras (a partir de los vacíos de la
// Discusión). Sin citas ni datos nuevos, como en los artículos de RSL publicados.
const C = require('./comun');
const { validarCitas } = require('../../modules/informes/referencias/citas');
const { tieneResultados, resultadosTexto } = require('./discusion');
const { aTexto } = require('../../modules/informes/secciones');

const NOMBRE = 'Conclusiones';
const piezas = ['preguntas', 'criterios', 'estudios', 'guardadas'];

async function texto(c) {
  C.exigir(tieneResultados(c.guardadas), NOMBRE, 'primero guarda la sección «Resultados»');
  const preguntas = C.preguntasConCodigo(c.preguntas, c.idioma);
  C.exigir(preguntas.length, NOMBRE, 'la revisión no tiene preguntas de investigación (Planificación)');
  const g = c.guardadas;
  const p = c.prisma;
  const pan = c.panorama;

  const instrucciones = [
    `TAREA: redacta la sección «${NOMBRE}» del artículo de revisión sistemática.`,
    '',
    'ESTRUCTURA (entre 400 y 650 palabras):',
    `1. Un párrafo que retome el objetivo y diga qué se hizo: revisión sistemática según PRISMA 2020 con ${p ? `${p.incluidos} estudios incluidos` : 'los estudios incluidos'}${pan?.desde ? ` publicados entre ${pan.desde} y ${pan.hasta}` : ''}.`,
    `2. Un párrafo por pregunta de investigación (${preguntas.map(x => x.codigo).join(', ')}) que empiece respondiéndola de forma directa («Respecto a ${preguntas[0].codigo}, …») con los hallazgos principales.`,
    '3. Un párrafo con la contribución de la revisión y sus implicaciones principales.',
    '4. Un párrafo final con 2 o 3 líneas de investigación futura concretas, tomadas de los vacíos identificados.',
    'No cites fuentes ni introduzcas datos que no estén en las secciones guardadas.',
    '',
    'DATOS DE LA REVISIÓN',
    C.datosRevision(c, preguntas),
    '',
    'RESULTADOS GUARDADOS',
    resultadosTexto(g, 2500),
    g.discusion?.texto ? `\nDISCUSIÓN GUARDADA\n${C.corta(g.discusion.texto, 6000)}` : '',
    g.discusion?.tabla_vacios ? `\nVACÍOS IDENTIFICADOS\n${C.corta(aTexto(g.discusion.tabla_vacios), 2500)}` : '',
    g.limitaciones ? `\nLIMITACIONES GUARDADAS\n${C.corta(g.limitaciones, 1500)}` : '',
    '',
    'Devuelve: { "conclusiones": "<párrafos separados por una línea en blanco>" }'
  ].filter(s => s !== '').join('\n');

  const r = await C.pedirJson(c.idioma, instrucciones, { maxTokens: 4000, indicaciones: c.indicaciones });
  const limpio = validarCitas(C.texto(r.conclusiones), []);
  return { resultado: { conclusiones: limpio.texto }, citas: [], quitadas: limpio.quitadas };
}

module.exports = { NOMBRE, piezas, texto };
