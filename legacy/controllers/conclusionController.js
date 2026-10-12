// legacy/controllers/conclusionController.js
// Ruta antigua: el navegador envía todo el contexto. La lógica vive en ia/prompts/conclusion.js,
// compartida con POST /api/v1/revisiones/:id/secciones/conclusion/generar.
// Se borrará cuando ninguna versión publicada del frontend use esta ruta.
const { texto } = require('../../ia/prompts/conclusion');

async function generateConclusion(req, res) {
  res.json(await texto(req.body));
}

module.exports = { generateConclusion };
