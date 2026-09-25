// controllers/trabaRelaKeywordsController.js
const { callOpenAI } = require('../services/openaiService');
const { extractKeywordsLocal, parseKeywordList } = require('../utils/keywords');

async function generatetrabaRelaKeywords(req, res) {
  const { text, n } = req.body;
  let keywords;
  try {
    const aiResp = await callOpenAI([
      { role: 'system', content: 'Eres un asistente que extrae palabras clave. Responde solo con la lista separada por comas.' },
      { role: 'user', content: `Extrae las ${n} palabras clave más representativas del siguiente texto, separadas por comas:\n\n"${text}"` }
    ], { maxTokens: 300 });
    keywords = parseKeywordList(aiResp, n);
  } catch {
    keywords = extractKeywordsLocal(text, n);
  }
  res.json({ keywords });
}

module.exports = { generatetrabaRelaKeywords };
