// legacy/controllers/adminController.js
// La lógica vive en modules/admin/admin.service.js (la comparte con /api/v1/admin, incluidos los
// códigos de confirmación para dar el rol de administrador).
const { contexto } = require('../../core/contexto');
const svc = require('../../modules/admin/admin.service');

const resumen = async (req, res) => res.json(await svc.resumen(contexto(req)));
const usuarios = async (req, res) => res.json(await svc.usuarios(contexto(req), req.query));
const uso = async (req, res) => res.json(await svc.uso(contexto(req), req.query));
const setActivo = async (req, res) => res.json(await svc.setActivo(contexto(req), req.params.id, req.body.activo));
const pedirCodigoRol = async (req, res) => res.json(await svc.pedirCodigoRol(contexto(req), req.params.id));
const setRol = async (req, res) => res.json(await svc.setRol(contexto(req), req.params.id, req.body));

module.exports = { resumen, usuarios, uso, setActivo, setRol, pedirCodigoRol };
