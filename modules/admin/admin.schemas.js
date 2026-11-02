// modules/admin/admin.schemas.js
const { z } = require('zod');

const id = z.coerce.number().int().positive();
const uuid = z.string().uuid('Identificador de usuario no válido.');
const fecha = z.string().trim().max(40).refine(v => !Number.isNaN(Date.parse(v)), 'Fecha no válida.').optional();
const opcional = max => z.string().trim().max(max).nullable().optional().transform(v => (v ? v : null));
const nombre = max => z.string().trim().min(1, 'El nombre es obligatorio.').max(max);

const usuario = z.object({ uid: uuid });
const conId = z.object({ cid: id });

const usuarios = z.object({
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce.number().int().min(1).max(100).default(25),
  filtro: z.enum(['todas', 'activas', 'desactivadas', 'admins']).default('todas')
});
const uso = z.object({ desde: fecha, hasta: fecha });
const revisiones = z.object({
  q: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
  id_usuarios: uuid.optional(),
  tipo: z.string().trim().max(100).optional()
});

const activo = z.object({ activo: z.boolean() }).strict();
const rol = z.object({ rol: z.enum(['admin', 'usuario']), codigo: z.string().trim().max(10).optional() }).strict();

const huellaConsensus = z.object({ huella: z.string().regex(/^[0-9a-f]{16}$/, 'Clave no válida.') });
const consensusClave = z.object({
  nombre: z.string().trim().max(60).nullable().optional().transform(v => v || null),
  plan: z.enum(['free', 'pro', 'teams', 'deep', 'enterprise']),
  uso_adicional: z.boolean().default(false),
  incluidas: z.coerce.number().int().min(0).max(1_000_000).optional(),
  maximo: z.coerce.number().int().min(0).max(1_000_000).optional(),
  costo_mensual: z.coerce.number().min(0).max(100_000).default(0),
  sync_usadas: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
  reactivar: z.boolean().default(false)
}).strict().refine(v => v.plan !== 'enterprise' || v.incluidas !== undefined,
  { message: 'Con el plan Enterprise indica cuántas búsquedas incluye.', path: ['incluidas'] });

const metodologia = z.object({ nombre: nombre(100), descripcion: opcional(1000) }).strict();
const componente = z.object({
  id_metodologia: id.optional(),
  nombre: nombre(100),
  descripcion: opcional(1000),
  sigla: z.string().trim().max(10).nullable().optional().transform(v => (v ? v.toUpperCase() : null))
}).strict();
const componentes = z.object({ id_metodologia: id.optional() });
const sigla = z.object({ nombre: z.string().trim().min(1).max(100), id_metodologia: id.optional() });
const plantilla = z.object({
  nombre: nombre(100),
  estilo_cita: z.string().trim().min(1, 'El estilo de cita es obligatorio.').max(100),
  cita_en_texto: z.enum(['autor_anio', 'numerica']),
  descripcion: opcional(1000)
}).strict();

module.exports = { usuario, conId, usuarios, uso, revisiones, activo, rol, huellaConsensus, consensusClave, metodologia, componente, componentes, sigla, plantilla };
