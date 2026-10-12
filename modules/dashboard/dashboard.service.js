// modules/dashboard/dashboard.service.js
// Panel principal en UNA petición: lo que hoy el frontend arma con fn_progreso_usuario +
// preferencias_revision (favorita/oculta) y, si la función no existe, con la tabla.
const sb = require('../../infra/supabase');
const revRepo = require('../revisiones/revisiones.repo');

async function progresoUsuario(token) {
  try {
    return { filas: (await sb.rpc(sb.forUser(token), 'fn_progreso_usuario')) || [], conProgreso: true };
  } catch (e) {
    if (e.status !== 501) throw e;
    // Respaldo si fn_progreso_usuario no está instalada: las revisiones visibles, sin progreso.
    const revs = await revRepo.listar(token);
    return {
      filas: revs.map(r => ({
        id_detalles_revision: r.id_detalles_revision,
        titulo_revision: r.titulo_revision,
        fecha_modificacion: r.fecha_modificacion,
        estudios: 0, aceptados: 0, progreso: 0
      })),
      conProgreso: false
    };
  }
}

async function resumen(ctx) {
  const [{ filas, conProgreso }, prefs] = await Promise.all([
    progresoUsuario(ctx.token),
    revRepo.preferencias(ctx.token)
  ]);
  const porRevision = new Map(prefs.map(p => [Number(p.id_detalles_revision), p]));
  return {
    progreso_disponible: conProgreso,
    revisiones: filas.map(f => {
      const p = porRevision.get(Number(f.id_detalles_revision));
      return { ...f, progreso: Number(f.progreso) || 0, favorita: !!p?.favorita, oculta: !!p?.oculta };
    })
  };
}

module.exports = { resumen };
