// modules/catalogos/catalogos.routes.js
//   GET /api/v1/catalogos/plantillas    → formatos de cita (APA 7, IEEE…) para elegir en una revisión
//   GET /api/v1/catalogos/metodologias  → frameworks de la pregunta (PICO, SPICE…) con sus componentes
//   GET /api/v1/catalogos/paises        → [{codigo, nombre}] en español (sin servicio externo)
// Lo que edita el administrador está en /api/v1/admin/catalogos.
const express = require('express');
const { asyncHandler: h } = require('../../core/asyncHandler');
const repo = require('./catalogos.repo');
const { paises } = require('./paises');

const router = express.Router();

router.get('/plantillas', h(async (req, res) => {
  res.set('Cache-Control', 'private, max-age=300');   // cambian poco: el navegador puede reutilizarlas 5 min
  res.json(await repo.plantillas(req.token));
}));

router.get('/metodologias', h(async (req, res) => {
  res.set('Cache-Control', 'private, max-age=300');
  res.json(await repo.metodologias(req.token));
}));

router.get('/paises', (req, res) => {
  res.set('Cache-Control', 'private, max-age=86400');   // no cambian: un día
  res.json(paises());
});

module.exports = router;
