// modules/equipo/equipo.routes.js
// Se monta en /api/v1/revisiones/:id (mergeParams).
//
//   GET    /equipo                  miembros con su rol (fn_equipo_revision)
//   GET    /mi-rol                  {rol} del usuario de la sesión, o null si no es del equipo
//   POST   /equipo/invitaciones     {correo, rol} solo el propietario; envía el correo (límite «correo»)
//   PATCH  /equipo/:uid             {rol} solo el propietario; el creador no cambia
//   DELETE /equipo/:uid             solo el propietario; el creador no se quita
//
// Aceptar una invitación no depende de una revisión: POST /api/v1/invitaciones/aceptar {token}
// (router `invitaciones` de este mismo archivo).
const express = require('express');
const limites = require('../../core/rateLimit');
const { validate } = require('../../core/validate');
const { asyncHandler: h } = require('../../core/asyncHandler');
const { contexto: c } = require('../../core/contexto');
const S = require('./equipo.schemas');
const svc = require('./equipo.service');

const router = express.Router({ mergeParams: true });
const P = req => req.valid.params;
const conId = validate(S.params, 'params');
const conMiembro = validate(S.paramsMiembro, 'params');

router.get('/equipo', conId, h(async (req, res) => res.json(await svc.equipo(c(req), P(req).id))));
router.get('/mi-rol', conId, h(async (req, res) => res.json(await svc.miRol(c(req), P(req).id))));

router.post('/equipo/invitaciones', conId, validate(S.invitacion), limites.correo,
  h(async (req, res) => res.status(201).json(await svc.invitar(c(req), P(req).id, req.body))));

router.patch('/equipo/:uid', conMiembro, validate(S.rol),
  h(async (req, res) => res.json(await svc.cambiarRol(c(req), P(req).id, P(req).uid, req.body))));

router.delete('/equipo/:uid', conMiembro,
  h(async (req, res) => { await svc.quitar(c(req), P(req).id, P(req).uid); res.status(204).end(); }));

const invitaciones = express.Router();
invitaciones.post('/aceptar', validate(S.aceptar), h(async (req, res) => res.json(await svc.aceptarInvitacion(c(req), req.body))));

module.exports = { router, invitaciones };
