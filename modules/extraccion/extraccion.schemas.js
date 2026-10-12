// modules/extraccion/extraccion.schemas.js
const { z } = require('zod');

const id = z.coerce.number().int().positive();

const params = z.object({ id });
const paramsEstudio = z.object({ id, e: id });

/** Cualquier valor de un campo se guarda como texto (como antes): true/false, números y fechas también. */
const valor = z.union([z.string().max(20000, 'Una respuesta no puede superar los 20 000 caracteres.'), z.number(), z.boolean()])
  .nullable().optional()
  .transform(v => (v === null || v === undefined ? '' : typeof v === 'string' ? v.trim() : String(v)));

const respuesta = z.object({ id_campo_extraccion: id, valor }).strict();

/** PUT …/extraccion: las respuestas del estudio y, si se envía, la marca de «hecho». */
const guardar = z.object({
  respuestas: z.array(respuesta).max(200),
  done: z.boolean().optional()
}).strict().refine(v => new Set(v.respuestas.map(r => r.id_campo_extraccion)).size === v.respuestas.length,
  { message: 'Hay un campo repetido.', path: ['respuestas'] });

/** PUT …/extraccion/estado */
const estado = z.object({ done: z.boolean() }).strict();

/** POST …/extraccion/sugerir: la URL solo se usa si el estudio no tiene PDF. */
const sugerir = z.object({
  url: z.string().trim().url('La URL del PDF no es válida.').max(2000).optional()
}).strict();

module.exports = { params, paramsEstudio, guardar, estado, sugerir };
