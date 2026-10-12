// core/logger.js
// Logger mínimo en JSON. Nunca registra cuerpos de petición ni secretos.
// En las pruebas (NODE_ENV=test) calla, salvo que se pida LOG_TEST=1.
const silencio = () => process.env.NODE_ENV === 'test' && process.env.LOG_TEST !== '1';

function log(level, msg, meta) {
  if (silencio()) return;
  const line = { t: new Date().toISOString(), level, msg, ...(meta || {}) };
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out); else console.log(out);
}
module.exports = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta)
};
