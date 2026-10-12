// server.js
// Arranque del servidor y cierre ordenado. La aplicación se construye en app.js.
const env = require('./config/env');
const logger = require('./core/logger');
const app = require('./app');

const server = app.listen(env.PORT, () => {
  logger.info('server_started', { port: env.PORT, env: env.NODE_ENV, auth: env.AUTH_MODE, mail: env.mailEnabled, admin: env.adminEnabled });
});

// Tiempos máximos por conexión (las generaciones largas no deben colgar el servidor indefinidamente)
server.requestTimeout = 180_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 60_000;

// Cierre ordenado
function shutdown(signal) {
  logger.info('shutdown', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', err => logger.error('unhandled_rejection', { message: err?.message, stack: err?.stack }));
process.on('uncaughtException', err => { logger.error('uncaught_exception', { message: err?.message, stack: err?.stack }); shutdown('uncaughtException'); });

module.exports = server;
