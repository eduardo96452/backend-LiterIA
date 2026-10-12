// legacy/controllers/trabaRelaKeywordsController.js
// Ruta antigua: el navegador envía todo el contexto. La lógica vive en ia/prompts/trabajos.js,
// compartida con POST /api/v1/revisiones/:id/secciones/trabajos_relacionados/generar.
// Se borrará cuando ninguna versión publicada del frontend use esta ruta.
const { keywords } = require('../../ia/prompts/trabajos');

async function generatetrabaRelaKeywords(req, res) {
  res.json(await keywords(req.body));
}

module.exports = { generatetrabaRelaKeywords };
