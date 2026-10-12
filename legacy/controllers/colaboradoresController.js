// legacy/controllers/colaboradoresController.js  (Tanda C, mejora 4)
// La lógica vive en modules/equipo/equipo.service.js (la comparte con POST /api/v1/revisiones/:id/equipo/invitaciones).
const { contexto } = require('../../core/contexto');
const equipo = require('../../modules/equipo/equipo.service');

/** POST /api/colaboradores/invitar  { id_detalles_revision, correo, rol } */
async function invitar(req, res) {
  const { id_detalles_revision, correo, rol } = req.body;
  res.json(await equipo.invitar(contexto(req), id_detalles_revision, { correo, rol }));
}

module.exports = { invitar };
