// modules/cuenta/cuenta.schemas.js
const { z } = require('zod');

/** Texto opcional del perfil: vacío → null; si no llega, no se toca. */
const texto = max => z.string().trim().max(max).nullable().optional().transform(v => (v === undefined ? undefined : v || null));

/**
 * Lo que la persona puede cambiar de su perfil. El correo no (es el de la cuenta: lo protege la base
 * desde el parche 1) ni la foto (va por PUT /cuenta/avatar) ni el nombre de usuario.
 */
const perfil = z.object({
  nombre: texto(100),
  apellido: texto(100),
  institucion: texto(200),
  orcid: texto(50),
  profesion: texto(100),
  pais: texto(100)
}).strict().refine(v => Object.keys(v).length > 0, { message: 'No hay cambios que guardar.' });

const bool = z.boolean().optional();
const preferencias = z.object({
  desactivar_todo: bool, invitaciones: bool, conflictos: bool, cambios_seccion: bool, fases: bool, recordatorios: bool,
  invitaciones_email: bool, conflictos_email: bool, cambios_seccion_email: bool, fases_email: bool, recordatorios_email: bool
}).strict();

/** Una sesión concreta o todas las demás. */
const cerrarSesion = z.union([
  z.object({ id: z.string().uuid('Identificador de sesión no válido.') }).strict(),
  z.object({ todas: z.literal(true) }).strict()
]);

module.exports = { perfil, preferencias, cerrarSesion };
