// ia/redaccion/limitaciones.js
// Sección «Limitaciones» como amenazas a la validez (formato habitual en las RSL publicadas):
// validez de constructo (búsqueda y fuentes), validez interna (selección, extracción, calidad,
// uso de IA), validez externa (generalización) y fiabilidad. Cada amenaza con la medida que se
// tomó para mitigarla, solo si consta en los datos.
const C = require('./comun');
const { basesConDatos } = require('./metodologia');
const { validarCitas } = require('../../modules/informes/referencias/citas');

const NOMBRE = 'Limitaciones';
const piezas = ['planificacion', 'preguntas', 'criterios', 'estudios', 'calidad', 'campos', 'importaciones', 'equipo'];

async function texto(c) {
  const pl = c.planificacion || {};
  const preguntas = C.preguntasConCodigo(c.preguntas, c.idioma);
  C.exigir(String(pl.global_search || '').trim() || (pl.bibliografias || []).length, NOMBRE,
    'faltan las bases de datos o la cadena de búsqueda (Planificación)');
  const bases = basesConDatos(c);
  const p = c.prisma;
  const q = c.calidad;
  const eq = c.equipo || {};

  const datos = [
    C.datosRevision(c, preguntas),
    `Bases consultadas: ${bases.map(b => `${b.nombre}${b.registros != null ? ` (${b.registros} registros)` : ''}${b.fecha ? `, ${b.fecha}` : ''}`).join('; ') || 'sin dato'}`,
    `Cadena de búsqueda global: ${C.corta(pl.global_search, 1500)}`,
    `Criterios:\n${c.criterios.map(k => `  - ${k.codigo}: ${k.descripcion}`).join('\n')}`,
    p ? `Selección: ${p.identificados} registros identificados, ${p.duplicados} duplicados, ${p.cribados} cribados, ${p.evaluados_texto_completo} evaluados a texto completo, ${p.incluidos} incluidos.` : '',
    eq.revisores_cribado >= 2
      ? `Cribado independiente por ${eq.revisores_cribado} revisores${eq.kappa ? `; kappa de Cohen = ${eq.kappa.valor} (${eq.kappa.interpretacion})` : ''}.`
      : 'No consta cribado independiente por dos o más revisores.',
    eq.ia?.sugerencias ? `La IA propuso decisiones de cribado para ${eq.ia.sugerencias} registros; ${eq.ia.revisadas} fueron revisadas por una persona y la decisión final fue humana.` : '',
    q && q.preguntas.length
      ? `Calidad: ${q.preguntas.length} preguntas, umbral ${q.umbral} de ${q.maxima}; ${q.no_superan} estudios no lo superaron y quedaron fuera de la síntesis.`
      : 'No se aplicó un instrumento de evaluación de la calidad.',
    `Extracción: formulario con ${(c.campos || []).length} campos; síntesis narrativa y temática (sin metaanálisis).`
  ].filter(Boolean).join('\n');

  const instrucciones = [
    `TAREA: redacta la sección «${NOMBRE}» del artículo como amenazas a la validez de la revisión.`,
    '',
    'ESTRUCTURA (3 o 4 párrafos, entre 350 y 600 palabras), un párrafo por tipo de amenaza:',
    '1. Validez de constructo: bases consultadas, términos y cadena de búsqueda, idioma y periodo; posibles estudios no recuperados.',
    '2. Validez interna: sesgo de selección, de extracción y de evaluación de la calidad; número de revisores y acuerdo; apoyo de la IA en el cribado si consta.',
    '3. Validez externa: en qué medida los hallazgos se pueden generalizar (periodo, tipos de publicación, contextos de los estudios).',
    '4. Fiabilidad: posibilidad de reproducir la revisión (protocolo, cadena publicada, criterios explícitos) y carácter interpretativo de la síntesis narrativa.',
    'Para cada amenaza, describe primero el riesgo y después la medida que se tomó para reducirlo, solo si consta en DATOS. No inventes medidas ni cifras. No cites fuentes.',
    '',
    'DATOS',
    datos,
    '',
    'Devuelve: { "limitaciones": "<párrafos separados por una línea en blanco>" }'
  ].join('\n');

  const r = await C.pedirJson(c.idioma, instrucciones, { maxTokens: 4000, indicaciones: c.indicaciones });
  // Sin fuentes: cualquier clave que escriba se quita
  const limpio = validarCitas(C.texto(r.limitaciones), []);
  return { resultado: { limitaciones: limpio.texto }, citas: [], quitadas: limpio.quitadas };
}

module.exports = { NOMBRE, piezas, texto };
