// legacy/controllers/introductionController.js
// Ruta antigua: el navegador envía todo el contexto. La lógica vive en ia/prompts/introduccion.js,
// compartida con POST /api/v1/revisiones/:id/secciones/introduccion/generar.
// Se borrará cuando ninguna versión publicada del frontend use esta ruta.
const { texto } = require('../../ia/prompts/introduccion');

async function generateIntroduction(req, res) {
  res.json(await texto(req.body));
}

module.exports = { generateIntroduction };
