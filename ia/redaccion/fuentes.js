// ia/redaccion/fuentes.js
// Búsqueda de fuentes externas en CrossRef para Trabajos relacionados, Introducción y Discusión,
// con filtro de pertinencia. Antes se aceptaban las 5 primeras aunque solo coincidieran en una
// palabra suelta («memoria» → arqueología forense). Ahora una fuente entra solo si su título y su
// resumen tocan al menos dos de los conceptos de la cadena de búsqueda de la revisión (o el único
// concepto, si la cadena tiene uno), y si hay embeddings disponibles se ordenan por parecido con la
// revisión y se descartan las que se parecen poco.
const crossref = require('../../infra/crossref');
const { embed } = require('../../infra/openai');
const logger = require('../../core/logger');

const quitarAcentos = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PALABRAS_VACIAS = new Set(['and', 'or', 'not', 'the', 'of', 'in', 'for', 'a', 'an', 'to', 'y', 'o', 'de', 'la', 'el', 'en', 'los', 'las', 'del', 'para']);

/**
 * Cadena booleana → grupos de conceptos. «("a" OR b*) AND (c OR "d e")» → [["a","b*"],["c","d e"]].
 * Quita etiquetas de campo como TITLE-ABS-KEY( … ) o [Title/Abstract].
 */
function conceptosDeCadena(cadena) {
  let s = String(cadena || '')
    .replace(/\b(?!(?:AND|OR|NOT)\b)[A-Z][A-Z-]{2,}\s*\(/g, '(')   // TITLE-ABS-KEY(  ALL(  (no AND/OR/NOT)
    .replace(/\[[^\]]*\]/g, ' ')                       // [Title/Abstract]
    .replace(/\b(TS|TI|AB|AK)\s*=/g, ' ');
  // AND fuera de comillas
  const grupos = [];
  let actual = '', comillas = false;
  const tokens = s.split(/(")/);
  for (const tk of tokens) {
    if (tk === '"') { comillas = !comillas; actual += tk; continue; }
    if (comillas) { actual += tk; continue; }
    const partes = tk.split(/\bAND\b/i);
    actual += partes[0];
    for (const p of partes.slice(1)) { grupos.push(actual); actual = p; }
  }
  grupos.push(actual);
  return grupos.map(g => g.split(/\bOR\b/i)
    .map(t => t.replace(/[()"']/g, ' ').replace(/\bNOT\b.*$/i, '').replace(/\s+/g, ' ').trim())
    .filter(t => t && !PALABRAS_VACIAS.has(t.toLowerCase())))
    .filter(g => g.length);
}

/** Grupos desde las palabras clave de la planificación (PICOC): un grupo por componente. */
function conceptosDePalabrasClave(keywords) {
  const m = new Map();
  for (const k of keywords || []) {
    const c = String(k.componente || k.palabra || '').trim();
    if (!m.has(c)) m.set(c, []);
    m.get(c).push(...[k.palabra, ...(k.sinonimos || [])].filter(Boolean));
  }
  return [...m.values()].filter(g => g.length);
}

/** ¿El término aparece en el texto? Admite comodín final (learn* → learning, learners). */
function aparece(termino, textoNormalizado) {
  const t = quitarAcentos(termino).replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const comodin = t.endsWith('*');
  const base = t.replace(/\*+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^a-z0-9])${base}${comodin ? '[a-z0-9-]*' : ''}($|[^a-z0-9])`);
  return re.test(textoNormalizado);
}

/** Qué grupos de conceptos toca un texto (índices). */
function gruposQueCoinciden(grupos, texto) {
  const norm = ` ${quitarAcentos(texto).replace(/[^a-z0-9*\s-]/g, ' ').replace(/\s+/g, ' ')} `;
  return grupos.map((g, i) => (g.some(t => aparece(t, norm)) ? i : -1)).filter(i => i >= 0);
}

const resumenDe = item => String(item?.abstract || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const coseno = (a, b) => {
  let p = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { p += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? p / Math.sqrt(na * nb) : 0;
};

/**
 * Busca y filtra. Devuelve [{ item, relevancia (0-1), coincidencias: [grupos], resumen, consulta }].
 * @param consultas   textos de búsqueda (se buscan en español e inglés)
 * @param grupos      conceptos de la revisión (conceptosDeCadena / conceptosDePalabrasClave)
 * @param perfil      texto que describe la revisión (título, objetivo, preguntas), para los embeddings
 * @param excluirDois DOIs que no deben salir (los estudios incluidos, que se citan en Resultados)
 */
async function buscarFuentes({ consultas, grupos, perfil, excluirDois = [], limite = 8, filas = 15 }) {
  const fuera = new Set(excluirDois.map(d => String(d || '').toLowerCase()).filter(Boolean));
  const vistos = new Map();
  for (const consulta of consultas.filter(Boolean).slice(0, 3)) {
    const { items } = await crossref.searchBilingual(consulta, { rows: filas, limit: filas * 2 });
    for (const item of items || []) {
      const doi = String(item?.DOI || '').toLowerCase();
      if (!doi || fuera.has(doi) || vistos.has(doi) || !item?.title?.length) continue;
      vistos.set(doi, { item, consulta });
    }
  }

  const minimo = Math.min(2, grupos.length || 1);
  let candidatos = [...vistos.values()].map(({ item, consulta }) => {
    const resumen = resumenDe(item);
    const coincidencias = grupos.length ? gruposQueCoinciden(grupos, `${item.title?.[0] || ''} ${resumen}`) : [];
    return { item, consulta, resumen: resumen.slice(0, 1500), coincidencias, lexica: grupos.length ? coincidencias.length / grupos.length : 0.5 };
  }).filter(c => !grupos.length || c.coincidencias.length >= minimo);

  // Parecido semántico con la revisión (si falla la API de embeddings, se sigue sin él)
  let semantica = null;
  if (candidatos.length && perfil) {
    try {
      const vectores = await embed([perfil, ...candidatos.map(c => `${c.item.title?.[0] || ''}. ${c.resumen}`)]);
      if (vectores?.length === candidatos.length + 1) semantica = vectores.slice(1).map(v => coseno(vectores[0], v));
    } catch (e) {
      logger.warn('fuentes_embeddings_no_disponibles', { message: e.message });
    }
  }
  candidatos = candidatos.map((c, i) => {
    const sem = semantica ? semantica[i] : null;
    const relevancia = sem == null ? c.lexica : 0.6 * sem + 0.4 * c.lexica;
    return { ...c, semantica: sem, relevancia: Math.round(relevancia * 1000) / 1000 };
  }).filter(c => c.semantica == null || c.semantica >= 0.25);

  candidatos.sort((a, b) => (b.relevancia - a.relevancia) || ((b.resumen ? 1 : 0) - (a.resumen ? 1 : 0)));
  return candidatos.slice(0, limite).map(({ item, relevancia, coincidencias, resumen, consulta }) => ({ item, relevancia, coincidencias, resumen, consulta }));
}

module.exports = { buscarFuentes, conceptosDeCadena, conceptosDePalabrasClave, gruposQueCoinciden, aparece };
