// legacy/controllers/limitacionesController.js
// Ruta antigua: el navegador envía todo el contexto. La lógica vive en ia/prompts/limitaciones.js,
// compartida con POST /api/v1/revisiones/:id/secciones/limitaciones/generar.
// Se borrará cuando ninguna versión publicada del frontend use esta ruta.
const { texto } = require('../../ia/prompts/limitaciones');

async function generateLimitaciones(req, res) {
  res.json(await texto(req.body));
}

module.exports = { generateLimitaciones };
