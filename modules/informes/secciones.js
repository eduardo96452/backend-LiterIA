// modules/informes/secciones.js
// Las 8 secciones del artículo y cómo están guardadas en secciones_revision.
// Cada columna guarda un texto; varias guardan un JSON con varias partes (el formato lo fijó la
// pantalla de Informes y aquí se lee igual que allí, con los mismos respaldos para borradores
// antiguos). Los textos pueden venir en HTML (borradores viejos) o en texto plano.

/** Nombres de columna en secciones_revision y en secciones_versiones.seccion. */
const SECCIONES = ['introduccion', 'trabajos_relacionados', 'metodologia', 'resultados',
  'discusion', 'limitaciones', 'conclusion', 'resumen'];

const NOMBRES = {
  introduccion: 'Introducción',
  trabajos_relacionados: 'Trabajos relacionados',
  metodologia: 'Metodología',
  resultados: 'Resultados',
  discusion: 'Discusión',
  limitaciones: 'Limitaciones',
  conclusion: 'Conclusiones',
  resumen: 'Resumen'
};

/** Columna de la valoración (me gusta / no me gusta) de cada sección. */
const COLUMNA_VALORACION = {
  introduccion: 'calidadintroduccion',
  trabajos_relacionados: 'calidadtrabajorelacionado',
  metodologia: 'calidadmetodologia',
  resultados: 'calidadresultados',
  discusion: 'calidaddiscusion',
  limitaciones: 'calidadlimitaciones',
  conclusion: 'calidadconclusion',
  resumen: 'calidadresumen'
};

const CAMPOS_METODOLOGIA = ['enfoque_metodologico', 'preguntas_investigacion', 'tabla_preguntas', 'fases_prisma',
  'procedimiento_busqueda', 'tabla_picos', 'analisis_cadena_busqueda', 'cadena_busqueda_global', 'introduccion_bases_datos',
  'tabla_bases_datos', 'tabla_cadenas_busqueda', 'criterios_seleccion', 'tabla_criterios', 'proceso_cribado',
  'evaluacion_calidad', 'tabla_calidad', 'extraccion_datos', 'sintesis_datos'];

/** Claves de Resultados que no son preguntas (formato antiguo: cada pregunta era una clave más). */
const NO_SON_PREGUNTAS = new Set(['version', 'reflexion_inicial', 'referencias', 'citas', 'panorama', 'tabla_panorama',
  'tabla_caracteristicas', 'calidad', 'tabla_calidad', 'preguntas', 'tablas_preguntas', 'categorias']);

/** HTML guardado → texto plano con sus saltos de párrafo (como htmlATexto en la pantalla). */
function aTexto(valor) {
  if (valor === null || valor === undefined) return '';
  const original = Array.isArray(valor) ? valor.join('\n\n') : String(valor);
  if (!/[<&]/.test(original)) return original.trim();
  return original
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<\/\s*t[dh]\s*>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Texto → párrafos (separados por una línea en blanco). */
function parrafos(valor) {
  if (Array.isArray(valor)) return valor.flatMap(parrafos);
  return aTexto(valor).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
}

function leerJson(valor) {
  if (!valor || typeof valor !== 'string') return null;
  try {
    const v = JSON.parse(valor);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Fila de secciones_revision → contenido de cada sección en texto plano.
 * Una sección sin guardar queda vacía ('' o listas vacías).
 */
function leerGuardadas(fila) {
  const f = fila || {};

  const intro = leerJson(f.introduccion) ?? { introText: f.introduccion || '' };
  const trabajos = leerJson(f.trabajos_relacionados) ?? { trabajos: f.trabajos_relacionados || '' };
  const met = leerJson(f.metodologia) ?? {};
  const res = leerJson(f.resultados) ?? {};
  const disc = leerJson(f.discusion) ?? { discusion: f.discusion || '' };
  const concl = leerJson(f.conclusion) ?? { conclusiones: f.conclusion || '' };

  // Resultados: formato 2 (con panorama, calidad y tablas por pregunta) o el antiguo (cada pregunta una clave)
  const preguntas = {};
  const tablasPreguntas = {};
  if (res.version === 2) {
    for (const [p, v] of Object.entries(res.preguntas || {})) preguntas[p] = parrafos(v);
    for (const [p, v] of Object.entries(res.tablas_preguntas || {})) tablasPreguntas[p] = String(v || '');
  } else {
    for (const [clave, valor] of Object.entries(res)) {
      if (NO_SON_PREGUNTAS.has(clave)) continue;
      preguntas[clave] = parrafos(valor);
    }
  }
  const resumen = leerJson(f.resumen) ?? { resumen: f.resumen || '' };

  return {
    introduccion: {
      keywords: aTexto(intro.keywords),
      texto: aTexto(intro.introText),
      referencias: parrafos(intro.references)
    },
    trabajos_relacionados: {
      keywords: aTexto(trabajos.keywords),
      texto: aTexto(trabajos.trabajos),
      referencias: parrafos(trabajos.referencias)
    },
    metodologia: Object.fromEntries(CAMPOS_METODOLOGIA.map(c => [c, aTexto(met[c])])),
    resultados: {
      reflexion_inicial: parrafos(res.reflexion_inicial),
      panorama: aTexto(res.panorama),
      calidad: aTexto(res.calidad),
      tabla_panorama: String(res.tabla_panorama || ''),
      tabla_caracteristicas: String(res.tabla_caracteristicas || ''),
      tabla_calidad: String(res.tabla_calidad || ''),
      preguntas,
      tablas_preguntas: tablasPreguntas,
      referencias: parrafos(res.referencias)
    },
    discusion: {
      keywords: aTexto(disc.keywords),
      texto: aTexto(disc.discusion),
      tabla_vacios: String(disc.tabla_vacios || ''),
      referencias: parrafos(disc.referencias)
    },
    limitaciones: aTexto(f.limitaciones),
    conclusion: aTexto(concl.conclusiones),
    resumen: aTexto(resumen.resumen),
    palabras_clave: Array.isArray(resumen.palabras_clave) ? resumen.palabras_clave.map(String) : []
  };
}

/** ¿Hay algo guardado en la sección? Sirve para avisar de que falta una sección previa. */
function tieneContenido(guardadas, seccion) {
  const s = guardadas[seccion];
  switch (seccion) {
    case 'metodologia': return Object.values(s).some(Boolean);
    case 'resultados': return s.reflexion_inicial.length > 0 || Object.keys(s.preguntas).length > 0 || Boolean(s.panorama);
    case 'introduccion':
    case 'trabajos_relacionados':
    case 'discusion': return Boolean(s.texto);
    default: return Boolean(s);
  }
}

module.exports = { SECCIONES, NOMBRES, COLUMNA_VALORACION, CAMPOS_METODOLOGIA, NO_SON_PREGUNTAS, aTexto, parrafos, leerJson, leerGuardadas, tieneContenido };
