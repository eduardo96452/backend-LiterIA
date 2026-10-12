// legacy/controllers/dataExtractionController.js
// El prompt vive en ia/prompts/planificacion.js (lo comparte con POST /api/v1/revisiones/:id/ia/campos-extraccion).
const P = require('../../ia/prompts/planificacion');

async function generateDataExtractionQuestions(req, res) {
  res.json({ questions: await P.camposExtraccion(req.body) });
}

module.exports = { generateDataExtractionQuestions };
