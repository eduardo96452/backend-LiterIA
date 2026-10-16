// modules/planificacion/planificacion.schemas.js
// Contratos de entrada de la pantalla de Planificación. Los objetos son .strict(): un campo de más
// (id_detalles_revision, id_revision…) se rechaza con 400; la revisión la dice la URL.
const { z } = require('zod');

const id = z.coerce.number().int().positive();
const texto = (max, min = 1, msg) => z.string().trim().min(min, msg).max(max);

const params = z.object({ id });
const conPregunta = z.object({ id, p: id });
const conPalabra = z.object({ id, k: id });
const conBase = z.object({ id, b: id });
const conCriterio = z.object({ id, c: id });
const conRespuesta = z.object({ id, r: id });
const conCampo = z.object({ id, c: id });
const conFuente = z.object({ id, fuente: texto(200) });

const noVacio = o => Object.keys(o).length > 0;
const SIN_CAMBIOS = { message: 'No hay cambios que guardar.' };

/* ---------- Framework ---------- */
const metodologia = z.object({
  id_metodologia: id,
  componentes: z.array(z.object({
    id_componente: id,
    valor: z.string().max(3000).nullable().optional().transform(v => (v ?? '').trim())
  }).strict()).max(30).default([])
}).strict();

/* ---------- Preguntas de investigación ---------- */
const pregunta = z.object({ pregunta: texto(1000, 1, 'La pregunta no puede estar vacía.') }).strict();

/* ---------- Palabras clave ---------- */
const palabra = z.object({
  palabra_clave: texto(150, 1, 'La palabra clave no puede estar vacía.'),
  id_componente: id,
  sinonimos: z.array(z.string().trim().max(150)).max(30).default([])
}).strict();

/* ---------- Bases y cadenas ---------- */
const base = z.object({
  nombre: texto(200, 1, 'El nombre de la base es obligatorio.'),
  url: z.string().trim().max(2000).default('')
}).strict();

const cadena = z.object({ cadena: texto(10000, 1, 'La cadena de búsqueda no puede estar vacía.') }).strict();

/* ---------- Criterios ---------- */
const criterio = z.object({
  descripcion: texto(2000, 1, 'El criterio no puede estar vacío.'),
  tipo: z.enum(['inclusion', 'exclusion'])
}).strict();
const criterioCambio = z.object({ descripcion: texto(2000, 1, 'El criterio no puede estar vacío.') }).strict();

/* ---------- Instrumento de calidad ---------- */
const preguntaCalidad = z.object({ descripcion: texto(2000, 1, 'La pregunta no puede estar vacía.') }).strict();
const peso = z.coerce.number().min(0, 'El peso no puede ser negativo.').max(1000);
const respuesta = z.object({ descripcion: texto(500, 1, 'La respuesta no puede estar vacía.'), peso: peso.default(0) }).strict();
const respuestaCambio = z.object({ descripcion: texto(500, 1, 'La respuesta no puede estar vacía.').optional(), peso: peso.optional() })
  .strict().refine(noVacio, SIN_CAMBIOS);
const umbral = z.object({ limite: z.coerce.number().min(0, 'La puntuación mínima no puede ser negativa.').max(9999) }).strict();

/* ---------- Campos de extracción ---------- */
const TIPOS_CAMPO = ['Texto', 'Booleano', 'Entero', 'Decimal', 'Fecha'];
const campo = z.object({
  descripcion: texto(1000, 1, 'La descripción no puede estar vacía.'),
  tipo: z.enum(TIPOS_CAMPO).default('Texto'),
  orden: z.coerce.number().int().min(0).max(100000).optional(),
  id_pregunta_investigacion: id.nullable().optional()      // pregunta a la que responde (sql/010)
}).strict();
const campoCambio = z.object({
  descripcion: texto(1000, 1, 'La descripción no puede estar vacía.').optional(),
  tipo: z.enum(TIPOS_CAMPO).optional(),
  id_pregunta_investigacion: id.nullable().optional()
}).strict().refine(noVacio, SIN_CAMBIOS);
const orden = z.object({ ids: z.array(id).min(1).max(500) }).strict();

/* ---------- Sugerencias de la IA ---------- */
const TIPOS_IA = ['objetivo', 'estructura', 'preguntas', 'palabras-clave', 'cadena', 'criterios', 'calidad', 'campos-extraccion'];
const conTipoIa = z.object({ id, tipo: z.enum(TIPOS_IA) });
const ia = {
  objetivo: z.object({}).strict(),
  estructura: z.object({ id_metodologia: id }).strict(),
  preguntas: z.object({ cantidad: z.coerce.number().int().min(1).max(10).default(3), id_metodologia: id.optional() }).strict(),
  // idioma de los términos (por defecto inglés, el de indexación de las bases)
  'palabras-clave': z.object({ idioma: texto(50, 1, 'Indica el idioma de los términos.').optional() }).strict(),
  cadena: z.object({ idioma: texto(50, 1, 'Indica el idioma de la cadena.') }).strict(),
  criterios: z.object({}).strict(),
  calidad: z.object({}).strict(),
  'campos-extraccion': z.object({ cantidad: z.coerce.number().int().min(1).max(20).default(5) }).strict()
};

module.exports = {
  params, conPregunta, conPalabra, conBase, conCriterio, conRespuesta, conCampo, conFuente, conTipoIa,
  metodologia, pregunta, palabra, base, cadena, criterio, criterioCambio,
  preguntaCalidad, respuesta, respuestaCambio, umbral, campo, campoCambio, orden, ia, TIPOS_IA, TIPOS_CAMPO
};
