// legacy/publicas.js
// Las dos rutas /api/* que se quedan aunque se apague la API antigua (LEGACY_API=off):
//   GET  /api/health   para el monitoreo de Render
//   POST /api/contact  formulario público de contacto (sin sesión, límite estricto por IP)
const express = require('express');
const limites = require('../core/rateLimit');
const { validate } = require('../core/validate');
const { asyncHandler } = require('../core/asyncHandler');
const S = require('./schemas');
const { sendContactMessage } = require('./controllers/contactController');

const router = express.Router();

router.get('/health', (_req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()) }));
router.post('/contact', limites.contacto, validate(S.contact), asyncHandler(sendContactMessage));

module.exports = router;
