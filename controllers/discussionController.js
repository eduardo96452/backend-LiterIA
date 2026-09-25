// controllers/discussionController.js
const { callOpenAI } = require('../services/openaiService');
const { searchBilingual, formatAPA7, cleanAbstract } = require('../services/crossrefService');
const { parseAiJson } = require('../utils/aiJson');
const { toBoundedText } = require('../utils/keywords');

async function generateDiscussion(req, res) {
  const { reflexion_inicial, referencias: _refsCliente, keywords, ...rest } = req.body;

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
  res.json({
    discusion: typeof parsed.discusion === 'string' ? parsed.discusion : '',
    referencias: formattedRefs.map(r => `${r}<br><br>`)
  });
}

module.exports = { generateDiscussion };
