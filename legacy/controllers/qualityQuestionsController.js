// legacy/controllers/qualityQuestionsController.js
// El prompt vive en ia/prompts/planificacion.js (lo comparte con POST /api/v1/revisiones/:id/ia/calidad).
const P = require('../../ia/prompts/planificacion');

async function generateQualityQuestions(req, res) {
  res.json({ quality_questions: await P.calidad(req.body) });
}

module.exports = { generateQualityQuestions };
