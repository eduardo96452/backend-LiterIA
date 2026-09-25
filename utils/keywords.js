// utils/keywords.js  (antes duplicado en 3 controladores)
const STOPWORDS = new Set([
  'que','de','la','el','y','en','los','se','con','para','del','las','por','a','su','lo','un','una','es','al','como',
  'the','and','of','in','on','for','with','to','an','is','are','be','by','this','that'
]);

function extractKeywordsLocal(text, n = 8) {
  return Array.from(new Set(
    String(text).toLowerCase()
      .replace(/[\d.,;:"“”()¿?¡!]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 4 && !STOPWORDS.has(w))
  )).slice(0, n).join(', ');
}

// Normaliza la lista "a, b, c" devuelta por el modelo
function parseKeywordList(aiResp, n) {
  return String(aiResp)
    .replace(/["\r\n]/g, '')
    .split(',')
    .map(w => w.trim())
    .filter(Boolean)
    .slice(0, n)
    .join(', ');
}

// Convierte cualquier valor a texto acotado para incluirlo en un prompt
function toBoundedText(value, max = 20_000) {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return s.length > max ? s.slice(0, max) + ' …[truncado]' : s;
}

module.exports = { STOPWORDS, extractKeywordsLocal, parseKeywordList, toBoundedText };
