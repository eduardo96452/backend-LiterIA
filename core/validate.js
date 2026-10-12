// core/validate.js
const { HttpError } = require('./httpError');

/**
 * Valida y NORMALIZA una parte de la petición con un esquema zod.
 *   validate(schema)           → req.body (sustituido por el valor validado, como antes)
 *   validate(schema, 'params') → req.valid.params
 *   validate(schema, 'query')  → req.valid.query
 * params y query no se sobrescriben en req (en Express 5 req.query es de solo lectura).
 */
const validate = (schema, where = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[where] ?? {});
  if (!result.success) {
    const details = result.error.issues.map(i => ({
      campo: i.path.join('.') || '(raíz)',
      mensaje: i.message
    }));
    return next(new HttpError(400, 'Datos de entrada inválidos.', details));
  }
  if (where === 'body') req.body = result.data;
  else req.valid = { ...(req.valid || {}), [where]: result.data };
  next();
};

module.exports = { validate };
