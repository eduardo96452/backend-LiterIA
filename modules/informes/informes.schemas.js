// modules/informes/informes.schemas.js
const { z } = require('zod');
const { SECCIONES } = require('./secciones');

const id = z.coerce.number().int().positive();
const seccion = z.enum(SECCIONES, { errorMap: () => ({ message: `Sección no válida. Opciones: ${SECCIONES.join(', ')}.` }) });

const params = z.object({ id });
const paramsSeccion = z.object({ id, seccion });
const paramsVersion = z.object({ id, seccion, version: id });
const paramsInforme = z.object({ id, idInforme: id });

/** PATCH …/secciones/:seccion — el contenido es el texto (o el JSON en texto) que guarda la pantalla. */
const guardar = z.object({
  contenido: z.string().max(500_000, 'La sección es demasiado larga (máx. 500 000 caracteres).'),
  id_generacion: id.optional()          // si el texto viene de una propuesta de la IA aceptada
}).strict();

const valoracion = z.object({
  valor: z.union([z.literal(0), z.literal(1)], { errorMap: () => ({ message: 'valor debe ser 1 (adecuada) o 0 (inadecuada).' }) })
}).strict();

/** POST …/secciones/:seccion/generar — el cliente solo envía lo que el usuario decide. */
const generar = z.object({
  paso: z.enum(['texto', 'keywords']).default('texto'),
  keywords: z.string().trim().max(500).optional(),          // palabras clave editadas en pantalla
  palabras: z.coerce.number().int().min(50).max(500).optional()   // longitud del resumen
}).strict();

module.exports = { params, paramsSeccion, paramsVersion, paramsInforme, guardar, valoracion, generar };
