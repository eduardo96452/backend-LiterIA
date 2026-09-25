// middlewares/errorHandler.js
const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpError');

function notFound(_req, _res, next) {
  next(new HttpError(404, 'Ruta no encontrada.'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  // Errores del parser JSON de Express
  if (err.type === 'entity.parse.failed') err = new HttpError(400, 'JSON mal formado.');
  if (err.type === 'entity.too.large') err = new HttpError(413, 'Cuerpo de la petición demasiado grande.');

  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  const expose = err instanceof HttpError ? err.expose : false;

  logger[status >= 500 ? 'error' : 'warn']('request_error', {
    status,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    message: err.message,
    ...(status >= 500 && err.stack ? { stack: err.stack } : {})
  });

  res.status(status).json({
    error: expose ? err.message : 'Error interno del servidor.',
    ...(expose && err.details ? { details: err.details } : {})
  });
}

module.exports = { notFound, errorHandler };
