// ia/prompts/introduccion.js
// Generación con IA de la sección «Introducción». Recibe los datos ya validados (con los
// esquemas de legacy/schemas.js) y devuelve el objeto que antes respondía el controlador.
// La usan la ruta antigua /api/generate-* y la nueva /api/v1/revisiones/:id/secciones/:seccion/generar.
const { callOpenAI } = require('../../infra/openai');
const { extractKeywordsLocal, parseKeywordList, toBoundedText } = require('../keywords');
const { searchBilingual, formatAPA7, cleanAbstract } = require('../../infra/crossref');
const { parseAiJson } = require('../aiJson');

async function keywords(datos) {
  const { title, description, objective, methodology, results_summary, discussion_summary, conclusions, research_questions } = datos;
  const N = 10;
  const combinedText = toBoundedText([
    title, description, objective,
    toBoundedText(methodology, 5000), toBoundedText(results_summary, 5000),
    discussion_summary.join(' '), conclusions, research_questions.join(' ')
  ].join(' '), 20000);

  let keywords;
  try {
    const aiResp = await callOpenAI([
      { role: 'system', content: 'Eres un asistente que extrae palabras clave. Responde solo con la lista separada por comas.' },
      { role: 'user', content: `Extrae las ${N} palabras clave más representativas, separadas por comas, del siguiente texto:\n"${combinedText}"` }
    ], { maxTokens: 300 });
    keywords = parseKeywordList(aiResp, N);
  } catch {
    keywords = extractKeywordsLocal(combinedText, N);
  }
  return ({ keywords });
}

async function texto(datos) {
  const {
    title, description, objective, methodology, results_summary,
    discussion_summary, conclusions, keywords, research_questions
  } = datos;

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
  return ({
    introduction: typeof parsed.introduction === 'string' ? parsed.introduction : '',
    references: formattedRefs
  });
}

module.exports = { keywords, texto };
