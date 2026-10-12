// modules/revisiones/revisiones.routes.js
// /api/v1/revisiones. El controlador vive aquí mismo porque cada ruta es una línea;
// se separa en su archivo cuando el módulo crezca.
//
//   GET    /                    ?propias=true  → lista (propias y compartidas; o solo propias)
//   POST   /                                   → crea (201)
//   GET    /:id                                → detalle
//   PATCH  /:id                                → cambia campos sueltos
//   DELETE /:id                                → borra (solo propietario) y limpia sus archivos (204)
//   PUT    /:id/preferencia     {favorita?, oculta?}
//   GET    /:id/progreso                       → progreso por fases (fn_progreso_revision)
const express = require('express');
const { validate } = require('../../core/validate');
const { asyncHandler: h } = require('../../core/asyncHandler');
const { contexto } = require('../../core/contexto');
const S = require('./revisiones.schemas');
const svc = require('./revisiones.service');

const router = express.Router();
const conId = validate(S.idParam, 'params');

router.get('/', validate(S.listarQuery, 'query'),
  h(async (req, res) => res.json(await svc.listar(contexto(req), req.valid.query))));

router.post('/', validate(S.crear),
  h(async (req, res) => res.status(201).json(await svc.crear(contexto(req), req.body))));

router.get('/:id', conId,
  h(async (req, res) => res.json(await svc.obtener(contexto(req), req.valid.params.id))));

router.patch('/:id', conId, validate(S.actualizar),
  h(async (req, res) => res.json(await svc.actualizar(contexto(req), req.valid.params.id, req.body))));

router.delete('/:id', conId,
  h(async (req, res) => { await svc.eliminar(contexto(req), req.valid.params.id); res.status(204).end(); }));

router.put('/:id/preferencia', conId, validate(S.preferencia),
  h(async (req, res) => res.json(await svc.marcar(contexto(req), req.valid.params.id, req.body))));

router.get('/:id/progreso', conId,
  h(async (req, res) => res.json(await svc.progreso(contexto(req), req.valid.params.id))));

module.exports = router;
