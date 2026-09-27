// controllers/adminController.js
// Panel de administración. Requiere JWT con app_metadata.rol = 'admin' (middleware requireAdmin).
// Las agregaciones las hacen las funciones SQL del esquema (fn_admin_*); aquí solo se orquesta.
const { forUser, admin, rpc } = require('../services/supabaseService');
const { HttpError } = require('../utils/httpError');
const { sendAdminCodeMail } = require('../services/emailService');
const env = require('../config/env');
const logger = require('../utils/logger');

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

/* ---- Confirmación en dos pasos para dar el rol de administrador ----
 * Promover a alguien es una acción delicada, así que se exige un código que llega al
 * correo de quien la solicita. Se guarda en memoria: si el servidor se reinicia, basta
 * con pedir otro código.
 */
const CODIGOS = new Map();            // `${adminId}:${objetivoId}` -> { codigo, expira, intentos }
const VIGENCIA_MS = 10 * 60 * 1000;
const MAX_INTENTOS = 5;

function clave(adminId, objetivoId) { return `${adminId}:${objetivoId}`; }

/** Paso 1: genera el código y lo envía al correo del administrador que lo pide. */
async function pedirCodigoRol(req, res) {
  const { id } = req.params;
  if (!env.mailEnabled) throw new HttpError(503, 'El envío de correo no está configurado en el servidor.');

  const { data, error } = await admin().auth.admin.getUserById(id);
  if (error || !data?.user) throw new HttpError(404, 'No se encontró ese usuario.');

  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  CODIGOS.set(clave(req.user.id, id), { codigo, expira: Date.now() + VIGENCIA_MS, intentos: 0 });

  await sendAdminCodeMail({
    to: req.user.email,
    codigo,
    destinatario: data.user.email,
    minutos: VIGENCIA_MS / 60000
  });

  logger.info('codigo_rol_enviado', { objetivo: id });
  res.json({ enviado: true, correo: enmascarar(req.user.email), minutos: VIGENCIA_MS / 60000 });
}

function enmascarar(correo = '') {
  const [nombre, dominio] = correo.split('@');
  if (!dominio) return correo;
  const visible = nombre.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(nombre.length - 2, 1))}@${dominio}`;
}

async function setRol(req, res) {
  const { id } = req.params;
  const { rol, codigo } = req.body;
  if (id === req.user.id && rol !== 'admin') throw new HttpError(400, 'No puedes quitarte el rol de administrador a ti mismo.');

  // Solo promover exige código; quitar el rol no debe quedar bloqueado por el correo
  if (rol === 'admin') {
    const registro = CODIGOS.get(clave(req.user.id, id));
    if (!registro || registro.expira < Date.now()) {
      CODIGOS.delete(clave(req.user.id, id));
      throw new HttpError(400, 'El código ha caducado. Solicita uno nuevo.');
    }
    registro.intentos += 1;
    if (registro.intentos > MAX_INTENTOS) {
      CODIGOS.delete(clave(req.user.id, id));
      throw new HttpError(429, 'Demasiados intentos. Solicita un código nuevo.');
    }
    if (String(codigo || '').trim() !== registro.codigo) {
      throw new HttpError(400, 'El código no es correcto.');
    }
    CODIGOS.delete(clave(req.user.id, id));
  }

  await rpc(forUser(req.token), 'fn_admin_set_rol', { p_id: id, p_rol: rol });
  res.json({ id, rol, nota: 'El usuario debe cerrar sesión y volver a entrar para que el rol aparezca en su token.' });
}

module.exports = { resumen, usuarios, uso, setActivo, setRol, pedirCodigoRol };
