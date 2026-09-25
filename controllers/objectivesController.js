// controllers/objectivesController.js
const { callOpenAI } = require('../services/openaiService');

async function generateObjective(req, res) {
  const { title, methodology, description, alcance, pais, ciudad, area_conocimiento, tipo_investigacion, institucion } = req.body;

  const optional = [
    alcance && `- Alcance: ${alcance}`,
    pais && `- País: ${pais}`,
    ciudad && `- Ciudad: ${ciudad}`,
    area_conocimiento && `- Área de Conocimiento: ${area_conocimiento}`,
    tipo_investigacion && `- Tipo de Investigación: ${tipo_investigacion}`,
    institucion && `- Institución: ${institucion}`
  ].filter(Boolean);
  const extraSection = optional.length ? `\nInformación adicional:\n${optional.join('\n')}` : '';

  const prompt = `
1. Usa los siguientes datos para elaborar un objetivo en un solo enunciado de tono académico:
- Título de la revisión: ${title}
- Metodología de la revisión: ${methodology}
- Descripción breve: ${description}${extraSection}

2. El objetivo debe seguir la fórmula: (verbo en infinitivo) + (qué cosa) + (cómo) + (para qué)
3. No excedas las 30 palabras en tu respuesta final.
4. No uses enumeraciones, viñetas ni explicaciones adicionales; la frase debe ser fluida y concisa.
5. Redacta en estilo académico, sin listas ni puntos.`;

  const objective = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en investigación académica.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 200 });

  res.json({ objective });
}

module.exports = { generateObjective };
