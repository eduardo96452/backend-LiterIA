// legacy/controllers/resultadosController.js
// Ruta antigua: el navegador envía todo el contexto. La lógica vive en ia/prompts/resultados.js,
// compartida con POST /api/v1/revisiones/:id/secciones/resultados/generar.
// Se borrará cuando ninguna versión publicada del frontend use esta ruta.
const { texto } = require('../../ia/prompts/resultados');

async function generateResultados(req, res) {
  res.json(await texto(req.body));
}

module.exports = { generateResultados };
