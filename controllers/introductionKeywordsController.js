// controllers/introductionKeywordsController.js
const { callOpenAI } = require('../services/openaiService');
const { extractKeywordsLocal, parseKeywordList, toBoundedText } = require('../utils/keywords');

async function generateIntroductionKeywords(req, res) {
  const { title, description, objective, methodology, results_summary, discussion_summary, conclusions, research_questions } = req.body;
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
  res.json({ keywords });
}

module.exports = { generateIntroductionKeywords };
