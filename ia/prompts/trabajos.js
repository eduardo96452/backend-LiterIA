// ia/prompts/trabajos.js
// Generación con IA de la sección «Trabajos relacionados». Recibe los datos ya validados (con los
// esquemas de legacy/schemas.js) y devuelve el objeto que antes respondía el controlador.
// La usan la ruta antigua /api/generate-* y la nueva /api/v1/revisiones/:id/secciones/:seccion/generar.
const { callOpenAI } = require('../../infra/openai');
const { extractKeywordsLocal, parseKeywordList } = require('../keywords');
const { searchBilingual, formatAPA7, cleanAbstract, firstSurnames } = require('../../infra/crossref');
const { parseAiJson } = require('../aiJson');
const { HttpError } = require('../../core/httpError');

async function keywords(datos) {
  const { text, n } = datos;
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
  return ({ keywords });
}

function relevanceScore(text, keywords) {
  return keywords.toLowerCase().split(/\s+/).filter(Boolean)
    .reduce((score, kw) => score + (text.includes(kw) ? 1 : 0), 0);
}

async function texto(datos) {
  const { title, keywords, criterios_seleccion, description } = datos;

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
  return ({
    trabajos_relacionados: typeof parsed.trabajos_relacionados === 'string' ? parsed.trabajos_relacionados : '',
    references: formattedRefs.map((r, i) => `[${i + 1}] ${r}`)
  });
}

module.exports = { keywords, texto };
