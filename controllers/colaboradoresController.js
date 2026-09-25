// controllers/colaboradoresController.js  (Tanda C, mejora 4)
// La lógica de permisos vive en la base (fn_invitar_colaborador); aquí solo se envía el correo
// cuando la persona invitada aún no tiene cuenta.
const env = require('../config/env');
const logger = require('../utils/logger');
const { forUser, rpc, fromSupabaseError } = require('../services/supabaseService');
const { sendInvitationMail } = require('../services/emailService');

/** POST /api/colaboradores/invitar  { id_detalles_revision, correo, rol } */
async function invitar(req, res) {
  const { id_detalles_revision, correo, rol } = req.body;
  const sb = forUser(req.token);

  const r = await rpc(sb, 'fn_invitar_colaborador', { p_id_rev: id_detalles_revision, p_correo: correo, p_rol: rol });

  let correo_enviado = false;
  if (r?.tipo === 'invitacion_enviada' && env.mailEnabled) {
    const { data: rev, error } = await sb.from('detalles_revision').select('titulo_revision').eq('id_detalles_revision', id_detalles_revision).single();
    if (error) throw fromSupabaseError(error);
    try {
      await sendInvitationMail({
        to: correo, rol, invitadoPor: req.user?.email || 'Un colega',
        tituloRevision: rev?.titulo_revision || 'una revisión',
        enlace: `${env.FRONTEND_URL}/invitacion?token=${r.token}`
      });
      correo_enviado = true;
    } catch (e) {
      logger.warn('invitacion_email_error', { message: e.message });
    }
  }
  // El token NO se devuelve al cliente si el correo salió: solo debe llegarle al invitado
  const { token, ...resto } = r || {};
  res.json({ ...resto, correo_enviado, ...(correo_enviado ? {} : { token }) });
}

module.exports = { invitar };
