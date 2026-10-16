// modules/informes/informes.schemas.js
const { z } = require('zod');
const { SECCIONES } = require('./secciones');

const id = z.coerce.number().int().positive();
const seccion = z.enum(SECCIONES, { errorMap: () => ({ message: `Sección no válida. Opciones: ${SECCIONES.join(', ')}.` }) });

const params = z.object({ id });
const paramsSeccion = z.object({ id, seccion });
const paramsVersion = z.object({ id, seccion, version: id });
const paramsInforme = z.object({ id, idInforme: id });
const paramsReferencia = z.object({ id, idRef: id });

/** POST …/referencias — una referencia nueva a partir de su DOI (los datos los pone CrossRef). */
const nuevaReferencia = z.object({
  doi: z.string().trim().min(7, 'Escribe un DOI (10.xxxx/…).').max(300)
    .refine(d => /10\.\d{4,9}\/\S+/.test(d), { message: 'Eso no parece un DOI (10.xxxx/…).' })
}).strict();

/** PUT …/redaccion/idioma — idioma en que la IA redacta el artículo. */
const idioma = z.object({ idioma: z.enum(['es', 'en'], { errorMap: () => ({ message: 'idioma debe ser «es» o «en».' }) }) }).strict();

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
  palabras: z.coerce.number().int().min(50).max(500).optional(),  // longitud del resumen
  indicaciones: z.string().trim().max(1000).optional()            // indicaciones del equipo para la IA (Asistente)
}).strict();

/** PUT …/redaccion/plantilla?nombre=… — nombre original del archivo (opcional). */
const nombrePlantilla = z.object({ nombre: z.string().max(300).optional() });

/** PATCH …/redaccion/plantilla — estilo de la plantilla para cada parte del artículo y si se usa al exportar. */
const plantilla = z.object({
  mapeo: z.record(z.string().max(40), z.string().max(100).nullable()).optional(),
  usar: z.boolean().optional()
}).strict().refine(v => v.mapeo !== undefined || v.usar !== undefined, { message: 'Indica mapeo o usar.' });

module.exports = {
  params, paramsSeccion, paramsVersion, paramsInforme, paramsReferencia, guardar, valoracion, generar, nuevaReferencia, idioma,
  nombrePlantilla, plantilla
};
