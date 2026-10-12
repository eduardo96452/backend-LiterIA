// legacy/controllers/introductionKeywordsController.js
// Ruta antigua: el navegador envía todo el contexto. La lógica vive en ia/prompts/introduccion.js,
// compartida con POST /api/v1/revisiones/:id/secciones/introduccion/generar.
// Se borrará cuando ninguna versión publicada del frontend use esta ruta.
const { keywords } = require('../../ia/prompts/introduccion');

async function generateIntroductionKeywords(req, res) {
  res.json(await keywords(req.body));
}

module.exports = { generateIntroductionKeywords };
