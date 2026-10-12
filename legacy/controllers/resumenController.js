// legacy/controllers/resumenController.js
// Ruta antigua: el navegador envía todo el contexto. La lógica vive en ia/prompts/resumen.js,
// compartida con POST /api/v1/revisiones/:id/secciones/resumen/generar.
// Se borrará cuando ninguna versión publicada del frontend use esta ruta.
const { texto } = require('../../ia/prompts/resumen');

async function generateResumen(req, res) {
  res.json(await texto(req.body));
}

module.exports = { generateResumen };
