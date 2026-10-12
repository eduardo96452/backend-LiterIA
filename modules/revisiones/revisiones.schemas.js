// modules/revisiones/revisiones.schemas.js
// Contratos de entrada de /api/v1/revisiones. Los objetos son .strict(): un campo que no está
// aquí (id_usuarios, fecha_creacion, fecha_modificacion…) se rechaza con 400 en lugar de
// ignorarse. El dueño lo decide el token y las fechas las pone la base.
const { z } = require('zod');

const id = z.coerce.number().int().positive();
const texto = max => z.string().trim().max(max);
const opcional = max => texto(max).nullable().optional();    // null borra el valor

const idParam = z.object({ id });

const listarQuery = z.object({
  // ?propias=true → solo las revisiones de las que eres dueño (sin las compartidas contigo)
  propias: z.enum(['true', 'false']).optional().transform(v => v === 'true')
});

const campos = {
  titulo_revision: texto(300).min(1, 'El título es obligatorio.'),
  tipo_revision: texto(100).min(1),
  descripcion: texto(3000),
  objetivo: opcional(2000),
  alcance: opcional(300),
  pais: opcional(100),
  ciudad: opcional(100),
  area_conocimiento: opcional(200),
  tipo_investigacion: opcional(200),
  institucion: opcional(200),
  id_plantilla: id.nullable().optional()
};

const crear = z.object({
  ...campos,
  tipo_revision: campos.tipo_revision.default('RSL'),
  descripcion: campos.descripcion.default('')
}).strict();

const actualizar = z.object(campos).partial().strict()
  .refine(o => Object.keys(o).length > 0, { message: 'No hay cambios que guardar.' });

const preferencia = z.object({
  favorita: z.boolean().optional(),
  oculta: z.boolean().optional()
}).strict().refine(o => o.favorita !== undefined || o.oculta !== undefined, { message: 'Indica favorita u oculta.' });

module.exports = { idParam, listarQuery, crear, actualizar, preferencia };
