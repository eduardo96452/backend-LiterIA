// modules/extraccion/extraccion.routes.js
// Se monta en /api/v1/revisiones/:id (mergeParams).
//
//   GET  /extraccion                       estudios que superaron la calidad, campos y respuestas
//   PUT  /estudios/:e/extraccion           {respuestas:[{id_campo_extraccion, valor}], done?}
//   PUT  /estudios/:e/extraccion/estado    {done}
//   POST /estudios/:e/extraccion/sugerir   {url?} la IA lee el PDF del estudio (límite «costoso»)
const express = require('express');
const limites = require('../../core/rateLimit');
const { validate } = require('../../core/validate');
const { asyncHandler: h } = require('../../core/asyncHandler');
const { contexto: c } = require('../../core/contexto');
const S = require('./extraccion.schemas');
const svc = require('./extraccion.service');

const router = express.Router({ mergeParams: true });
const P = req => req.valid.params;

router.get('/extraccion', validate(S.params, 'params'),
  h(async (req, res) => res.json(await svc.obtener(c(req), P(req).id))));

router.put('/estudios/:e/extraccion', validate(S.paramsEstudio, 'params'), validate(S.guardar),
  h(async (req, res) => res.json(await svc.guardar(c(req), P(req).id, P(req).e, req.body))));

router.put('/estudios/:e/extraccion/estado', validate(S.paramsEstudio, 'params'), validate(S.estado),
  h(async (req, res) => res.json(await svc.marcar(c(req), P(req).id, P(req).e, req.body))));

router.post('/estudios/:e/extraccion/sugerir', validate(S.paramsEstudio, 'params'), validate(S.sugerir), limites.costoso,
  h(async (req, res) => res.json(await svc.sugerir(c(req), P(req).id, P(req).e, req.body))));

module.exports = router;
