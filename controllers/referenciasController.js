// controllers/referenciasController.js  (Tanda B, mejora 11)
// Verifica referencias contra CrossRef por DOI y registra el resultado con fn_verificar_referencia.
const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');
const { forUser, rpc, fromSupabaseError } = require('../services/supabaseService');
const { HttpError } = require('../utils/httpError');

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

/** POST /api/referencias/verificar  { id_detalles_revision, ids_referencias?: [], solo_pendientes?: true } */
async function verificar(req, res) {
  const { id_detalles_revision, ids_referencias, solo_pendientes } = req.body;
  const sb = forUser(req.token);

  let q = sb.from('referencias').select('id_referencia, doi, verificada')
    .eq('id_detalles_revision', id_detalles_revision).not('doi', 'is', null).neq('doi', '');
  if (ids_referencias?.length) q = q.in('id_referencia', ids_referencias);
  if (solo_pendientes) q = q.in('verificada', ['pendiente', 'no_encontrada']);
  const { data: refs, error } = await q.limit(200);
  if (error) throw fromSupabaseError(error);

  const resultados = [];
  for (const r of refs || []) {
    const item = await consultarDoi(r.doi);
    const out = await rpc(sb, 'fn_verificar_referencia', { p_id_ref: r.id_referencia, p_datos_crossref: item || {} });
    resultados.push({ id_referencia: r.id_referencia, doi: r.doi, ...out });
    await new Promise(t => setTimeout(t, 120)); // cortesía con CrossRef
  }
  const estado = await rpc(sb, 'fn_estado_referencias', { p_id_rev: id_detalles_revision });
  res.json({ verificadas: resultados.length, resultados, estado });
}

/** GET /api/referencias/doi/:doi  → metadatos de un DOI (para autocompletar una referencia manual) */
async function porDoi(req, res) {
  const item = await consultarDoi(req.params.doi);
  if (!item) throw new HttpError(404, 'DOI no encontrado en CrossRef.');
  res.json({
    doi: item.DOI, titulo: item.title?.[0], anio: item.issued?.['date-parts']?.[0]?.[0] ?? null,
    revista: item['container-title']?.[0] || null, volumen: item.volume || null, numero: item.issue || null,
    paginas: item.page || null, editorial: item.publisher || null, issn: item.ISSN?.[0] || null,
    tipo: item.type === 'journal-article' ? 'article' : item.type === 'book' ? 'book' : item.type === 'book-chapter' ? 'chapter' : item.type === 'proceedings-article' ? 'conference' : 'other',
    autores: (item.author || []).map(a => ({ apellido: a.family || a.name || '', nombre: a.given || '' }))
  });
}

module.exports = { verificar, porDoi };
