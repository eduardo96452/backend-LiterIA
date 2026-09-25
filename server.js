// server.js
const env = require('./config/env');          // valida .env; aborta si falta algo crítico
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const logger = require('./utils/logger');
const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middlewares/errorHandler');
const { requestContext } = require('./middlewares/requestContext');
const { HttpError } = require('./utils/httpError');

const app = express();

app.disable('x-powered-by');
if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY); // necesario para rate-limit por IP real tras un proxy

// Cabeceras de seguridad
app.use(helmet());

// CORS restringido a los orígenes configurados
app.use(cors({
  origin(origin, cb) {
    // Permitir herramientas sin Origin (curl, health checks) y los orígenes de la lista
    if (!origin || env.allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new HttpError(403, 'Origen no permitido por CORS.'));
  },
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  maxAge: 600
}));

// Body JSON acotado (antes: sin límite explícito y con body-parser redundante)
app.use(express.json({ limit: '1mb' }));
app.use(requestContext);

// Log de acceso mínimo (sin cuerpos)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('request', { method: req.method, path: req.originalUrl, status: res.statusCode, ms: Date.now() - start, ip: req.ip });
  });
  next();
});

app.use('/api', apiRoutes);

app.use(notFound);
app.use(errorHandler);

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

module.exports = app;
