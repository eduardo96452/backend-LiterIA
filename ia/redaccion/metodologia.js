// ia/redaccion/metodologia.js
// Sección «Metodología» con los apartados que exige PRISMA 2020 y que traen los artículos de RSL
// publicados: diseño y guía, preguntas (con su motivación), estrategia de búsqueda (marco PICOC,
// cadena, bases, fechas), criterios con código, proceso de selección con las cifras del diagrama,
// evaluación de la calidad, extracción y síntesis de datos.
// La IA escribe los párrafos; las tablas, la cadena y la lista de criterios salen de la base.
const C = require('./comun');
const T = require('../../modules/informes/tablas');
const registro = require('../../modules/informes/referencias/registro');
const { validarEnValor } = require('../../modules/informes/referencias/citas');

const NOMBRE = 'Metodología';
const piezas = ['planificacion', 'preguntas', 'criterios', 'estudios', 'calidad', 'campos', 'importaciones', 'equipo', 'referencias'];

const fecha = (iso, idioma) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(idioma === 'en' ? 'en-US' : 'es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
};

/** Bases consultadas con los registros identificados en cada una y la fecha de la última búsqueda. */
function basesConDatos(c) {
  const norm = s => String(s || '').trim().toLowerCase();
  const porFuente = new Map((c.prisma?.por_fuente || []).map(f => [norm(f.fuente), f.n]));
  const ultima = new Map();
  for (const imp of c.importaciones || []) {
    const k = norm(imp.fuente);
    if (!ultima.has(k) || new Date(imp.fecha_inicio) > new Date(ultima.get(k).fecha_inicio)) ultima.set(k, imp);
  }
  const nombres = [...new Set([...(c.planificacion?.bibliografias || []).map(b => b.nombre), ...(c.prisma?.por_fuente || []).map(f => f.fuente)]
    .filter(n => n && n !== 'Sin especificar'))];
  return nombres.map(nombre => ({
    nombre,
    registros: porFuente.get(norm(nombre)) ?? null,
    fecha: fecha(ultima.get(norm(nombre))?.fecha_inicio, c.idioma),
    filtros: ultima.get(norm(nombre))?.filtros || null
  }));
}

function lineasFiltros(bases) {
  return bases.filter(b => b.filtros).map(b => {
    const f = b.filtros;
    const partes = [
      f.anio_desde || f.anio_hasta ? `años ${f.anio_desde || '…'}–${f.anio_hasta || '…'}` : '',
      f.idioma ? `idioma ${f.idioma}` : '',
      f.tipo ? `tipo ${f.tipo}` : ''
    ].filter(Boolean);
    return partes.length ? `  - ${b.nombre}: ${partes.join(', ')}` : '';
  }).filter(Boolean);
}

async function texto(c) {
  const pl = c.planificacion || {};
  const preguntas = C.preguntasConCodigo(c.preguntas, c.idioma);
  C.exigir(String(pl.global_search || '').trim(), NOMBRE, 'falta la cadena de búsqueda global (Planificación)');
  C.exigir(preguntas.length, NOMBRE, 'la revisión no tiene preguntas de investigación (Planificación)');
  C.exigir(c.criterios.length, NOMBRE, 'la revisión no tiene criterios de inclusión o exclusión (Planificación)');

  const lista = await registro.asegurarGuias(c.token, c.idRev, c.referencias, { kitchenham: true });
  const guias = lista.filter(r => r.origen === 'manual' && (/prisma 2020/i.test(r.titulo) || /guidelines for performing systematic literature reviews/i.test(r.titulo)));
  const permitidas = guias.map(r => r.clave);

  const p = c.prisma;
  const q = c.calidad;
  const eq = c.equipo || {};
  const bases = basesConDatos(c);
  const camposTxt = (c.campos || []).map(f => {
    const pi = preguntas.find(x => Number(x.id) === Number(f.id_pregunta_investigacion));
    return `  - ${f.descripcion} (${f.tipo || 'Texto'})${pi ? ` → ${pi.codigo}` : ''}`;
  });
  const hayNumericos = (c.campos || []).some(f => /entero|decimal/i.test(f.tipo || ''));

  const datos = [
    C.datosRevision(c, preguntas),
    `Tipo de revisión: ${pl.tipo_revision || c.revision.tipo_revision || 'RSL'}`,
    `Marco(s) para formular la pregunta: ${(pl.frameworks || []).join(', ') || 'no indicado'}`,
    `Conceptos y términos (por componente del marco):\n${(pl.keywords || []).map(k => `  - ${k.componente || '—'}: ${[k.palabra, ...(k.sinonimos || [])].filter(Boolean).join('; ')}`).join('\n')}`,
    `Cadena de búsqueda global: ${C.corta(pl.global_search, 2500)}`,
    (pl.per_base_search || []).length ? `Cadenas adaptadas por base:\n${pl.per_base_search.map(b => `  - ${b.fuente}: ${C.corta(b.cadena, 600)}`).join('\n')}` : '',
    `Bases de datos (registros identificados; fecha de la última búsqueda):\n${bases.map(b => `  - ${b.nombre}: ${b.registros ?? 'sin dato'} registros${b.fecha ? `; ${b.fecha}` : ''}`).join('\n')}`,
    lineasFiltros(bases).length ? `Filtros aplicados en la búsqueda:\n${lineasFiltros(bases).join('\n')}` : '',
    `Criterios de selección:\n${c.criterios.map(k => `  - ${k.codigo} (${k.tipo === 'inclusion' ? 'inclusión' : 'exclusión'}): ${k.descripcion}`).join('\n')}`,
    p ? [
      'Cifras del diagrama PRISMA (úsalas exactas):',
      `  - Registros identificados: ${p.identificados} (${p.por_fuente.map(f => `${f.fuente}: ${f.n}`).join('; ')})`,
      `  - Duplicados eliminados: ${p.duplicados}`,
      `  - Registros cribados por título y resumen: ${p.cribados}; excluidos en el cribado: ${p.excluidos_cribado}`,
      `  - Informes evaluados a texto completo: ${p.evaluados_texto_completo}; excluidos: ${p.excluidos_texto_completo}` +
        (p.motivos_exclusion.length ? ` (${p.motivos_exclusion.map(m => `${m.codigo || m.motivo}: ${m.n}`).join('; ')})` : ''),
      `  - Estudios incluidos: ${p.incluidos}`,
      p.pendientes > 0 ? `  - Aún sin clasificar: ${p.pendientes} (no los menciones como resultado final)` : ''
    ].filter(Boolean).join('\n') : '',
    eq.revisores_cribado >= 2
      ? `Cribado: independiente por ${eq.revisores_cribado} revisores` +
        (eq.kappa ? `; acuerdo entre los dos con más decisiones: kappa de Cohen = ${eq.kappa.valor} (${eq.kappa.interpretacion}; ${eq.kappa.porcentaje_acuerdo} % de acuerdo en ${eq.kappa.n} estudios)` : '')
      : '',
    eq.ia?.sugerencias ? `Apoyo de IA en el cribado: la aplicación propuso una decisión para ${eq.ia.sugerencias} registros; ${eq.ia.revisadas} fueron revisadas por una persona y ${eq.ia.aceptadas} se aceptaron. La decisión final siempre fue humana.` : '',
    q && q.preguntas.length ? [
      'Evaluación de la calidad:',
      ...q.preguntas.map(x => `  - ${x.codigo}: ${x.pregunta}`),
      `  - Escala: ${q.escala.map(e => `${e.respuesta} = ${e.peso}`).join('; ')}; puntuación máxima ${q.maxima}; umbral de inclusión ${q.umbral}`,
      `  - Estudios evaluados: ${q.evaluados}; superaron el umbral: ${q.superan}; no lo superaron: ${q.no_superan}`
    ].join('\n') : 'Evaluación de la calidad: no se definió instrumento (omite el párrafo).',
    camposTxt.length ? `Formulario de extracción de datos (campo, tipo → pregunta a la que responde):\n${camposTxt.join('\n')}` : '',
    hayNumericos ? 'Hay campos numéricos: se resumen con estadística descriptiva (mínimo, máximo, media, mediana).' : ''
  ].filter(Boolean).join('\n');

  const instrucciones = [
    `TAREA: redacta la sección «${NOMBRE}» del artículo de revisión sistemática, en apartados.`,
    'Cada valor del JSON es un apartado; no escribas títulos dentro del texto. Las tablas las genera la aplicación: remite a ellas como «la Tabla de preguntas de investigación», «la tabla de bases de datos», etc., sin numerarlas.',
    '',
    'APARTADOS:',
    '- enfoque_metodologico (1-2 párrafos): diseño del estudio como revisión sistemática que sigue PRISMA 2020 [cita la guía PRISMA de FUENTES]; si describes las fases de planificación, ejecución y reporte, puedes citar la guía de Kitchenham y Charters. Propósito y por qué el diseño es adecuado para el objetivo.',
    `- motivaciones (lista): una oración por pregunta, en el mismo orden (${preguntas.map(x => x.codigo).join(', ')}), que explique qué se busca conocer con ella y por qué importa.`,
    '- preguntas_investigacion (1 párrafo): cómo se derivaron las preguntas del objetivo y del marco; remite a la tabla.',
    '- fases_prisma (1 párrafo): fases aplicadas (identificación, cribado, elegibilidad, inclusión) tal como se hicieron en esta revisión.',
    '- procedimiento_busqueda (1 párrafo): cómo el marco descompone la pregunta en conceptos y términos; remite a la tabla del marco.',
    '- analisis_cadena_busqueda (1 párrafo): cómo se construyó la cadena (sinónimos unidos con OR dentro de cada concepto y AND entre conceptos, comodines si los hay) y cómo se adaptó a cada base.',
    '- introduccion_bases_datos (1 párrafo): bases consultadas y por qué (cobertura del área), fecha de la búsqueda, registros obtenidos en cada una y filtros aplicados.',
    '- criterios_intro (1-2 oraciones): presenta los criterios de inclusión y exclusión, que la aplicación lista debajo con sus códigos.',
    '- proceso_cribado (1-2 párrafos): las etapas con las cifras PRISMA exactas, quién cribó (independencia y acuerdo si hay datos), cómo se resolvieron discrepancias si consta, el uso de la IA como apoyo con decisión humana si consta, y remite a la Figura 1 (diagrama PRISMA).',
    '- evaluacion_calidad (1 párrafo o cadena vacía si no hay instrumento): instrumento (preguntas con su código), escala, puntuación máxima, umbral y cuántos estudios lo superaron.',
    '- extraccion_datos (1 párrafo): formulario de extracción, qué datos se recogieron y a qué pregunta responde cada uno.',
    '- sintesis_datos (1 párrafo): síntesis narrativa y temática por pregunta (agrupación en categorías y frecuencias de estudios) y, si hay campos numéricos, estadística descriptiva. No hubo metaanálisis.',
    '',
    'DATOS',
    datos,
    '',
    'FUENTES (las únicas que puedes citar)',
    C.bloqueFuentes(guias),
    '',
    'Devuelve: { "enfoque_metodologico": "", "motivaciones": [""], "preguntas_investigacion": "", "fases_prisma": "", "procedimiento_busqueda": "", ' +
      '"analisis_cadena_busqueda": "", "introduccion_bases_datos": "", "criterios_intro": "", "proceso_cribado": "", "evaluacion_calidad": "", "extraccion_datos": "", "sintesis_datos": "" }'
  ].join('\n');

  const r = await C.pedirJson(c.idioma, instrucciones, { maxTokens: 9000, indicaciones: c.indicaciones });
  const acumulado = { usadas: new Set(), quitadas: new Set() };
  const val = v => validarEnValor(C.texto(v), permitidas, acumulado);

  const motivaciones = Array.isArray(r.motivaciones) ? r.motivaciones.map(m => C.corta(m, 600)) : [];
  const conMotivo = preguntas.map((x, i) => ({ ...x, motivacion: motivaciones[i] || '' }));
  const listaCriterios = c.criterios.map(k => `${k.codigo}. ${k.descripcion}`).join('\n');

  const resultado = {
    enfoque_metodologico: val(r.enfoque_metodologico),
    preguntas_investigacion: val(r.preguntas_investigacion),
    tabla_preguntas: T.preguntas(conMotivo, c.idioma),
    fases_prisma: val(r.fases_prisma),
    procedimiento_busqueda: val(r.procedimiento_busqueda),
    tabla_picos: T.picoc(pl.keywords, c.idioma),
    analisis_cadena_busqueda: val(r.analisis_cadena_busqueda),
    cadena_busqueda_global: String(pl.global_search || '').trim(),
    introduccion_bases_datos: val(r.introduccion_bases_datos),
    tabla_bases_datos: T.bases(bases, c.idioma),
    tabla_cadenas_busqueda: T.cadenas(pl.per_base_search, c.idioma),
    criterios_seleccion: [val(r.criterios_intro), listaCriterios].filter(Boolean).join('\n\n'),
    tabla_criterios: T.criterios(c.criterios, c.idioma),
    proceso_cribado: val(r.proceso_cribado),
    evaluacion_calidad: q?.preguntas.length ? val(r.evaluacion_calidad) : '',
    tabla_calidad: q?.preguntas.length ? T.instrumentoCalidad(q, c.idioma) : '',
    extraccion_datos: val(r.extraccion_datos),
    sintesis_datos: val(r.sintesis_datos)
  };
  const citas = [...acumulado.usadas];
  return { resultado: { ...resultado, citas }, citas, quitadas: [...acumulado.quitadas] };
}

module.exports = { NOMBRE, piezas, texto, basesConDatos };
