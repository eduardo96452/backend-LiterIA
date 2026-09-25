// controllers/resumenController.js
const { callOpenAI } = require('../services/openaiService');
const { parseAiJson } = require('../utils/aiJson');
const { toBoundedText } = require('../utils/keywords');

async function generateResumen(req, res) {
  const { title, objective, methodology, results_summary, discussion_summary, conclusions, word_count } = req.body;

  const prompt = `
Genera en español un Resumen (abstract) académico de aproximadamente ${word_count} palabras a partir de:

Título:
${title}

Objetivo:
${objective}

Metodología:
${toBoundedText(methodology, 10000)}

Resumen de resultados:
${toBoundedText(results_summary, 20000)}

Resumen de discusión:
${toBoundedText(discussion_summary, 10000)}

Conclusiones:
${conclusions}

Instrucciones:
- Un único párrafo fluido y académico, sin encabezados.
- Devuelve estrictamente este JSON: { "resumen": "…texto generado…" }`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en redacción de abstracts científicos. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: Math.min(4000, word_count * 4), json: true });

  const parsed = parseAiJson(raw);
  res.json({ resumen: typeof parsed.resumen === 'string' ? parsed.resumen : '' });
}

module.exports = { generateResumen };
