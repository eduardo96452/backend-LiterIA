// controllers/searchStringController.js
const { callOpenAI } = require('../services/openaiService');

async function generateSearchString(req, res) {
  const { keywords, idioma } = req.body;

  const keywordsString = keywords
    .map(({ palabra_clave, sinonimos }) => {
      const terms = [palabra_clave, ...sinonimos].map(t => t.trim()).filter(Boolean).map(t => `"${t}"`).join(' OR ');
      return `(${terms})`;
    })
    .join(' AND ');

  const prompt = `
Utilizando únicamente la siguiente información, genera una cadena de búsqueda avanzada en formato booleano:
- Palabras clave y sinónimos: ${keywordsString}
- Idioma en que debe estar la cadena: ${idioma}

La cadena final NO debe incluir la mención explícita del idioma.
Cada término va entre comillas; usa "OR" para combinar sinónimos y "AND" para unir grupos.
Proporciona únicamente la cadena final sin explicaciones adicionales.`;

  const searchString = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en la generación de cadenas de búsqueda académicas.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 800 });

  res.json({ searchString });
}

module.exports = { generateSearchString };
