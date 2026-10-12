// legacy/controllers/discussionController.js
// Ruta antigua: el navegador envía todo el contexto. La lógica vive en ia/prompts/discusion.js,
// compartida con POST /api/v1/revisiones/:id/secciones/discusion/generar.
// Se borrará cuando ninguna versión publicada del frontend use esta ruta.
const { texto } = require('../../ia/prompts/discusion');

async function generateDiscussion(req, res) {
  res.json(await texto(req.body));
}

module.exports = { generateDiscussion };
