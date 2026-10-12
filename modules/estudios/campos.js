// modules/estudios/campos.js
// Qué columnas de un estudio se leen y cuáles puede escribir el cliente, y cómo se comparan
// títulos y DOI para detectar duplicados.

/** Lo que se devuelve de cada estudio (url_pdf_articulo se convierte en tiene_pdf). */
const COLS = [
  'id_estudios', 'id_detalles_revision', 'titulo', 'resumen', 'autores', 'anio', 'revista', 'doi',
  'fecha_ingreso', 'estado', 'id_criterio', 'keywords', 'author_keywords', 'bibtex_key', 'document_type',
  'paginas', 'volumen', 'url', 'afiliacion', 'publisher', 'issn', 'language', 'comentario',
  'fuente_bibliografica', 'url_pdf_articulo', 'origen', 'citas', 'acceso_abierto', 'url_pdf_externo'
].join(', ');

/**
 * Columnas que el cliente puede escribir. Fuera quedan, a propósito, id_detalles_revision
 * (mover un estudio a otra revisión), url_pdf_articulo (apuntar a un archivo de otro estudio:
 * el PDF tiene sus propias rutas) y las que pone la importación (origen, id_externo…).
 */
const EDITABLES = [
  'titulo', 'resumen', 'autores', 'anio', 'revista', 'doi', 'keywords', 'author_keywords', 'bibtex_key',
  'document_type', 'paginas', 'volumen', 'url', 'afiliacion', 'publisher', 'issn', 'language', 'comentario',
  'fuente_bibliografica'
];

const ESTADOS = ['Sin clasificar', 'Aceptado', 'Rechazado', 'Duplicado'];
/** Estados que llevan criterio: Aceptado → inclusión, Rechazado → exclusión. */
const TIPO_CRITERIO = { Aceptado: 'inclusion', Rechazado: 'exclusion' };

/**
 * Título comparable: sin tildes, en minúsculas, solo letras y números (como normaliza_titulo
 * de la base, pero además juntando espacios). "Deep-Learning: A Review" = "deep learning a review".
 */
function normalizarTitulo(t) {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** "https://doi.org/10.1/X " o "doi:10.1/X" → "10.1/X"; vacío → null. */
function limpiarDoi(d) {
  const limpio = String(d ?? '').trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim();
  return limpio || null;
}

const claveDoi = d => limpiarDoi(d)?.toLowerCase() ?? null;

/** Fila de la base → lo que ve el navegador. La ruta interna del PDF no sale. */
function aPublico(fila) {
  if (!fila) return fila;
  const { url_pdf_articulo, cribado_sugerencias, ...resto } = fila;
  const sug = Array.isArray(cribado_sugerencias) ? cribado_sugerencias[0] : cribado_sugerencias;
  const out = { ...resto, tiene_pdf: Boolean(url_pdf_articulo) };
  if (cribado_sugerencias !== undefined) {
    out.sugerencia = sug ? {
      sugerencia: sug.sugerencia, id_criterio: sug.id_criterio ?? null, confianza: Number(sug.confianza ?? 0),
      justificacion: sug.justificacion ?? '', revisada: Boolean(sug.revisada), fecha: sug.fecha ?? null
    } : null;
  }
  return out;
}

module.exports = { COLS, EDITABLES, ESTADOS, TIPO_CRITERIO, normalizarTitulo, limpiarDoi, claveDoi, aPublico };
