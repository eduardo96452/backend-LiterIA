// legacy/controllers/criteriaController.js
// El prompt vive en ia/prompts/planificacion.js (lo comparte con POST /api/v1/revisiones/:id/ia/criterios).
const P = require('../../ia/prompts/planificacion');

async function generateCriteria(req, res) {
  // Compatibilidad: el frontend esperaba un arreglo plano
  res.json(await P.criterios(req.body));
}

module.exports = { generateCriteria };
