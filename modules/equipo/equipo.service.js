// modules/equipo/equipo.service.js
// Equipo de una revisión: miembros, invitaciones, cambio de rol y baja. Los permisos los deciden las
// funciones de la base (solo el propietario invita, cambia roles o quita; nadie toca al creador);
// aquí se comprueba antes que la revisión existe para el usuario (404 si no) y se envía el correo.
const env = require('../../config/env');
const logger = require('../../core/logger');
const sb = require('../../infra/supabase');
const email = require('../../infra/email');
const revisiones = require('../revisiones/revisiones.service');

const cliente = ctx => sb.forUser(ctx.token);

async function equipo(ctx, idRev) {
  const [, miembros] = await Promise.all([
    revisiones.obtener(ctx, idRev),
    sb.rpc(cliente(ctx), 'fn_equipo_revision', { p_id_rev: idRev })
  ]);
  return miembros || [];
}

/** Rol del usuario en la revisión (propietario, revisor o lector), o null si no es del equipo. */
async function miRol(ctx, idRev) {
  const miembros = await equipo(ctx, idRev);
  return { rol: miembros.find(m => m.id_usuarios === ctx.user.id)?.rol ?? null };
}

/**
 * Invita por correo. Si la persona ya tiene cuenta, entra directo; si no, recibe un enlace.
 * El token de la invitación solo vuelve al cliente si el correo NO salió (para pasarlo a mano).
 * También lo usa la ruta antigua POST /api/colaboradores/invitar mientras exista.
 */
async function invitar(ctx, idRev, { correo, rol }) {
  const cl = cliente(ctx);
  const r = await sb.rpc(cl, 'fn_invitar_colaborador', { p_id_rev: idRev, p_correo: correo, p_rol: rol });

  let correo_enviado = false;
  if (r?.tipo === 'invitacion_enviada' && env.mailEnabled) {
    const { data: rev, error } = await cl.from('detalles_revision').select('titulo_revision').eq('id_detalles_revision', idRev).single();
    if (error) throw sb.fromSupabaseError(error);
    try {
      await email.sendInvitationMail({
        to: correo, rol, invitadoPor: ctx.user?.email || 'Un colega', nombreInvitador: ctx.user?.nombre || null,
        tituloRevision: rev?.titulo_revision || 'una revisión',
        enlace: `${env.FRONTEND_URL}/invitacion?token=${r.token}`
      });
      correo_enviado = true;
    } catch (e) {
      logger.warn('invitacion_email_error', { message: e.message });
    }
  }
  const { token, ...resto } = r || {};
  return { ...resto, correo_enviado, ...(correo_enviado ? {} : { token }) };
}

async function cambiarRol(ctx, idRev, idUsuario, { rol }) {
  await revisiones.obtener(ctx, idRev);
  await sb.rpc(cliente(ctx), 'fn_cambiar_rol_colaborador', { p_id_rev: idRev, p_id_usuario: idUsuario, p_rol: rol });
  return { id_usuarios: idUsuario, rol };
}

async function quitar(ctx, idRev, idUsuario) {
  await revisiones.obtener(ctx, idRev);
  await sb.rpc(cliente(ctx), 'fn_quitar_colaborador', { p_id_rev: idRev, p_id_usuario: idUsuario });
}

/** El correo de la invitación se compara en la base con el correo verificado de la sesión. */
function aceptarInvitacion(ctx, { token }) {
  return sb.rpc(cliente(ctx), 'fn_aceptar_invitacion', { p_token: token });
}

module.exports = { equipo, miRol, invitar, cambiarRol, quitar, aceptarInvitacion };
