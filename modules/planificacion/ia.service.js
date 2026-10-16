// modules/planificacion/ia.service.js
// Sugerencias de la IA para la pantalla de Planificación: POST /revisiones/:id/ia/:tipo.
//
// El cliente solo dice qué quiere y el servidor lee lo GUARDADO de la revisión: no se puede enviar
// texto arbitrario para gastar tokens y la IA trabaja con lo mismo que verán los colaboradores.
// Desde la v3.9 cada sugerencia recibe todo lo guardado que le sirve (descripción, objetivo,
// framework, preguntas, términos, criterios, bases…), no solo el título y el objetivo, para que
// cada paso sea coherente con los anteriores (prompts en ia/sugerencias/planificacion.js).
// Nada se guarda: la pantalla muestra la sugerencia y el usuario decide qué conservar.
const P = require('../../ia/sugerencias/planificacion');
const { HttpError } = require('../../core/httpError');
const revisiones = require('../revisiones/revisiones.service');
const registro = require('../informes/referencias/registro');
const repo = require('./planificacion.repo');
const plan = require('./planificacion.service');

const corta = (v, max) => String(v ?? '').trim().slice(0, max);

function exigirObjetivo(rev) {
  if (!String(rev.objetivo ?? '').trim()) {
    throw new HttpError(400, 'Guarda primero el objetivo de la revisión (paso 1).');
  }
}

async function frameworkPorId(token, idMetodologia) {
  const met = (await plan.metodologias(token)).find(m => m.id_metodologia === idMetodologia);
  if (!met) throw new HttpError(400, 'Ese framework no existe.');
  return met;
}

async function frameworkGuardado(token, idRev) {
  const [catalogo, filas] = await Promise.all([plan.metodologias(token), repo.componentesRevision(token, idRev)]);
  return plan.frameworkGuardado(filas, catalogo);
}

/** Si una pieza opcional del contexto no se puede leer, la sugerencia sigue sin ella. */
const opcional = promesa => promesa.catch(() => null);

/**
 * Lo guardado de la revisión que usan los prompts. Las piezas se piden según la sugerencia.
 * Devuelve el objeto que espera ia/sugerencias/planificacion.js (datosRevision).
 */
async function contexto(ctx, rev, piezas = []) {
  const idRev = rev.id_detalles_revision;
  const quiere = p => piezas.includes(p);
  const [idioma, fw, preguntas, terminos, criterios, bases] = await Promise.all([
    opcional(registro.idioma(ctx.token, idRev)),
    quiere('framework') ? opcional(frameworkGuardado(ctx.token, idRev)) : null,
    quiere('preguntas') ? opcional(repo.preguntas(ctx.token, idRev)) : null,
    quiere('terminos') ? opcional(repo.palabrasClave(ctx.token, idRev)) : null,
    quiere('criterios') ? opcional(repo.criterios(ctx.token, idRev)) : null,
    quiere('bases') ? opcional(repo.bases(ctx.token, idRev)) : null
  ]);
  return {
    idioma: idioma || 'es',
    titulo: corta(rev.titulo_revision, 300),
    tipo: corta(rev.tipo_revision, 100) || 'RSL',
    descripcion: corta(rev.descripcion, 3000),
    objetivo: corta(rev.objetivo, 2000),
    alcance: corta(rev.alcance, 300),
    pais: corta(rev.pais, 100),
    ciudad: corta(rev.ciudad, 100),
    area: corta(rev.area_conocimiento, 200),
    tipoInvestigacion: corta(rev.tipo_investigacion, 200),
    institucion: corta(rev.institucion, 200),
    framework: fw ? { nombre: fw.nombre, componentes: fw.componentes.map(c => ({ sigla: c.sigla, nombre: c.nombre, valor: corta(c.valor, 1000) })) } : null,
    preguntas: (preguntas || []).map(p => corta(p.pregunta, 1000)).filter(Boolean),
    preguntasConId: (preguntas || []).map((p, i) => ({ id: p.id_preguntas_investigacion, pregunta: corta(p.pregunta, 1000) }))
      .filter(p => p.pregunta).map((p, i) => ({ ...p, codigo: `PI${i + 1}` })),
    terminos: (terminos || []).map(k => ({ palabra_clave: corta(k.palabra_clave, 150), sinonimos: plan.sinonimos(k.sinonimos), fila: k })),
    criterios: (criterios || []).map(c => ({ tipo: c.tipo, descripcion: corta(c.descripcion, 1000) })),
    bases: (bases || []).map(b => corta(b.nombre, 100)).filter(Boolean)
  };
}

const GENERADORES = {
  async objetivo(ctx, rev) {
    const r = await contexto(ctx, rev, ['framework', 'preguntas', 'bases']);
    return { objetivo: await P.objetivo(r) };
  },

  async estructura(ctx, rev, { id_metodologia }) {
    exigirObjetivo(rev);
    const met = await frameworkPorId(ctx.token, id_metodologia);
    if (!met.componentes.length) throw new HttpError(400, `El framework «${met.nombre}» no tiene componentes definidos.`);
    const r = await contexto(ctx, rev, ['preguntas']);
    const valores = await P.estructura(r, {
      nombre: met.nombre,
      componentes: met.componentes.map(c => ({ ...c, descripcion: corta(c.descripcion, 300) }))
    });
    return {
      id_metodologia: met.id_metodologia,
      valores: met.componentes.map(c => ({ id_componente: c.id_componente, sigla: c.sigla, nombre: c.nombre, valor: corta(valores[c.id_componente], 3000) }))
    };
  },

  async preguntas(ctx, rev, { cantidad, id_metodologia }) {
    exigirObjetivo(rev);
    const r = await contexto(ctx, rev, ['framework', 'preguntas']);
    const nombre = id_metodologia ? (await frameworkPorId(ctx.token, id_metodologia)).nombre : r.framework?.nombre || 'PICO';
    if (r.framework && r.framework.nombre !== nombre) r.framework = null;   // el guardado es de otro framework
    const preguntas = await P.preguntas(r, { cantidad, framework: nombre });
    return { preguntas: preguntas.map(p => corta(p, 1000)).filter(Boolean) };
  },

  async 'palabras-clave'(ctx, rev, { idioma } = {}) {
    const fw = await frameworkGuardado(ctx.token, rev.id_detalles_revision);
    const conValor = (fw?.componentes || []).filter(c => String(c.valor).trim());
    if (!conValor.length) throw new HttpError(400, 'Guarda primero el framework con al menos un componente rellenado (paso 3).');
    const r = await contexto(ctx, rev, ['preguntas']);
    const sugeridas = await P.palabrasClave(r, {
      componentes: conValor.map(c => ({ id_componente: c.id_componente, sigla: c.sigla, nombre: c.nombre, valor: corta(c.valor, 1000) })),
      idiomaTerminos: corta(idioma, 50) || 'inglés'
    });
    const porId = new Map(fw.componentes.map(c => [c.id_componente, c]));
    return {
      palabras_clave: sugeridas.map(k => ({
        ...k,
        componente: porId.get(k.id_componente)?.nombre ?? null,
        sigla: porId.get(k.id_componente)?.sigla ?? null
      }))
    };
  },

  async cadena(ctx, rev, { idioma }) {
    const r = await contexto(ctx, rev, ['framework', 'preguntas', 'terminos']);
    const guardadas = r.terminos.filter(k => k.palabra_clave);
    if (!guardadas.length) throw new HttpError(400, 'Guarda primero los términos clave (paso 4).');
    // Un grupo por componente del framework (los términos sin componente, cada uno el suyo)
    const grupos = new Map();
    for (const k of guardadas.slice(0, 30)) {
      const comp = k.fila?.componente_revision?.componente;
      const nombre = comp ? `${comp.nombre}${comp.sigla ? ` (${comp.sigla})` : ''}` : k.palabra_clave;
      if (!grupos.has(nombre)) grupos.set(nombre, []);
      grupos.get(nombre).push(k.palabra_clave, ...k.sinonimos.slice(0, 10).map(s => corta(s, 150)));
    }
    const cadena = await P.cadena(r, {
      grupos: [...grupos].map(([componente, terminos]) => ({ componente, terminos: [...new Set(terminos)] })),
      idioma
    });
    return { cadena: String(cadena).trim() };
  },

  async criterios(ctx, rev) {
    exigirObjetivo(rev);
    const r = await contexto(ctx, rev, ['framework', 'preguntas', 'criterios', 'bases']);
    const lista = await P.criterios(r);
    return { criterios: lista.map(c => ({ descripcion: corta(c.descripcion, 2000), tipo: c.tipo })).filter(c => c.descripcion) };
  },

  async calidad(ctx, rev) {
    exigirObjetivo(rev);
    const [r, existentes, escala] = await Promise.all([
      contexto(ctx, rev, ['framework', 'preguntas', 'criterios']),
      opcional(repo.preguntasCalidad(ctx.token, rev.id_detalles_revision)),
      opcional(repo.respuestasCalidad(ctx.token, rev.id_detalles_revision))
    ]);
    const preguntas = await P.calidad(r, {
      existentes: (existentes || []).map(p => corta(p.descripcion, 500)).filter(Boolean),
      escala: (escala || []).map(e => ({ descripcion: corta(e.descripcion, 60), peso: e.peso }))
    });
    return { preguntas: preguntas.map(p => corta(p, 2000)).filter(Boolean) };
  },

  async 'campos-extraccion'(ctx, rev, { cantidad }) {
    exigirObjetivo(rev);
    const [r, existentes] = await Promise.all([
      contexto(ctx, rev, ['framework', 'preguntas']),
      opcional(repo.campos(ctx.token, rev.id_detalles_revision))
    ]);
    const campos = await P.camposExtraccion(r, {
      cantidad,
      preguntasConId: r.preguntasConId,
      existentes: (existentes || []).map(c => ({ descripcion: corta(c.descripcion, 300), tipo: c.tipo }))
    });
    return {
      campos: campos
        .map(c => ({ descripcion: corta(c.pregunta, 1000), tipo: c.tipo, id_pregunta_investigacion: c.id_pregunta ?? null }))
        .filter(c => c.descripcion)
    };
  }
};

/** Antes de gastar tokens: la revisión existe y el usuario puede escribir en ella (un lector no). */
async function sugerir(ctx, idRev, tipo, datos) {
  const rev = await revisiones.exigirEscritura(ctx, idRev);
  return { tipo, ...(await GENERADORES[tipo](ctx, rev, datos)) };
}

module.exports = { sugerir, contexto, TIPOS: Object.keys(GENERADORES) };
