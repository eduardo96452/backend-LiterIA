// modules/equipo/equipo.schemas.js
const { z } = require('zod');

const id = z.coerce.number().int().positive();
const uuid = z.string().uuid('Identificador de usuario no válido.');

const params = z.object({ id });
const paramsMiembro = z.object({ id, uid: uuid });

const invitacion = z.object({
  correo: z.string().trim().toLowerCase().email('El correo no es válido.').max(254),
  rol: z.enum(['revisor', 'lector']).default('revisor')
}).strict();

const rol = z.object({ rol: z.enum(['propietario', 'revisor', 'lector']) }).strict();

/** El token va en el cuerpo, no en la URL: así no queda en los registros de acceso. */
const aceptar = z.object({ token: z.string().uuid('El enlace de invitación no es válido.') }).strict();

module.exports = { params, paramsMiembro, invitacion, rol, aceptar };
