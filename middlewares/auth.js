// middlewares/auth.js
// AUTH_MODE=jwt    → valida el JWT de Supabase (Authorization: Bearer <access_token>).
// AUTH_MODE=apikey → clave estática x-api-key (modo de compatibilidad).
// En ambos modos deja req.user = { id, email, rol } (o null con apikey) y req.token.
const crypto = require('crypto');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const env = require('../config/env');
const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpError');
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

function apiKeyOk(provided) {
  if (!env.API_KEY || !provided) return false;
  const a = Buffer.from(String(provided)); const b = Buffer.from(env.API_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function auth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

    if (env.AUTH_MODE === 'apikey') {
      if (!apiKeyOk(req.get('x-api-key'))) return next(new HttpError(401, 'API key inválida o ausente.'));
      req.user = null; req.token = token;   // si además mandó el JWT, se usa para las RPC con RLS
      return next();
    }

    if (!token) return next(new HttpError(401, 'Falta el token de autenticación (Authorization: Bearer).'));
    let payload;
    try { payload = await verifyJwt(token); }
    catch (e) { logger.warn('jwt_invalid', { message: e.message }); return next(new HttpError(403, 'Token inválido o expirado.')); }

    req.token = token;
    req.user = {
      id: payload.sub,
      email: payload.email,
      rol: payload.app_metadata?.rol || 'usuario'
    };
    const ctx = getContext(); if (ctx) ctx.userId = payload.sub;
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

module.exports = { auth, requireAdmin, requireUserToken };
