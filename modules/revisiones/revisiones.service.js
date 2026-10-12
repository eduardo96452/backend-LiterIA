// modules/revisiones/revisiones.service.js
// Reglas de negocio de revisiones. No conoce req/res: recibe un contexto { token, user }.
const repo = require('./revisiones.repo');
const storage = require('../../infra/storage');
const logger = require('../../core/logger');
const { HttpError } = require('../../core/httpError');

function listar(ctx, { propias } = {}) {
  return repo.listar(ctx.token, { soloDe: propias ? ctx.user.id : undefined });
}

/** Si no existe o no es visible para el usuario, para él no existe: 404 en ambos casos. */
async function obtener(ctx, id) {
  const rev = await repo.obtener(ctx.token, id);
  if (!rev) throw new HttpError(404, 'Revisión no encontrada.');
  return rev;
}

/**
 * Para operaciones que escriben o gastan (IA, subir archivos): 404 si no la ve,
 * 403 si la ve pero es lector. Devuelve la revisión.
 */
async function exigirEscritura(ctx, id) {
  const [rev, puede] = await Promise.all([repo.obtener(ctx.token, id), repo.puedeEscribir(ctx.token, id)]);
  if (!rev) throw new HttpError(404, 'Revisión no encontrada.');
  if (!puede) throw new HttpError(403, 'Tu rol en esta revisión es de solo lectura.');
  return rev;
}

/** El dueño sale del token, nunca del cuerpo; las fechas las pone la base (DEFAULT now()). */
function crear(ctx, datos) {
  return repo.crear(ctx.token, { ...datos, id_usuarios: ctx.user.id });
}

async function actualizar(ctx, id, cambios) {
  const rev = await repo.actualizar(ctx.token, id, cambios);   // fecha_modificacion la pone un trigger
  if (rev) return rev;
  await obtener(ctx, id);                                     // 404 si ni siquiera la ve
  throw new HttpError(403, 'No tienes permiso para editar esta revisión.');
}

async function eliminar(ctx, id) {
  await obtener(ctx, id);
  // Antes de borrar: el ON DELETE CASCADE elimina los estudios y con ellos sus rutas.
  const estudios = await repo.idsEstudiosConPdf(ctx.token, id);
  if (!(await repo.eliminar(ctx.token, id))) {
    throw new HttpError(403, 'Solo el propietario puede eliminar la revisión.');
  }
  // Limpieza de archivos (antes no se hacía y quedaban PDFs huérfanos). Nunca rompe el borrado.
  const borrados = await limpiarArchivos(ctx.token, id, estudios);
  logger.info('revision_eliminada', { id, estudios_con_pdf: estudios.length, archivos_borrados: borrados });
}

async function limpiarArchivos(token, idRevision, idsEstudios) {
  const cliente = storage.clienteLimpieza(token);
  const carpetas = [`informes/${idRevision}`, ...idsEstudios.map(e => `estudios/${e}`)];
  let total = 0;
  for (let i = 0; i < carpetas.length; i += 5) {               // de 5 en 5 para no saturar Storage
    const lote = await Promise.all(carpetas.slice(i, i + 5).map(c => storage.borrarCarpeta(cliente, c)));
    total += lote.reduce((a, b) => a + b, 0);
  }
  return total;
}

async function marcar(ctx, id, { favorita, oculta }) {
  await obtener(ctx, id);   // no se crean preferencias sobre revisiones que el usuario no ve
  return repo.marcar(ctx.token, id, { favorita: favorita ?? null, oculta: oculta ?? null });
}

function progreso(ctx, id) {
  return repo.progreso(ctx.token, id);   // si no puede leerla, la base responde 42501 → 403
}

module.exports = { listar, obtener, exigirEscritura, crear, actualizar, eliminar, marcar, progreso };
