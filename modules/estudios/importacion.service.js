// modules/estudios/importacion.service.js
// Buscar en OpenAlex / Semantic Scholar / CrossRef e importar a la revisión.
// La consulta a las bases es la de siempre (infra/academicas.js); la inserción la hace
// fn_importar_estudios, que ya descarta los DOI repetidos. Aquí además se descartan los
// títulos que ya están en la revisión (p. ej. los importados antes desde un .bib sin DOI).
const repo = require('./estudios.repo');
const revisiones = require('../revisiones/revisiones.service');
const sb = require('../../infra/supabase');
const logger = require('../../core/logger');
const { HttpError } = require('../../core/httpError');
const { FUENTES } = require('../../infra/academicas');
const { normalizarTitulo, claveDoi } = require('./campos');

const NOMBRE = { openalex: 'OpenAlex', semantic_scholar: 'Semantic Scholar', crossref: 'CrossRef' };

async function consultar(fuente, q) {
  try {
    return await FUENTES[fuente](q);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    logger.warn('importacion_api_error', { fuente, status: e.response?.status, message: e.message });
    if (e.response?.status === 429) throw new HttpError(503, `${NOMBRE[fuente]} está limitando las peticiones; intenta en unos segundos.`);
    throw new HttpError(502, `No se pudo consultar ${NOMBRE[fuente]}.`);
  }
}

async function clavesDeLaRevision(token, idRev) {
  const existentes = await repo.claves(token, idRev);
  return {
    titulos: new Set(existentes.map(e => normalizarTitulo(e.titulo)).filter(Boolean)),
    dois: new Set(existentes.map(e => claveDoi(e.doi)).filter(Boolean))
  };
}

/** Vista previa: no guarda nada. Marca los resultados que ya están en la revisión. */
async function buscar(ctx, idRev, { fuente, ...q }) {
  await revisiones.obtener(ctx, idRev);
  const [r, claves] = await Promise.all([consultar(fuente, q), clavesDeLaRevision(ctx.token, idRev)]);
  const resultados = r.items.map(it => ({
    ...it,
    ya_en_revision: Boolean((it.doi && claves.dois.has(claveDoi(it.doi))) || claves.titulos.has(normalizarTitulo(it.titulo)))
  }));
  return { fuente, pagina: q.pagina, por_pagina: q.porPagina, total: r.total, resultados };
}

/** Consulta N páginas y las inserta como «Sin clasificar», sin los que ya estaban. */
async function importar(ctx, idRev, { fuente, paginas, ...q }) {
  await revisiones.exigirEscritura(ctx, idRev);

  let recolectados = [], total = 0;
  for (let p = q.pagina; p < q.pagina + paginas; p++) {
    let r;
    try { r = await consultar(fuente, { ...q, pagina: p }); }
    catch (e) {
      if (!recolectados.length) throw e;
      break;                                     // se importa lo que se alcanzó a recolectar
    }
    total = r.total;
    recolectados = recolectados.concat(r.items.filter(i => i.titulo));
    if (r.items.length < q.porPagina) break;
  }

  const claves = await clavesDeLaRevision(ctx.token, idRev);
  const nuevos = recolectados.filter(it => {
    const t = normalizarTitulo(it.titulo);
    if (!t || claves.titulos.has(t)) return false;
    claves.titulos.add(t);
    return true;
  });

  const resultado = nuevos.length
    ? await sb.rpc(sb.forUser(ctx.token), 'fn_importar_estudios', {
      p_id_rev: idRev,
      p_fuente: fuente,
      p_cadena: q.cadena,
      p_filtros: { anio_desde: q.anioDesde ?? null, anio_hasta: q.anioHasta ?? null, tipo: q.tipo ?? null, idioma: q.idioma ?? null, paginas },
      p_estudios: nuevos,
      p_total_api: total
    })
    : { id_importacion: null, recibidos: 0, importados: 0, duplicados: 0 };

  return {
    ...resultado,
    recibidos: recolectados.length,
    duplicados: recolectados.length - (resultado.importados ?? 0),
    total_en_api: total
  };
}

module.exports = { buscar, importar };
