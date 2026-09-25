// middlewares/asyncHandler.js
// Express 4 no captura rechazos de funciones async: sin esto, un error deja la petición colgada.
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
module.exports = { asyncHandler };
