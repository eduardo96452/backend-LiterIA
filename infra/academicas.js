// infra/academicas.js
// Búsqueda en las bases académicas para importar estudios (IEEE Xplore y Springer Nature) y
// consulta de un DOI en CrossRef (completar un estudio a mano y añadir referencias por DOI).
// Las dos bases piden clave propia: IEEE_API_KEY (developer.ieee.org) y SPRINGER_API_KEY
// (dev.springernature.com). Sin la clave, esa base responde 503 con un mensaje claro.
const axios = require('axios');
const env = require('../config/env');
const logger = require('../core/logger');
const { HttpError } = require('../core/httpError');

const http = axios.create({ timeout: 25_000, headers: { 'User-Agent': 'LiteriaBackend/3.11', Accept: 'application/json' } });

const limpiarDoi = d => d ? String(d).replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)/i, '').trim() || null : null;
// "Juan Pérez" -> "Pérez, Juan"  (formato que entiende fn_referencias_desde_estudios)
const apellidoPrimero = nombre => {
  const p = String(nombre || '').trim().split(/\s+/);
  return p.length > 1 ? `${p.pop()}, ${p.join(' ')}` : (p[0] || '');
};
const unirAutores = arr => arr.filter(Boolean).slice(0, 30).join('; ');
/** Quita etiquetas (IEEE y Springer devuelven a veces <inline-formula>, <i>…) y espacios de más. */
const sinHtml = t => t == null ? null
  : String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\s+([.,;:!?)\]])/g, '$1').replace(/([(\[])\s+/g, '$1').trim() || null;
const paginas = (ini, fin) => ini ? `${ini}${fin && String(fin) !== String(ini) ? '-' + fin : ''}` : null;

function exigirClave(nombre, variable) {
  if (!env[variable]) throw new HttpError(503, `${nombre} no está configurado en el servidor (falta ${variable}).`);
  return env[variable];
}

/* ---------- IEEE Xplore (Metadata Search API) ---------- */
// GET /api/v1/search/articles?apikey=&querytext=&max_records=(≤200)&start_record=(desde 1)&start_year=&end_year=
// Respuesta: { total_records, articles: [{ title, abstract, authors: { authors: [{ full_name, author_order }] }, … }] }
async function buscarIeee({ cadena, anioDesde, anioHasta, pagina, porPagina }) {
  const apikey = exigirClave('IEEE Xplore', 'IEEE_API_KEY');
  const params = {
    apikey, format: 'json', querytext: cadena,
    max_records: Math.min(porPagina, 200), start_record: (pagina - 1) * porPagina + 1
  };
  if (anioDesde) params.start_year = anioDesde;
  if (anioHasta) params.end_year = anioHasta;

  const { data } = await http.get('https://ieeexploreapi.ieee.org/api/v1/search/articles', { params });
  const items = (data?.articles || []).map(a => {
    const abierto = a.access_type ? /open/i.test(a.access_type) : null;
    const autores = [...(a.authors?.authors || [])].sort((x, y) => (x.author_order ?? 0) - (y.author_order ?? 0));
    const terminos = [...(a.index_terms?.author_terms?.terms || []), ...(a.index_terms?.ieee_terms?.terms || [])];
    return {
      id_externo: a.article_number ? String(a.article_number) : null,
      doi: limpiarDoi(a.doi),
      titulo: sinHtml(a.title),
      resumen: a.abstract ? sinHtml(a.abstract).slice(0, 5000) : null,
      autores: unirAutores(autores.map(x => apellidoPrimero(x.full_name))),
      anio: Number(a.publication_year) || null,
      revista: a.publication_title || null,
      volumen: a.volume || null,
      paginas: paginas(a.start_page, a.end_page),
      issn: a.issn || null,
      url: a.html_url || a.abstract_url || (a.doi ? `https://doi.org/${limpiarDoi(a.doi)}` : null),
      publisher: a.publisher || 'IEEE',
      document_type: a.content_type || null,
      keywords: [...new Set(terminos)].slice(0, 15).join(', ') || null,
      citas: a.citing_paper_count ?? null,
      acceso_abierto: abierto,
      url_pdf_externo: abierto && a.pdf_url ? a.pdf_url : null
    };
  });
  return { items, total: Number(data?.total_records) || items.length };
}

/* ---------- Springer Nature (Meta API v2) ---------- */
// GET /meta/v2/json?q=&api_key=&s=(desde 1)&p=
// Respuesta: { result: [{ total }], records: [{ title, abstract, creators: [{ creator }], doi, … }] }
// Se piden lotes de 25 (lo que admite cualquier plan) hasta completar la página de LiterIA.
const SPRINGER_LOTE = 25;

/** El resumen llega como texto o como { h1: 'Abstract', p: '…' | ['…'] }. */
function resumenSpringer(a) {
  if (!a) return null;
  if (typeof a === 'string') return sinHtml(a);
  const partes = [];
  const recorrer = v => {
    if (v == null) return;
    if (typeof v === 'string') partes.push(v);
    else if (Array.isArray(v)) v.forEach(recorrer);
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'h1') recorrer(x);
  };
  recorrer(a);
  return sinHtml(partes.join(' '));
}

function itemSpringer(r) {
  const urls = Array.isArray(r.url) ? r.url : [];
  const pdf = urls.find(u => /pdf/i.test(u.format || ''))?.value || null;
  const web = urls.find(u => !/pdf/i.test(u.format || ''))?.value || null;
  const doi = limpiarDoi(r.doi || (String(r.identifier || '').startsWith('doi:') ? r.identifier : null));
  const abierto = r.openaccess == null ? null : String(r.openaccess) === 'true';
  const anio = Number(String(r.publicationDate || r.coverDate || r.onlineDate || '').slice(0, 4)) || null;
  return {
    id_externo: r.identifier || null,
    doi,
    titulo: sinHtml(r.title),
    resumen: (resumenSpringer(r.abstract) || '').slice(0, 5000) || null,
    // Springer ya da «Apellido, Nombre»
    autores: unirAutores((r.creators || []).map(c => (typeof c === 'string' ? c : c?.creator) || null)),
    anio,
    revista: r.publicationName || null,
    volumen: r.volume || null,
    paginas: paginas(r.startingPage, r.endingPage),
    issn: r.issn || r.eIssn || r.isbn || r.electronicIsbn || null,
    url: web || (doi ? `https://doi.org/${doi}` : null),
    publisher: r.publisher || 'Springer Nature',
    language: r.language || null,
    document_type: r.contentType || r.publicationType || null,
    keywords: (Array.isArray(r.keyword) ? r.keyword : []).filter(Boolean).slice(0, 15).join(', ') || null,
    citas: null,
    acceso_abierto: abierto,
    url_pdf_externo: abierto && pdf ? pdf : null
  };
}

async function loteSpringer(apiKey, q, s, p) {
  const { data } = await http.get('https://api.springernature.com/meta/v2/json', { params: { q, api_key: apiKey, s, p } });
  return { records: Array.isArray(data?.records) ? data.records : [], total: Number(data?.result?.[0]?.total) || 0 };
}

async function buscarSpringer({ cadena, anioDesde, anioHasta, pagina, porPagina }) {
  const apiKey = exigirClave('Springer Nature', 'SPRINGER_API_KEY');
  const filtros = [];
  if (anioDesde) filtros.push(`datefrom:${anioDesde}-01-01`);
  if (anioHasta) filtros.push(`dateto:${anioHasta}-12-31`);
  let q = filtros.length ? `(${cadena}) AND ${filtros.join(' AND ')}` : cadena;
  let filtrarAqui = false;

  const inicio = (pagina - 1) * porPagina + 1;
  const registros = [];
  let total = 0;
  while (registros.length < porPagina) {
    const p = Math.min(SPRINGER_LOTE, porPagina - registros.length);
    let r;
    try {
      r = await loteSpringer(apiKey, q, inicio + registros.length, p);
    } catch (e) {
      // Si el plan no admite el filtro de fechas, se repite sin él y se filtra aquí
      const st = e.response?.status;
      if (filtros.length && !filtrarAqui && (st === 400 || st === 403) && !registros.length) {
        logger.warn('springer_sin_filtro_fechas', { status: st });
        q = cadena;
        filtrarAqui = true;
        continue;
      }
      throw e;
    }
    total = r.total;
    registros.push(...r.records);
    if (r.records.length < p) break;
  }

  let items = registros.map(itemSpringer);
  if (filtrarAqui) items = items.filter(i => (!anioDesde || (i.anio && i.anio >= anioDesde)) && (!anioHasta || (i.anio && i.anio <= anioHasta)));
  return { items, total: total || items.length };
}

/** Bases en las que se puede buscar e importar. La clave es la que guarda la importación (origen). */
const FUENTES = { ieee: buscarIeee, springer: buscarSpringer };
const NOMBRES_FUENTE = { ieee: 'IEEE Xplore', springer: 'Springer Nature' };

/* ---------- CrossRef: datos de un DOI ---------- */
const crossref = axios.create({
  baseURL: 'https://api.crossref.org', timeout: 15_000,
  headers: { 'User-Agent': `LiteriaBackend/3.11${env.CROSSREF_MAILTO ? ` (mailto:${env.CROSSREF_MAILTO})` : ''}` }
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

module.exports = {
  FUENTES, NOMBRES_FUENTE, buscarIeee, buscarSpringer, consultarDoi, limpiarDoi,
  _http: http, _internos: { itemSpringer, resumenSpringer, sinHtml }
};
