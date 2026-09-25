// controllers/trabajosRelacionadosController.js
const { callOpenAI } = require('../services/openaiService');
const { searchBilingual, formatAPA7, cleanAbstract, firstSurnames } = require('../services/crossrefService');
const { parseAiJson } = require('../utils/aiJson');
const { HttpError } = require('../utils/httpError');

function relevanceScore(text, keywords) {
  return keywords.toLowerCase().split(/\s+/).filter(Boolean)
    .reduce((score, kw) => score + (text.includes(kw) ? 1 : 0), 0);
}

async function generateTrabajosRelacionados(req, res) {
  const { title, keywords, criterios_seleccion, description } = req.body;

  // 1) Referencias reales con abstract, puntuadas por coincidencia de keywords
  const { items, keywordsEn } = await searchBilingual(keywords, { rows: 10, limit: 20, requireAbstract: true });
  const bestRefs = items
    .map(item => {
      const text = [...(item.title || []), cleanAbstract(item, 5000)].join(' ').toLowerCase();
      return { item, score: relevanceScore(text, `${keywords} ${keywordsEn}`) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(r => r.item);

  if (!bestRefs.length) {
    throw new HttpError(502, 'No se encontraron referencias en CrossRef para esas palabras clave.');
  }

  const formattedRefs = bestRefs.map(formatAPA7);
  const refsForPrompt = formattedRefs.map((r, i) => `[${i + 1}] ${r}`).join('\n');
  const authorListForPrompt = bestRefs.map((it, i) => `[${i + 1}]: ${firstSurnames(it).join(' y ')}`).join('\n');
  const abstractsForPrompt = bestRefs.map((it, i) => `[${i + 1}] ${cleanAbstract(it)}`).join('\n\n');

  // 2) Prompt
  const prompt = `
Genera exactamente este JSON:
{ "trabajos_relacionados": "<texto en al menos 5 párrafos>" }

Reglas estrictas para citas en el texto:
- Usa solo el primer apellido de cada autor.
- Formato de cita: Apellido1 y Apellido2 (Año) [n].
- Cita únicamente las referencias listadas.
- Tono académico-formal, párrafos de máximo 4-5 oraciones; concluye con una breve reflexión sobre la importancia de estas referencias.

Referencias disponibles:
${refsForPrompt}

Autores por referencia:
${authorListForPrompt}

Basa el contenido en los abstracts:
${abstractsForPrompt}

Datos del artículo:
Título: ${title}
Palabras clave: ${keywords}
Criterios de selección: ${criterios_seleccion}
Descripción: ${description}`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Redactor académico que usa solo las referencias proporcionadas. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 6000, json: true });

  const parsed = parseAiJson(raw); // ya no se devuelve "raw" al cliente en caso de fallo
  res.json({
    trabajos_relacionados: typeof parsed.trabajos_relacionados === 'string' ? parsed.trabajos_relacionados : '',
    references: formattedRefs.map((r, i) => `[${i + 1}] ${r}`)
  });
}

module.exports = { generateTrabajosRelacionados };
