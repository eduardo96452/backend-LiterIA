// core/auth.js
// authJwt          → SIEMPRE exige el JWT de Supabase (Authorization: Bearer <access_token>). Lo usa /api/v1.
// auth             → rutas /api antiguas: depende de AUTH_MODE (jwt | apikey, modo de compatibilidad).
// Ambos dejan req.user = { id, email, rol } (o null con apikey) y req.token.
//
// Códigos de respuesta:
//   401 → falta el token, o es inválido o caducó: el frontend debe cerrar la sesión.
//   503 → no se pudieron obtener las claves públicas de Supabase (caída o red): no es culpa del usuario.
//   403 → queda para "autenticado pero sin permiso" (p. ej. requireAdmin, RLS).
const crypto = require('crypto');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const env = require('../config/env');
const logger = require('./logger');
const { HttpError } = require('./httpError');
const { getContext } = require('./requestContext');

const jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
const issuer = `${env.SUPABASE_URL}/auth/v1`;

async function verifyJwt(token) {
  const opts = { issuer, audience: 'authenticated' };
  try {
    return (await jwtVerify(token, jwks, opts)).payload;            // claves asimétricas (proyectos nuevos)
  } catch (e) {
    if (!env.SUPABASE_JWT_SECRET) throw e;
    const key = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);   // HS256 (proyectos antiguos)
    return (await jwtVerify(token, key, opts)).payload;
  }
}

/** Errores de jose que significan "este token no vale" (y no "no pude comprobarlo"). */
const esTokenInvalido = e =>
  /^ERR_(JWT|JWS|JWK|JOSE)/.test(e?.code || '') && e.code !== 'ERR_JWKS_TIMEOUT';

function leerBearer(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

async function autenticarConJwt(req, token) {
  if (!token) throw new HttpError(401, 'Falta el token de autenticación (Authorization: Bearer).');
  let payload;
  try {
    payload = await verifyJwt(token);
  } catch (e) {
    if (esTokenInvalido(e)) {
      logger.warn('jwt_invalid', { code: e.code, message: e.message });
      throw new HttpError(401, 'Token inválido o expirado.');
    }
    logger.error('jwt_verificacion_no_disponible', { code: e.code, message: e.message });
    throw new HttpError(503, 'No se pudo verificar la sesión en este momento. Intente de nuevo.');
  }
  if (!payload.sub) throw new HttpError(401, 'Token sin usuario.');

  req.token = token;
  req.user = {
    id: payload.sub,
    email: payload.email,
    rol: payload.app_metadata?.rol || 'usuario'
  };
  const ctx = getContext(); if (ctx) ctx.userId = payload.sub;
}

function apiKeyOk(provided) {
  if (!env.API_KEY || !provided) return false;
  const a = Buffer.from(String(provided)); const b = Buffer.from(env.API_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** /api/v1: siempre JWT, sea cual sea AUTH_MODE. */
async function authJwt(req, _res, next) {
  try { await autenticarConJwt(req, leerBearer(req)); next(); }
  catch (e) { next(e); }
}

/** Rutas /api antiguas: respeta AUTH_MODE. */
async function auth(req, _res, next) {
  try {
    const token = leerBearer(req);
    if (env.AUTH_MODE === 'apikey') {
      if (!apiKeyOk(req.get('x-api-key'))) return next(new HttpError(401, 'API key inválida o ausente.'));
      req.user = null; req.token = token;   // si además mandó el JWT, se usa para las RPC con RLS
      return next();
    }
    await autenticarConJwt(req, token);
    next();
  } catch (e) { next(e); }
}

/** Requiere rol admin en app_metadata (lo pone el dashboard de Supabase o fn_admin_set_rol). */
function requireAdmin(req, _res, next) {
  if (!req.user || req.user.rol !== 'admin') return next(new HttpError(403, 'Se requiere rol de administrador.'));
  next();
}

/** Para endpoints que necesitan sí o sí un usuario identificado (RPC con RLS). */
function requireUserToken(req, _res, next) {
  if (!req.token) return next(new HttpError(401, 'Este endpoint requiere el token de sesión de Supabase.'));
  next();
}

module.exports = { auth, authJwt, requireAdmin, requireUserToken };
