// modules/informes/tablas.js
// Tablas del artículo construidas con los datos de la base (no las escribe la IA, así no puede
// inventar filas ni cifras). Salen en HTML con las clases de Bootstrap que ya usa la pantalla de
// Redacción; el Word las convierte en tablas reales. Las citas van como [@clave] y la aplicación
// las pone con el formato de la plantilla al mostrar y al exportar.

const { pct } = require('./prisma');

const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const corta = (t, max) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };
const citas = claves => (claves || []).length ? `[${claves.map(c => `@${c}`).join('; ')}]` : '—';

const T = {
  es: {
    componente: 'Componente', terminos: 'Términos de búsqueda', id: 'ID', pregunta: 'Pregunta de investigación',
    motivacion: 'Motivación', base: 'Base de datos', registros: 'Registros identificados', fecha: 'Fecha de búsqueda',
    cadena: 'Cadena de búsqueda', codigo: 'Código', tipo: 'Tipo', criterio: 'Criterio', inclusion: 'Inclusión',
    exclusion: 'Exclusión', preguntaCalidad: 'Pregunta de calidad', anio: 'Año', estudios: 'Estudios', fuente: 'Fuente',
    tipoPub: 'Tipo de publicación', estudio: 'Estudio', categoria: 'Categoría', nPct: 'n (%)', vacio: 'Vacío identificado',
    descripcion: 'Descripción', linea: 'Línea de investigación futura', total: 'Total', puntaje: 'Puntuación',
    revista: 'Artículo de revista', conferencia: 'Actas de congreso', libro: 'Libro o capítulo', otro: 'Otro'
  },
  en: {
    componente: 'Component', terminos: 'Search terms', id: 'ID', pregunta: 'Research question',
    motivacion: 'Motivation', base: 'Database', registros: 'Records identified', fecha: 'Search date',
    cadena: 'Search string', codigo: 'Code', tipo: 'Type', criterio: 'Criterion', inclusion: 'Inclusion',
    exclusion: 'Exclusion', preguntaCalidad: 'Quality question', anio: 'Year', estudios: 'Studies', fuente: 'Source',
    tipoPub: 'Publication type', estudio: 'Study', categoria: 'Category', nPct: 'n (%)', vacio: 'Identified gap',
    descripcion: 'Description', linea: 'Future research direction', total: 'Total', puntaje: 'Score',
    revista: 'Journal article', conferencia: 'Conference paper', libro: 'Book or chapter', otro: 'Other'
  }
};
const t = idioma => T[idioma === 'en' ? 'en' : 'es'];

/** Tabla HTML: encabezados (texto) y filas (celdas YA escapadas con esc o citas()). */
function tabla(encabezados, filas) {
  if (!filas.length) return '';
  const head = `<thead><tr>${encabezados.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${filas.map(f => `<tr>${f.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<table class="table table-sm table-bordered">${head}${body}</table>`;
}

function picoc(keywords, idioma) {
  const L = t(idioma);
  const grupos = new Map();
  for (const k of keywords || []) {
    const comp = String(k.componente || '').trim() || '—';
    if (!grupos.has(comp)) grupos.set(comp, []);
    grupos.get(comp).push(...[k.palabra, ...(k.sinonimos || [])].map(s => String(s || '').trim()).filter(Boolean));
  }
  return tabla([L.componente, L.terminos], [...grupos].map(([c, ts]) => [esc(c), esc([...new Set(ts)].join('; '))]));
}

function preguntas(lista, idioma) {
  const L = t(idioma);
  return tabla([L.id, L.pregunta, L.motivacion], lista.map(p => [esc(p.codigo), esc(p.pregunta), esc(p.motivacion || '')]));
}

/** Bases con los registros identificados (estudios importados por fuente) y la fecha de la última búsqueda. */
function bases(lista, idioma) {
  const L = t(idioma);
  return tabla([L.base, L.registros, L.fecha], lista.map(b => [esc(b.nombre), esc(b.registros ?? '—'), esc(b.fecha || '—')]));
}

function cadenas(lista, idioma) {
  const L = t(idioma);
  return tabla([L.base, L.cadena], (lista || []).map(c => [esc(c.fuente), esc(c.cadena)]));
}

function criterios(lista, idioma) {
  const L = t(idioma);
  return tabla([L.codigo, L.tipo, L.criterio],
    lista.map(c => [esc(c.codigo), esc(c.tipo === 'inclusion' ? L.inclusion : L.exclusion), esc(c.descripcion)]));
}

function instrumentoCalidad(calidad, idioma) {
  const L = t(idioma);
  return tabla([L.codigo, L.preguntaCalidad], calidad.preguntas.map(p => [esc(p.codigo), esc(p.pregunta)]));
}

/** Resultado de la evaluación: por pregunta, cuántos estudios recibieron cada respuesta. */
function resultadosCalidad(calidad, idioma) {
  const L = t(idioma);
  if (!calidad.escala.length) return '';
  const filas = calidad.preguntas.map(p => [
    esc(p.codigo), esc(corta(p.pregunta, 160)),
    ...p.distribucion.map(d => esc(`${d.n} (${pct(d.n, p.evaluados)} %)`))
  ]);
  return tabla([L.codigo, L.preguntaCalidad, ...calidad.escala.map(e => `${e.respuesta} (${e.peso})`)], filas);
}

function panorama(datos, idioma) {
  const L = t(idioma);
  const fila = r => [esc(r.valor), esc(`${r.n} (${r.pct} %)`)];
  const tipos = datos.por_tipo.map(r => ({ ...r, valor: L[r.valor] || r.valor }));
  return [
    tabla([L.anio, L.nPct], datos.por_anio.map(fila)),
    tabla([L.fuente, L.nPct], datos.por_fuente.map(fila)),
    tabla([L.tipoPub, L.nPct], tipos.map(fila))
  ].filter(Boolean).join('');
}

/**
 * Características de los estudios incluidos en la síntesis: estudio (cita), año, tipo y hasta
 * cuatro campos de extracción, recortados para que la tabla quepa en una página.
 */
function caracteristicas(estudios, campos, idioma) {
  const L = t(idioma);
  const usados = campos.slice(0, 4);
  const filas = estudios.map(e => [
    citas([e.clave]), esc(e.anio || '—'),
    ...usados.map(c => esc(corta(e.respuestas?.[c] ?? '—', 140) || '—'))
  ]);
  return tabla([L.estudio, L.anio, ...usados.map(c => corta(c, 60))], filas);
}

/** Categorías de una pregunta de investigación con los estudios que las informan. */
function categorias(lista, totalSintesis, idioma) {
  const L = t(idioma);
  return tabla([L.categoria, L.estudios, L.nPct],
    lista.map(c => [esc(c.nombre), citas(c.claves), esc(`${c.claves.length} (${pct(c.claves.length, totalSintesis)} %)`)]));
}

function vacios(lista, idioma) {
  const L = t(idioma);
  return tabla([L.vacio, L.descripcion, L.linea], lista.map(v => {
    const faltan = (v.claves || []).filter(k => !String(v.explicacion || '').includes(`@${k}`));   // sin repetir las que ya cita
    return [esc(v.vacio), `${esc(v.explicacion)}${faltan.length ? ` ${citas(faltan)}` : ''}`, esc(v.linea_futura)];
  }));
}

module.exports = { esc, corta, tabla, picoc, preguntas, bases, cadenas, criterios, instrumentoCalidad, resultadosCalidad, panorama, caracteristicas, categorias, vacios, T };
