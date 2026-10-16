// modules/extraccion/extraccion.service.js
// Extracción de datos: los estudios que superaron la puntuación mínima de calidad, el formulario de
// la revisión y las respuestas de cada estudio.
//
// Antes la pantalla hacía 5 consultas a Supabase y guardaba INSERTANDO filas nuevas en cada guardado
// (la tabla crecía y la pantalla mostraba la que llegara la última). Ahora: una lectura y un guardado
// por estudio en una transacción (fn_guardar_extraccion_estudio, sql/006).
//
// Las sugerencias de la IA leen el PDF que ya tiene el estudio (el bucket es privado): antes la
// pantalla enviaba la ruta guardada como si fuera una URL y, desde la fase 3, eso ya no servía.
const sb = require('../../infra/supabase');
const storage = require('../../infra/storage');
const env = require('../../config/env');
const logger = require('../../core/logger');
const pdf = require('../../infra/pdf');
const { HttpError } = require('../../core/httpError');
const P = require('../../ia/prompts/extraccion');
const IA = require('../../ia/sugerencias/extraccion');
const planRepo = require('../planificacion/planificacion.repo');
const registro = require('../informes/referencias/registro');
const revisiones = require('../revisiones/revisiones.service');
const estudiosSvc = require('../estudios/estudios.service');
const repo = require('./extraccion.repo');

/** El valor guardado tal como lo usa el formulario: los Booleano vuelven a ser true/false. */
function aFormulario(valor, tipo) {
  if (valor === null || valor === undefined) return '';
  if (tipo === 'Booleano') {
    const t = String(valor).trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return valor;
}

/** Si quedaran respuestas repetidas (datos anteriores al sql/006), la más reciente. */
function ultimas(filas) {
  const m = new Map();
  for (const f of filas) {
    const k = `${f.id_estudios}:${f.id_campo_extraccion}`;
    const prev = m.get(k);
    if (!prev || String(f.fecha) > String(prev.fecha)
        || (String(f.fecha) === String(prev.fecha) && f.id_respuesta_extraccion > prev.id_respuesta_extraccion)) {
      m.set(k, f);
    }
  }
  return [...m.values()];
}

/** GET /revisiones/:id/extraccion — toda la pantalla en una petición. */
async function obtener(ctx, idRev) {
  const [rev, filas, campos, limite] = await Promise.all([
    revisiones.obtener(ctx, idRev),
    repo.estudios(ctx.token, idRev),
    repo.campos(ctx.token, idRev),
    repo.umbral(ctx.token, idRev)
  ]);
  const tipos = new Map(campos.map(c => [c.id_campo_extraccion, c.tipo]));
  const porEstudio = new Map(filas.map(e => [e.id_estudios, {}]));
  if (campos.length && filas.length) {
    for (const r of ultimas(await repo.respuestas(ctx.token, campos.map(c => c.id_campo_extraccion)))) {
      const delEstudio = porEstudio.get(r.id_estudios);
      if (delEstudio) delEstudio[r.id_campo_extraccion] = aFormulario(r.valor, tipos.get(r.id_campo_extraccion));
    }
  }
  return {
    revision: { id_detalles_revision: rev.id_detalles_revision, titulo_revision: rev.titulo_revision },
    limite,
    campos,
    estudios: filas.map(e => ({
      id_estudios: e.id_estudios,
      titulo: e.titulo,
      autores: e.autores ?? null,
      anio: e.anio ?? null,
      revista: e.revista ?? null,
      doi: e.doi ?? null,
      puntuacion: Number(e.totalPeso) || 0,
      tiene_pdf: Boolean(String(e.url_pdf_articulo ?? '').trim()),
      done: Boolean(e.done),
      respuestas: porEstudio.get(e.id_estudios)
    }))
  };
}

/** PUT /revisiones/:id/estudios/:e/extraccion — respuestas (y, si llega, la marca de «hecho»). */
async function guardar(ctx, idRev, idEstudio, { respuestas, done }) {
  await revisiones.exigirEscritura(ctx, idRev);
  return repo.guardar(ctx.token, idRev, idEstudio, respuestas, done);
}

/** PUT /revisiones/:id/estudios/:e/extraccion/estado */
async function marcar(ctx, idRev, idEstudio, { done }) {
  await revisiones.exigirEscritura(ctx, idRev);
  return repo.guardar(ctx.token, idRev, idEstudio, null, done);
}

/* ---------- Sugerencias de la IA ---------- */

function exigirPdf(buf) {
  if (buf.length > env.PDF_MAX_BYTES) throw new HttpError(413, 'El PDF supera el tamaño máximo permitido.');
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'El archivo guardado no es un PDF.');
  return buf;
}

/** Lee el PDF del bucket como el usuario; si las políticas de Storage no lo dejan, con service_role. */
async function descargarDelBucket(ctx, idEstudio, ruta) {
  try {
    return await storage.descargar(sb.forUser(ctx.token), ruta);
  } catch (e) {
    // Mismo criterio que al abrir el PDF: la fila ya pasó RLS y la ruta es de este estudio
    if (![403, 404].includes(e.status) || !sb.adminDisponible()) throw e;
    logger.warn('pdf_leido_con_service_role', { id_estudios: Number(idEstudio), ruta });
    return storage.descargar(sb.admin(), ruta);
  }
}

/**
 * El PDF del estudio: el subido (o su enlace externo) y, si no tiene, la URL que mande la pantalla
 * o el enlace de acceso abierto que trajo la importación.
 */
async function pdfDelEstudio(ctx, estudio, urlManual) {
  const guardado = String(estudio.url_pdf_articulo ?? '').trim();
  if (guardado) {
    if (estudiosSvc.esEnlaceExterno(guardado)) return pdf.downloadPdf(guardado);
    const ruta = estudiosSvc.rutaDelPdf(estudio.id_estudios, guardado);
    if (!ruta) throw new HttpError(404, 'El PDF de este estudio no está disponible.');
    return exigirPdf(await descargarDelBucket(ctx, estudio.id_estudios, ruta));
  }
  const otra = urlManual || String(estudio.url_pdf_externo ?? '').trim();
  if (otra) return pdf.downloadPdf(otra);
  throw new HttpError(400, 'Este estudio no tiene PDF. Súbelo en Estudios o indica la URL del PDF.');
}

/** La IA devuelve las fechas como dd/mm/aaaa; el campo de fecha del formulario usa aaaa-mm-dd. */
function paraElCampo(valor, tipo) {
  if (tipo === 'Fecha' && typeof valor === 'string') {
    const m = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return valor;
}

const NO_REPORTADO = { es: 'No reportado en el estudio.', en: 'Not reported in the study.' };

/**
 * POST /revisiones/:id/estudios/:e/extraccion/sugerir — la IA lee el PDF y responde TODOS los campos,
 * sin guardar nada: la pantalla muestra cada propuesta debajo de su campo, con la frase del artículo
 * que la respalda y su página, y la persona decide cuáles acepta.
 * Devuelve { sugerencias: {id_campo: valor}, evidencias: {id_campo: {cita, pagina, verificada}},
 *            no_reportados: [id_campo…] } (los campos que el estudio no informa).
 */
async function sugerir(ctx, idRev, idEstudio, { url }) {
  await revisiones.exigirEscritura(ctx, idRev);
  const [estudio, campos, preguntas, idioma] = await Promise.all([
    estudiosSvc.estudioDe(ctx, idRev, idEstudio),
    planRepo.campos(ctx.token, idRev),
    planRepo.preguntas(ctx.token, idRev).catch(() => []),
    registro.idioma(ctx.token, idRev).catch(() => 'es')
  ]);
  if (!campos.length) {
    throw new HttpError(400, 'Esta revisión no tiene campos de extracción. Defínelos en Planificación.');
  }

  const { fullText, pages } = await pdf.extractText(await pdfDelEstudio(ctx, estudio, url));
  P.exigirQueConcuerde(estudio.titulo, fullText);   // 412 si el PDF no es el del artículo

  const textoPregunta = new Map(preguntas.map((p, i) => [Number(p.id_preguntas_investigacion), `PI${i + 1}. ${String(p.pregunta).slice(0, 300)}`]));
  const respuestas = await IA.sugerencias({
    titulo: estudio.titulo, fullText, pages, idioma,
    preguntas: [...textoPregunta.values()],
    campos: campos.map(c => ({
      id_campo: c.id_campo_extraccion, pregunta: String(c.descripcion).slice(0, 1000), tipo: c.tipo,
      pi: c.id_pregunta_investigacion ? textoPregunta.get(Number(c.id_pregunta_investigacion)) : null
    }))
  });

  const sugerencias = {}, evidencias = {}, noReportados = [];
  for (const c of campos) {
    const r = respuestas.get(c.id_campo_extraccion);
    if (!r?.encontrado) {
      noReportados.push(c.id_campo_extraccion);
      // En un campo de texto, «no reportado» también es una respuesta de la extracción
      if (c.tipo === 'Texto' && r?.respondida) sugerencias[c.id_campo_extraccion] = NO_REPORTADO[idioma] || NO_REPORTADO.es;
      continue;
    }
    sugerencias[c.id_campo_extraccion] = paraElCampo(r.valor, c.tipo);
    if (r.evidencia) evidencias[c.id_campo_extraccion] = { cita: r.evidencia, pagina: r.pagina, verificada: r.verificada };
  }
  return { sugerencias, evidencias, no_reportados: noReportados };
}

module.exports = { obtener, guardar, marcar, sugerir, aFormulario, paraElCampo };
