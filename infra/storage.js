// infra/storage.js
// Operaciones con Supabase Storage que no dependen de ningún módulo.
const sb = require('./supabase');
const logger = require('../core/logger');
const { HttpError } = require('../core/httpError');

const BUCKET_DOCUMENTOS = 'documentos';
const LOTE = 1000;

/**
 * Borra todos los archivos que cuelgan directamente de una "carpeta" del bucket.
 * Devuelve cuántos borró. Nunca lanza: un archivo huérfano no debe romper la operación principal.
 */
async function borrarCarpeta(client, prefijo, bucket = BUCKET_DOCUMENTOS) {
  let borrados = 0;
  try {
    for (;;) {
      const { data, error } = await client.storage.from(bucket).list(prefijo, { limit: LOTE });
      if (error) throw error;
      const rutas = (data || []).filter(o => o.id).map(o => `${prefijo}/${o.name}`);   // id null = subcarpeta
      if (!rutas.length) break;
      const { error: e2 } = await client.storage.from(bucket).remove(rutas);
      if (e2) throw e2;
      borrados += rutas.length;
      if (rutas.length < LOTE) break;
    }
  } catch (e) {
    logger.warn('storage_borrar_carpeta_fallido', { bucket, prefijo, message: e.message });
  }
  return borrados;
}

/**
 * Cliente para tareas de limpieza YA autorizadas: service_role si está configurado (no depende
 * de las políticas de Storage, que pueden exigir que la revisión aún exista), si no, el usuario.
 */
function clienteLimpieza(token) {
  return sb.adminDisponible() ? sb.admin() : sb.forUser(token);
}

async function subir(client, ruta, contenido, contentType, bucket = BUCKET_DOCUMENTOS) {
  const { error } = await client.storage.from(bucket).upload(ruta, contenido, { contentType, upsert: false, cacheControl: '3600' });
  if (error) throw errorDeStorage(error, 'No se pudo guardar el archivo.');
}

/** Devuelve el archivo como Buffer. */
async function descargar(client, ruta, bucket = BUCKET_DOCUMENTOS) {
  const { data, error } = await client.storage.from(bucket).download(ruta);
  if (error) throw errorDeStorage(error, 'No se pudo leer el archivo.');
  return Buffer.from(await data.arrayBuffer());
}

/** Borra archivos sueltos. Nunca lanza: un archivo huérfano no debe romper la operación principal. */
async function borrar(client, rutas, bucket = BUCKET_DOCUMENTOS) {
  if (!rutas.length) return 0;
  const { error } = await client.storage.from(bucket).remove(rutas);
  if (error) { logger.warn('storage_borrar_fallido', { bucket, rutas, message: error.message }); return 0; }
  return rutas.length;
}

/**
 * URL firmada para que el NAVEGADOR suba el archivo directo a Storage (sin pasar los bytes por
 * el backend). Vale para esa ruta y caduca en 2 horas. Devuelve { ruta, url, token }.
 */
async function urlDeSubida(client, ruta, bucket = BUCKET_DOCUMENTOS) {
  const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(ruta);
  if (error) throw errorDeStorage(error, 'No se pudo preparar la subida del archivo.');
  return { ruta, url: data.signedUrl, token: data.token };
}

/** URL firmada de lectura (por defecto, 10 minutos). */
async function urlDeLectura(client, ruta, segundos = 600, bucket = BUCKET_DOCUMENTOS) {
  const { data, error } = await client.storage.from(bucket).createSignedUrl(ruta, segundos);
  if (error) throw errorDeStorage(error, 'No se pudo abrir el archivo.');
  return data.signedUrl;
}

/** ¿Existe el archivo? (se busca por nombre dentro de su carpeta). */
async function existe(client, ruta, bucket = BUCKET_DOCUMENTOS) {
  const i = ruta.lastIndexOf('/');
  const carpeta = ruta.slice(0, i), nombre = ruta.slice(i + 1);
  const { data, error } = await client.storage.from(bucket).list(carpeta, { search: nombre, limit: 100 });
  if (error) throw errorDeStorage(error, 'No se pudo comprobar el archivo.');
  return (data || []).some(o => o.name === nombre);
}

function errorDeStorage(error, mensaje) {
  const status = Number(error.statusCode || error.status);
  if (status === 404 || /not found/i.test(error.message || '')) return new HttpError(404, 'El archivo ya no existe en el almacenamiento.');
  if (status === 403 || /row-level security|unauthorized|permission/i.test(error.message || '')) {
    return new HttpError(403, 'No tienes permiso sobre ese archivo.');
  }
  logger.warn('storage_error', { status, message: error.message });
  return new HttpError(502, mensaje);
}

module.exports = {
  borrarCarpeta, clienteLimpieza, subir, descargar, borrar, urlDeSubida, urlDeLectura, existe, errorDeStorage,
  BUCKET_DOCUMENTOS
};
