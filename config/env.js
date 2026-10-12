// config/env.js
// Carga y VALIDA las variables de entorno al arrancar. Si falta algo crítico, el proceso no inicia.
// En las pruebas (NODE_ENV=test) no se lee el .env: así nunca se usan claves reales por accidente.
if (process.env.NODE_ENV !== 'test') require('dotenv').config();
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3005),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  OPENAI_API_KEY: z.string().min(20, 'OPENAI_API_KEY inválida o ausente'),
  OPENAI_MODEL: z.string().default('gpt-5.6-terra'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  OPENAI_REASONING_EFFORT: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).default('low'),

  // --- Supabase ---
  SUPABASE_URL: z.string().url('SUPABASE_URL debe ser una URL, p. ej. https://xxxx.supabase.co'),
  SUPABASE_ANON_KEY: z.string().min(20, 'SUPABASE_ANON_KEY ausente'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),   // solo para panel admin, auditoría y limpieza de Storage
  SUPABASE_JWT_SECRET: z.string().min(20).optional(),         // proyectos antiguos con HS256

  // --- Autenticación del backend ---
  // jwt    → el frontend envía el token de Supabase (recomendado)
  // apikey → clave estática x-api-key (compatibilidad, solo rutas /api antiguas; /api/v1 exige siempre JWT)
  AUTH_MODE: z.enum(['jwt', 'apikey']).default('jwt'),
  API_KEY: z.string().min(32).optional(),

  // Rutas antiguas /api/* (las del frontend anterior a la v3.5.0). Déjalo en «on» hasta publicar el
  // frontend nuevo; después ponlo en «off»: solo quedan /api/health y /api/contact.
  LEGACY_API: z.enum(['on', 'off']).default('on'),

  ALLOWED_ORIGINS: z.string().default('http://localhost:4200'),
  FRONTEND_URL: z.string().url().default('http://localhost:4200'),

  // --- Límites de peticiones (ver core/rateLimit.js) ---
  // RATE_LIMIT_WINDOW_MS y RATE_LIMIT_MAX ya no se usan: el límite global de 60 cada 15 min
  // por IP bloqueaba la app al pasar todo por el backend y a usuarios que comparten IP.
  RATE_LIMIT_IP_MAX: z.coerce.number().int().positive().default(300),        // por IP y minuto, antes de autenticar
  RATE_LIMIT_USER_MAX: z.coerce.number().int().positive().default(120),      // por usuario y minuto
  RATE_LIMIT_COSTOSO_MAX: z.coerce.number().int().positive().default(20),    // por usuario cada 15 min: IA, importación, indexación
  RATE_LIMIT_IA_MAX: z.coerce.number().int().positive().default(60),         // por usuario cada 15 min: sugerencias cortas de la IA (Planificación)
  RATE_LIMIT_CORREO_MAX: z.coerce.number().int().positive().default(10),     // por usuario y hora: correos que dispara el usuario
  RATE_LIMIT_CONTACTO_MAX: z.coerce.number().int().positive().default(5),    // por IP y hora: formulario público de contacto

  GMAIL_USER: z.string().email().optional(),
  GMAIL_PASS: z.string().optional(),
  CONTACT_TO: z.string().email().optional(),

  CROSSREF_MAILTO: z.string().email().optional().or(z.literal('')),
  OPENALEX_MAILTO: z.string().email().optional().or(z.literal('')),
  SEMANTIC_SCHOLAR_API_KEY: z.string().optional().or(z.literal('')),
  PDF_MAX_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024)
}).superRefine((v, ctx) => {
  if (v.AUTH_MODE === 'apikey' && !v.API_KEY) {
    ctx.addIssue({ code: 'custom', path: ['API_KEY'], message: 'API_KEY es obligatoria cuando AUTH_MODE=apikey' });
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuración inválida (.env):');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

const env = parsed.data;
env.allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
env.isProd = env.NODE_ENV === 'production';
env.mailEnabled = Boolean(env.GMAIL_USER && env.GMAIL_PASS && env.CONTACT_TO);
env.adminEnabled = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);
env.legacyApi = env.LEGACY_API === 'on';

module.exports = env;
