// controllers/qualityQuestionsController.js
const { callOpenAI } = require('../services/openaiService');
const { parseAiJson } = require('../utils/aiJson');

async function generateQualityQuestions(req, res) {
  const { title, objective } = req.body;
  const prompt = `
Eres un experto en metodología de investigación y evaluación crítica de estudios.
Con base en:
- Título: ${title}
- Objetivo: ${objective}

Genera preguntas de evaluación de calidad para determinar si un estudio debe ser aceptado en una revisión sistemática.
Deben abordar: diseño metodológico, relevancia, validez de resultados, claridad del reporte y riesgo de sesgo.
Devuelve estrictamente este JSON: { "quality_questions": ["Pregunta 1", "Pregunta 2"] }
Sin texto adicional.`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en revisión sistemática. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 1500, json: true });

  const parsed = parseAiJson(raw);
  res.json({ quality_questions: Array.isArray(parsed.quality_questions) ? parsed.quality_questions.map(String) : [] });
}

module.exports = { generateQualityQuestions };
