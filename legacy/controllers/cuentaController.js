// legacy/controllers/cuentaController.js
// La lógica vive en modules/cuenta/cuenta.service.js (la comparte con /api/v1/cuenta).
const { contexto } = require('../../core/contexto');
const cuenta = require('../../modules/cuenta/cuenta.service');

/** POST /api/cuenta/aviso-inicio-sesion */
async function avisoInicioSesion(req, res) {
  res.json(await cuenta.avisoInicioSesion(contexto(req), { userAgent: req.get('user-agent'), ip: req.ip }));
}

/** POST /api/cuenta/cerrar-sesion  { id } | { todas: true } */
async function cerrarSesion(req, res) {
  const { id, todas } = req.body || {};
  res.json(await cuenta.cerrarSesion(contexto(req), { id, todas }));
}

module.exports = { avisoInicioSesion, cerrarSesion };
