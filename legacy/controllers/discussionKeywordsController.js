// legacy/controllers/discussionKeywordsController.js
// Ruta antigua: el navegador envía todo el contexto. La lógica vive en ia/prompts/discusion.js,
// compartida con POST /api/v1/revisiones/:id/secciones/discusion/generar.
// Se borrará cuando ninguna versión publicada del frontend use esta ruta.
const { keywords } = require('../../ia/prompts/discusion');

async function discussionKeywordsController(req, res) {
  res.json(await keywords(req.body));
}

module.exports = { discussionKeywordsController };
