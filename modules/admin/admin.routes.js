// modules/admin/admin.routes.js — panel de administración (/api/v1/admin). Exige rol admin en el token.
//
//   GET    /resumen                         GET /usuarios?q&page&size        GET /uso?desde&hasta
//   PATCH  /usuarios/:uid/activo {activo}   bloquea o desbloquea el inicio de sesión
//   POST   /usuarios/:uid/rol/codigo        paso 1 para promover: código al correo del admin (límite «correo»)
//   PATCH  /usuarios/:uid/rol {rol, codigo?}
//   GET    /revisiones?q&page&size&id_usuarios   todas las revisiones con su propietario
//   GET, POST /catalogos/metodologias       PUT, DELETE /catalogos/metodologias/:cid
//   GET, POST /catalogos/componentes        PUT, DELETE /catalogos/componentes/:cid   (?id_metodologia=)
//   GET    /catalogos/componentes/sigla?nombre&id_metodologia   sigla propuesta
//   GET, POST /catalogos/plantillas         PUT, DELETE /catalogos/plantillas/:cid
const express = require('express');
const limites = require('../../core/rateLimit');
const { requireAdmin } = require('../../core/auth');
const { validate } = require('../../core/validate');
const { asyncHandler: h } = require('../../core/asyncHandler');
const { contexto: c } = require('../../core/contexto');
const S = require('./admin.schemas');
const svc = require('./admin.service');

const router = express.Router();
router.use(requireAdmin);

const Q = req => req.valid.query;
const uid = req => req.valid.params.uid;
const cid = req => req.valid.params.cid;
const conUsuario = validate(S.usuario, 'params');
const conId = validate(S.conId, 'params');
const nada = res => res.status(204).end();

router.get('/resumen', h(async (req, res) => res.json(await svc.resumen(c(req)))));
router.get('/usuarios', validate(S.usuarios, 'query'), h(async (req, res) => res.json(await svc.usuarios(c(req), Q(req)))));
router.get('/uso', validate(S.uso, 'query'), h(async (req, res) => res.json(await svc.uso(c(req), Q(req)))));
router.patch('/usuarios/:uid/activo', conUsuario, validate(S.activo),
  h(async (req, res) => res.json(await svc.setActivo(c(req), uid(req), req.body.activo))));
router.post('/usuarios/:uid/rol/codigo', conUsuario, limites.correo,
  h(async (req, res) => res.json(await svc.pedirCodigoRol(c(req), uid(req)))));
router.patch('/usuarios/:uid/rol', conUsuario, validate(S.rol),
  h(async (req, res) => res.json(await svc.setRol(c(req), uid(req), req.body))));

router.get('/revisiones', validate(S.revisiones, 'query'), h(async (req, res) => res.json(await svc.revisiones(c(req), Q(req)))));

/* ---------- Catálogos ---------- */
const cat = express.Router();

cat.get('/metodologias', h(async (req, res) => res.json(await svc.listarMetodologias(c(req)))));
cat.post('/metodologias', validate(S.metodologia), h(async (req, res) => res.status(201).json(await svc.guardarMetodologia(c(req), null, req.body))));
cat.put('/metodologias/:cid', conId, validate(S.metodologia), h(async (req, res) => res.json(await svc.guardarMetodologia(c(req), cid(req), req.body))));
cat.delete('/metodologias/:cid', conId, h(async (req, res) => { await svc.borrarMetodologia(c(req), cid(req)); nada(res); }));

cat.get('/componentes/sigla', validate(S.sigla, 'query'), h(async (req, res) => res.json(await svc.siglaSugerida(c(req), Q(req)))));
cat.get('/componentes', validate(S.componentes, 'query'), h(async (req, res) => res.json(await svc.listarComponentes(c(req), Q(req)))));
cat.post('/componentes', validate(S.componente), h(async (req, res) => res.status(201).json(await svc.guardarComponente(c(req), null, req.body))));
cat.put('/componentes/:cid', conId, validate(S.componente), h(async (req, res) => res.json(await svc.guardarComponente(c(req), cid(req), req.body))));
cat.delete('/componentes/:cid', conId, h(async (req, res) => { await svc.borrarComponente(c(req), cid(req)); nada(res); }));

cat.get('/plantillas', h(async (req, res) => res.json(await svc.listarPlantillas(c(req)))));
cat.post('/plantillas', validate(S.plantilla), h(async (req, res) => res.status(201).json(await svc.guardarPlantilla(c(req), null, req.body))));
cat.put('/plantillas/:cid', conId, validate(S.plantilla), h(async (req, res) => res.json(await svc.guardarPlantilla(c(req), cid(req), req.body))));
cat.delete('/plantillas/:cid', conId, h(async (req, res) => { await svc.borrarPlantilla(c(req), cid(req)); nada(res); }));

router.use('/catalogos', cat);

module.exports = router;
