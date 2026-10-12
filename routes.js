// routes.js
// Monta las dos generaciones de la API:
//   /api/v1/*  → API por módulos (siempre con JWT, límites por usuario). La usa todo el frontend.
//   /api/*     → rutas antiguas (legacy/routes.js), para el frontend anterior a la v3.5.0. Con
//                LEGACY_API=off solo quedan /api/health y /api/contact (legacy/publicas.js).
const express = require('express');
const env = require('./config/env');
const limites = require('./core/rateLimit');
const { authJwt } = require('./core/auth');
const { notFound } = require('./core/errorHandler');
const equipo = require('./modules/equipo/equipo.routes');

const v1 = express.Router();
v1.use(authJwt, limites.usuario);                       // todo /api/v1 exige sesión
v1.use('/revisiones', require('./modules/revisiones/revisiones.routes'));
v1.use('/revisiones/:id', require('./modules/informes/informes.routes'));     // secciones, IA, PRISMA, Word
v1.use('/revisiones/:id', require('./modules/estudios/estudios.routes'));     // estudios, PDF, calidad, importar, cribado
v1.use('/revisiones/:id', require('./modules/planificacion/planificacion.routes'));   // framework, palabras clave, bases, criterios, calidad, IA
v1.use('/revisiones/:id', require('./modules/extraccion/extraccion.routes'));         // extracción de datos e IA sobre el PDF
v1.use('/revisiones/:id', equipo.router);                                              // equipo, invitaciones, mi rol
v1.use('/invitaciones', equipo.invitaciones);                                          // aceptar una invitación
v1.use('/dashboard', require('./modules/dashboard/dashboard.routes'));
v1.use('/catalogos', require('./modules/catalogos/catalogos.routes'));
v1.use('/cuenta', require('./modules/cuenta/cuenta.routes'));
v1.use('/notificaciones', require('./modules/notificaciones/notificaciones.routes'));
v1.use('/referencias', require('./modules/referencias/referencias.routes'));
v1.use('/admin', require('./modules/admin/admin.routes'));                              // exige rol admin
v1.use(notFound);                                       // una ruta v1 desconocida no cae en las antiguas

const router = express.Router();
router.use('/api', limites.ip);                         // antes de autenticar, holgado
router.use('/api/v1', v1);
router.use('/api', env.legacyApi ? require('./legacy/routes') : require('./legacy/publicas'));

module.exports = router;
