// controllers/introductionController.js
const { callOpenAI } = require('../services/openaiService');
const { searchBilingual, formatAPA7, cleanAbstract } = require('../services/crossrefService');
const { parseAiJson } = require('../utils/aiJson');
const { toBoundedText } = require('../utils/keywords');

async function generateIntroduction(req, res) {
  const {
    title, description, objective, methodology, results_summary,
    discussion_summary, conclusions, keywords, research_questions
  } = req.body;

  // Referencias reales (CrossRef). Si el servicio falla, se continúa sin referencias.
  const { items } = keywords ? await searchBilingual(keywords, { rows: 5, limit: 5 }) : { items: [] };
  const formattedRefs = items.map(formatAPA7);
  const refsPrompt = formattedRefs.map((r, i) => `[${i + 1}] ${r}`).join('\n\n') || '(sin referencias disponibles)';
  const abstractsPrompt = items.map((it, i) => `[${i + 1}] ${cleanAbstract(it)}`).join('\n\n') || '(sin abstracts)';

  const prompt = `
Genera exactamente este JSON:
{ "introduction": "<texto>" }

Organiza la introducción en secciones (sin escribir los subtítulos en el texto):
- Contexto: 2–3 párrafos sobre el tema, con referencias donde corresponda.
- Problema: 1 párrafo con el problema específico del estudio.
- Objetivo: 1 párrafo.
- Justificación: 1 párrafo.
- Preguntas de investigación: 1 párrafo.
- Metodología: 1 párrafo.
- Resultados: 1 párrafo.
- Discusión: 1 párrafo.
- Conclusiones: 1 párrafo.

Para citar usa: Apellido (Año) [n], donde n es la posición en la lista de referencias. Cita solo referencias de la lista.

Concluir con:
"Este documento se organizó de la siguiente manera: en la sección 2 se abordó los trabajos relacionados, en la sección 3 se presentó la metodología, en la sección 4 se establecieron los resultados, en la sección 5 se desarrolló la discusión, en la sección 6 se describieron las limitaciones y en la sección 7 se detallaron las conclusiones."

Referencias (APA7):
${refsPrompt}

Abstracts:
${abstractsPrompt}

Datos:
- Título: ${title}
- Descripción: ${description}
- Objetivo: ${objective}
- Metodología: ${toBoundedText(methodology, 8000)}
- Resultados: ${toBoundedText(results_summary, 8000)}
- Discusión: ${discussion_summary.join(' ')}
- Conclusiones: ${conclusions}
- Keywords: ${keywords}
- Preguntas de investigación: ${research_questions.join(', ')}`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Redactor académico experto en introducciones. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 6000, json: true });

  const parsed = parseAiJson(raw);
  res.json({
    introduction: typeof parsed.introduction === 'string' ? parsed.introduction : '',
    references: formattedRefs
  });
}

module.exports = { generateIntroduction };
