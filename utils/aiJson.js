// utils/aiJson.js
const { HttpError } = require('./httpError');

// Extrae y parsea el JSON de una respuesta del modelo (tolera ```json fences y texto alrededor).
function parseAiJson(raw) {
  if (typeof raw !== 'string') throw new HttpError(502, 'Respuesta de IA vacía.');
  const text = raw.replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(text); } catch (_) { /* seguir */ }

  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  const starts = [firstObj, firstArr].filter(i => i >= 0);
  if (!starts.length) throw new HttpError(502, 'La IA no devolvió un JSON válido.');
  const start = Math.min(...starts);
  const endChar = text[start] === '{' ? '}' : ']';
  const end = text.lastIndexOf(endChar);
  if (end <= start) throw new HttpError(502, 'La IA no devolvió un JSON válido.');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (_) {
    throw new HttpError(502, 'La IA devolvió un JSON mal formado.');
  }
}

module.exports = { parseAiJson };
