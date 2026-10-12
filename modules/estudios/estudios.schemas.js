// modules/estudios/estudios.schemas.js
const { z } = require('zod');
const legacy = require('../../legacy/schemas');
const { ESTADOS } = require('./campos');

const id = z.coerce.number().int().positive();
const uuid = z.string().uuid('Identificador de usuario no válido.');

const params = z.object({ id });
const paramsEstudio = z.object({ id, e: id });

/** Texto opcional: null o cadena (se recorta). */
const texto = max => z.string().trim().max(max).nullable().optional();
/** Año: vacío o null → null; 0 se admite (así guardaba la pantalla los años desconocidos). */
const anio = z.preprocess(
  v => (v === '' || v === null || v === undefined ? null : Number(v)),
  z.number({ invalid_type_error: 'El año debe ser un número.' }).int().min(0).max(2100).nullable()
).optional();
const criterio = z.preprocess(v => (v === '' || v === 0 || v === '0' ? null : v), id.nullable()).optional();

const camposTexto = {
  resumen: texto(20000),
  autores: texto(5000),
  anio,
  revista: texto(1000),
  doi: texto(300),
  keywords: texto(3000),
  author_keywords: texto(3000),
  bibtex_key: texto(300),
  document_type: texto(200),
  paginas: texto(100),
  volumen: texto(100),
  url: texto(2000),
  afiliacion: texto(3000),
  publisher: texto(500),
  issn: texto(100),
  language: texto(100),
  comentario: texto(5000),
  fuente_bibliografica: texto(200)
};

const titulo = z.string().trim().min(1, 'El título es obligatorio.').max(2000);
const estado = z.enum(ESTADOS, { errorMap: () => ({ message: `Estado no válido. Opciones: ${ESTADOS.join(', ')}.` }) });

/** Un estudio nuevo (alta manual o desde un archivo .bib/.ris). */
const estudioNuevo = z.object({
  titulo,
  ...camposTexto,
  estado: estado.default('Sin clasificar'),
  id_criterio: criterio
}).strict();

/** POST …/estudios — uno o un lote. El servidor marca los duplicados. */
const crear = z.object({
  estudios: z.array(estudioNuevo).min(1, 'Envía al menos un estudio.').max(500, 'Máximo 500 estudios por petición.')
}).strict();

/** PATCH …/estudios/:e — solo lo que cambia. */
const actualizar = z.object({
  titulo: titulo.optional(),
  ...camposTexto,
  estado: estado.optional(),
  id_criterio: criterio
}).strict().refine(o => Object.keys(o).length > 0, { message: 'No hay cambios que guardar.' });

/* ---------- PDF ---------- */
const MAX_PDF = 50 * 1024 * 1024;

const subidaPdf = z.object({
  nombre: z.string().trim().min(1).max(200).regex(/\.pdf$/i, 'El archivo debe ser un PDF.'),
  tamano: z.coerce.number().int().positive().max(MAX_PDF, 'El PDF supera los 50 MB permitidos.')
}).strict();

const confirmarPdf = z.object({ ruta: z.string().trim().min(1).max(400) }).strict();

/* ---------- Calidad ---------- */
const calidad = z.object({
  respuestas: z.array(z.object({ id_pregunta: id, id_respuesta: id }).strict())
    .min(1, 'Responde al menos una pregunta.').max(100)
}).strict();

/* ---------- Importación desde OpenAlex / Semantic Scholar / CrossRef ---------- */
const importarBuscar = legacy.importarBuscar;
const importar = legacy.importarBuscar.extend({ paginas: z.coerce.number().int().min(1).max(10).default(1) });

/* ---------- Cribado ---------- */
const sugerir = z.object({
  ids_estudios: z.array(id).max(50).optional(),
  solo_sin_clasificar: z.boolean().default(true),
  max: z.coerce.number().int().min(1).max(50).default(20)
}).strict();

const decision = z.object({
  id_estudios: id,
  decision: z.enum(['Aceptado', 'Rechazado', 'Dudoso']),
  id_criterio: criterio,
  comentario: texto(1000)
}).strict();

const resolver = z.object({
  decision: z.enum(['Aceptado', 'Rechazado'], { errorMap: () => ({ message: 'La decisión final es Aceptado o Rechazado.' }) }),
  id_criterio: criterio
}).strict();

const kappa = z.object({ a: uuid, b: uuid });

module.exports = {
  params, paramsEstudio, crear, actualizar, subidaPdf, confirmarPdf, calidad,
  importarBuscar, importar, sugerir, decision, resolver, kappa, MAX_PDF
};
