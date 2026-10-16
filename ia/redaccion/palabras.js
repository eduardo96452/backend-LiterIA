// ia/redaccion/palabras.js
// Paso «palabras clave» de Trabajos relacionados, Introducción y Discusión: términos para buscar
// fuentes externas en CrossRef. Se piden en inglés (la mayor parte de lo indexado está en inglés)
// y centrados en los conceptos de la revisión, no palabras sueltas del texto.
const { callOpenAI } = require('../../infra/openai');
const { extractKeywordsLocal, parseKeywordList } = require('../keywords');
const { corta } = require('./comun');

const PROPOSITO = {
  trabajos: 'encontrar revisiones de la literatura y estudios previos sobre el mismo tema que la revisión (para la sección «Trabajos relacionados»)',
  introduccion: 'encontrar literatura que explique el contexto, la importancia y el problema que motivan la revisión (para la «Introducción»)',
  discusion: 'encontrar estudios y revisiones con los que contrastar los hallazgos principales de la revisión (para la «Discusión»)'
};

/** Devuelve { keywords: 'term 1, term 2, …' } (6 a 8 términos). */
async function terminos(proposito, textoBase, n = 8) {
  const prompt = [
    `Necesito términos de búsqueda para ${PROPOSITO[proposito]}.`,
    '',
    'Reglas:',
    `- Devuelve entre 6 y ${n} términos en inglés, separados por comas, sin numerar, sin comillas y sin explicación.`,
    '- Cada término es un concepto del tema (1 a 4 palabras), como los que se usan en una base de datos académica: «large language models», «formative assessment».',
    '- Incluye los conceptos centrales de la revisión y sus sinónimos más usados; nada de palabras genéricas («study», «analysis», «impact», «review»).',
    '',
    'Revisión:',
    corta(textoBase, 12000)
  ].join('\n');
  try {
    const resp = await callOpenAI([
      { role: 'system', content: 'Eres documentalista experto en búsquedas bibliográficas. Respondes solo con la lista de términos separados por comas.' },
      { role: 'user', content: prompt }
    ], { maxTokens: 300, temperature: 0.2 });
    const lista = parseKeywordList(resp, n);
    return { keywords: lista || extractKeywordsLocal(textoBase, n) };
  } catch {
    return { keywords: extractKeywordsLocal(textoBase, n) };
  }
}

module.exports = { terminos, PROPOSITO };
