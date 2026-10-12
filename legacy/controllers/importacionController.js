// legacy/controllers/importacionController.js  (Tanda A, mejora 1)
// Consulta OpenAlex / Semantic Scholar / CrossRef, normaliza los resultados al formato que
// espera fn_importar_estudios y la llama COMO EL USUARIO (RLS aplica).
const logger = require('../../core/logger');
const { forUser, rpc } = require('../../infra/supabase');
const { HttpError } = require('../../core/httpError');
const { FUENTES } = require('../../infra/academicas');

/** POST /api/importar/buscar  → solo consulta (para previsualizar antes de importar) */
async function buscar(req, res) {
  const { fuente, ...q } = req.body;
  try {
    const r = await FUENTES[fuente](q);
    res.json({ fuente, pagina: q.pagina, por_pagina: q.porPagina, total: r.total, resultados: r.items });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    logger.warn('importacion_api_error', { fuente, status: e.response?.status, message: e.message });
    if (e.response?.status === 429) throw new HttpError(503, `${fuente} está limitando las peticiones; intente en unos segundos.`);
    throw new HttpError(502, `No se pudo consultar ${fuente}.`);
  }
}

/** POST /api/importar  → consulta N páginas y las inserta en la revisión con deduplicación (RPC) */
async function importar(req, res) {
  const { id_detalles_revision, fuente, paginas, ...q } = req.body;
  const sb = forUser(req.token);
  let recolectados = [], total = 0;
  for (let p = q.pagina; p < q.pagina + paginas; p++) {
    let r;
    try { r = await FUENTES[fuente]({ ...q, pagina: p }); }
    catch (e) {
      logger.warn('importacion_api_error', { fuente, pagina: p, message: e.message });
      if (!recolectados.length) throw new HttpError(502, `No se pudo consultar ${fuente}.`);
      break; // se importa lo que se alcanzó a recolectar
    }
    total = r.total;
    recolectados = recolectados.concat(r.items.filter(i => i.titulo));
    if (r.items.length < q.porPagina) break;
  }

  const resultado = await rpc(sb, 'fn_importar_estudios', {
    p_id_rev: id_detalles_revision,
    p_fuente: fuente,
    p_cadena: q.cadena,
    p_filtros: { anio_desde: q.anioDesde ?? null, anio_hasta: q.anioHasta ?? null, tipo: q.tipo ?? null, idioma: q.idioma ?? null, paginas },
    p_estudios: recolectados,
    p_total_api: total
  });
  res.json({ ...resultado, total_en_api: total, recolectados: recolectados.length });
}

module.exports = { buscar, importar };
