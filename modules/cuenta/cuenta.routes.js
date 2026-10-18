// modules/cuenta/cuenta.routes.js — la cuenta del usuario de la sesión (/api/v1/cuenta)
//
//   GET   /perfil                       datos del perfil (+ correo_pendiente: el correo nuevo sin confirmar)
//   PATCH /perfil                       {nombre, apellido, institucion, orcid, profesion, pais} (el correo no)
//   GET   /contrasena                   {requiere_actual}: si hay que escribir la contraseña actual
//   PUT   /contrasena                   {actual?, nueva} cambia la contraseña (límite «costoso»)
//   POST  /correo                       {nuevo, actual} pide el cambio de correo; Supabase envía la confirmación
//   PUT   /avatar                       la imagen en el cuerpo (PNG, JPG o WEBP, hasta 2 MB) → {ruta_imagen}
//   GET   /preferencias-notificacion    PUT /preferencias-notificacion {…booleanos}
//   GET   /sesiones                     dispositivos con la sesión abierta
//   GET   /sesion-vigente               {vigente}: ¿sigue abierta la sesión de este token?
//   POST  /sesiones/cerrar              {id} o {todas: true}; bloquea la cuenta 10 s (límite «costoso»)
//   POST  /aviso-inicio-sesion          correo «nuevo inicio de sesión» a la dirección del token (límite «correo»)
//   GET   /eliminacion                  qué se borraría: revisiones propias (y con cuántas personas), colaboraciones
//   DELETE /                            {confirmacion: correo de la cuenta} borra la cuenta y sus revisiones (204)
const express = require('express');
const limites = require('../../core/rateLimit');
const { validate } = require('../../core/validate');
const { asyncHandler: h } = require('../../core/asyncHandler');
const { contexto: c } = require('../../core/contexto');
const { HttpError } = require('../../core/httpError');
const S = require('./cuenta.schemas');
const svc = require('./cuenta.service');
const seguridad = require('./seguridad');

const router = express.Router();

router.get('/perfil', h(async (req, res) => res.json(await svc.perfil(c(req)))));
router.patch('/perfil', validate(S.perfil), h(async (req, res) => res.json(await svc.actualizarPerfil(c(req), req.body))));

router.get('/contrasena', h(async (req, res) => res.json(seguridad.estadoContrasena(c(req)))));
router.put('/contrasena', limites.costoso, validate(S.contrasena),
  h(async (req, res) => res.json(await seguridad.cambiarContrasena(c(req), req.body))));
router.post('/correo', limites.correo, validate(S.correo),
  h(async (req, res) => res.json(await seguridad.cambiarCorreo(c(req), req.body))));

/** Solo para esta ruta: el cuerpo es la imagen tal cual. */
const imagen = express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: svc.MAX_AVATAR });
const imagenAcotada = (req, res, next) => imagen(req, res, err => {
  if (err?.type === 'entity.too.large') return next(new HttpError(413, 'La imagen no debe superar los 2 MB.'));
  next(err);
});
router.put('/avatar', limites.costoso, imagenAcotada, h(async (req, res) => res.json(await svc.cambiarAvatar(c(req), req.body))));

router.get('/preferencias-notificacion', h(async (req, res) => res.json(await svc.preferencias(c(req)))));
router.put('/preferencias-notificacion', validate(S.preferencias),
  h(async (req, res) => res.json(await svc.guardarPreferencias(c(req), req.body))));

router.get('/sesiones', h(async (req, res) => res.json(await svc.sesiones(c(req)))));
router.get('/sesion-vigente', h(async (req, res) => res.json(await svc.sesionVigente(c(req)))));
router.post('/sesiones/cerrar', validate(S.cerrarSesion), limites.costoso,
  h(async (req, res) => res.json(await svc.cerrarSesion(c(req), req.body))));

router.post('/aviso-inicio-sesion', limites.correo,
  h(async (req, res) => res.json(await svc.avisoInicioSesion(c(req), { userAgent: req.get('user-agent'), ip: req.ip }))));

router.get('/eliminacion', h(async (req, res) => res.json(await svc.resumenEliminacion(c(req)))));
router.delete('/', limites.costoso, validate(S.eliminarCuenta),
  h(async (req, res) => { await svc.eliminarCuenta(c(req), req.body); res.status(204).end(); }));

module.exports = router;
