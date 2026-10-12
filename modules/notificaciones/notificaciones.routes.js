// modules/notificaciones/notificaciones.routes.js — bandeja del usuario de la sesión (/api/v1/notificaciones)
//
//   GET  /?solo_no_leidas=true&limite=30   las más recientes primero (fn_mis_notificaciones)
//   POST /leidas                           {ids?: [..]} sin ids marca todas → {marcadas}
//
// El aviso en tiempo real (canal Realtime de Supabase) sigue en el navegador: solo dice «hay algo
// nuevo» y la pantalla vuelve a pedir la bandeja aquí.
const express = require('express');
const { z } = require('zod');
const { validate } = require('../../core/validate');
const { asyncHandler: h } = require('../../core/asyncHandler');
const sb = require('../../infra/supabase');

const consulta = z.object({
  solo_no_leidas: z.enum(['true', 'false', '1', '0']).optional().transform(v => v === 'true' || v === '1'),
  limite: z.coerce.number().int().min(1).max(200).default(30)
});
const leidas = z.object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(500).optional() }).strict();

const router = express.Router();

router.get('/', validate(consulta, 'query'), h(async (req, res) => {
  const { solo_no_leidas, limite } = req.valid.query;
  const filas = await sb.rpc(sb.forUser(req.token), 'fn_mis_notificaciones', { p_solo_no_leidas: solo_no_leidas, p_limite: limite });
  res.json(filas || []);
}));

router.post('/leidas', validate(leidas), h(async (req, res) => {
  const n = await sb.rpc(sb.forUser(req.token), 'fn_marcar_notificaciones', { p_ids: req.body.ids ?? null });
  res.json({ marcadas: Number(n) || 0 });
}));

module.exports = router;
