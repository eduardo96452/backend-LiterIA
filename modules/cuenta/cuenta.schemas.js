// modules/cuenta/cuenta.schemas.js
const { z } = require('zod');

/** Texto opcional del perfil: vacío → null; si no llega, no se toca. */
const texto = max => z.string().trim().max(max).nullable().optional().transform(v => (v === undefined ? undefined : v || null));

/**
 * ORCID: cuatro grupos de cuatro cifras y el dígito de control (ISO 7064 11,2; puede ser X).
 * Se acepta pegado como enlace (https://orcid.org/…) y se guarda solo el identificador.
 */
function orcidValido(v) {
  const m = /^(\d{4})-(\d{4})-(\d{4})-(\d{3})([\dX])$/.exec(String(v || ''));
  if (!m) return false;
  let total = 0;
  for (const d of m[1] + m[2] + m[3] + m[4]) total = (total + Number(d)) * 2;
  const resto = (12 - (total % 11)) % 11;
  return (resto === 10 ? 'X' : String(resto)) === m[5];
}
const orcid = z.string().trim().max(60).nullable().optional()
  .transform(v => (v === undefined ? undefined : v ? v.replace(/^(https?:\/\/)?(www\.)?orcid\.org\//i, '').toUpperCase() : null))
  .refine(v => v == null || orcidValido(v), { message: 'El ORCID no es válido: tiene la forma 0000-0000-0000-000X y su última cifra es de control.' });

/**
 * Lo que la persona puede cambiar de su perfil. El correo no (es el de la cuenta: lo protege la base
 * desde el parche 1) ni la foto (va por PUT /cuenta/avatar) ni el nombre de usuario.
 */
const perfil = z.object({
  nombre: texto(100),
  apellido: texto(100),
  institucion: texto(200),
  orcid,
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

/** DELETE /cuenta — se escribe el correo de la cuenta para confirmar. */
const eliminarCuenta = z.object({ confirmacion: z.string().min(3).max(320) }).strict();

/** Las mismas reglas que muestra la pantalla (72 es el máximo que admite Supabase Auth). */
const contrasenaNueva = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(72, 'La contraseña admite hasta 72 caracteres.')
  .refine(v => /[A-ZÁÉÍÓÚÜÑ]/.test(v), 'La contraseña necesita al menos una mayúscula.')
  .refine(v => /\d/.test(v), 'La contraseña necesita al menos un número.')
  .refine(v => /[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ\s]/.test(v), 'La contraseña necesita al menos un carácter especial.');

/** PUT /cuenta/contrasena — la actual no hace falta si se llega desde el enlace de recuperación. */
const contrasena = z.object({
  actual: z.string().min(1).max(200).optional(),
  nueva: contrasenaNueva
}).strict();

/** POST /cuenta/correo — el correo nuevo y la contraseña actual. */
const correo = z.object({
  nuevo: z.string().trim().email('Escribe un correo válido.').max(320),
  actual: z.string().min(1, 'Escribe tu contraseña actual.').max(200)
}).strict();

module.exports = { perfil, preferencias, cerrarSesion, eliminarCuenta, contrasena, correo, orcidValido };
