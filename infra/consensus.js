// infra/consensus.js
// Cliente de la API de Consensus (https://api.consensus.app, GET /v1/search): búsqueda de artículos
// revisados por pares con su resumen, la conclusión principal («takeaway») y, en los planes de pago,
// fragmentos del texto completo. Lo usa la redacción del artículo para encontrar fuentes reales.
//
// - La clave va en CONSENSUS_API_KEY (Render). Admite VARIAS, separadas por comas, que se usan en
//   orden: cuando una agota las búsquedas del mes (429), Consensus la rechaza (401) o tiene la
//   facturación pendiente (402), se pasa a la siguiente y esa no se vuelve a probar hasta pasadas
//   unas horas. Si no queda ninguna, o sin clave, la redacción sigue con CrossRef.
// - Límite de la API: 1 petición por segundo. Aquí las peticiones se ponen en fila.
// - Cada búsqueda gasta llamadas del plan (1 por cada 100 artículos devueltos): las respuestas se
//   guardan en memoria unas horas para no repetir la misma búsqueda al regenerar una sección.
// - La API no dice cuántas búsquedas quedan: cada una se apunta en consensus_uso (infra/consensusUso)
//   y el panel de administración lo resume por clave. Una clave que Consensus dio por agotada este
//   mes se recuerda en la base, así que tras un reinicio no se vuelve a probar hasta pasadas las horas.
const axios = require('axios');
const env = require('../config/env');
const logger = require('../core/logger');
const { HttpError } = require('../core/httpError');
const uso = require('./consensusUso');

const BASE = 'https://api.consensus.app';
/**
 * intervaloMs: un poco más de 1 s entre peticiones (en las pruebas, sin espera).
 * reintentoMs: cuánto se deja de usar una clave agotada o rechazada antes de volver a probarla.
 */
const ajustes = { intervaloMs: env.NODE_ENV === 'test' ? 0 : 1100, reintentoMs: 12 * 60 * 60 * 1000 };
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_MAX = 200;

const http = axios.create({ baseURL: BASE, timeout: 30_000 });
const cache = new Map();
let fila = Promise.resolve();
let ultima = 0;
/** Formato de study_types que acepta la API: repetido (study_types=a&study_types=b) o separado por comas. */
let tiposSeparadosPorComas = false;
/** Lo guardado en la base (claves agotadas este mes) se lee una vez, en la primera búsqueda. */
let guardadoCargado = null;
/**
 * Estado de cada clave, en memoria (se reinicia al reiniciar el servidor):
 *   hasta            hasta cuándo no se usa (agotada o rechazada)
 *   motivo           { status, msg } de Consensus, para explicarlo si no queda ninguna
 *   sinTextoCompleto su plan no incluye fragmentos de texto completo (403 feature_not_allowed)
 */
const estados = new Map();

/** Las claves, en el orden en que se usan. */
const claves = () => String(env.CONSENSUS_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
function estado(clave) {
  if (!estados.has(clave)) estados.set(clave, { hasta: 0, motivo: null, sinTextoCompleto: false });
  return estados.get(clave);
}
/** La primera clave que se puede usar ahora, o null. */
const claveDisponible = () => claves().find(k => estado(k).hasta <= Date.now()) || null;
/** «2 de 3»: para el registro, que nunca lleva la clave. */
const cual = clave => `${claves().indexOf(clave) + 1} de ${claves().length}`;

const activo = () => claves().length > 0;

/** Al arrancar, las claves que Consensus ya dio por agotadas este mes se apartan como si acabara de decirlo. */
function cargarGuardado() {
  if (!guardadoCargado) {
    const lista = claves();
    guardadoCargado = uso.agotadasEsteMes(lista).then(agotadas => {
      for (const k of lista) {
        const st = estado(k);
        if (agotadas.has(uso.huella(k)) && st.hasta <= Date.now()) {
          st.hasta = Date.now() + ajustes.reintentoMs;
          st.motivo = { status: 429, msg: 'You have used all included searches' };
        }
      }
    }).catch(() => {});
  }
  return guardadoCargado;
}
const textoCompletoPedido = () => Boolean(env.CONSENSUS_TEXTO_COMPLETO);
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
  if (hit && hit.exp > Date.now()) {
    uso.registrarBusqueda({ desdeCache: true, resultados: hit.valor.results.length });
    return hit.valor;
  }
  await cargarGuardado();

  const valor = await enFila(() => pedir(params));
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(clave, { valor, exp: Date.now() + CACHE_TTL_MS });
  return valor;
}

async function pedir(params, intento = 0, clave = claveDisponible()) {
  if (!clave) throw errorSinClaves();
  const st = estado(clave);
  let p = params;
  if (st.sinTextoCompleto && p.include_full_text_chunks) {
    const { include_full_text_chunks: _quitado, ...resto } = p;
    p = resto;
  }
  const t0 = Date.now();
  try {
    const { data } = await http.get(`/v1/search?${queryString(p)}`, {
      headers: { 'x-api-key': clave, Accept: 'application/json' }
    });
    const results = Array.isArray(data?.results) ? data.results : [];
    uso.registrarBusqueda({ clave, resultados: results.length, estado: 200, ms: Date.now() - t0 });
    return { results, page_size: data?.page_size ?? null, consulta: p.query };
  } catch (e) {
    const status = e.response?.status;
    const msg = mensajeDe(e);
    logger.warn('consensus_error', { status, code: codigoDe(e), message: msg, clave: cual(clave) });
    uso.registrarBusqueda({ clave, estado: status || 0, ms: Date.now() - t0 });

    // El plan de esta clave no incluye fragmentos de texto completo: se repite sin ellos y no se vuelven a pedir con ella
    if (status === 403 && p.include_full_text_chunks && intento < 2) {
      st.sinTextoCompleto = true;
      return pedir(params, intento + 1, clave);
    }
    // Formato de las listas: si la API no acepta study_types repetido, se prueba separado por comas
    if (status === 422 && Array.isArray(p.study_types) && !tiposSeparadosPorComas && intento < 2) {
      tiposSeparadosPorComas = true;
      return pedir(params, intento + 1, clave);
    }
    const cupoAgotado = status === 429 && /included|used all/i.test(msg);
    // Más de 1 petición por segundo: se espera lo que diga retry-after (máx. 5 s) y se repite una vez
    if (status === 429 && !cupoAgotado && intento < 1) {
      const segundos = Math.min(5, Number(e.response?.headers?.['retry-after']) || 1);
      await espera(segundos * 1000);
      return pedir(params, intento + 1, clave);
    }
    // Esta clave no sirve por ahora (búsquedas del mes agotadas, rechazada o facturación pendiente):
    // se aparta unas horas y se sigue con la siguiente
    if (cupoAgotado || status === 401 || status === 402) {
      st.hasta = Date.now() + ajustes.reintentoMs;
      st.motivo = { status, msg };
      uso.marcarClave(clave, { status, msg, agotada: cupoAgotado });
      logger.warn('consensus_clave_apartada', { clave: cual(clave), status, hasta: new Date(st.hasta).toISOString() });
      const otra = claveDisponible();
      if (otra) return pedir(params, 0, otra);
      throw errorSinClaves();
    }
    throw traducirError(status, msg);
  }
}

/** No queda ninguna clave: con una sola, su motivo de siempre; con varias, el de todas. */
function errorSinClaves() {
  const lista = claves();
  const motivos = lista.map(k => estado(k).motivo).filter(Boolean);
  if (lista.length === 1) return motivos[0] ? traducirError(motivos[0].status, motivos[0].msg) : new HttpError(503, 'Consensus no está disponible por ahora.');
  if (motivos.length === lista.length && motivos.every(m => m.status === 429)) {
    return new HttpError(429, `Se agotaron las búsquedas de Consensus de este mes en las ${lista.length} claves (se renuevan el día 1).`);
  }
  return new HttpError(502, `Ninguna de las ${lista.length} claves de Consensus está disponible ahora (agotadas o rechazadas): revisa CONSENSUS_API_KEY en el servidor.`);
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

/**
 * Para el panel de administración: cada clave en su orden, con su huella y sus 4 últimos caracteres
 * (para reconocerla en el panel de Consensus). Nunca la clave entera.
 */
function estadoClaves() {
  const ahora = Date.now();
  return claves().map((k, i) => {
    const st = estado(k);
    const apartada = st.hasta > ahora;
    return {
      huella: uso.huella(k),
      posicion: i + 1,
      final: k.length > 12 ? k.slice(-4) : null,
      apartada_hasta: apartada ? new Date(st.hasta).toISOString() : null,
      motivo: apartada && st.motivo ? { status: st.motivo.status, msg: st.motivo.msg } : null,
      sin_texto_completo: st.sinTextoCompleto
    };
  });
}

/** El administrador avisa de que una clave vuelve a servir (p. ej., activó el uso adicional): se prueba ya. */
function reactivar(h) {
  const k = claves().find(c => uso.huella(c) === h);
  if (!k) return false;
  const st = estado(k);
  st.hasta = 0;
  st.motivo = null;
  return true;
}

/** Solo para las pruebas: vacía la caché, la fila y lo aprendido de la API. */
function _reiniciar() {
  cache.clear();
  fila = Promise.resolve();
  ultima = 0;
  tiposSeparadosPorComas = false;
  estados.clear();
  guardadoCargado = null;
}

module.exports = { buscar, activo, queryString, estadoClaves, reactivar, _reiniciar, _http: http, ajustes };
