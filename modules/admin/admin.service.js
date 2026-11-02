// modules/admin/admin.service.js
// Panel de administración. Solo llega aquí quien tiene app_metadata.rol = 'admin' en el token
// (requireAdmin) y, además, cada función fn_admin_* vuelve a comprobar is_admin() en la base.
// Las lecturas van como el usuario (las políticas *_admin_select le dejan ver todo); service_role
// solo para bloquear o desbloquear el inicio de sesión y leer el correo de una cuenta.
// También lo usan las rutas antiguas /api/admin/* mientras existan (comparten los códigos).
const crypto = require('crypto');
const env = require('../../config/env');
const logger = require('../../core/logger');
const sb = require('../../infra/supabase');
const email = require('../../infra/email');
const consensusCli = require('../../infra/consensus');
const { resumirConsensus, limites } = require('./consensus.resumen');
const { HttpError } = require('../../core/httpError');

const cliente = ctx => sb.forUser(ctx.token);
function datos({ data, error, count }) {
  if (error) throw sb.fromSupabaseError(error);
  return { data, count };
}

/* ---------- Resumen, usuarios y uso ---------- */

/** Cifras de la plataforma y qué servicios externos están configurados (sin ningún secreto). */
async function resumen(ctx) {
  const r = await sb.rpc(cliente(ctx), 'fn_admin_resumen');
  return {
    ...(r || {}),
    servicios: {
      openai: Boolean(env.OPENAI_API_KEY),
      correo: Boolean(env.mailEnabled),
      consensus: consensusCli.estadoClaves().length
    }
  };
}

const FILTROS_USUARIOS = {
  todas: () => true,
  activas: u => u.activo !== false,
  desactivadas: u => u.activo === false,
  admins: u => u.rol === 'admin'
};

/**
 * Página de usuarios con su foto y cuántas cuentas hay en cada filtro (sql/016). Sin ese script,
 * la función de antes (sin filtro): se filtra la página que llega y no hay conteos.
 */
async function usuarios(ctx, { q = '', page = 1, size = 25, filtro = 'todas' }) {
  const pagina = Number(page) || 1;
  const base = { q: String(q).slice(0, 100), p_page: pagina, p_size: Math.min(Number(size) || 25, 100) };
  let filas, conFiltro = true;
  try {
    filas = await sb.rpc(cliente(ctx), 'fn_admin_usuarios', { ...base, p_filtro: filtro });
  } catch (e) {
    if (e.status !== 501) throw e;
    conFiltro = false;
    filas = (await sb.rpc(cliente(ctx), 'fn_admin_usuarios', base) || []).filter(FILTROS_USUARIOS[filtro] || FILTROS_USUARIOS.todas);
  }
  filas = filas || [];
  const primera = filas[0];
  const conteos = conFiltro && primera && primera.n_todas !== undefined
    ? { todas: Number(primera.n_todas), activas: Number(primera.n_activas), desactivadas: Number(primera.n_desactivadas), admins: Number(primera.n_admins) }
    : null;
  return {
    usuarios: filas.map(({ n_todas: _a, n_activas: _b, n_desactivadas: _c, n_admins: _d, ...u }) => u),
    total: conFiltro ? Number(primera?.total ?? 0) : filas.length,
    page: pagina,
    conteos
  };
}

function uso(ctx, { desde, hasta }) {
  const params = {};
  if (desde) params.desde = new Date(desde).toISOString();
  if (hasta) params.hasta = new Date(hasta).toISOString();
  return sb.rpc(cliente(ctx), 'fn_admin_uso', params);
}

/** Activar o desactivar: marca el perfil (RPC) y bloquea o desbloquea el inicio de sesión (service_role). */
async function setActivo(ctx, id, activo) {
  if (id === ctx.user.id) throw new HttpError(400, 'No puedes desactivar tu propia cuenta.');
  await sb.rpc(cliente(ctx), 'fn_admin_set_activo', { p_id: id, p_activo: activo });
  const { error } = await sb.admin().auth.admin.updateUserById(id, {
    ban_duration: activo ? 'none' : '876000h'   // ~100 años = bloqueo indefinido
  });
  if (error) throw new HttpError(502, `No se pudo ${activo ? 'reactivar' : 'bloquear'} el acceso: ${error.message}`);
  return { id, activo };
}

/* ---- Confirmación en dos pasos para dar el rol de administrador ----
 * Promover a alguien es una acción delicada: se exige un código que llega al correo de quien la
 * solicita. Se guarda en memoria (con una instancia basta; si el servidor se reinicia, se pide otro).
 */
const CODIGOS = new Map();            // `${adminId}:${objetivoId}` -> { codigo, expira, intentos }
const VIGENCIA_MS = 10 * 60 * 1000;
const MAX_INTENTOS = 5;
const clave = (adminId, objetivoId) => `${adminId}:${objetivoId}`;

function enmascarar(correo = '') {
  const [nombre, dominio] = correo.split('@');
  if (!dominio) return correo;
  return `${nombre.slice(0, 2)}${'*'.repeat(Math.max(nombre.length - 2, 1))}@${dominio}`;
}

/** Paso 1: genera el código y lo envía al correo del administrador que lo pide. */
async function pedirCodigoRol(ctx, id) {
  if (!env.mailEnabled) throw new HttpError(503, 'El envío de correo no está configurado en el servidor.');
  const { data, error } = await sb.admin().auth.admin.getUserById(id);
  if (error || !data?.user) throw new HttpError(404, 'No se encontró ese usuario.');

  const codigo = String(crypto.randomInt(100000, 1000000));   // generador criptográfico
  CODIGOS.set(clave(ctx.user.id, id), { codigo, expira: Date.now() + VIGENCIA_MS, intentos: 0 });
  await email.sendAdminCodeMail({ to: ctx.user.email, codigo, destinatario: data.user.email, minutos: VIGENCIA_MS / 60000 });

  logger.info('codigo_rol_enviado', { objetivo: id });
  return { enviado: true, correo: enmascarar(ctx.user.email), minutos: VIGENCIA_MS / 60000 };
}

/** Paso 2. Solo promover exige el código; quitar el rol no debe depender del correo. */
async function setRol(ctx, id, { rol, codigo }) {
  if (id === ctx.user.id && rol !== 'admin') throw new HttpError(400, 'No puedes quitarte el rol de administrador a ti mismo.');
  if (rol === 'admin') {
    const k = clave(ctx.user.id, id);
    const registro = CODIGOS.get(k);
    if (!registro || registro.expira < Date.now()) {
      CODIGOS.delete(k);
      throw new HttpError(400, 'El código ha caducado. Solicita uno nuevo.');
    }
    registro.intentos += 1;
    if (registro.intentos > MAX_INTENTOS) {
      CODIGOS.delete(k);
      throw new HttpError(429, 'Demasiados intentos. Solicita un código nuevo.');
    }
    if (String(codigo || '').trim() !== registro.codigo) throw new HttpError(400, 'El código no es correcto.');
    CODIGOS.delete(k);
  }
  await sb.rpc(cliente(ctx), 'fn_admin_set_rol', { p_id: id, p_rol: rol });
  return { id, rol, nota: 'El usuario debe cerrar sesión y volver a entrar para que el rol aparezca en su token.' };
}

/* ---------- Revisiones de toda la plataforma ---------- */

/**
 * Página de revisiones con su propietario. El propietario se pide aparte: entre detalles_revision y
 * usuarios hay dos caminos (el dueño y colaboradores_revision) y el embebido de PostgREST falla.
 */
async function revisiones(ctx, { q = '', page = 1, size = 20, id_usuarios, tipo }) {
  const texto = String(q).trim().replace(/[%_\\]/g, m => `\\${m}`);   // comodines como texto literal
  try {
    const r = await sb.rpc(cliente(ctx), 'fn_admin_revisiones', {
      q: texto, p_page: page, p_size: size, p_id_usuarios: id_usuarios ?? null, p_tipo: tipo || null
    });
    return { revisiones: r?.revisiones || [], total: Number(r?.total ?? 0), page, tipos: r?.tipos || [] };
  } catch (e) {
    if (e.status !== 501) throw e;   // sin sql/016: la consulta de antes (sin equipo ni estudios)
  }
  return revisionesSinConteos(ctx, { texto, page, size, id_usuarios, tipo });
}

async function revisionesSinConteos(ctx, { texto, page, size, id_usuarios, tipo }) {
  const desde = (page - 1) * size;
  let consulta = cliente(ctx).from('detalles_revision')
    .select('id_detalles_revision, titulo_revision, tipo_revision, fecha_creacion, fecha_modificacion, id_usuarios', { count: 'exact' })
    .order('fecha_creacion', { ascending: false })
    .range(desde, desde + size - 1);
  if (texto) consulta = consulta.ilike('titulo_revision', `%${texto}%`);
  if (id_usuarios) consulta = consulta.eq('id_usuarios', id_usuarios);
  if (tipo) consulta = consulta.eq('tipo_revision', tipo);
  const { data, count } = datos(await consulta);
  const filas = data || [];

  const ids = [...new Set(filas.map(r => r.id_usuarios).filter(Boolean))];
  const porId = new Map();
  if (ids.length) {
    const { data: duenos } = datos(await cliente(ctx).from('usuarios')
      .select('id_usuarios, nombre_usuario, correo_electronico').in('id_usuarios', ids));
    for (const u of duenos || []) porId.set(u.id_usuarios, { nombre_usuario: u.nombre_usuario, correo_electronico: u.correo_electronico });
  }
  return { revisiones: filas.map(r => ({ ...r, usuarios: porId.get(r.id_usuarios) ?? null })), total: count ?? 0, page, tipos: [] };
}

/** En cuántas revisiones se usa cada marco y cada formato (sql/016). Sin el script, vacío. */
async function usoCatalogos(ctx) {
  try {
    return await sb.rpc(cliente(ctx), 'fn_admin_uso_catalogos') || { metodologias: {}, plantillas: {} };
  } catch (e) {
    if (e.status !== 501) throw e;
    return { metodologias: {}, plantillas: {} };
  }
}

/* ---------- Consensus: lo que queda y lo que cuesta cada clave ----------
 * Su API no informa del saldo: lo cuenta LiterIA (consensus_uso) y se junta con lo que el servidor
 * sabe en memoria de cada clave. La base solo recibe huellas; las claves no salen del servidor.
 */
async function consensus(ctx, ahora = new Date()) {
  const estados = consensusCli.estadoClaves();
  let datos = null, sinRegistro = false;
  if (estados.length) {
    try {
      datos = await sb.rpc(cliente(ctx), 'fn_admin_consensus', { p_claves: estados.map(e => e.huella) });
    } catch (e) {
      if (e.status !== 501) throw e;
      sinRegistro = true;   // falta sql/016: se muestra lo que hay en memoria
    }
  }
  return resumirConsensus(estados, datos, ahora, sinRegistro, { consultasPorSeccion: env.CONSENSUS_MAX_CONSULTAS });
}

/** Plan, nombre y gasto fijo de una clave; opcionalmente, lo usado según el panel de Consensus. */
async function guardarConsensus(ctx, huella, cuerpo) {
  if (!consensusCli.estadoClaves().some(e => e.huella === huella)) {
    throw new HttpError(404, 'Esa clave ya no está configurada en el servidor (CONSENSUS_API_KEY).');
  }
  const { incluidas, maximo, usoAdicional } = limites(cuerpo.plan, cuerpo);
  await sb.rpc(cliente(ctx), 'fn_admin_guardar_consensus_clave', {
    p_clave: huella,
    p_nombre: cuerpo.nombre,
    p_plan: cuerpo.plan,
    p_incluidas: incluidas,
    p_maximo: maximo,
    p_uso_adicional: usoAdicional,
    p_costo_mensual: cuerpo.costo_mensual,
    p_sync_usadas: cuerpo.sync_usadas ?? null,
    p_reactivar: cuerpo.reactivar
  });
  if (cuerpo.reactivar) consensusCli.reactivar(huella);
  logger.info('consensus_clave_guardada', { plan: cuerpo.plan, sincronizada: cuerpo.sync_usadas != null, reactivada: cuerpo.reactivar });
  return consensus(ctx);
}

/* ---------- Catálogos: frameworks, sus componentes y formatos de cita ---------- */

const DUPLICADO = {
  metodologias: 'Ya existe una metodología con ese nombre.',
  componentes: 'Ya existe un componente con esa sigla en esta metodología.',
  plantillas: 'Ya existe un formato con ese nombre.'
};
async function catalogo(tipo, fn) {
  try {
    return await fn();
  } catch (e) {
    if (e.status === 409) throw new HttpError(409, DUPLICADO[tipo]);
    throw e;
  }
}

async function listarMetodologias(ctx) {
  const { data } = datos(await cliente(ctx).from('metodologias')
    .select('id_metodologia, nombre, descripcion, es_sistema').order('id_metodologia'));
  return data || [];
}
const guardarMetodologia = (ctx, id, { nombre, descripcion }) => catalogo('metodologias', () =>
  sb.rpc(cliente(ctx), 'fn_admin_guardar_metodologia', { p_id: id, p_nombre: nombre, p_descripcion: descripcion }));
const borrarMetodologia = (ctx, id) => sb.rpc(cliente(ctx), 'fn_admin_borrar_metodologia', { p_id: id });

async function listarComponentes(ctx, { id_metodologia }) {
  let q = cliente(ctx).from('componente')
    .select('id_componente, nombre, sigla, descripcion, id_metodologia, es_sistema').order('id_componente');
  if (id_metodologia) q = q.eq('id_metodologia', id_metodologia);
  const { data } = datos(await q);
  return data || [];
}
const guardarComponente = (ctx, id, { id_metodologia, nombre, descripcion, sigla }) => catalogo('componentes', () =>
  sb.rpc(cliente(ctx), 'fn_admin_guardar_componente', {
    p_id: id, p_id_metodologia: id_metodologia ?? null, p_nombre: nombre, p_descripcion: descripcion, p_sigla: sigla
  }));
const borrarComponente = (ctx, id) => sb.rpc(cliente(ctx), 'fn_admin_borrar_componente', { p_id: id });

/** Sigla propuesta a partir del nombre; la calcula la base para no repetir una existente. */
async function siglaSugerida(ctx, { nombre, id_metodologia }) {
  return { sigla: String((await sb.rpc(cliente(ctx), 'fn_sigla_sugerida', { p_nombre: nombre, p_id_metodologia: id_metodologia ?? null })) ?? '') };
}

async function listarPlantillas(ctx) {
  const { data } = datos(await cliente(ctx).from('plantillas_formato')
    .select('id_plantilla, nombre, estilo_cita, cita_en_texto, descripcion, es_sistema').order('id_plantilla'));
  return data || [];
}
const guardarPlantilla = (ctx, id, { nombre, estilo_cita, cita_en_texto, descripcion }) => catalogo('plantillas', () =>
  sb.rpc(cliente(ctx), 'fn_admin_guardar_plantilla', {
    p_id: id, p_nombre: nombre, p_estilo_cita: estilo_cita, p_cita_en_texto: cita_en_texto, p_descripcion: descripcion
  }));
const borrarPlantilla = (ctx, id) => sb.rpc(cliente(ctx), 'fn_admin_borrar_plantilla', { p_id: id });

module.exports = {
  resumen, usuarios, uso, setActivo, pedirCodigoRol, setRol, revisiones, enmascarar, CODIGOS,
  consensus, guardarConsensus, usoCatalogos,
  listarMetodologias, guardarMetodologia, borrarMetodologia,
  listarComponentes, guardarComponente, borrarComponente, siglaSugerida,
  listarPlantillas, guardarPlantilla, borrarPlantilla
};
