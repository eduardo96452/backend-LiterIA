// modules/informes/referencias/referencias.service.js
// Registro de referencias de la revisión para la pantalla de Redacción: listarlo con el formato de
// la plantilla, añadir una referencia por DOI, quitar una y cambiar el idioma del artículo.
const revisiones = require('../../revisiones/revisiones.service');
const academicas = require('../../../infra/academicas');
const { HttpError } = require('../../../core/httpError');
const R = require('./registro');
const consensus = require('../../../infra/consensus');

/** Registro completo con el formato de la plantilla y el idioma del artículo. */
async function listar(ctx, idRev) {
  const revision = await revisiones.obtener(ctx, idRev);
  const [plantilla, idioma, filas] = await Promise.all([
    R.plantilla(ctx.token, revision), R.idioma(ctx.token, idRev), R.filas(ctx.token, idRev)
  ]);
  return {
    estilo: plantilla.estilo,
    cita_en_texto: plantilla.cita_en_texto,
    plantilla: plantilla.nombre,
    idioma,
    // Dónde busca la redacción las fuentes externas: 'consensus' (sin palabras clave) o 'crossref'
    buscador: consensus.activo() ? 'consensus' : 'crossref',
    referencias: R.vista(filas, { ...plantilla, idioma })
  };
}

/** Añade una referencia con los datos de CrossRef de ese DOI. */
async function agregarPorDoi(ctx, idRev, doi) {
  const revision = await revisiones.exigirEscritura(ctx, idRev);
  const item = await academicas.consultarDoi(R.doiLimpio(doi));
  if (!item) throw new HttpError(404, 'Ese DOI no está en CrossRef.');
  const fila = await R.agregarPorDoi(ctx.token, idRev, item);
  if (!fila) throw new HttpError(409, 'Esa referencia ya está en la lista.');
  const [plantilla, idioma] = await Promise.all([R.plantilla(ctx.token, revision), R.idioma(ctx.token, idRev)]);
  return R.vista([fila], { ...plantilla, idioma })[0];
}

/** Quita una referencia del registro. Las de los estudios incluidos se gestionan desde Revisión de datos. */
async function borrar(ctx, idRev, idRef) {
  await revisiones.exigirEscritura(ctx, idRev);
  const fila = (await R.filas(ctx.token, idRev)).find(r => Number(r.id_referencia) === Number(idRef));
  if (!fila) throw new HttpError(404, 'Referencia no encontrada.');
  if (fila.id_estudios) {
    throw new HttpError(400, 'Es un estudio incluido: para quitarlo de la revisión, cambia su estado en Revisión de datos.');
  }
  await R.borrar(ctx.token, idRev, idRef);
}

async function cambiarIdioma(ctx, idRev, idioma) {
  await revisiones.exigirEscritura(ctx, idRev);
  return { idioma: await R.cambiarIdioma(ctx.token, idRev, idioma) };
}

module.exports = { listar, agregarPorDoi, borrar, cambiarIdioma };
