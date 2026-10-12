// ia/prompts/conclusion.js
// Generación con IA de la sección «Conclusiones». Recibe los datos ya validados (con los
// esquemas de legacy/schemas.js) y devuelve el objeto que antes respondía el controlador.
// La usan la ruta antigua /api/generate-* y la nueva /api/v1/revisiones/:id/secciones/:seccion/generar.
const { callOpenAI } = require('../../infra/openai');
const { parseAiJson } = require('../aiJson');
const { toBoundedText } = require('../keywords');

async function texto(datos) {
  const { results_summary, discussion_summary, objective, research_questions } = datos;

  const prompt = `
Eres un asistente de redacción académica. Genera la sección de Conclusiones de un artículo de revisión sistemática de literatura usando estos datos:

• Objetivo de la revisión:
${objective}

• Resumen de resultados:
${toBoundedText(results_summary, 25000)}

• Resumen de la discusión:
${discussion_summary.join('\n\n')}

• Preguntas de investigación:
${research_questions.map(q => `- ${q}`).join('\n')}

Instrucciones:
1. Texto académico-formal, claro y conciso.
2. Empieza contestando directamente la(s) pregunta(s) de investigación.
3. Integra los hallazgos y cómo apoyan o matizan el objetivo.
4. Propón al final 2–3 sugerencias para futuras líneas de investigación.
5. Devuelve únicamente este JSON: { "conclusiones": "<2–3 párrafos separados por \\n\\n>" }`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en redacción académica. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 3000, json: true });

  const parsed = parseAiJson(raw);
  return ({ conclusiones: typeof parsed.conclusiones === 'string' ? parsed.conclusiones : '' });
}

module.exports = { texto };
