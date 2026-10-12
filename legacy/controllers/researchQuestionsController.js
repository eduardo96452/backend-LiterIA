// legacy/controllers/researchQuestionsController.js
// El prompt vive en ia/prompts/planificacion.js (lo comparte con POST /api/v1/revisiones/:id/ia/preguntas).
const P = require('../../ia/prompts/planificacion');

async function generateResearchQuestions(req, res) {
  res.json({ questions: await P.preguntas(req.body) });
}

module.exports = { generateResearchQuestions };
