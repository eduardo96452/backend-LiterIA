// legacy/controllers/searchStringController.js
// El prompt vive en ia/prompts/planificacion.js (lo comparte con POST /api/v1/revisiones/:id/ia/cadena).
const P = require('../../ia/prompts/planificacion');

async function generateSearchString(req, res) {
  res.json({ searchString: await P.cadena(req.body) });
}

module.exports = { generateSearchString };
