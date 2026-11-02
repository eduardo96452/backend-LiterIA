// modules/admin/consensus.resumen.js
// Junta lo que sabe el servidor de cada clave de Consensus (en memoria: si está apartada y por qué)
// con lo que cuenta la base (fn_admin_consensus) y calcula, por clave y en total, cuánto se ha usado
// este mes, cuánto queda, cuánto cuesta y a qué ritmo va. Sin E/S: se prueba con datos fijos.
//
// Planes de la API de Consensus (docs.consensus.app, noviembre de 2026): llamadas incluidas al mes y
// el máximo con el uso adicional activado (cada llamada extra, US$ 0,05). Se renuevan el día 1.
const PLANES = {
  free: { incluidas: 30, maximo: 30 },
  pro: { incluidas: 500, maximo: 1000 },
  teams: { incluidas: 500, maximo: 1000 },
  deep: { incluidas: 2000, maximo: 10000 },
  enterprise: null   // a medida: lo escribe el administrador
};
const PRECIO_EXTRA = 0.05;
const DIA = 86_400_000;

const redondear = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const num = v => Number(v) || 0;

function inicioMes(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function mesSiguiente(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); }

/** Incluidas y máximo de un plan con lo que haya guardado el administrador. */
function limites(plan, ajustes = {}) {
  if (plan === 'enterprise') {
    const incluidas = num(ajustes.incluidas);
    return { incluidas, maximo: Math.max(incluidas, num(ajustes.maximo)), usoAdicional: num(ajustes.maximo) > incluidas };
  }
  const p = PLANES[plan] || PLANES.free;
  const usoAdicional = plan !== 'free' && Boolean(ajustes.uso_adicional);
  return { incluidas: p.incluidas, maximo: usoAdicional ? p.maximo : p.incluidas, usoAdicional };
}

/**
 * @param estados   consensus.estadoClaves(): [{ huella, posicion, final, apartada_hasta, motivo, sin_texto_completo }]
 * @param datos     lo que devuelve fn_admin_consensus (o null si no se pudo leer)
 * @param ahora     Date
 * @param sinRegistro  true si falta sql/016: solo se sabe lo que hay en memoria
 * @param opciones  consultasPorSeccion: búsquedas que hace cada sección del artículo (CONSENSUS_MAX_CONSULTAS)
 */
function resumirConsensus(estados, datos, ahora = new Date(), sinRegistro = false, { consultasPorSeccion = 3 } = {}) {
  const desde = inicioMes(ahora), hasta = mesSiguiente(ahora);
  const mes = desde.toISOString().slice(0, 7);
  const diasMes = (hasta - desde) / DIA;
  const transcurridos = Math.max((ahora - desde) / DIA, 1 / 24);
  const porHuella = new Map((datos?.claves || []).map(c => [c.clave, c]));
  const fechaTras = (quedan, ritmo) => {
    if (!(ritmo > 0) || !(quedan > 0)) return null;
    const fecha = new Date(ahora.getTime() + (quedan / ritmo) * DIA);
    return fecha < hasta ? fecha.toISOString().slice(0, 10) : null;
  };

  let hayEnUso = false;
  const claves = estados.map(e => {
    const d = porHuella.get(e.huella) || {};
    const a = d.ajustes || {};
    const plan = Object.prototype.hasOwnProperty.call(PLANES, a.plan) ? a.plan : 'free';
    const { incluidas, maximo, usoAdicional } = limites(plan, a);
    const sincronizado = a.sync_fecha && new Date(a.sync_fecha) >= desde ? { usadas: num(a.sync_usadas), fecha: a.sync_fecha } : null;
    const usadas = sincronizado ? sincronizado.usadas + num(d.llamadas_tras_sync) : num(d.llamadas);
    const agotadaGuardada = String(a.agotada_mes || '').slice(0, 7) === mes;
    const motivo = e.motivo;

    let estado;
    if (motivo?.status === 401) estado = 'rechazada';
    else if (motivo?.status === 402) estado = 'facturacion';
    else if (motivo?.status === 429 || agotadaGuardada) estado = 'agotada';
    else if (!hayEnUso) { estado = 'en_uso'; hayEnUso = true; }
    else estado = 'en_espera';

    const quedan = estado === 'agotada' ? 0 : Math.max(0, maximo - usadas);
    const extra = Math.max(0, usadas - incluidas);
    const costoExtra = redondear(extra * PRECIO_EXTRA);
    const costoMensual = redondear(num(a.costo_mensual));

    return {
      huella: e.huella,
      posicion: e.posicion,
      final: e.final ?? null,
      nombre: a.nombre || null,
      plan, incluidas, maximo, uso_adicional: usoAdicional,
      costo_mensual: costoMensual,
      usadas, quedan,
      quedan_incluidas: Math.max(0, incluidas - usadas),
      extra, costo_extra: costoExtra,
      costo_mes: redondear(costoMensual + costoExtra),
      busquedas: num(d.busquedas),
      errores: num(d.errores),
      ultima: d.ultima || null,
      estado,
      motivo: motivo?.msg || (estado === 'agotada' ? a.ultimo_error || null : null),
      agotada_el: estado === 'agotada' && a.ultimo_error_fecha && String(a.ultimo_error_fecha).slice(0, 7) === mes ? a.ultimo_error_fecha : null,
      apartada_hasta: e.apartada_hasta || null,
      sincronizado,
      agotara_el: null,
      sin_texto_completo: Boolean(e.sin_texto_completo)
    };
  });

  const suma = campo => claves.reduce((t, c) => t + c[campo], 0);
  // Las búsquedas van siempre a la clave en uso: el ritmo es el de todas juntas
  const ritmo = suma('usadas') / transcurridos;
  const enUso = claves.find(c => c.estado === 'en_uso');
  if (enUso) enUso.agotara_el = fechaTras(enUso.quedan, ritmo);
  const total = {
    claves: claves.length,
    usadas: suma('usadas'),
    maximo: suma('maximo'),
    quedan: suma('quedan'),
    extra: suma('extra'),
    costo_mes: redondear(suma('costo_mes')),
    busquedas: suma('busquedas'),
    errores: suma('errores'),
    cache: num(datos?.cache),
    proyeccion: Math.round(ritmo * diasMes),
    agotara_el: fechaTras(suma('quedan'), ritmo),
    // Cada sección que busca fuentes hace una búsqueda por consulta: para cuántas alcanza lo que queda
    secciones_restantes: Math.floor(suma('quedan') / Math.max(1, consultasPorSeccion))
  };

  // Gasto de los meses anteriores con los planes de ahora (una aproximación: el plan pudo cambiar)
  const planDe = new Map(claves.map(c => [c.huella, c]));
  const porMes = new Map();
  for (const h of datos?.historial || []) {
    const c = planDe.get(h.clave);
    const fila = porMes.get(h.mes) || { mes: h.mes, llamadas: 0, costo: 0 };
    fila.llamadas += num(h.llamadas);
    if (c) fila.costo += c.costo_mensual + Math.max(0, num(h.llamadas) - c.incluidas) * PRECIO_EXTRA;
    porMes.set(h.mes, fila);
  }
  const historial = [...porMes.values()].sort((x, y) => x.mes.localeCompare(y.mes)).map(f => ({ ...f, costo: redondear(f.costo) }));

  return {
    configurada: estados.length > 0,
    sin_registro: Boolean(sinRegistro),
    mes,
    renueva: hasta.toISOString().slice(0, 10),
    precio_extra: PRECIO_EXTRA,
    consultas_por_seccion: Math.max(1, consultasPorSeccion),
    claves,
    total,
    por_dia: datos?.por_dia || [],
    por_endpoint: datos?.por_endpoint || [],
    por_usuario: datos?.por_usuario || [],
    historial
  };
}

module.exports = { resumirConsensus, limites, PLANES, PRECIO_EXTRA };
