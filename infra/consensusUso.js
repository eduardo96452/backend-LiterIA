// infra/consensusUso.js
// La API de Consensus no dice cuántas búsquedas quedan: LiterIA las cuenta. Cada búsqueda se apunta
// en consensus_uso con la HUELLA de la clave (sha256, 16 caracteres; nunca la clave) y, cuando
// Consensus avisa de que una clave agotó el mes, la rechaza o tiene la facturación pendiente, se
// guarda en consensus_claves para que el panel lo muestre y para recordarlo tras un reinicio.
//
// Todo va con service_role y sin esperar: si falla, se anota en el registro y la búsqueda sigue.
// Sin sql/016 (faltan las tablas) se avisa una vez y se deja de intentar hasta reiniciar.
const crypto = require('crypto');
const logger = require('../core/logger');
const sb = require('./supabase');
const { getContext } = require('../core/requestContext');

const huella = clave => crypto.createHash('sha256').update(String(clave)).digest('hex').slice(0, 16);

/** Primer día del mes en UTC (Consensus renueva el día 1), como AAAA-MM-DD. */
function mesISO(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/** Lo que cobra Consensus: 1 llamada por cada 100 artículos devueltos, mínimo 1 por búsqueda. */
const llamadasDe = resultados => Math.max(1, Math.ceil((Number(resultados) || 0) / 100));

let sinTablas = false;
const faltaTabla = error => Boolean(error) && (error.code === '42P01' || error.code === 'PGRST205'
  || /relation .* does not exist|could not find the table/i.test(error.message || ''));
const disponible = () => !sinTablas && sb.adminDisponible();

async function escribir(accion, fn) {
  if (!disponible()) return;
  try {
    const { error } = await fn(sb.admin());
    if (faltaTabla(error)) {
      sinTablas = true;
      logger.warn('consensus_uso_sin_tablas', { accion, nota: 'Ejecuta sql/016_admin_consensus.sql para contar las búsquedas.' });
    } else if (error) {
      logger.warn('consensus_uso_error', { accion, message: error.message });
    }
  } catch (e) {
    logger.warn('consensus_uso_error', { accion, message: e.message });
  }
}

/**
 * Apunta una búsqueda (sin esperar). Una respuesta de la caché no gasta; una que falla, tampoco.
 * @returns {number} las llamadas que cobra Consensus por ella
 */
function registrarBusqueda({ clave = null, resultados = 0, estado = 200, ms = null, desdeCache = false } = {}) {
  const ctx = getContext();
  const llamadas = desdeCache || estado !== 200 ? 0 : llamadasDe(resultados);
  escribir('busqueda', db => db.from('consensus_uso').insert({
    clave: clave ? huella(clave) : null,
    id_usuarios: ctx?.userId || null,
    endpoint: ctx?.endpoint ? String(ctx.endpoint).slice(0, 200) : null,
    resultados: Number(resultados) || 0,
    llamadas,
    estado: Number(estado) || 0,
    ms: ms == null ? null : Math.round(ms),
    desde_cache: Boolean(desdeCache)
  }));
  return llamadas;
}

/** Consensus agotó, rechazó o no cobró una clave: se guarda el motivo (y, si se agotó, el mes). */
function marcarClave(clave, { status, msg, agotada = false }) {
  const fila = {
    clave: huella(clave),
    ultimo_error_estado: Number(status) || 0,
    ultimo_error: String(msg || '').slice(0, 300),
    ultimo_error_fecha: new Date().toISOString()
  };
  if (agotada) fila.agotada_mes = mesISO();
  escribir('marcar_clave', db => db.from('consensus_claves').upsert(fila, { onConflict: 'clave' }));
}

/** Huellas de las claves que Consensus dio por agotadas este mes (para no volver a probarlas tras un reinicio). */
async function agotadasEsteMes(claves) {
  if (!claves.length || !disponible()) return new Set();
  try {
    const { data, error } = await sb.admin().from('consensus_claves').select('clave')
      .in('clave', claves.map(huella)).eq('agotada_mes', mesISO());
    if (faltaTabla(error)) { sinTablas = true; return new Set(); }
    if (error) return new Set();
    return new Set((data || []).map(r => r.clave));
  } catch {
    return new Set();
  }
}

/** Solo para las pruebas. */
function _reiniciar() { sinTablas = false; }

module.exports = { huella, mesISO, llamadasDe, registrarBusqueda, marcarClave, agotadasEsteMes, _reiniciar };
