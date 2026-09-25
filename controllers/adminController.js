// controllers/adminController.js
// Panel de administración. Requiere JWT con app_metadata.rol = 'admin' (middleware requireAdmin).
// Las agregaciones las hacen las funciones SQL del esquema (fn_admin_*); aquí solo se orquesta.
const { forUser, admin, rpc } = require('../services/supabaseService');
const { HttpError } = require('../utils/httpError');

async function resumen(req, res) {
  res.json(await rpc(forUser(req.token), 'fn_admin_resumen'));
}

async function usuarios(req, res) {
  const { q = '', page = 1, size = 25 } = req.query;
  const data = await rpc(forUser(req.token), 'fn_admin_usuarios', {
    q: String(q).slice(0, 100), p_page: Number(page) || 1, p_size: Math.min(Number(size) || 25, 100)
  });
  res.json({ usuarios: data, total: data?.[0]?.total ?? 0, page: Number(page) || 1 });
}

async function uso(req, res) {
  const { desde, hasta } = req.query;
  const params = {};
  if (desde) params.desde = new Date(desde).toISOString();
  if (hasta) params.hasta = new Date(hasta).toISOString();
  res.json(await rpc(forUser(req.token), 'fn_admin_uso', params));
}

/** Activar/desactivar: marca el perfil (RPC) y bloquea/desbloquea el login (service_role). */
async function setActivo(req, res) {
  const { id } = req.params;
  const { activo } = req.body;
  if (id === req.user.id) throw new HttpError(400, 'No puedes desactivar tu propia cuenta.');

  await rpc(forUser(req.token), 'fn_admin_set_activo', { p_id: id, p_activo: activo });

  const { error } = await admin().auth.admin.updateUserById(id, {
    ban_duration: activo ? 'none' : '876000h'   // ~100 años = bloqueo indefinido
  });
  if (error) throw new HttpError(502, `No se pudo ${activo ? 'reactivar' : 'bloquear'} el acceso: ${error.message}`);

  res.json({ id, activo });
}

async function setRol(req, res) {
  const { id } = req.params;
  const { rol } = req.body;
  if (id === req.user.id && rol !== 'admin') throw new HttpError(400, 'No puedes quitarte el rol de administrador a ti mismo.');
  await rpc(forUser(req.token), 'fn_admin_set_rol', { p_id: id, p_rol: rol });
  res.json({ id, rol, nota: 'El usuario debe cerrar sesión y volver a entrar para que el rol aparezca en su token.' });
}

module.exports = { resumen, usuarios, uso, setActivo, setRol };
