// infra/consensus.js
// Cliente de la API de Consensus (https://api.consensus.app, GET /v1/search): búsqueda de artículos
// revisados por pares con su resumen, la conclusión principal («takeaway») y, en los planes de pago,
// fragmentos del texto completo. Lo usa la redacción del artículo para encontrar fuentes reales.
//
// - La clave va en CONSENSUS_API_KEY (Render). Sin ella, la redacción sigue con CrossRef.
// - Límite de la API: 1 petición por segundo. Aquí las peticiones se ponen en fila.
// - Cada búsqueda gasta llamadas del plan (1 por cada 100 artículos devueltos): las respuestas se
//   guardan en memoria unas horas para no repetir la misma búsqueda al regenerar una sección.
const axios = require('axios');
const env = require('../config/env');
const logger = require('../core/logger');
const { HttpError } = require('../core/httpError');

const BASE = 'https://api.consensus.app';
/** Un poco más de 1 s entre peticiones (en las pruebas, sin espera). */
const ajustes = { intervaloMs: env.NODE_ENV === 'test' ? 0 : 1100 };
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_MAX = 200;

const http = axios.create({ baseURL: BASE, timeout: 30_000 });
const cache = new Map();
let fila = Promise.resolve();
let ultima = 0;
/** Formato de study_types que acepta la API: repetido (study_types=a&study_types=b) o separado por comas. */
let tiposSeparadosPorComas = false;
/** El plan no incluye fragmentos de texto completo (403 feature_not_allowed): no se vuelven a pedir. */
let sinTextoCompleto = false;

const activo = () => Boolean(String(env.CONSENSUS_API_KEY || '').trim());
const textoCompletoPedido = () => Boolean(env.CONSENSUS_TEXTO_COMPLETO) && !sinTextoCompleto;
const espera = ms => new Promise(r => setTimeout(r, env.NODE_ENV === 'test' ? Math.min(ms, 20) : ms));

/** Pone la petición en fila para respetar el límite de 1 por segundo. */
function enFila(fn) {
  const turno = fila.then(async () => {
    const falta = ultima + ajustes.intervaloMs - Date.now();
    if (falta > 0) await espera(falta);
    try {
      return await fn();
    } finally {
      ultima = Date.now();
    }
  });
  fila = turno.catch(() => {});
  return turno;
}

/** Parámetros → query string. Las listas van repetidas o separadas por comas (según lo que acepte la API). */
function queryString(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      if (tiposSeparadosPorComas) q.append(k, v.join(','));
      else v.forEach(x => q.append(k, String(x)));
    } else {
      q.append(k, String(v));
    }
  }
  return q.toString();
}

const mensajeDe = e => {
  const d = e.response?.data;
  return String(d?.detail?.message || d?.detail || d?.message || d?.error || e.message || '').slice(0, 300);
};
const codigoDe = e => String(e.response?.data?.detail?.code || e.response?.data?.code || '');

/**
 * Busca artículos. Devuelve { results: [...], page_size, consulta } con los campos de la API
 * (title, authors, doi, journal_name, publish_year, abstract, takeaway, study_type, citation_count,
 * sjr_best_quartile, full_text_chunks, url…). Lanza HttpError con un motivo claro si falla.
 *
 * @param query   texto de la búsqueda (pregunta o afirmación, en inglés)
 * @param filtros study_types, year_min, year_max, exclude_preprints, open_access, page_size, domain…
 */
async function buscar(query, filtros = {}) {
  if (!activo()) throw new HttpError(503, 'Consensus no está configurado (falta CONSENSUS_API_KEY).');
  const consulta = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!consulta) return { results: [], page_size: 0, consulta };

  const params = {
    query: consulta,
    page_size: env.CONSENSUS_PAGE_SIZE,
    exclude_preprints: true,
    include_semantic_score: true,
    ...filtros
  };
  if (textoCompletoPedido()) params.include_full_text_chunks = true;

  const clave = JSON.stringify(Object.entries(params).sort());
  const hit = cache.get(clave);
  if (hit && hit.exp > Date.now()) return hit.valor;

  const valor = await enFila(() => pedir(params));
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(clave, { valor, exp: Date.now() + CACHE_TTL_MS });
  return valor;
}

async function pedir(params, intento = 0) {
  try {
    const { data } = await http.get(`/v1/search?${queryString(params)}`, {
      headers: { 'x-api-key': String(env.CONSENSUS_API_KEY).trim(), Accept: 'application/json' }
    });
    return { results: Array.isArray(data?.results) ? data.results : [], page_size: data?.page_size ?? null, consulta: params.query };
  } catch (e) {
    const status = e.response?.status;
    const msg = mensajeDe(e);
    logger.warn('consensus_error', { status, code: codigoDe(e), message: msg });

    // El plan no incluye fragmentos de texto completo: se repite sin ellos y no se vuelven a pedir
    if (status === 403 && params.include_full_text_chunks && intento < 2) {
      sinTextoCompleto = true;
      const { include_full_text_chunks: _quitado, ...resto } = params;
      return pedir(resto, intento + 1);
    }
    // Formato de las listas: si la API no acepta study_types repetido, se prueba separado por comas
    if (status === 422 && Array.isArray(params.study_types) && !tiposSeparadosPorComas && intento < 2) {
      tiposSeparadosPorComas = true;
      return pedir(params, intento + 1);
    }
    // Más de 1 petición por segundo: se espera lo que diga retry-after (máx. 5 s) y se repite una vez
    if (status === 429 && !/included|used all/i.test(msg) && intento < 1) {
      const segundos = Math.min(5, Number(e.response?.headers?.['retry-after']) || 1);
      await espera(segundos * 1000);
      return pedir(params, intento + 1);
    }
    throw traducirError(status, msg);
  }
}

function traducirError(status, msg) {
  if (status === 401) return new HttpError(502, 'Consensus rechazó la clave: revisa CONSENSUS_API_KEY en el servidor.');
  if (status === 402) return new HttpError(502, 'Consensus: la facturación de la cuenta está pendiente.');
  if (status === 403) return new HttpError(502, 'Consensus no permite esta búsqueda con el plan contratado.');
  if (status === 429) {
    return /included|used all/i.test(msg)
      ? new HttpError(429, 'Se agotaron las búsquedas de Consensus de este mes (se renuevan el día 1).')
      : new HttpError(429, 'Consensus recibió demasiadas búsquedas seguidas; inténtalo de nuevo en unos segundos.');
  }
  if (status === 422) return new HttpError(502, `Consensus no aceptó la búsqueda: ${msg || 'parámetros no válidos'}.`);
  return new HttpError(502, 'Consensus no respondió; inténtalo de nuevo en unos minutos.');
}

/** Solo para las pruebas: vacía la caché, la fila y lo aprendido de la API. */
function _reiniciar() {
  cache.clear();
  fila = Promise.resolve();
  ultima = 0;
  tiposSeparadosPorComas = false;
  sinTextoCompleto = false;
}

module.exports = { buscar, activo, queryString, _reiniciar, _http: http, ajustes };
