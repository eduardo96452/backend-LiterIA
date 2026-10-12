// modules/dashboard/dashboard.routes.js
//   GET /api/v1/dashboard → { progreso_disponible, revisiones: [{ …fn_progreso_usuario, favorita, oculta }] }
const express = require('express');
const { asyncHandler: h } = require('../../core/asyncHandler');
const { contexto } = require('../../core/contexto');
const svc = require('./dashboard.service');

const router = express.Router();

router.get('/', h(async (req, res) => res.json(await svc.resumen(contexto(req)))));

module.exports = router;
