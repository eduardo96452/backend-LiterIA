// ia/redaccion/resultados.js
// Sección «Resultados», organizada como en los artículos de RSL publicados:
//   panorama de los estudios (año, fuente, tipo) → tabla de características → calidad →
//   una respuesta por pregunta de investigación, con categorías, frecuencias y estudios citados.
//
// Se hace en dos llamadas para que las cifras sean exactas:
//   1) la IA clasifica los datos extraídos en categorías por pregunta (con las claves de los estudios);
//   2) la aplicación cuenta los estudios de cada categoría y la IA redacta con esas cifras.
// Las tablas las construye la aplicación con los datos de la base.
const C = require('./comun');
const T = require('../../modules/informes/tablas');
const { panorama: calcularPanorama, pct } = require('../../modules/informes/prisma');
const { validarEnValor, normalizar } = require('../../modules/informes/referencias/citas');

const NOMBRE = 'Resultados';
const piezas = ['preguntas', 'criterios', 'estudios', 'calidad', 'extraccion', 'referencias'];

const vacio = v => !String(v ?? '').trim();

/** Estudios con datos extraídos (los que entran en la síntesis), con su clave de cita y sus respuestas. */
function estudiosSintesis(c) {
  const clavePorEstudio = new Map((c.referencias || []).filter(r => r.id_estudios).map(r => [Number(r.id_estudios), r.clave]));
  const respuestas = new Map();
  for (const r of c.extraccion || []) {
    if (vacio(r.respuesta)) continue;
    const id = Number(r.id_estudios);
    if (!respuestas.has(id)) respuestas.set(id, {});
    respuestas.get(id)[r.pregunta] = String(r.respuesta).trim();
  }
  return c.estudios.incluidos
    .filter(e => respuestas.has(Number(e.id_estudios)) && clavePorEstudio.has(Number(e.id_estudios)))
    .map(e => ({ ...e, clave: clavePorEstudio.get(Number(e.id_estudios)), respuestas: respuestas.get(Number(e.id_estudios)) }));
}

/** Datos extraídos por estudio, recortados para no pasar de `presupuesto` caracteres. */
function bloqueExtraccion(estudios, campos, presupuesto = 90000) {
  const total = estudios.reduce((n, e) => n + Object.values(e.respuestas).join('').length, 0) || 1;
  const maxPorRespuesta = Math.max(120, Math.min(800, Math.floor(800 * presupuesto / total)));
  return estudios.map(e => [
    `[@${e.clave}] (${e.anio || 's. f.'}) ${C.corta(e.titulo, 140)}`,
    ...campos.filter(f => e.respuestas[f]).map(f => `  - ${C.corta(f, 120)}: ${C.corta(e.respuestas[f], maxPorRespuesta)}`)
  ].join('\n')).join('\n');
}

function reflexion(c, n, codigos) {
  const p = c.prisma;
  const conCalidad = c.calidad?.preguntas?.length && c.calidad.umbral > 0;
  if (c.idioma === 'en') {
    return [
      `This section presents the results of the synthesis of ${n} studies${conCalidad ? ' that met the quality threshold' : ''}` +
        (p && p.incluidos > n ? ` (out of the ${p.incluidos} studies included, ${n} had extracted data)` : '') + '.',
      `It first describes the general landscape of the studies and their methodological quality, and then answers each research question (${codigos.join(', ')}).`
    ].join(' ');
  }
  return [
    `Esta sección presenta los resultados de la síntesis de ${n} estudios${conCalidad ? ' que superaron el umbral de calidad' : ''}` +
      (p && p.incluidos > n ? ` (de los ${p.incluidos} estudios incluidos, ${n} contaban con datos extraídos)` : '') + '.',
    `En primer lugar se describe el panorama general de los estudios y su calidad metodológica; a continuación se responde a cada pregunta de investigación (${codigos.join(', ')}).`
  ].join(' ');
}

async function texto(c) {
  const preguntas = C.preguntasConCodigo(c.preguntas, c.idioma);
  C.exigir(preguntas.length, NOMBRE, 'la revisión no tiene preguntas de investigación (Planificación)');
  const sintesis = estudiosSintesis(c);
  C.exigir(sintesis.length, NOMBRE, 'aún no hay respuestas en Extracción de datos');

  const campos = [...new Set([...(c.campos || []).map(f => f.descripcion), ...(c.extraccion || []).map(r => r.pregunta)])]
    .filter(f => sintesis.some(e => e.respuestas[f]));
  const vinculo = new Map((c.campos || []).filter(f => f.id_pregunta_investigacion)
    .map(f => [f.descripcion, preguntas.find(p => Number(p.id) === Number(f.id_pregunta_investigacion))?.codigo]).filter(([, cod]) => cod));
  const vinculados = vinculo.size > 0;
  const claves = sintesis.map(e => e.clave);
  const permitidas = new Set((c.referencias || []).filter(r => r.id_estudios).map(r => r.clave));
  const N = sintesis.length;

  /* ---------- 1) Categorías por pregunta ---------- */
  const paso1 = [
    'TAREA: clasifica los hallazgos de los estudios para responder a cada pregunta de investigación. Todavía no redactes.',
    '',
    'Para cada pregunta:',
    '- Define entre 2 y 8 categorías (temas, tipos, enfoques o resultados) que respondan a la pregunta según los DATOS EXTRAÍDOS.',
    `- "nombre": breve (máximo 6 palabras) y en ${C.NOMBRE_IDIOMA[c.idioma]}; "descripcion": una oración que la defina.`,
    '- "estudios": claves (sin @) de los estudios cuyos datos respaldan la categoría. Un estudio puede estar en varias. No incluyas un estudio si sus datos no lo respaldan.',
    '- Si ningún dato responde a la pregunta, devuelve "categorias": [].',
    vinculados
      ? '- Cada campo indica a qué pregunta responde: usa sobre todo esos campos.'
      : '- Los campos no están vinculados a preguntas: decide qué campos responden a cada pregunta y devuélvelos en "campos".',
    '',
    'PREGUNTAS',
    preguntas.map(p => `${p.codigo}. ${p.pregunta}`).join('\n'),
    '',
    'CAMPOS DEL FORMULARIO',
    campos.map(f => `- ${f}${vinculo.get(f) ? ` → ${vinculo.get(f)}` : ''}`).join('\n'),
    '',
    `DATOS EXTRAÍDOS (${N} estudios)`,
    bloqueExtraccion(sintesis, campos),
    '',
    'Devuelve: { "preguntas": [ { "codigo": "PI1", "campos": ["…"], "categorias": [ { "nombre": "", "descripcion": "", "estudios": ["clave"] } ] } ] }'
  ].join('\n');
  const r1 = await C.pedirJson(c.idioma, paso1, { maxTokens: 6000, temperature: 0.2 });

  const validas = new Set(claves);
  const porCodigo = new Map((Array.isArray(r1.preguntas) ? r1.preguntas : []).map(x => [String(x.codigo || '').trim().toUpperCase(), x]));
  const categorias = preguntas.map(p => {
    const bruto = porCodigo.get(p.codigo) || {};
    const cats = (Array.isArray(bruto.categorias) ? bruto.categorias : []).map(k => ({
      nombre: C.corta(k.nombre, 80),
      descripcion: C.corta(k.descripcion, 300),
      claves: [...new Set((Array.isArray(k.estudios) ? k.estudios : []).map(normalizar).filter(x => validas.has(x)))]
    })).filter(k => k.nombre && k.claves.length).sort((a, b) => b.claves.length - a.claves.length);
    const camposPregunta = vinculados
      ? campos.filter(f => vinculo.get(f) === p.codigo)
      : (Array.isArray(bruto.campos) ? bruto.campos.filter(f => campos.includes(f)) : []);
    return { ...p, categorias: cats, campos: camposPregunta.length ? camposPregunta : campos };
  });

  /* ---------- 2) Redacción con las cifras contadas ---------- */
  const pan = calcularPanorama(sintesis);
  const q = c.calidad;
  const datosPanorama = [
    `Estudios en la síntesis: ${N}${pan.desde ? ` (publicados entre ${pan.desde} y ${pan.hasta})` : ''}`,
    `Por año: ${pan.por_anio.map(x => `${x.valor}: ${x.n} (${x.pct} %)`).join('; ')}`,
    `Por fuente: ${pan.por_fuente.map(x => `${x.valor}: ${x.n} (${x.pct} %)`).join('; ')}`,
    `Por tipo de publicación: ${pan.por_tipo.map(x => `${T.T[c.idioma === 'en' ? 'en' : 'es'][x.valor] || x.valor}: ${x.n} (${x.pct} %)`).join('; ')}`,
    pan.revistas_frecuentes.length ? `Revistas o congresos con más de un estudio: ${pan.revistas_frecuentes.map(x => `${x.valor} (${x.n})`).join('; ')}` : ''
  ].filter(Boolean).join('\n');
  const datosCalidad = q && q.preguntas.length ? [
    `Evaluación de la calidad (${q.evaluados} estudios evaluados; umbral ${q.umbral} de ${q.maxima}; superaron el umbral ${q.superan}):`,
    ...q.preguntas.map(x => `  - ${x.codigo} ${C.corta(x.pregunta, 160)}: ${x.distribucion.map(d => `${d.respuesta} ${d.n} (${pct(d.n, x.evaluados)} %)`).join('; ')}`)
  ].join('\n') : 'Sin evaluación de la calidad: devuelve "calidad": "".';
  const datosPreguntas = categorias.map(p => [
    `${p.codigo}. ${p.pregunta}`,
    p.categorias.length
      ? p.categorias.map(k => `  * ${k.nombre} — ${k.descripcion} — ${k.claves.length} de ${N} estudios (${pct(k.claves.length, N)} %): ${k.claves.map(x => `[@${x}]`).join(' ')}`).join('\n')
      : '  (sin datos que respondan a esta pregunta)',
    `  Datos de apoyo:\n${bloqueExtraccion(sintesis.filter(e => p.categorias.some(k => k.claves.includes(e.clave))), p.campos, 40000 / Math.max(1, categorias.length))
      .split('\n').map(l => `    ${l}`).join('\n')}`
  ].join('\n')).join('\n\n');

  const paso2 = [
    `TAREA: redacta los apartados de la sección «${NOMBRE}» del artículo de revisión sistemática.`,
    '',
    'APARTADOS:',
    '- panorama (1-2 párrafos): número de estudios, evolución por año (tendencia), fuentes, tipos de publicación y revistas frecuentes, con las cifras exactas de DATOS. Remite a las tablas de panorama y de características de los estudios incluidos.',
    '- calidad (1 párrafo, o "" si no hay evaluación): en qué aspectos (QA) cumple la mayoría de los estudios y en cuáles fallan, y cuántos superaron el umbral. Remite a la tabla de calidad.',
    '- preguntas: para cada pregunta, por su código, 2 a 4 párrafos:',
    '  1) primera oración con la respuesta directa: las categorías y su frecuencia exacta «n (x %)» tal como aparecen en DATOS;',
    '  2) desarrollo de cada categoría con ejemplos concretos de los estudios (qué hicieron, qué encontraron, valores si los hay), citando con sus claves;',
    '  3) cierre con patrones, diferencias o ausencias relevantes, sin interpretarlos a fondo (eso va en la Discusión).',
    '  Si una pregunta no tiene datos, dilo en una oración.',
    'No inventes categorías ni cambies las cifras. La aplicación añade, debajo de cada pregunta, una tabla con las categorías y sus estudios.',
    '',
    'DATOS DEL PANORAMA',
    datosPanorama,
    '',
    datosCalidad,
    '',
    'CATEGORÍAS POR PREGUNTA (cifras ya contadas por la aplicación)',
    datosPreguntas,
    '',
    'FUENTES (los estudios incluidos; cítalos con su clave)',
    sintesis.map(e => `[@${e.clave}] ${C.corta(e.autores, 60) || 'Sin autor'} (${e.anio || 's. f.'}). ${C.corta(e.titulo, 140)}`).join('\n'),
    '',
    `Devuelve: { "panorama": "", "calidad": "", "preguntas": { ${preguntas.map(p => `"${p.codigo}": "<párrafos>"`).join(', ')} } }`
  ].join('\n');
  const r2 = await C.pedirJson(c.idioma, paso2, { maxTokens: 12000, indicaciones: c.indicaciones });

  const acumulado = { usadas: new Set(), quitadas: new Set() };
  const val = v => validarEnValor(C.texto(v), permitidas, acumulado);
  const textos = r2.preguntas && typeof r2.preguntas === 'object' ? r2.preguntas : {};

  const preguntasOut = {};
  const tablasOut = {};
  for (const p of categorias) {
    const titulo = `${p.codigo}. ${p.pregunta}`;
    preguntasOut[titulo] = C.enParrafos(val(textos[p.codigo] ?? textos[titulo] ?? ''));
    tablasOut[titulo] = T.categorias(p.categorias, N, c.idioma);
  }

  const resultado = {
    version: 2,
    reflexion_inicial: [reflexion(c, N, preguntas.map(p => p.codigo))],
    panorama: val(r2.panorama),
    tabla_panorama: T.panorama(pan, c.idioma),
    tabla_caracteristicas: T.caracteristicas(sintesis, campos, c.idioma),
    calidad: q?.preguntas.length ? val(r2.calidad) : '',
    tabla_calidad: q?.preguntas.length ? T.resultadosCalidad(q, c.idioma) : '',
    preguntas: preguntasOut,
    tablas_preguntas: tablasOut,
    categorias: Object.fromEntries(categorias.map(p => [`${p.codigo}. ${p.pregunta}`, p.categorias]))
  };
  const citas = [...new Set([...acumulado.usadas, ...categorias.flatMap(p => p.categorias.flatMap(k => k.claves)), ...claves])]
    .filter(k => permitidas.has(k));
  return { resultado: { ...resultado, citas }, citas, quitadas: [...acumulado.quitadas] };
}

module.exports = { NOMBRE, piezas, texto, estudiosSintesis };
