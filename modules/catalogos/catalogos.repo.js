// modules/catalogos/catalogos.repo.js
// Catálogos de solo lectura para cualquier usuario con sesión. Consultas como el usuario:
// con el parche 3, cada uno ve las plantillas del sistema y las suyas.
const sb = require('../../infra/supabase');

async function plantillas(token) {
  const { data, error } = await sb.forUser(token).from('plantillas_formato')
    .select('id_plantilla, nombre, estilo_cita, cita_en_texto, descripcion')
    .order('id_plantilla');
  if (error) throw sb.fromSupabaseError(error);
  return data || [];
}

/** Frameworks (PICO, SPICE… y los que añada un administrador) con sus componentes en orden. */
async function metodologias(token) {
  const { data, error } = await sb.forUser(token).from('metodologias')
    .select('id_metodologia, nombre, descripcion, componente(id_componente, nombre, sigla, descripcion)')
    .order('id_metodologia');
  if (error) throw sb.fromSupabaseError(error);
  return (data || []).map(m => ({
    id_metodologia: m.id_metodologia,
    nombre: m.nombre,
    descripcion: m.descripcion ?? null,
    componentes: (m.componente || [])
      .map(c => ({ id_componente: c.id_componente, nombre: c.nombre, sigla: String(c.sigla || '').toUpperCase(), descripcion: c.descripcion ?? null }))
      .sort((a, b) => a.id_componente - b.id_componente)
  }));
}

module.exports = { plantillas, metodologias };
