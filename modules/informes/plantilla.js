// modules/informes/plantilla.js
// Plantilla Word de la revista (sql/011). El archivo se guarda en Storage, en la carpeta de informes
// de la revisión; los datos (nombre, mapeo de estilos, si se usa) en detalles_revision.plantilla_word.
// El artículo se monta dentro de la plantilla en el navegador: aquí solo se guarda, se valida y se
// devuelve el archivo.
const crypto = require('crypto');
const revisiones = require('../revisiones/revisiones.service');
const storage = require('../../infra/storage');
const sb = require('../../infra/supabase');
const logger = require('../../core/logger');
const { HttpError } = require('../../core/httpError');
const { DOCX, MAX_DOCX, rutaDelInforme } = require('./informes.service');

/** Partes del artículo a las que se puede asignar un estilo de la plantilla. */
const ROLES = [
  'titulo', 'tituloTraducido', 'autores', 'afiliacion', 'tituloResumen', 'resumen', 'palabrasClave',
  'h1', 'h2', 'cuerpo', 'rotulo', 'tabla', 'nota', 'referencia'
];

const FALTA_SQL = 'Para guardar la plantilla de la revista falta ejecutar sql/011_plantilla_word.sql en Supabase.';
const faltaColumna = e => e?.code === '42703' || e?.code === 'PGRST204' || /column .* does not exist|could not find the '.*' column/i.test(e?.message || '');

/* ---------- Validación del archivo (sin descomprimir: solo el índice del zip) ---------- */

/**
 * Nombres de los archivos del zip, leídos del directorio central. Devuelve null si no es un zip
 * válido. No descomprime nada: un zip malicioso no puede llenar la memoria.
 */
function entradasZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return null;
  // Fin del directorio central: firma 0x06054b50 en los últimos 22 bytes + comentario (máx. 64 KB)
  const desde = Math.max(0, buf.length - 22 - 0xffff);
  let fin = -1;
  for (let i = buf.length - 22; i >= desde; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) return null;
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  if (total > 5000 || p >= buf.length) return null;
  const nombres = [];
  for (let k = 0; k < total; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const largo = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comentario = buf.readUInt16LE(p + 32);
    if (p + 46 + largo > buf.length) return null;
    nombres.push(buf.toString('utf8', p + 46, p + 46 + largo));
    p += 46 + largo + extra + comentario;
  }
  return nombres;
}

/** Comprueba que el archivo es un Word sin macros con estilos. Lanza HttpError con el motivo. */
function validarPlantilla(contenido) {
  if (!Buffer.isBuffer(contenido) || !contenido.length) {
    throw new HttpError(415, `Envía la plantilla como ${DOCX}.`);
  }
  if (contenido.length > MAX_DOCX) throw new HttpError(413, 'La plantilla supera los 10 MB.');
  const nombres = contenido.subarray(0, 4).toString('latin1') === 'PK\u0003\u0004' ? entradasZip(contenido) : null;
  if (!nombres) {
    throw new HttpError(400, 'El archivo no es una plantilla Word (.docx o .dotx). Si está protegida con contraseña, quítasela y vuelve a subirla.');
  }
  const hay = n => nombres.some(x => x.toLowerCase() === n);
  if (nombres.some(n => /vbaproject\.bin$|vbadata\.xml$/i.test(n))) {
    throw new HttpError(400, 'La plantilla tiene macros (.docm/.dotm). Guárdala como .docx o .dotx (sin macros) y vuelve a subirla.');
  }
  if (!hay('[content_types].xml') || !hay('word/document.xml')) {
    throw new HttpError(400, 'El archivo no es un documento Word (.docx o .dotx).');
  }
  if (!hay('word/styles.xml')) {
    throw new HttpError(400, 'La plantilla no tiene estilos (word/styles.xml): ábrela en Word, guárdala de nuevo como .docx y súbela otra vez.');
  }
}

/** Nombre original del archivo (?nombre=… en la subida; Express ya lo decodifica). */
function nombreLimpio(original) {
  let n = String(original || '');
  n = n.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim();
  if (!n) n = 'plantilla.docx';
  return n.length > 120 ? `${n.slice(0, 110)}…${n.slice(-8)}` : n;
}

/** Solo los estilos de los roles conocidos y con un id razonable. */
function mapeoLimpio(mapeo) {
  const salida = {};
  for (const rol of ROLES) {
    const v = mapeo?.[rol];
    if (typeof v === 'string' && v.trim() && v.length <= 100) salida[rol] = v.trim();
  }
  return salida;
}

/* ---------- Datos en detalles_revision.plantilla_word ---------- */

const cliente = token => sb.forUser(token);

async function leerFila(token, idRev) {
  const { data, error } = await cliente(token).from('detalles_revision')
    .select('plantilla_word').eq('id_detalles_revision', idRev).maybeSingle();
  if (error) {
    if (faltaColumna(error)) return { sqlPendiente: true, valor: null };
    throw sb.fromSupabaseError(error);
  }
  if (!data) throw new HttpError(404, 'Revisión no encontrada.');
  const v = data.plantilla_word;
  return { sqlPendiente: false, valor: v && typeof v === 'object' && v.ruta ? v : null };
}

async function escribirFila(token, idRev, valor) {
  const { data, error } = await cliente(token).from('detalles_revision')
    .update({ plantilla_word: valor }).eq('id_detalles_revision', idRev)
    .select('id_detalles_revision').maybeSingle();
  if (error) {
    if (faltaColumna(error)) throw new HttpError(409, FALTA_SQL);
    throw sb.fromSupabaseError(error);
  }
  if (!data) throw new HttpError(403, 'No tienes permiso para editar esta revisión.');
}

/** Lo que ve el navegador (sin la ruta interna). */
const vista = v => (v ? {
  nombre: v.nombre || 'plantilla.docx', tamano: Number(v.tamano) || null, fecha: v.fecha || null,
  usar: v.usar !== false, mapeo: mapeoLimpio(v.mapeo)
} : null);

/* ---------- Operaciones ---------- */

/** { plantilla: {...} | null, sql_pendiente? } */
async function obtener(ctx, idRev) {
  await revisiones.obtener(ctx, idRev);
  const { sqlPendiente, valor } = await leerFila(ctx.token, idRev);
  return sqlPendiente ? { plantilla: null, sql_pendiente: true } : { plantilla: vista(valor) };
}

/** Sube (o sustituye) la plantilla. El mapeo de estilos se reinicia: lo propone el navegador. */
async function subir(ctx, idRev, contenido, nombreOriginal) {
  validarPlantilla(contenido);
  await revisiones.exigirEscritura(ctx, idRev);
  const anterior = await leerFila(ctx.token, idRev);
  if (anterior.sqlPendiente) throw new HttpError(409, FALTA_SQL);

  const ruta = `informes/${Number(idRev)}/plantilla_revista_${Date.now()}-${crypto.randomInt(10000)}.docx`;
  await storage.subir(sb.forUser(ctx.token), ruta, contenido, DOCX);   // como el usuario: aplican las políticas de Storage

  const valor = {
    ruta, nombre: nombreLimpio(nombreOriginal), tamano: contenido.length, fecha: new Date().toISOString(),
    usar: true, mapeo: {}
  };
  try {
    await escribirFila(ctx.token, idRev, valor);
  } catch (e) {
    await storage.borrar(storage.clienteLimpieza(ctx.token), [ruta]);   // no dejar el archivo huérfano
    throw e;
  }
  const rutaVieja = anterior.valor && rutaDelInforme(idRev, anterior.valor.ruta);
  if (rutaVieja && rutaVieja !== ruta) await storage.borrar(storage.clienteLimpieza(ctx.token), [rutaVieja]);
  logger.info('plantilla_word_subida', { id_revision: Number(idRev), tamano: contenido.length });
  return { plantilla: vista(valor) };
}

/** Cambia el mapeo de estilos o si se usa al exportar. */
async function actualizar(ctx, idRev, { mapeo, usar }) {
  await revisiones.exigirEscritura(ctx, idRev);
  const { sqlPendiente, valor } = await leerFila(ctx.token, idRev);
  if (sqlPendiente) throw new HttpError(409, FALTA_SQL);
  if (!valor) throw new HttpError(404, 'Esta revisión no tiene plantilla de revista.');
  const nuevo = {
    ...valor,
    ...(mapeo !== undefined ? { mapeo: mapeoLimpio(mapeo) } : {}),
    ...(usar !== undefined ? { usar: Boolean(usar) } : {})
  };
  await escribirFila(ctx.token, idRev, nuevo);
  return { plantilla: vista(nuevo) };
}

/** Quita la plantilla: el Word vuelve al formato por defecto. */
async function borrar(ctx, idRev) {
  await revisiones.exigirEscritura(ctx, idRev);
  const { sqlPendiente, valor } = await leerFila(ctx.token, idRev);
  if (sqlPendiente || !valor) return;
  await escribirFila(ctx.token, idRev, null);
  const ruta = rutaDelInforme(idRev, valor.ruta);
  if (ruta) await storage.borrar(storage.clienteLimpieza(ctx.token), [ruta]);
}

/** { nombre, contenido (Buffer), tipo } */
async function descargar(ctx, idRev) {
  await revisiones.obtener(ctx, idRev);
  const { valor } = await leerFila(ctx.token, idRev);
  const ruta = valor && rutaDelInforme(idRev, valor.ruta);
  if (!ruta) throw new HttpError(404, 'Esta revisión no tiene plantilla de revista.');
  let contenido;
  try {
    contenido = await storage.descargar(sb.forUser(ctx.token), ruta);
  } catch (e) {
    // Igual que los informes: la fila ya se leyó con RLS (es del equipo) y la ruta es de esta revisión
    if (![403, 404].includes(e.status) || !sb.adminDisponible()) throw e;
    logger.warn('plantilla_leida_con_service_role', { id_revision: Number(idRev) });
    contenido = await storage.descargar(sb.admin(), ruta);
  }
  return { nombre: valor.nombre || 'plantilla.docx', contenido, tipo: DOCX };
}

module.exports = { obtener, subir, actualizar, borrar, descargar, ROLES, entradasZip, validarPlantilla, nombreLimpio, mapeoLimpio };
