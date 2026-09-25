// services/crossrefService.js
// Centraliza lo que antes estaba duplicado en introduction, discussion y trabajosRelacionados.
const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');
const { callOpenAI } = require('./openaiService');

const client = axios.create({
  baseURL: 'https://api.crossref.org',
  timeout: 15_000,
  headers: {
    'User-Agent': `LiteriaBackend/2.0${env.CROSSREF_MAILTO ? ` (mailto:${env.CROSSREF_MAILTO})` : ''}`
  }
});

// Caché en memoria con TTL (mismas keywords se repiten entre secciones)
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) { cache.delete(key); return null; }
  return hit.value;
}
function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { value, exp: Date.now() + CACHE_TTL_MS });
}

/** Busca artículos en CrossRef. Nunca lanza: ante error devuelve []. */
async function searchWorks(query, rows = 5) {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) return [];
  const key = `${rows}:${q.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  try {
    const { data } = await client.get('/works', {
      params: { query: q, rows, filter: 'type:journal-article', sort: 'relevance', select: 'DOI,title,author,issued,container-title,volume,issue,page,abstract' }
    });
    const items = Array.isArray(data?.message?.items) ? data.message.items : [];
    cacheSet(key, items);
    return items;
  } catch (err) {
    logger.warn('crossref_error', { message: err.message, status: err.response?.status });
    return [];
  }
}

function getYear(item) {
  const parts = item?.issued?.['date-parts']?.[0] || item?.['published-print']?.['date-parts']?.[0]
    || item?.['published-online']?.['date-parts']?.[0];
  return parts?.[0] ?? 's.f.';
}

function authorsApa(item) {
  const list = Array.isArray(item?.author) ? item.author : [];
  return list
    .map(a => {
      const family = a?.family || a?.name || '';
      const initial = a?.given ? `${a.given.trim()[0]}.` : '';
      return [family, initial].filter(Boolean).join(', ');
    })
    .filter(Boolean)
    .join('; ') || 'Autor desconocido';
}

/** Formatea un ítem CrossRef a APA 7 sin romperse ante campos faltantes. */
function formatAPA7(item) {
  const year = getYear(item);
  const title = item?.title?.[0] || 'Sin título';
  const journal = item?.['container-title']?.[0] || '';
  const volume = item?.volume ? `, ${item.volume}` : '';
  const issue = item?.issue ? `(${item.issue})` : '';
  const pages = item?.page ? `, ${item.page}` : '';
  const doi = item?.DOI ? ` https://doi.org/${item.DOI}` : '';
  return `${authorsApa(item)} (${year}). ${title}. *${journal}*${volume}${issue}${pages}.${doi}`;
}

function cleanAbstract(item, max = 2500) {
  const raw = (item?.abstract || 'No abstract available').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return raw.length > max ? raw.slice(0, max) + '…' : raw;
}

function firstSurnames(item) {
  return (item?.author || []).map(a => (a?.family || a?.name || '').split(' ')[0]).filter(Boolean);
}

/** Traduce keywords al inglés con IA; si falla devuelve el original. */
async function translateKeywords(keywordsEs) {
  const key = `tr:${String(keywordsEs).toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  try {
    const out = await callOpenAI([
      { role: 'system', content: 'Traduce palabras clave al inglés. Responde solo con las palabras separadas por espacios.' },
      { role: 'user', content: `Traduce estas keywords al inglés separadas por espacios: "${keywordsEs}"` }
    ], { temperature: 0.1, maxTokens: 200 });
    const t = out.replace(/["\r\n]/g, '').trim() || keywordsEs;
    cacheSet(key, t);
    return t;
  } catch {
    return keywordsEs;
  }
}

/** Busca en español e inglés, deduplica por DOI y devuelve hasta `limit`. */
async function searchBilingual(keywordsEs, { rows = 5, limit = 5, requireAbstract = false } = {}) {
  const keywordsEn = await translateKeywords(keywordsEs);
  const [es, en] = await Promise.all([searchWorks(keywordsEs, rows), searchWorks(keywordsEn, rows)]);
  const seen = new Set();
  const out = [];
  for (const item of [...es, ...en]) {
    if (!item?.DOI || seen.has(item.DOI)) continue;
    if (!item.title?.length) continue;
    if (requireAbstract && !item.abstract) continue;
    seen.add(item.DOI);
    out.push(item);
    if (out.length >= limit) break;
  }
  return { items: out, keywordsEn };
}

module.exports = { searchWorks, searchBilingual, translateKeywords, formatAPA7, cleanAbstract, firstSurnames };
