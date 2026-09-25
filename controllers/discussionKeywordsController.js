// controllers/discussionKeywordsController.js
const { callOpenAI } = require('../services/openaiService');
const { extractKeywordsLocal, parseKeywordList, toBoundedText } = require('../utils/keywords');

async function discussionKeywordsController(req, res) {
  const { reflexion_inicial, referencias, n, ...otrasSecciones } = req.body;
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
  res.json({ keywords });
}

module.exports = { discussionKeywordsController };
