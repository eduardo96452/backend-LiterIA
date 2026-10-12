// modules/estudios/estudios.routes.js
// Se monta en /api/v1/revisiones/:id (mergeParams).
//
//   GET    /estudios                                todos, con la sugerencia de la IA si la hay
//   POST   /estudios                {estudios:[…]}  uno o un lote; marca los duplicados (201)
//   PATCH  /estudios/:e                             solo lo que cambia (estado, criterio, datos)
//   DELETE /estudios/:e                             borra el estudio y su PDF (204)
//   POST   /estudios/:e/pdf/subida  {nombre, tamano}  URL firmada para subir el PDF directo a Storage
//   PUT    /estudios/:e/pdf         {ruta}           asocia el PDF ya subido (borra el anterior)
//   GET    /estudios/:e/pdf                          URL temporal para abrirlo
//   DELETE /estudios/:e/pdf                          (204)
//   GET    /calidad                                  preguntas, respuestas, umbral y evaluaciones
//   PUT    /estudios/:e/calidad     {respuestas:[…]} guarda la evaluación completa del estudio
//   POST   /importar/buscar                          OpenAlex / Semantic Scholar / CrossRef (vista previa)
//   POST   /importar                                 importa N páginas (límite costoso)
//   POST   /cribado/sugerir                          sugerencias de la IA (límite costoso)
//   GET    /cribado/mio                              cribado independiente: mis decisiones
//   POST   /cribado/decisiones                       registra mi decisión
//   GET    /cribado/conflictos                       estudios en los que los revisores no coinciden
//   POST   /cribado/conflictos/:e/resolver           decisión final (solo el propietario)
//   GET    /cribado/kappa?a=&b=                      acuerdo entre dos revisores
const express = require('express');
const limites = require('../../core/rateLimit');
const { validate } = require('../../core/validate');
const { asyncHandler: h } = require('../../core/asyncHandler');
const { contexto } = require('../../core/contexto');
const S = require('./estudios.schemas');
const svc = require('./estudios.service');
const importacion = require('./importacion.service');
const cribado = require('./cribado.service');

const router = express.Router({ mergeParams: true });
const p = esquema => validate(esquema, 'params');
const P = req => req.valid.params;
const conId = p(S.params);
const conEstudio = p(S.paramsEstudio);

/* ---------- Estudios ---------- */

router.get('/estudios', conId,
  h(async (req, res) => res.json(await svc.listar(contexto(req), P(req).id))));

router.post('/estudios', conId, validate(S.crear),
  h(async (req, res) => res.status(201).json(await svc.crear(contexto(req), P(req).id, req.body.estudios))));

router.patch('/estudios/:e', conEstudio, validate(S.actualizar),
  h(async (req, res) => res.json(await svc.actualizar(contexto(req), P(req).id, P(req).e, req.body))));

router.delete('/estudios/:e', conEstudio,
  h(async (req, res) => { await svc.eliminar(contexto(req), P(req).id, P(req).e); res.status(204).end(); }));

/* ---------- PDF ---------- */

router.post('/estudios/:e/pdf/subida', conEstudio, validate(S.subidaPdf),
  h(async (req, res) => res.json(await svc.prepararSubidaPdf(contexto(req), P(req).id, P(req).e, req.body))));

router.put('/estudios/:e/pdf', conEstudio, validate(S.confirmarPdf),
  h(async (req, res) => res.json(await svc.confirmarPdf(contexto(req), P(req).id, P(req).e, req.body))));

router.get('/estudios/:e/pdf', conEstudio,
  h(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await svc.urlPdf(contexto(req), P(req).id, P(req).e)); }));

router.delete('/estudios/:e/pdf', conEstudio,
  h(async (req, res) => { await svc.borrarPdf(contexto(req), P(req).id, P(req).e); res.status(204).end(); }));

/* ---------- Calidad ---------- */

router.get('/calidad', conId,
  h(async (req, res) => res.json(await svc.calidad(contexto(req), P(req).id))));

router.put('/estudios/:e/calidad', conEstudio, validate(S.calidad),
  h(async (req, res) => res.json(await svc.guardarCalidad(contexto(req), P(req).id, P(req).e, req.body.respuestas))));

/* ---------- Importar desde las bases académicas ---------- */

router.post('/importar/buscar', conId, validate(S.importarBuscar),
  h(async (req, res) => res.json(await importacion.buscar(contexto(req), P(req).id, req.body))));

router.post('/importar', limites.costoso, conId, validate(S.importar),
  h(async (req, res) => res.json(await importacion.importar(contexto(req), P(req).id, req.body))));

/* ---------- Cribado ---------- */

router.post('/cribado/sugerir', limites.costoso, conId, validate(S.sugerir),
  h(async (req, res) => res.json(await cribado.sugerir(contexto(req), P(req).id, req.body))));

router.get('/cribado/mio', conId,
  h(async (req, res) => res.json(await cribado.mio(contexto(req), P(req).id))));

router.post('/cribado/decisiones', conId, validate(S.decision),
  h(async (req, res) => res.json(await cribado.decidir(contexto(req), P(req).id, req.body))));

router.get('/cribado/conflictos', conId,
  h(async (req, res) => res.json(await cribado.conflictos(contexto(req), P(req).id))));

router.post('/cribado/conflictos/:e/resolver', conEstudio, validate(S.resolver),
  h(async (req, res) => res.json(await cribado.resolver(contexto(req), P(req).id, P(req).e, req.body))));

router.get('/cribado/kappa', conId, validate(S.kappa, 'query'),
  h(async (req, res) => res.json(await cribado.kappa(contexto(req), P(req).id, req.valid.query.a, req.valid.query.b))));

module.exports = router;
