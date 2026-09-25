// utils/logger.js
// Logger mínimo en JSON. Nunca registra cuerpos de petición ni secretos.
function log(level, msg, meta) {
  const line = { t: new Date().toISOString(), level, msg, ...(meta || {}) };
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out); else console.log(out);
}
module.exports = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta)
};
