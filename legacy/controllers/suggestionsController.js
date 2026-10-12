// legacy/controllers/suggestionsController.js
// El prompt vive en ia/prompts/extraccion.js (lo comparte con POST /api/v1/…/extraccion/sugerir).
const { downloadPdf, extractText } = require('../../infra/pdf');
const P = require('../../ia/prompts/extraccion');

async function generateExtractionSuggestions(req, res) {
  const { url, title, questions } = req.body;

  const buf = await downloadPdf(url);
  const { fullText } = await extractText(buf);
  P.exigirQueConcuerde(title, fullText);   // 412 si el PDF no es el del artículo

  const respuestas = await P.sugerencias({ title, fullText, questions });
  res.json({ suggestions: respuestas.map(answer => ({ answer })) });
}

module.exports = { generateExtractionSuggestions };
