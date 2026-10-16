// modules/informes/prisma.js
// Cifras de la revisión calculadas en el servidor, para que el texto que redacta la IA diga
// exactamente lo mismo que el diagrama PRISMA y las tablas. La IA nunca cuenta: recibe estas cifras.
//
// El diagrama PRISMA se calcula igual que en la pantalla (prisma.model.ts → construirPrismaDesdeEstudios):
//   identificados por fuente → duplicados → cribados → excluidos en el cribado (rechazados sin criterio)
//   → evaluados a texto completo (aceptados + rechazados con criterio) → excluidos con motivo → incluidos.

const estadoDe = e => String(e?.estado ?? '').trim().toLowerCase();
const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);

/** Códigos de los criterios en el orden de Planificación: CI1, CI2… y CE1, CE2… */
function codigosCriterios(criterios) {
  let i = 0, e = 0;
  return criterios.map(c => ({
    ...c,
    codigo: c.tipo === 'inclusion' ? `CI${++i}` : `CE${++e}`
  }));
}

function contarPrisma(estudios, criterios) {
  const exclusion = codigosCriterios(criterios).filter(c => c.tipo !== 'inclusion');
  const porFuente = new Map();
  for (const e of estudios) {
    const f = String(e.fuente_bibliografica ?? '').trim() || 'Sin especificar';
    porFuente.set(f, (porFuente.get(f) ?? 0) + 1);
  }
  const duplicados = estudios.filter(e => estadoDe(e) === 'duplicado').length;
  const aceptados = estudios.filter(e => estadoDe(e) === 'aceptado').length;
  const rechazados = estudios.filter(e => estadoDe(e) === 'rechazado');
  const sinCriterio = rechazados.filter(e => e.id_criterio == null).length;
  const conCriterio = rechazados.filter(e => e.id_criterio != null);
  const cribados = estudios.length - duplicados;

  const motivos = exclusion
    .map(c => ({ codigo: c.codigo, motivo: c.descripcion, n: conCriterio.filter(e => Number(e.id_criterio) === Number(c.id_criterios)).length }))
    .filter(m => m.n > 0);
  const conocidos = new Set(exclusion.map(c => Number(c.id_criterios)));
  const otro = conCriterio.filter(e => !conocidos.has(Number(e.id_criterio))).length;
  if (otro) motivos.push({ codigo: '', motivo: 'Otro motivo', n: otro });

  const evaluados = aceptados + conCriterio.length;
  return {
    identificados: estudios.length,
    por_fuente: [...porFuente].map(([fuente, n]) => ({ fuente, n })).sort((a, b) => b.n - a.n),
    duplicados,
    cribados,
    excluidos_cribado: sinCriterio,
    buscados_texto_completo: evaluados,
    no_recuperados: 0,
    evaluados_texto_completo: evaluados,
    excluidos_texto_completo: conCriterio.length,
    motivos_exclusion: motivos,
    incluidos: aceptados,
    pendientes: cribados - aceptados - rechazados.length
  };
}

/**
 * Evaluación de calidad de los estudios incluidos.
 * @param preguntas   [{ id_pregunta, descripcion }]
 * @param respuestas  [{ id_respuesta, descripcion, peso }]   escala (Sí = 1, Parcialmente = 0,5…)
 * @param evaluaciones [{ id_estudios, id_pregunta, id_respuesta, peso }]
 */
function resumenCalidad({ incluidos, preguntas, respuestas, evaluaciones, umbral }) {
  const ids = new Set(incluidos.map(e => Number(e.id_estudios)));
  const evals = (evaluaciones || []).filter(v => ids.has(Number(v.id_estudios)));
  const puntaje = new Map();
  for (const v of evals) puntaje.set(Number(v.id_estudios), (puntaje.get(Number(v.id_estudios)) ?? 0) + (Number(v.peso) || 0));
  const evaluados = new Set(evals.map(v => Number(v.id_estudios)));
  const maxPeso = (respuestas || []).reduce((m, r) => Math.max(m, Number(r.peso) || 0), 0);
  const limite = Number(umbral?.puntuacion_limite) || 0;
  const superan = incluidos.filter(e => (puntaje.get(Number(e.id_estudios)) ?? 0) >= limite && (limite === 0 || evaluados.has(Number(e.id_estudios))));

  const porPregunta = (preguntas || []).map((p, i) => {
    const deEsta = evals.filter(v => Number(v.id_pregunta) === Number(p.id_pregunta));
    const distribucion = (respuestas || []).map(r => ({
      respuesta: r.descripcion,
      peso: Number(r.peso) || 0,
      n: deEsta.filter(v => Number(v.id_respuesta) === Number(r.id_respuesta)).length
    }));
    return { codigo: `QA${i + 1}`, pregunta: p.descripcion, distribucion, evaluados: deEsta.length };
  });

  return {
    preguntas: porPregunta,
    escala: (respuestas || []).map(r => ({ respuesta: r.descripcion, peso: Number(r.peso) || 0 })),
    maxima: (preguntas || []).length * maxPeso,
    umbral: limite,
    evaluados: evaluados.size,
    superan: superan.length,
    no_superan: incluidos.length - superan.length,
    puntaje,
    ids_superan: new Set(superan.map(e => Number(e.id_estudios)))
  };
}

/** Normaliza document_type en tres grupos que se entienden en cualquier artículo. */
function tipoPublicacion(e) {
  const t = String(e.document_type ?? '').toLowerCase();
  if (/conference|proceeding|congres/.test(t)) return 'conferencia';
  if (/chapter|book|libro|cap[ií]tulo/.test(t)) return 'libro';
  if (/review|article|journal|art[ií]culo|^$/.test(t)) return 'revista';
  return 'otro';
}

/** Distribución de los estudios incluidos por año, fuente, tipo y revista más frecuente. */
function panorama(incluidos) {
  const contar = (clave) => {
    const m = new Map();
    for (const e of incluidos) { const k = clave(e); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m].map(([valor, n]) => ({ valor, n, pct: pct(n, incluidos.length) }));
  };
  const porAnio = contar(e => (e.anio ? String(e.anio) : 's. f.')).sort((a, b) => a.valor.localeCompare(b.valor));
  const porFuente = contar(e => String(e.fuente_bibliografica ?? '').trim() || 'Sin especificar').sort((a, b) => b.n - a.n);
  const porTipo = contar(tipoPublicacion).sort((a, b) => b.n - a.n);
  const revistas = contar(e => String(e.revista ?? '').trim()).filter(r => r.valor && r.n > 1).sort((a, b) => b.n - a.n).slice(0, 5);
  const anios = incluidos.map(e => Number(e.anio)).filter(Boolean);
  return {
    total: incluidos.length,
    desde: anios.length ? Math.min(...anios) : null,
    hasta: anios.length ? Math.max(...anios) : null,
    por_anio: porAnio, por_fuente: porFuente, por_tipo: porTipo, revistas_frecuentes: revistas
  };
}

module.exports = { contarPrisma, resumenCalidad, panorama, codigosCriterios, tipoPublicacion, pct };
