// infra/academicas.js
// Consultas a las bases académicas abiertas (OpenAlex, Semantic Scholar, CrossRef).
// Movido sin cambios desde legacy/controllers/importacionController.js y referenciasController.js
// para que lo usen tanto las rutas antiguas (/api/importar, /api/referencias) como /api/v1.
const axios = require('axios');
const env = require('../config/env');
const logger = require('../core/logger');
const { HttpError } = require('../core/httpError');

const http = axios.create({ timeout: 25_000, headers: { 'User-Agent': `LiteriaBackend/3.0${env.OPENALEX_MAILTO ? ` (mailto:${env.OPENALEX_MAILTO})` : ''}` } });

const limpiarDoi = d => d ? String(d).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim() : null;
// "Juan Pérez" -> "Pérez, Juan"  (formato que entiende fn_referencias_desde_estudios)
const apellidoPrimero = nombre => {
  const p = String(nombre || '').trim().split(/\s+/);
  return p.length > 1 ? `${p.pop()}, ${p.join(' ')}` : (p[0] || '');
};
const unirAutores = arr => arr.filter(Boolean).slice(0, 30).join('; ');

/* ---------- OpenAlex ---------- */
function abstractOpenAlex(inv) {
  if (!inv) return null;
  const words = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.join(' ').replace(/\s+/g, ' ').trim().slice(0, 5000) || null;
}
async function buscarOpenAlex({ cadena, anioDesde, anioHasta, tipo, idioma, pagina, porPagina }) {
  const filtros = [];
  if (anioDesde) filtros.push(`from_publication_date:${anioDesde}-01-01`);
  if (anioHasta) filtros.push(`to_publication_date:${anioHasta}-12-31`);
  if (tipo) filtros.push(`type:${tipo}`);
  if (idioma) filtros.push(`language:${idioma}`);
  const params = { search: cadena, page: pagina, 'per-page': porPagina, sort: 'relevance_score:desc' };
  if (filtros.length) params.filter = filtros.join(',');
  if (env.OPENALEX_MAILTO) params.mailto = env.OPENALEX_MAILTO;

  const { data } = await http.get('https://api.openalex.org/works', { params });
  const items = (data?.results || []).map(w => ({
    id_externo: (w.id || '').replace('https://openalex.org/', ''),
    doi: limpiarDoi(w.doi),
    titulo: w.title || w.display_name,
    resumen: abstractOpenAlex(w.abstract_inverted_index),
    autores: unirAutores((w.authorships || []).map(a => apellidoPrimero(a.author?.display_name))),
    anio: w.publication_year,
    revista: w.primary_location?.source?.display_name || null,
    volumen: w.biblio?.volume || null,
    paginas: w.biblio?.first_page ? `${w.biblio.first_page}${w.biblio.last_page ? '-' + w.biblio.last_page : ''}` : null,
    issn: w.primary_location?.source?.issn_l || null,
    url: w.primary_location?.landing_page_url || w.id,
    publisher: w.primary_location?.source?.host_organization_name || null,
    language: w.language || null,
    document_type: w.type || null,
    keywords: (w.keywords || []).map(k => k.display_name || k.keyword).filter(Boolean).slice(0, 15).join(', ') || null,
    citas: w.cited_by_count ?? null,
    acceso_abierto: w.open_access?.is_oa ?? null,
    url_pdf_externo: w.open_access?.oa_url || w.primary_location?.pdf_url || null
  }));
  return { items, total: data?.meta?.count ?? items.length };
}

/* ---------- Semantic Scholar ---------- */
async function buscarSemanticScholar({ cadena, anioDesde, anioHasta, pagina, porPagina }) {
  const headers = env.SEMANTIC_SCHOLAR_API_KEY ? { 'x-api-key': env.SEMANTIC_SCHOLAR_API_KEY } : {};
  const params = {
    query: cadena, offset: (pagina - 1) * porPagina, limit: porPagina,
    fields: 'externalIds,title,abstract,authors,year,venue,journal,citationCount,isOpenAccess,openAccessPdf,publicationTypes,url'
  };
  if (anioDesde || anioHasta) params.year = `${anioDesde || ''}-${anioHasta || ''}`;
  const { data } = await http.get('https://api.semanticscholar.org/graph/v1/paper/search', { params, headers });
  const items = (data?.data || []).map(p => ({
    id_externo: p.paperId,
    doi: limpiarDoi(p.externalIds?.DOI),
    titulo: p.title,
    resumen: p.abstract ? p.abstract.slice(0, 5000) : null,
    autores: unirAutores((p.authors || []).map(a => apellidoPrimero(a.name))),
    anio: p.year,
    revista: p.journal?.name || p.venue || null,
    volumen: p.journal?.volume || null,
    paginas: p.journal?.pages || null,
    url: p.url,
    document_type: (p.publicationTypes || [])[0] || null,
    citas: p.citationCount ?? null,
    acceso_abierto: p.isOpenAccess ?? null,
    url_pdf_externo: p.openAccessPdf?.url || null
  }));
  return { items, total: data?.total ?? items.length };
}

/* ---------- CrossRef ---------- */
async function buscarCrossref({ cadena, anioDesde, anioHasta, tipo, pagina, porPagina }) {
  const filtros = [`type:${tipo || 'journal-article'}`];
  if (anioDesde) filtros.push(`from-pub-date:${anioDesde}`);
  if (anioHasta) filtros.push(`until-pub-date:${anioHasta}`);
  const params = { query: cadena, rows: porPagina, offset: (pagina - 1) * porPagina, filter: filtros.join(','), sort: 'relevance',
    select: 'DOI,title,author,issued,container-title,volume,issue,page,abstract,ISSN,URL,publisher,language,type,is-referenced-by-count' };
  if (env.CROSSREF_MAILTO) params.mailto = env.CROSSREF_MAILTO;
  const { data } = await http.get('https://api.crossref.org/works', { params });
  const items = (data?.message?.items || []).map(w => ({
    doi: limpiarDoi(w.DOI),
    titulo: w.title?.[0],
    resumen: w.abstract ? w.abstract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000) : null,
    autores: unirAutores((w.author || []).map(a => a.family ? `${a.family}, ${a.given || ''}`.replace(/, $/, '') : a.name)),
    anio: w.issued?.['date-parts']?.[0]?.[0] ?? null,
    revista: w['container-title']?.[0] || null,
    volumen: w.volume || null,
    paginas: w.page || null,
    issn: w.ISSN?.[0] || null,
    url: w.URL || null,
    publisher: w.publisher || null,
    language: w.language || null,
    document_type: w.type || null,
    citas: w['is-referenced-by-count'] ?? null
  }));
  return { items, total: data?.message?.['total-results'] ?? items.length };
}

const FUENTES = { openalex: buscarOpenAlex, semantic_scholar: buscarSemanticScholar, crossref: buscarCrossref };

const crossref = axios.create({
  baseURL: 'https://api.crossref.org', timeout: 15_000,
  headers: { 'User-Agent': `LiteriaBackend/3.0${env.CROSSREF_MAILTO ? ` (mailto:${env.CROSSREF_MAILTO})` : ''}` }
});

async function consultarDoi(doi) {
  try {
    const { data } = await crossref.get(`/works/${encodeURIComponent(doi)}`);
    return data?.message || null;
  } catch (e) {
    if (e.response?.status === 404) return null;
    logger.warn('crossref_doi_error', { doi, status: e.response?.status, message: e.message });
    throw new HttpError(502, 'CrossRef no respondió; intente más tarde.');
  }
}

module.exports = { FUENTES, buscarOpenAlex, buscarSemanticScholar, buscarCrossref, consultarDoi, limpiarDoi };
