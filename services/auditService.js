// services/auditService.js
// Escribe en auditoria_ia (tabla creada por literia_schema.sql) con service_role.
// Es "fire and forget": si falla, se registra en el log pero nunca rompe la petición.
const env = require('../config/env');
const logger = require('../utils/logger');
const { admin } = require('./supabaseService');

async function registrarLlamadaIA({ userId, endpoint, modelo, tokensEntrada, tokensSalida, ms, exito }) {
  if (!env.adminEnabled) return;
  try {
    const { error } = await admin().from('auditoria_ia').insert({
      id_usuarios: userId || null,
      endpoint: endpoint || 'desconocido',
      modelo,
      tokens_entrada: tokensEntrada || 0,
      tokens_salida: tokensSalida || 0,
      ms: ms || null,
      exito: exito !== false
    });
    if (error) logger.warn('auditoria_ia_error', { message: error.message });
  } catch (e) {
    logger.warn('auditoria_ia_error', { message: e.message });
  }
}

module.exports = { registrarLlamadaIA };
