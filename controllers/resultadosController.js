// controllers/resultadosController.js
const { callOpenAI } = require('../services/openaiService');
const { parseAiJson } = require('../utils/aiJson');

function uniqueBy(arr, keyFn) {
  const seen = new Set();
  return arr.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
const pct = (n, total) => (total ? ((n / total) * 100).toFixed(1) : '0.0');

async function generateResultados(req, res) {
  const { studies_data, extraction_data } = req.body;

  // Totales (calculados en el servidor: la IA no debe inventar cifras)
  const total = studies_data.length;
  const count = s => studies_data.filter(x => String(x.status || '').toLowerCase() === s).length;
  const aceptados = count('aceptado'), rechazados = count('rechazado'), duplicados = count('duplicado');

  const reflexionInicial =
    `De un total de ${total} estudios, ${aceptados} fueron aceptados (${pct(aceptados, total)}%), ` +
    `${rechazados} rechazados (${pct(rechazados, total)}%) y ${duplicados} duplicados (${pct(duplicados, total)}%).\n\n` +
    `El propósito de esta sección es presentar los hallazgos sintéticos para cada pregunta de investigación, ` +
    `destacando patrones y discrepancias entre los artículos aceptados, para aportar claridad sobre la efectividad del tema investigado.\n\n` +
    `A continuación, se presenta un análisis detallado estructurado por cada pregunta específica.`;

  const preguntas = Array.from(new Set(extraction_data.map(r => r.pregunta)));
  const bloques = preguntas.map(pregunta => ({
    pregunta,
    respuestas: extraction_data.filter(r => r.pregunta === pregunta)
      .map(r => ({ autores: r.autores, anio: r.anio, respuesta: r.respuesta }))
  }));

  // Referencias enumeradas (construidas en el servidor, no por la IA)
  const referencias = uniqueBy(extraction_data, r => r.titulo).map((r, i) =>
    `[${i + 1}] ${r.autores} (${r.anio}). ${r.titulo}. ${r.revista}.${r.doi ? ` https://doi.org/${r.doi}` : ''}`
  );

  const prompt = `
Usa SOLO los siguientes datos para generar un JSON con esta forma exacta:
{
  "secciones": {
    "<pregunta 1>": ["<párrafo por cada respuesta>", "..."],
    "<pregunta 2>": ["..."]
  }
}

Reglas:
1. No inventes nada. Usa solo los datos proporcionados.
2. Para cada respuesta escribe un párrafo de 4–5 oraciones en tono académico-formal: primero describe brevemente el enfoque del artículo de Autores (Año) y luego presenta un detalle explícito basado en su respuesta.
3. Si las respuestas de varios autores son similares, puedes unirlas en un solo párrafo de 5–10 oraciones.
4. Usa exactamente los textos de las preguntas como claves. Devuelve únicamente JSON.

Datos:
${JSON.stringify(bloques, null, 1)}`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en redacción académica que no inventa datos. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 12000, json: true });

  const parsed = parseAiJson(raw);
  const secciones = parsed.secciones && typeof parsed.secciones === 'object' ? parsed.secciones : parsed;

  // Misma forma de respuesta que antes: reflexion_inicial, <pregunta>: [...], referencias
  const out = { reflexion_inicial: reflexionInicial };
  for (const p of preguntas) {
    const v = secciones[p];
    out[p] = Array.isArray(v) ? v.map(String) : (typeof v === 'string' ? [v] : []);
  }
  out.referencias = referencias;
  res.json(out);
}

module.exports = { generateResultados };
