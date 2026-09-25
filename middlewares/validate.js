// middlewares/validate.js
const { HttpError } = require('../utils/httpError');

// Valida y NORMALIZA req.body con un esquema zod. Los controladores reciben datos tipados y acotados.
const validate = schema => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const details = result.error.issues.map(i => ({
      campo: i.path.join('.') || '(raíz)',
      mensaje: i.message
    }));
    return next(new HttpError(400, 'Datos de entrada inválidos.', details));
  }
  req.body = result.data;
  next();
};

module.exports = { validate };
