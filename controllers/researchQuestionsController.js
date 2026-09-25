// controllers/researchQuestionsController.js
const { callOpenAI } = require('../services/openaiService');
const { parseAiJson } = require('../utils/aiJson');

async function generateResearchQuestions(req, res) {
  const { title, objective, methodology, numQuestions = 3, tipoInvestigacion } = req.body;
  const investigationPart = tipoInvestigacion ? `y considerando que la investigación es de tipo "${tipoInvestigacion}" ` : '';

  const prompt = `
Eres un asistente experto en investigación académica.
Con base en la metodología "${methodology}", el título "${title}" y el objetivo "${objective}" ${investigationPart}
genera ${numQuestions} preguntas de investigación en formato JSON.
Ejemplo de salida:
{ "questions": ["¿Cómo ha evolucionado el uso de la inteligencia artificial en la detección de enfermedades?", "Pregunta 2..."] }
Devuelve únicamente el JSON sin ningún texto adicional.`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en investigación académica. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 1500, json: true });

  const parsed = parseAiJson(raw);
  const questions = Array.isArray(parsed.questions) ? parsed.questions.map(String).slice(0, numQuestions) : [];
  res.json({ questions });
}

module.exports = { generateResearchQuestions };
