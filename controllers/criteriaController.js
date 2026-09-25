// controllers/criteriaController.js
const { callOpenAI } = require('../services/openaiService');
const { parseAiJson } = require('../utils/aiJson');

async function generateCriteria(req, res) {
  const { title, objective } = req.body;
  const prompt = `
Eres un experto en revisiones sistemáticas de literatura.
Basado en el siguiente estudio:
- Título: ${title}
- Objetivo: ${objective}

Genera criterios de inclusión y exclusión. Devuelve estrictamente este JSON:
{ "criterios": [ { "criterio": "Texto del criterio 1", "categoria": "incluido" }, { "criterio": "Texto del criterio 2", "categoria": "excluido" } ] }
Usa lenguaje académico, claro y directo. Sin explicaciones adicionales.`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en metodología científica. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 1500, json: true });

  const parsed = parseAiJson(raw);
  // Compatibilidad: el frontend esperaba un arreglo plano
  const criterios = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.criterios) ? parsed.criterios : []);
  res.json(criterios);
}

module.exports = { generateCriteria };
