// legacy/controllers/objectivesController.js
// El prompt vive en ia/prompts/planificacion.js (lo comparte con POST /api/v1/revisiones/:id/ia/objetivo).
const P = require('../../ia/prompts/planificacion');

async function generateObjective(req, res) {
  res.json({ objective: await P.objetivo(req.body) });
}

module.exports = { generateObjective };
