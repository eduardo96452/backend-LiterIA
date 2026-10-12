// legacy/controllers/metodologiaController.js
// Ruta antigua: el navegador envía todo el contexto. La lógica vive en ia/prompts/metodologia.js,
// compartida con POST /api/v1/revisiones/:id/secciones/metodologia/generar.
// Se borrará cuando ninguna versión publicada del frontend use esta ruta.
const { texto } = require('../../ia/prompts/metodologia');

async function generateMetodologia(req, res) {
  res.json(await texto(req.body));
}

module.exports = { generateMetodologia };
