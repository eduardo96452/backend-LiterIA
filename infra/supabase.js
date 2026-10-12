// infra/supabase.js
// Dos formas de hablar con Supabase:
//   forUser(token)  → cliente con la clave anon + el JWT del usuario: RLS se aplica como si fuera él.
//   admin()         → cliente con service_role: SALTA RLS. Solo para el panel admin, la auditoría
//                     y tareas de sistema ya autorizadas (p. ej. limpiar Storage tras borrar una revisión).
// Los módulos llaman a estas funciones a través del objeto del módulo (sb.forUser), no
// desestructuradas: así las pruebas pueden sustituirlas por un cliente simulado.
const { createClient } = require('@supabase/supabase-js');
const env = require('../config/env');
const { HttpError } = require('../core/httpError');

const base = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

function forUser(token) {
  if (!token) throw new HttpError(401, 'Se requiere el token de sesión de Supabase.');
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...base,
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

let adminClient = null;
function admin() {
  if (!env.adminEnabled) throw new HttpError(503, 'Las funciones de administración no están configuradas (falta SUPABASE_SERVICE_ROLE_KEY).');
  if (!adminClient) adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, base);
  return adminClient;
}

/** Ejecuta una RPC y convierte el error de PostgREST en HttpError legible. */
async function rpc(client, fn, params = {}) {
  const { data, error } = await client.rpc(fn, params);
  if (error) throw fromSupabaseError(error);
  return data;
}

function fromSupabaseError(error) {
  const msg = error.message || 'Error de base de datos';
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(msg)) {
    return new HttpError(503, 'La base de datos no está disponible en este momento.');
  }
  // "function x does not exist" (Postgres) o PGRST202 "Could not find the function public.x(...)" (PostgREST)
  if (error.code === 'PGRST202' || /function .* does not exist|could not find the function/i.test(msg)) {
    const nombre = msg.match(/function ([\w.]+)/i)?.[1] || '';
    return new HttpError(501, `Función no instalada en la base de datos: ${nombre}. Ejecute el script SQL de la tanda correspondiente.`);
  }
  if (error.code === '42501' || /no autorizado|permission denied|row-level security/i.test(msg)) {
    return new HttpError(403, msg.replace(/^.*?:\s*/, ''));
  }
  if (error.code === '23505') return new HttpError(409, 'Registro duplicado.');
  if (error.code === '23503') return new HttpError(400, 'Hace referencia a un registro que no existe.');
  if (error.code === 'PGRST116') return new HttpError(404, 'No encontrado.');
  if (error.code === 'P0002') return new HttpError(404, msg);   // no_data_found de las funciones SQL
  return new HttpError(400, msg);
}

const adminDisponible = () => env.adminEnabled;

module.exports = { forUser, admin, adminDisponible, rpc, fromSupabaseError };
