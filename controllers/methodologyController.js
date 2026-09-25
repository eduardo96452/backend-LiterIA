// controllers/methodologyController.js
const { callOpenAI } = require('../services/openaiService');
const { parseAiJson } = require('../utils/aiJson');
const { HttpError } = require('../utils/httpError');

const METHODOLOGIES = {
  PICO:   { picoP: 'Población', picoI: 'Intervención', picoC: 'Comparación', picoO: 'Outcome' },
  PICOC:  { picocP: 'Población', picocI: 'Intervención', picocC: 'Comparación', picocO: 'Outcome', picocContext: 'Contexto' },
  PICOTT: { picottP: 'Población', picottI: 'Intervención', picottC: 'Comparación', picottO: 'Outcome', picottT: 'Tipo de pregunta', picottT2: 'Tipo de estudio' },
  SPICE:  { spiceS: 'Setting', spiceP: 'Población', spiceI: 'Intervención', spiceC: 'Comparación', spiceE: 'Evaluación' }
};

async function generateMethodologyStructure(req, res) {
  const { methodology, title, objective } = req.body;
  const key = methodology.toUpperCase();
  const fields = METHODOLOGIES[key];
  if (!fields) throw new HttpError(400, 'Metodología no reconocida (PICO, PICOC, PICOTT, SPICE).');

  const prompt = `
Eres un asistente experto en metodología de investigación.
Con base en la metodología "${key}", el título "${title}" y el objetivo "${objective}",
devuelve exclusivamente un objeto JSON con EXACTAMENTE estas claves y un texto desarrollado en cada una:
${Object.entries(fields).map(([k, v]) => `- "${k}": ${v}`).join('\n')}

Ejemplo de formato (para PICO):
{"picoP": "Pacientes con diagnósticos convencionales", "picoI": "Aplicación de modelos de aprendizaje profundo", "picoC": "Resultados con métodos tradicionales", "picoO": "Medir la efectividad y precisión de la IA en el diagnóstico"}

No incluyas explicaciones ni texto adicional.`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en investigación académica. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 1000, json: true });

  const parsed = parseAiJson(raw);
  // Devolver solo las claves esperadas
  const out = {};
  for (const k of Object.keys(fields)) out[k] = typeof parsed[k] === 'string' ? parsed[k] : '';
  res.json(out);
}

module.exports = { generateMethodologyStructure };
