// modules/informes/informes.service.js
// Pantalla de Informes: secciones del artículo (con versiones), valoraciones, PRISMA e informes
// Word generados. La generación con IA está en generacion.js.
const crypto = require('crypto');
const repo = require('./informes.repo');
const revisiones = require('../revisiones/revisiones.service');
const storage = require('../../infra/storage');
const sb = require('../../infra/supabase');
const logger = require('../../core/logger');
const { HttpError } = require('../../core/httpError');
const { SECCIONES, COLUMNA_VALORACION, NOMBRES } = require('./secciones');

/* ---------- Secciones ---------- */

const COLUMNAS_DEVUELTAS = [...SECCIONES, ...Object.values(COLUMNA_VALORACION), 'fecha_ingreso'];

/** Texto guardado de cada sección y sus valoraciones (null si aún no hay nada). */
async function secciones(ctx, idRev) {
  const [, fila] = await Promise.all([revisiones.obtener(ctx, idRev), repo.filaSecciones(ctx.token, idRev)]);
  return Object.fromEntries(COLUMNAS_DEVUELTAS.map(c => [c, fila?.[c] ?? null]));
}

/**
 * Guarda una sección y deja versión. Escribe SOLO esa columna: si dos personas editan
 * secciones distintas a la vez, ninguna pisa a la otra (antes se reescribía la fila entera).
 * Con id_generacion, la versión queda marcada como 'ia' y enlazada a esa generación.
 */
async function guardar(ctx, idRev, seccion, { contenido, id_generacion: idGeneracion }) {
  let origen = 'usuario', modelo = null;
  if (idGeneracion) {
    const gen = await repo.generacion(ctx.token, idGeneracion);
    if (!gen || Number(gen.id_detalles_revision) !== Number(idRev) || gen.seccion !== seccion) {
      throw new HttpError(400, 'La generación indicada no corresponde a esta sección.');
    }
    origen = 'ia'; modelo = gen.modelo;
  }

  const version = await repo.guardarVersion(ctx.token, idRev, seccion, contenido, origen, modelo);

  if (idGeneracion && version) {
    try {
      const idV = await repo.idVersion(ctx.token, idRev, seccion, version);
      if (idV) await repo.vincularGeneracion(ctx.token, idGeneracion, idV);
    } catch (e) {
      logger.warn('vincular_generacion_fallido', { seccion, message: e.message });   // el guardado ya está hecho
    }
  }
  return { seccion, version, origen };
}

/** Valoración de la sección: 1 = adecuada, 0 = inadecuada. Escribe solo esa columna. */
async function valorar(ctx, idRev, seccion, valor) {
  await repo.valorar(ctx.token, idRev, COLUMNA_VALORACION[seccion], String(valor));
  return { seccion, valor };
}

async function historial(ctx, idRev, seccion) {
  await revisiones.obtener(ctx, idRev);
  return repo.historial(ctx.token, idRev, seccion);
}

/** Restaura una versión anterior: se guarda como versión nueva, así no se pierde nada. */
async function restaurar(ctx, idRev, seccion, version) {
  const idV = await repo.idVersion(ctx.token, idRev, seccion, version);
  if (!idV) throw new HttpError(404, `No existe la versión ${version} de «${NOMBRES[seccion]}».`);
  const nueva = await repo.restaurar(ctx.token, idV);
  return { seccion, version: nueva, restaurada: version };
}

/* ---------- PRISMA ---------- */

async function prisma(ctx, idRev) {
  const [, d] = await Promise.all([revisiones.obtener(ctx, idRev), repo.datosPrisma(ctx.token, idRev)]);
  return d;
}

/* ---------- Informes Word ---------- */

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_DOCX = 10 * 1024 * 1024;

/**
 * Ruta del archivo en el bucket. Las filas antiguas guardaban una URL pública
 * (…/object/public/documentos/<ruta>), que con el bucket privado no se puede abrir.
 * Solo se aceptan rutas dentro de informes/<id de la revisión>/: una fila manipulada no
 * puede hacer que el servidor lea o borre archivos de otra revisión.
 */
function rutaDelInforme(idRev, rutaGuardada) {
  let ruta = String(rutaGuardada || '');
  if (/^https?:\/\//i.test(ruta)) {
    const i = ruta.indexOf('/documentos/');
    ruta = i >= 0 ? ruta.slice(i + '/documentos/'.length).split('?')[0] : '';
    try { ruta = decodeURIComponent(ruta); } catch { ruta = ''; }
  }
  const prefijo = `informes/${Number(idRev)}/`;
  if (!ruta.startsWith(prefijo) || ruta.includes('..') || ruta.slice(prefijo.length).includes('/')) return null;
  return ruta;
}

const sinRuta = ({ ruta_archivo, ...resto }) => resto;   // la ruta interna no sale al navegador

async function listarInformes(ctx, idRev) {
  const [, filas] = await Promise.all([revisiones.obtener(ctx, idRev), repo.listarInformes(ctx.token, idRev)]);
  return filas.map(sinRuta);
}

/** Sube el Word generado en el navegador y lo registra. */
async function subirInforme(ctx, idRev, contenido) {
  if (!Buffer.isBuffer(contenido) || !contenido.length) {
    throw new HttpError(415, `Envía el archivo Word como ${DOCX}.`);
  }
  if (contenido.length > MAX_DOCX) throw new HttpError(413, 'El informe supera los 10 MB.');
  if (contenido.subarray(0, 4).toString('latin1') !== 'PK\u0003\u0004') {
    throw new HttpError(400, 'El archivo no es un documento Word (.docx).');
  }

  await revisiones.exigirEscritura(ctx, idRev);
  const nombre = `Borrador_de_Articulo_${Date.now()}-${crypto.randomInt(10000)}.docx`;
  const ruta = `informes/${Number(idRev)}/${nombre}`;
  await storage.subir(sb.forUser(ctx.token), ruta, contenido, DOCX);   // como el usuario: aplican las políticas de Storage

  try {
    const fila = await repo.insertarInforme(ctx.token, { id_detalles_revision: idRev, nombre_informe: nombre, ruta_archivo: ruta });
    return sinRuta(fila);
  } catch (e) {
    await storage.borrar(storage.clienteLimpieza(ctx.token), [ruta]);   // no dejar el archivo huérfano
    throw e;
  }
}

/** Devuelve { nombre, contenido (Buffer) } para descargarlo a través del backend. */
async function descargarInforme(ctx, idRev, idInforme) {
  const fila = await repo.informe(ctx.token, idRev, idInforme);
  if (!fila) throw new HttpError(404, 'Informe no encontrado.');
  const ruta = rutaDelInforme(idRev, fila.ruta_archivo);
  if (!ruta) throw new HttpError(404, 'El archivo de este informe no está disponible.');
  let contenido;
  try {
    contenido = await storage.descargar(sb.forUser(ctx.token), ruta);   // como el usuario: aplican las políticas de Storage
  } catch (e) {
    // Si las políticas de Storage no dejan leer esa carpeta al usuario, Storage responde
    // "no encontrado" (o 403). La fila ya se leyó con RLS (es del equipo) y la ruta es de esta
    // revisión, así que se reintenta con service_role y queda aviso para añadir la política.
    if (![403, 404].includes(e.status) || !sb.adminDisponible()) throw e;
    logger.warn('informe_leido_con_service_role', { id_revision: Number(idRev), ruta });
    contenido = await storage.descargar(sb.admin(), ruta);
  }
  return { nombre: fila.nombre_informe || 'informe.docx', contenido, tipo: DOCX };
}

/** Borra el registro y su archivo (antes el archivo quedaba huérfano en el bucket). */
async function borrarInforme(ctx, idRev, idInforme) {
  const fila = await repo.informe(ctx.token, idRev, idInforme);
  if (!fila) throw new HttpError(404, 'Informe no encontrado.');
  if (!(await repo.borrarInforme(ctx.token, idRev, idInforme))) {
    throw new HttpError(403, 'Tu rol en esta revisión es de solo lectura.');
  }
  const ruta = rutaDelInforme(idRev, fila.ruta_archivo);
  if (ruta) await storage.borrar(storage.clienteLimpieza(ctx.token), [ruta]);
}

module.exports = {
  secciones, guardar, valorar, historial, restaurar, prisma,
  listarInformes, subirInforme, descargarInforme, borrarInforme,
  rutaDelInforme, DOCX, MAX_DOCX
};
