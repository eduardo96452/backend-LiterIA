// controllers/dataExtractionController.js
const { callOpenAI } = require('../services/openaiService');
const { parseAiJson } = require('../utils/aiJson');

const TIPOS = new Set(['Booleano', 'Texto', 'Decimal', 'Entero', 'Fecha']);

async function generateDataExtractionQuestions(req, res) {
  const { title, objective, numberOfQuestions } = req.body;
  const prompt = `
Eres un experto en revisiones sistemáticas de literatura.
Basado en el siguiente estudio:
- Título: ${title}
- Objetivo: ${objective}

Genera ${numberOfQuestions} preguntas de extracción de datos. Devuelve estrictamente este JSON:
{ "questions": [ { "pregunta": "Texto de la pregunta", "tipo": "Booleano" } ] }
donde "tipo" es uno de: "Booleano", "Texto", "Decimal", "Entero", "Fecha". Sin texto adicional.`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en metodología científica. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 2000, json: true });

  const parsed = parseAiJson(raw);
  const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.questions) ? parsed.questions : []);
  const questions = list
    .filter(q => q && typeof q.pregunta === 'string')
    .map(q => ({ pregunta: q.pregunta, tipo: TIPOS.has(q.tipo) ? q.tipo : 'Texto' }))
    .slice(0, numberOfQuestions);
  res.json({ questions });
}

module.exports = { generateDataExtractionQuestions };
