// core/rateLimit.js
// Límites de peticiones. Antes había uno global de 60 peticiones cada 15 minutos POR IP:
// con todo el tráfico de la app pasando por el backend, una sola pantalla lo agotaba, y en
// una universidad muchos usuarios comparten la misma IP pública.
//
// Ahora:
//   ip        → antes de autenticar, holgado; solo frena volumen anómalo desde una IP.
//   usuario   → después de autenticar, por usuario: uso normal de la app.
//   costoso   → por usuario: lo que cuesta dinero o recursos (IA, importación, indexación).
//   ia        → por usuario: sugerencias cortas de la IA (Planificación: objetivo, preguntas, términos…).
//               Son muchas y baratas; con el límite «costoso» una sesión de planificación lo agotaba.
//   correo    → por usuario: acciones que envían un correo (invitar, aviso de sesión, código admin).
//   contacto  → por IP: formulario público, sin sesión.
//
// Los contadores viven en memoria: correcto con una instancia. Con varias instancias en
// Render habría que usar un store compartido (Redis o Postgres).
const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intente más tarde.' }
};

// Después de auth hay usuario; en modo apikey (compatibilidad) puede no haberlo y se usa la IP.
const porUsuario = req => (req.user?.id ? `u:${req.user.id}` : `ip:${req.ip}`);

const MINUTO = 60_000;

module.exports = {
  ip:       rateLimit({ ...base, windowMs: MINUTO,      max: env.RATE_LIMIT_IP_MAX }),
  usuario:  rateLimit({ ...base, windowMs: MINUTO,      max: env.RATE_LIMIT_USER_MAX,     keyGenerator: porUsuario }),
  costoso:  rateLimit({ ...base, windowMs: 15 * MINUTO, max: env.RATE_LIMIT_COSTOSO_MAX,  keyGenerator: porUsuario }),
  ia:       rateLimit({ ...base, windowMs: 15 * MINUTO, max: env.RATE_LIMIT_IA_MAX,       keyGenerator: porUsuario }),
  correo:   rateLimit({ ...base, windowMs: 60 * MINUTO, max: env.RATE_LIMIT_CORREO_MAX,   keyGenerator: porUsuario }),
  contacto: rateLimit({ ...base, windowMs: 60 * MINUTO, max: env.RATE_LIMIT_CONTACTO_MAX })
};
