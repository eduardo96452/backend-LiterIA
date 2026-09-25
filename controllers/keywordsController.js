// controllers/keywordsController.js
const { callOpenAI } = require('../services/openaiService');
const { parseAiJson } = require('../utils/aiJson');

async function generateKeywords(req, res) {
  const { methodologyData } = req.body;
  const methodologyJSON = JSON.stringify(methodologyData, null, 2);

  const prompt = `
Eres un experto en terminología científica y metodología de investigación. Dada la siguiente metodología en formato JSON, extrae palabras clave significativas de cada sección y asigna la etiqueta correspondiente según la siguiente convención:
- Para SPICE: "Escenario", "Perspectiva", "Intervención", "Comparación", "Evidencia".
- Para PICO: "Población", "Intervención", "Comparación", "Resultado".
- Para PICOC: "Población", "Intervención", "Comparación", "Resultado", "Contexto".
- Para PICOTT: "Población", "Intervención", "Comparación", "Resultado", "Tipo de pregunta", "Tipo de artículo".

Para cada palabra clave genera de 2 a 5 sinónimos relevantes e incluye el campo "siglas" con un número según esta numeración global:
- PICO: Población → 1, Intervención → 2, Comparación → 3, Resultado → 4
- PICOC: Población → 5, Intervención → 6, Comparación → 7, Resultado → 8, Contexto → 9
- PICOTT: Población → 10, Intervención → 11, Comparación → 12, Resultado → 13, Tipo de pregunta → 14, Tipo de artículo → 15
- SPICE: Escenario → 16, Perspectiva → 17, Intervención → 18, Comparación → 19, Evidencia → 20

Devuelve estrictamente un JSON con esta forma:
{ "keywords": [ { "palabra_clave": "...", "metodologia": "...", "sinonimos": ["..."], "siglas": 1 } ] }
No incluyas texto adicional.

Metodología:
${methodologyJSON}`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en terminología científica. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 3000, json: true });

  const parsed = parseAiJson(raw);
  const keywords = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.keywords) ? parsed.keywords : []);
  res.json({ keywords });
}

module.exports = { generateKeywords };
