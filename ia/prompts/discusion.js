// ia/prompts/discusion.js
// Generación con IA de la sección «Discusión». Recibe los datos ya validados (con los
// esquemas de legacy/schemas.js) y devuelve el objeto que antes respondía el controlador.
// La usan la ruta antigua /api/generate-* y la nueva /api/v1/revisiones/:id/secciones/:seccion/generar.
const { callOpenAI } = require('../../infra/openai');
const { extractKeywordsLocal, parseKeywordList, toBoundedText } = require('../keywords');
const { searchBilingual, formatAPA7, cleanAbstract } = require('../../infra/crossref');
const { parseAiJson } = require('../aiJson');

async function keywords(datos) {
  const { reflexion_inicial, referencias, n, ...otrasSecciones } = datos;
  const partes = [
    ...reflexion_inicial,
    ...referencias,
    ...Object.values(otrasSecciones).flatMap(v => Array.isArray(v) ? v.map(String) : [toBoundedText(v, 3000)])
  ];
  const combinedText = toBoundedText(partes.join(' '), 20000);

  let keywords;
  try {
    const aiResp = await callOpenAI([
      { role: 'system', content: 'Eres un asistente que extrae palabras clave. Responde solo con la lista separada por comas.' },
      { role: 'user', content: `Extrae las ${n} palabras clave más representativas, separadas por comas, del siguiente texto:\n"${combinedText}"` }
    ], { maxTokens: 300 });
    keywords = parseKeywordList(aiResp, n);
  } catch {
    keywords = extractKeywordsLocal(combinedText, n);
  }
  return ({ keywords });
}

async function texto(datos) {
  const { reflexion_inicial, referencias: _refsCliente, keywords, ...rest } = datos;

  const resultadosArr = Object.values(rest).flatMap(v => Array.isArray(v) ? v.map(String) : [toBoundedText(v, 3000)]);
  const combinedText = toBoundedText([...reflexion_inicial, ...resultadosArr].join(' '), 30000);

  const { items } = await searchBilingual(keywords, { rows: 5, limit: 2 });
  const formattedRefs = items.map(formatAPA7);
  const refsForPrompt = formattedRefs.map((r, i) => `[${i + 1}] ${r}`).join('<br><br>') || '(sin referencias disponibles)';
  const abstractsForPrompt = items.map(it => cleanAbstract(it)).join('<br><br>') || '(sin abstracts)';

  const prompt = `
Eres un asistente experto en redacción académica.
Genera la sección de Discusión de un artículo científico basada en estos resultados:
"${combinedText}"

Contrasta estos resultados con hallazgos reales usando referencias numeradas:<br><br>
${refsForPrompt}

Basa el contraste en los abstracts:<br><br>
${abstractsForPrompt}

- Usa citas en formato APA (Autor, año). Cita solo las referencias listadas.
- Redacta 2-3 párrafos académicos.

Respuesta JSON:
{ "discusion": "<2-3 párrafos separados por <br><br>>" }`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Redactor académico contrastando resultados. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 4000, json: true });

  const parsed = parseAiJson(raw);
  return ({
    discusion: typeof parsed.discusion === 'string' ? parsed.discusion : '',
    referencias: formattedRefs.map(r => `${r}<br><br>`)
  });
}

module.exports = { keywords, texto };
