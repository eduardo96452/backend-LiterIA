// app.js
// Construye la aplicación Express (sin escuchar en un puerto): server.js la arranca y las
// pruebas la usan directamente con supertest.
const env = require('./config/env');          // valida .env; aborta si falta algo crítico
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const logger = require('./core/logger');
const routes = require('./routes');
const { notFound, errorHandler } = require('./core/errorHandler');
const { requestContext } = require('./core/requestContext');
const { HttpError } = require('./core/httpError');

const app = express();

app.disable('x-powered-by');
// En Render (detrás de un proxy) debe ser 1: si no, req.ip es la IP del proxy y todos los
// usuarios comparten el mismo contador de límite por IP.
if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY);

// Cabeceras de seguridad
app.use(helmet());

// CORS restringido a los orígenes configurados. PUT y DELETE son necesarios para /api/v1.
app.use(cors({
  origin(origin, cb) {
    // Permitir herramientas sin Origin (curl, health checks) y los orígenes de la lista
    if (!origin || env.allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new HttpError(403, 'Origen no permitido por CORS.'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  maxAge: 600
}));

// Body JSON acotado
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

app.use(routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
