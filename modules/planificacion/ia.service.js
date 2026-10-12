// modules/planificacion/ia.service.js
// Sugerencias de la IA para la pantalla de Planificación: POST /revisiones/:id/ia/:tipo.
//
// Antes el navegador enviaba a /api/generate-* lo que tuviera en pantalla (título, objetivo,
// componentes, palabras clave…). Ahora el cliente solo dice qué quiere y el servidor lee lo
// GUARDADO de la revisión: no se puede enviar texto arbitrario para gastar tokens y la IA trabaja
// con lo mismo que verán los colaboradores. Nada se guarda: la pantalla muestra la sugerencia y
// el usuario decide qué conservar.
const P = require('../../ia/prompts/planificacion');
const { HttpError } = require('../../core/httpError');
const revisiones = require('../revisiones/revisiones.service');
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

const GENERADORES = {
  async objetivo(ctx, rev) {
    const extra = {};
    for (const [campo, max] of [['alcance', 300], ['pais', 100], ['ciudad', 100], ['area_conocimiento', 200], ['tipo_investigacion', 200], ['institucion', 200]]) {
      const v = corta(rev[campo], max);
      if (v) extra[campo] = v;
    }
    const objetivo = await P.objetivo({
      title: corta(rev.titulo_revision, 300),
      methodology: corta(rev.tipo_revision, 100) || 'RSL',
      description: corta(rev.descripcion, 3000),
      ...extra
    });
    return { objetivo: String(objetivo).trim().replace(/^["“]|["”]$/g, '') };
  },

  async estructura(ctx, rev, { id_metodologia }) {
    exigirObjetivo(rev);
    const met = await frameworkPorId(ctx.token, id_metodologia);
    if (!met.componentes.length) throw new HttpError(400, `El framework «${met.nombre}» no tiene componentes definidos.`);
    const valores = await P.estructura({
      metodologia: met.nombre, titulo: corta(rev.titulo_revision, 300), objetivo: corta(rev.objetivo, 2000),
      componentes: met.componentes.map(c => ({ ...c, descripcion: corta(c.descripcion, 300) }))
    });
    return {
      id_metodologia: met.id_metodologia,
      valores: met.componentes.map(c => ({ id_componente: c.id_componente, sigla: c.sigla, nombre: c.nombre, valor: corta(valores[c.id_componente], 3000) }))
    };
  },

  async preguntas(ctx, rev, { cantidad, id_metodologia }) {
    exigirObjetivo(rev);
    const nombre = id_metodologia
      ? (await frameworkPorId(ctx.token, id_metodologia)).nombre
      : (await frameworkGuardado(ctx.token, rev.id_detalles_revision))?.nombre || 'PICO';
    const preguntas = await P.preguntas({
      title: corta(rev.titulo_revision, 300), objective: corta(rev.objetivo, 2000), methodology: corta(nombre, 100),
      numQuestions: cantidad, tipoInvestigacion: corta(rev.tipo_investigacion, 200) || undefined
    });
    return { preguntas: preguntas.map(p => corta(p, 1000)).filter(Boolean) };
  },

  async 'palabras-clave'(ctx, rev) {
    const fw = await frameworkGuardado(ctx.token, rev.id_detalles_revision);
    const conValor = (fw?.componentes || []).filter(c => String(c.valor).trim());
    if (!conValor.length) throw new HttpError(400, 'Guarda primero el framework con al menos un componente rellenado (paso 3).');
    const sugeridas = await P.palabrasClave({
      metodologia: fw.nombre,
      componentes: conValor.map(c => ({ id_componente: c.id_componente, sigla: c.sigla, nombre: c.nombre, valor: corta(c.valor, 1000) }))
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
    const guardadas = (await repo.palabrasClave(ctx.token, rev.id_detalles_revision))
      .map(k => ({ palabra_clave: corta(k.palabra_clave, 150), sinonimos: plan.sinonimos(k.sinonimos).slice(0, 10).map(s => corta(s, 150)) }))
      .filter(k => k.palabra_clave);
    if (!guardadas.length) throw new HttpError(400, 'Guarda primero los términos clave (paso 4).');
    const cadena = await P.cadena({ keywords: guardadas.slice(0, 30), idioma });
    return { cadena: String(cadena).trim() };
  },

  async criterios(ctx, rev) {
    exigirObjetivo(rev);
    const lista = await P.criterios({ title: corta(rev.titulo_revision, 300), objective: corta(rev.objetivo, 2000) });
    return {
      criterios: lista
        .map(c => ({
          descripcion: corta(c?.criterio ?? c?.descripcion, 2000),
          tipo: /exclu/.test(String(c?.categoria ?? c?.tipo ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()) ? 'exclusion' : 'inclusion'
        }))
        .filter(c => c.descripcion)
    };
  },

  async calidad(ctx, rev) {
    exigirObjetivo(rev);
    const preguntas = await P.calidad({ title: corta(rev.titulo_revision, 300), objective: corta(rev.objetivo, 2000) });
    return { preguntas: preguntas.map(p => corta(p, 2000)).filter(Boolean) };
  },

  async 'campos-extraccion'(ctx, rev, { cantidad }) {
    exigirObjetivo(rev);
    const campos = await P.camposExtraccion({ title: corta(rev.titulo_revision, 300), objective: corta(rev.objetivo, 2000), numberOfQuestions: cantidad });
    return { campos: campos.map(c => ({ descripcion: corta(c.pregunta, 1000), tipo: c.tipo })).filter(c => c.descripcion) };
  }
};

/** Antes de gastar tokens: la revisión existe y el usuario puede escribir en ella (un lector no). */
async function sugerir(ctx, idRev, tipo, datos) {
  const rev = await revisiones.exigirEscritura(ctx, idRev);
  return { tipo, ...(await GENERADORES[tipo](ctx, rev, datos)) };
}

module.exports = { sugerir, TIPOS: Object.keys(GENERADORES) };
