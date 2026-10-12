// legacy/controllers/trabajosRelacionadosController.js
// Ruta antigua: el navegador envía todo el contexto. La lógica vive en ia/prompts/trabajos.js,
// compartida con POST /api/v1/revisiones/:id/secciones/trabajos_relacionados/generar.
// Se borrará cuando ninguna versión publicada del frontend use esta ruta.
const { texto } = require('../../ia/prompts/trabajos');

async function generateTrabajosRelacionados(req, res) {
  res.json(await texto(req.body));
}

module.exports = { generateTrabajosRelacionados };
