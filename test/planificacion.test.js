// test/planificacion.test.js — Planificación: lectura en una petición, framework, preguntas,
// palabras clave, bases y cadenas, criterios, instrumento de calidad, campos de extracción y
// sugerencias de la IA. Sin red: Supabase y OpenAI simulados.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const h = require('./helpers');

// ---------- IA simulada (antes de cargar la app) ----------
const llamadasIA = [];
let respuestaIA = () => '{}';
require.cache[path.join(__dirname, '../infra/openai.js')] = {
  id: 'openai-falso', filename: 'openai-falso', loaded: true,
  exports: { callOpenAI: async (m, o) => { llamadasIA.push(m); return respuestaIA(m, o); }, embed: async () => [] }
};

const request = require('supertest');
const app = require('../app');
const sb = require('../infra/supabase');
const { sinonimos } = require('../modules/planificacion/planificacion.service');

// ---------- Supabase simulado ----------
let responder;
const consultas = [];
beforeEach(() => {
  consultas.length = 0; llamadasIA.length = 0;
  respuestaIA = () => '{}';
  responder = () => ({ data: null, error: null });
  sb.forUser = () => h.clienteFalso(p => { consultas.push(p); return responder(p); });
  sb.admin = () => { throw new Error('Planificación no debe usar service_role'); };
});

const REV = {
  id_detalles_revision: 5, id_usuarios: 'u', titulo_revision: 'IA en educación', objetivo: 'Analizar la IA en la universidad',
  tipo_revision: 'RSL', descripcion: 'Revisión sobre tutores', pais: 'Ecuador', institucion: 'UTEQ', tipo_investigacion: 'cualitativa', alcance: ''
};
const CATALOGO = [
  { id_metodologia: 1, nombre: 'PICO', descripcion: null, componente: [
    { id_componente: 4, nombre: 'Resultado', sigla: 'o' }, { id_componente: 1, nombre: 'Población', sigla: 'P', descripcion: 'Quiénes' },
    { id_componente: 2, nombre: 'Intervención', sigla: 'I' }, { id_componente: 3, nombre: 'Comparación', sigla: 'C' }] },
  { id_metodologia: 2, nombre: 'SPICE', descripcion: null, componente: [{ id_componente: 16, nombre: 'Setting', sigla: 'S' }] }
];
const FILAS_FW = [
  { id_componente_revision: 30, id_componente: 1, palabra_clave: 'Estudiantes', componente: { id_metodologia: 1 } },
  { id_componente_revision: 31, id_componente: 2, palabra_clave: 'Tutor inteligente', componente: { id_metodologia: 1 } }
];
const esRpc = (p, fn) => Array.isArray(p) && p[0] && p[0][0] === 'rpc' && p[0][1][0] === fn;
const rpcParams = fn => consultas.find(p => esRpc(p, fn))?.[0][1][1];
const deTabla = (tabla, paso) => consultas.filter(p => Array.isArray(p) && h.tabla(p) === tabla && (!paso || h.paso(p, paso)));
const ok = data => ({ data, error: null });
const falla = (code, message) => ({ data: null, error: { code, message } });

function base(extra = {}, { escribe = true, visible = true, rev = REV } = {}) {
  return p => {
    if (esRpc(p, 'owns_revision')) return ok(escribe);
    if (h.tabla(p) === 'detalles_revision') return ok(visible ? rev : null);
    for (const [clave, fn] of Object.entries(extra)) {
      if ((clave.startsWith('rpc:') && esRpc(p, clave.slice(4))) || h.tabla(p) === clave) return fn(p);
    }
    if (h.tabla(p) === 'metodologias') return ok(CATALOGO);
    if (h.tabla(p) === 'componente_revision') return ok(FILAS_FW);
    return ok([]);
  };
}
const sesion = async () => `Bearer ${await h.token()}`;
const pide = async (metodo, ruta, cuerpo) => {
  const r = request(app)[metodo](`/api/v1/revisiones/5${ruta}`).set('Authorization', await sesion());
  return cuerpo === undefined ? r : r.send(cuerpo);
};
const escrituras = () => consultas.filter(p => Array.isArray(p) && (p[0][0] === 'rpc' ? !esRpc(p, 'owns_revision') : ['insert', 'update', 'delete', 'upsert'].some(x => h.paso(p, x))));

// ---------- Lectura ----------
describe('GET /planificacion', () => {
  test('todo en una petición: framework con todos sus componentes, palabras ordenadas, conteos y máxima calculada', async () => {
    responder = base({
      preguntas_investigacion: () => ok([{ id_preguntas_investigacion: 1, pregunta: '¿Qué efecto tiene?' }]),
      palabras_clave: () => ok([
        { id_palabras_clave: 9, palabra_clave: 'suelta', sinonimos: [], componente_revision: null },
        { id_palabras_clave: 6, palabra_clave: 'tutor', sinonimos: [{ id_sinonimos: 2, sinonimo: 'ITS' }],
          componente_revision: { id_componente: 2, componente: { id_componente: 2, nombre: 'Intervención', sigla: 'I' } } },
        { id_palabras_clave: 7, palabra_clave: 'students', sinonimos: [{ id_sinonimos: 5, sinonimo: 'pupils' }, { id_sinonimos: 1, sinonimo: 'alumnos, estudiantes ,  , Alumnos' }],
          componente_revision: { id_componente: 1, componente: { id_componente: 1, nombre: 'Población', sigla: 'P' } } }
      ]),
      bases_bibliograficas: () => ok([{ id_base_bibliografica: 3, nombre: 'Scopus', url: 'https://scopus.com' }]),
      cadenas_busqueda: () => ok([{ id_cadenas_busqueda: 1, fuente: 'global', cadena_busqueda: '("ia")' }]),
      criterios: () => ok([{ id_criterios: 1, descripcion: 'Empíricos', tipo: 'inclusion', estudios: [{ count: 3 }] }]),
      evaluacion_calidad_preguntas: () => ok([{ id_pregunta: 1, descripcion: '¿Claro?', calidad_estudios: [{ count: 2 }] }, { id_pregunta: 2, descripcion: '¿Muestra?', calidad_estudios: [] }]),
      evaluacion_calidad_respuestas: () => ok([{ id_respuesta: 1, descripcion: 'Sí', peso: '1.50', calidad_estudios: [{ count: 4 }] }, { id_respuesta: 2, descripcion: 'No', peso: '0' }]),
      puntuaciones_evaluacion: () => ok({ puntuacion_limite: '2', puntuacion_maxima: '9' }),
      campos_extraccion: () => ok([{ id_campo_extraccion: 1, descripcion: 'Año', tipo: 'Entero', orden: 0, respuestas_extraccion: [{ count: 6 }] }])
    }, { escribe: false });
    const r = await pide('get', '/planificacion');
    assert.equal(r.status, 200, 'un lector también puede leerla');
    const b = r.body;
    assert.equal(b.revision.titulo_revision, 'IA en educación');
    assert.deepEqual(b.metodologia, {
      id_metodologia: 1, nombre: 'PICO', componentes: [
        { id_componente: 1, nombre: 'Población', sigla: 'P', descripcion: 'Quiénes', valor: 'Estudiantes' },
        { id_componente: 2, nombre: 'Intervención', sigla: 'I', descripcion: null, valor: 'Tutor inteligente' },
        { id_componente: 3, nombre: 'Comparación', sigla: 'C', descripcion: null, valor: '' },
        { id_componente: 4, nombre: 'Resultado', sigla: 'O', descripcion: null, valor: '' }
      ]
    }, 'todos los componentes del framework, en orden y con la sigla en mayúsculas; vacíos los no guardados');
    assert.deepEqual(b.palabras_clave.map(k => k.id_palabras_clave), [7, 6, 9], 'en el orden de los componentes (P antes que I); la que no tiene componente, al final');
    assert.deepEqual(b.palabras_clave[0].sinonimos, ['alumnos', 'estudiantes', 'pupils'], 'lee los sinónimos viejos (separados por comas) y los nuevos, sin repetir');
    assert.deepEqual(b.palabras_clave[2], { id_palabras_clave: 9, palabra_clave: 'suelta', id_componente: null, componente: null, sigla: null, sinonimos: [] });
    assert.deepEqual(b.criterios[0], { id_criterios: 1, descripcion: 'Empíricos', tipo: 'inclusion', estudios: 3 });
    assert.deepEqual(b.calidad.preguntas.map(p => p.evaluaciones), [2, 0]);
    assert.deepEqual(b.calidad.respuestas[0], { id_respuesta: 1, descripcion: 'Sí', peso: 1.5, usos: 4 });
    assert.deepEqual(b.calidad.umbral, { limite: 2, maxima: 3, guardado: true }, 'máxima = 2 preguntas × peso mayor 1.5 (no la guardada)');
    assert.deepEqual(b.campos[0], { id_campo_extraccion: 1, descripcion: 'Año', tipo: 'Entero', orden: 0, respuestas: 6 });
    for (const [tabla, col] of [['preguntas_investigacion', 'id_detalles_revision'], ['palabras_clave', 'id_detalles_revision'], ['componente_revision', 'id_revision'],
      ['bases_bibliograficas', 'id_revision'], ['cadenas_busqueda', 'id_detalles_revision'], ['criterios', 'id_detalles_revision'], ['campos_extraccion', 'id_revision']]) {
      assert.deepEqual(h.paso(deTabla(tabla)[0], 'eq')[1], [col, 5], `${tabla} filtra por la revisión`);
    }
    assert.equal(escrituras().length, 0);
  });

  test('si quedaron filas de dos frameworks (pantalla vieja), manda el guardado más reciente', async () => {
    responder = base({ componente_revision: () => ok([
      { id_componente_revision: 2, id_componente: 16, palabra_clave: 'Aula', componente: { id_metodologia: 2 } },
      ...FILAS_FW
    ]) });
    const r = await pide('get', '/planificacion');
    assert.equal(r.body.metodologia.nombre, 'PICO');
    assert.equal(r.body.metodologia.componentes.length, 4);
  });

  test('sin framework guardado: metodologia null; si no ve la revisión: 404', async () => {
    responder = base({ componente_revision: () => ok([]), puntuaciones_evaluacion: () => ok(null) });   // maybeSingle sin filas → null
    const r = await pide('get', '/planificacion');
    assert.equal(r.body.metodologia, null);
    assert.deepEqual(r.body.calidad.umbral, { limite: 0, maxima: 0, guardado: false });
    responder = base({}, { visible: false });
    assert.equal((await pide('get', '/planificacion')).status, 404);
  });

  test('sinónimos: una fila con comas (pantalla vieja) o una por sinónimo dan la misma lista', () => {
    assert.deepEqual(sinonimos([{ id_sinonimos: 1, sinonimo: 'a, b,  c' }]), ['a', 'b', 'c']);
    assert.deepEqual(sinonimos([{ id_sinonimos: 3, sinonimo: 'c' }, { id_sinonimos: 1, sinonimo: 'a' }, { id_sinonimos: 2, sinonimo: 'B' }, { id_sinonimos: 4, sinonimo: 'b' }]), ['a', 'B', 'c']);
    assert.deepEqual(sinonimos(null), []);
  });

  test('GET /catalogos/metodologias: frameworks con componentes ordenados y caché de 5 minutos', async () => {
    responder = base();
    const r = await request(app).get('/api/v1/catalogos/metodologias').set('Authorization', await sesion());
    assert.equal(r.status, 200);
    assert.deepEqual(r.body[0].componentes.map(c => c.sigla), ['P', 'I', 'C', 'O']);
    assert.match(r.headers['cache-control'], /max-age=300/);
  });
});

// ---------- Framework ----------
describe('framework', () => {
  test('PUT /metodologia guarda en una transacción (fn_guardar_metodologia) y devuelve el framework releído', async () => {
    responder = base({ 'rpc:fn_guardar_metodologia': () => ok({ id_metodologia: 1, cambio: true, palabras_borradas: 4 }) });
    const r = await pide('put', '/metodologia', { id_metodologia: 1, componentes: [{ id_componente: 1, valor: '  Estudiantes ' }, { id_componente: 3, valor: null }] });
    assert.equal(r.status, 200);
    assert.deepEqual(rpcParams('fn_guardar_metodologia'), {
      p_id_rev: 5, p_id_metodologia: 1, p_componentes: [{ id_componente: 1, valor: 'Estudiantes' }, { id_componente: 3, valor: '' }]
    });
    assert.equal(r.body.metodologia.nombre, 'PICO');
    assert.equal(r.body.cambio, true);
    assert.equal(r.body.palabras_borradas, 4);
    assert.equal(deTabla('cadenas_busqueda', 'delete').length, 0, 'ya no borra las cadenas de búsqueda');
  });

  test('un lector recibe 403 sin tocar nada; datos mal formados → 400', async () => {
    responder = base({}, { escribe: false });
    const r = await pide('put', '/metodologia', { id_metodologia: 1, componentes: [] });
    assert.equal(r.status, 403);
    assert.equal(escrituras().length, 0);
    responder = base();
    assert.equal((await pide('put', '/metodologia', { id_metodologia: 'PICO' })).status, 400);
    assert.equal((await pide('put', '/metodologia', { id_metodologia: 1, componentes: [{ id_componente: 1, valor: 'x', otro: 1 }] })).status, 400);
  });

  test('un componente de otro framework: el 22023 de la base llega como 400 con su mensaje', async () => {
    responder = base({ 'rpc:fn_guardar_metodologia': () => falla('22023', 'Algún componente no pertenece al framework elegido') });
    const r = await pide('put', '/metodologia', { id_metodologia: 1, componentes: [{ id_componente: 16, valor: 'x' }] });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /no pertenece al framework/);
  });
});

// ---------- Preguntas de investigación ----------
describe('preguntas de investigación', () => {
  test('POST crea en la revisión de la URL; no se acepta otra revisión en el cuerpo', async () => {
    responder = base({ preguntas_investigacion: () => ok({ id_preguntas_investigacion: 3, pregunta: '¿Qué?' }) });
    const r = await pide('post', '/preguntas', { pregunta: '  ¿Qué?  ' });
    assert.equal(r.status, 201);
    assert.deepEqual(h.paso(deTabla('preguntas_investigacion', 'insert')[0], 'insert')[1][0], { pregunta: '¿Qué?', id_detalles_revision: 5 });
    assert.equal((await pide('post', '/preguntas', { pregunta: 'x', id_detalles_revision: 7 })).status, 400);
    assert.equal((await pide('post', '/preguntas', { pregunta: '   ' })).status, 400);
  });

  test('PATCH y DELETE filtran por id Y revisión; si no está en esa revisión → 404', async () => {
    responder = base({ preguntas_investigacion: p => ok(h.paso(p, 'update') ? { id_preguntas_investigacion: 3, pregunta: 'Nueva' } : [{ id_preguntas_investigacion: 3 }]) });
    const r = await pide('patch', '/preguntas/3', { pregunta: 'Nueva' });
    assert.equal(r.status, 200);
    const upd = deTabla('preguntas_investigacion', 'update')[0];
    assert.deepEqual(upd.filter(x => x[0] === 'eq').map(x => x[1]), [['id_preguntas_investigacion', 3], ['id_detalles_revision', 5]]);
    assert.equal((await pide('delete', '/preguntas/3')).status, 204);
    responder = base({ preguntas_investigacion: () => ok(null) });
    const no = await pide('patch', '/preguntas/99', { pregunta: 'x' });
    assert.equal(no.status, 404);
    assert.equal(no.body.error, 'Pregunta no encontrada en esta revisión.');
    responder = base({ preguntas_investigacion: () => ok([]) });
    assert.equal((await pide('delete', '/preguntas/99')).status, 404);
  });
});

// ---------- Palabras clave ----------
describe('palabras clave', () => {
  const KW = { id_palabras_clave: 8, palabra_clave: 'tutor', id_componente: 2, componente: 'Intervención', sigla: 'I', sinonimos: ['ITS'] };

  test('POST y PUT van por fn_guardar_palabra_clave (palabra, componente de SU revisión y sinónimos juntos)', async () => {
    responder = base({ 'rpc:fn_guardar_palabra_clave': () => ok(KW) });
    const r = await pide('post', '/palabras-clave', { palabra_clave: ' tutor ', id_componente: 2, sinonimos: [' ITS ', ''] });
    assert.equal(r.status, 201);
    assert.deepEqual(rpcParams('fn_guardar_palabra_clave'), { p_id_rev: 5, p_id: null, p_palabra: 'tutor', p_id_componente: 2, p_sinonimos: ['ITS', ''] });
    assert.deepEqual(r.body, KW);
    consultas.length = 0;
    assert.equal((await pide('put', '/palabras-clave/8', { palabra_clave: 'tutor', id_componente: 2 })).status, 200);
    assert.deepEqual(rpcParams('fn_guardar_palabra_clave').p_id, 8);
    assert.deepEqual(rpcParams('fn_guardar_palabra_clave').p_sinonimos, []);
  });

  test('sin componente → 400; errores de la base: 22023 → 400 y P0002 → 404', async () => {
    responder = base();
    assert.equal((await pide('post', '/palabras-clave', { palabra_clave: 'x' })).status, 400);
    responder = base({ 'rpc:fn_guardar_palabra_clave': () => falla('22023', 'Guarda primero el framework de la pregunta (paso 3)') });
    const r = await pide('post', '/palabras-clave', { palabra_clave: 'x', id_componente: 1 });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Guarda primero el framework/);
    responder = base({ 'rpc:fn_guardar_palabra_clave': () => falla('P0002', 'Palabra clave no encontrada') });
    assert.equal((await pide('put', '/palabras-clave/99', { palabra_clave: 'x', id_componente: 1 })).status, 404);
  });

  test('DELETE borra la palabra de esa revisión (los sinónimos caen en cascada)', async () => {
    responder = base({ palabras_clave: () => ok([{ id_palabras_clave: 8 }]) });
    assert.equal((await pide('delete', '/palabras-clave/8')).status, 204);
    assert.deepEqual(deTabla('palabras_clave', 'delete')[0].filter(x => x[0] === 'eq').map(x => x[1]), [['id_palabras_clave', 8], ['id_detalles_revision', 5]]);
  });
});

// ---------- Bases y cadenas ----------
describe('bases bibliográficas y cadenas', () => {
  test('POST/PUT de bases por fn_guardar_base; nombre repetido → 409 con mensaje claro', async () => {
    responder = base({ 'rpc:fn_guardar_base': () => ok({ id_base_bibliografica: 3, nombre: 'Scopus', url: '', cadena: null }) });
    assert.equal((await pide('post', '/bases', { nombre: 'Scopus' })).status, 201);
    assert.deepEqual(rpcParams('fn_guardar_base'), { p_id_rev: 5, p_id: null, p_nombre: 'Scopus', p_url: '' });
    consultas.length = 0;
    await pide('put', '/bases/3', { nombre: 'Scopus (Elsevier)', url: 'https://scopus.com' });
    assert.equal(rpcParams('fn_guardar_base').p_id, 3);
    responder = base({ 'rpc:fn_guardar_base': () => falla('23505', 'Ya hay una base con ese nombre en esta revisión') });
    const r = await pide('post', '/bases', { nombre: 'scopus' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'Ya hay una base con ese nombre en esta revisión.');
  });

  test('DELETE /bases/:b borra base y cadena en la base (fn_borrar_base)', async () => {
    responder = base({ 'rpc:fn_borrar_base': () => ok({ nombre: 'Scopus', cadena_borrada: true }) });
    const r = await pide('delete', '/bases/3');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { nombre: 'Scopus', cadena_borrada: true });
    assert.deepEqual(rpcParams('fn_borrar_base'), { p_id_rev: 5, p_id: 3 });
  });

  test('PUT /cadenas/:fuente con nombres que llevan barra o tildes; DELETE de «Global»; 404 si no estaba', async () => {
    responder = base({ 'rpc:fn_guardar_cadena': () => ok({ id_cadenas_busqueda: 1, fuente: 'Web of Science / Clarivate', cadena_busqueda: 'x' }) });
    const r = await pide('put', `/cadenas/${encodeURIComponent('Web of Science / Clarivate')}`, { cadena: ' TS=(x) ' });
    assert.equal(r.status, 200);
    assert.deepEqual(rpcParams('fn_guardar_cadena'), { p_id_rev: 5, p_fuente: 'Web of Science / Clarivate', p_cadena: 'TS=(x)' });
    assert.equal((await pide('put', '/cadenas/global', { cadena: '  ' })).status, 400);
    responder = base({ cadenas_busqueda: () => ok([{ id_cadenas_busqueda: 1 }]) });
    assert.equal((await pide('delete', '/cadenas/Global')).status, 204);
    assert.deepEqual(deTabla('cadenas_busqueda', 'delete')[0].filter(x => x[0] === 'eq').map(x => x[1]), [['id_detalles_revision', 5], ['fuente', 'global']]);
    responder = base({ cadenas_busqueda: () => ok([]) });
    assert.equal((await pide('delete', '/cadenas/WoS')).status, 404);
  });
});

// ---------- Criterios ----------
describe('criterios', () => {
  test('POST valida el tipo; PATCH solo cambia la descripción', async () => {
    responder = base({ criterios: p => ok(h.paso(p, 'insert') || h.paso(p, 'update') ? { id_criterios: 4, descripcion: 'X', tipo: 'exclusion' } : []) });
    assert.equal((await pide('post', '/criterios', { descripcion: 'X', tipo: 'excluido' })).status, 400);
    const r = await pide('post', '/criterios', { descripcion: 'X', tipo: 'exclusion' });
    assert.equal(r.status, 201);
    assert.deepEqual(h.paso(deTabla('criterios', 'insert')[0], 'insert')[1][0], { descripcion: 'X', tipo: 'exclusion', id_detalles_revision: 5 });
    assert.equal((await pide('patch', '/criterios/4', { descripcion: 'Y', tipo: 'inclusion' })).status, 400, 'el tipo no se cambia por PATCH');
    assert.equal((await pide('patch', '/criterios/4', { descripcion: 'Y' })).status, 200);
  });

  test('si la actualización falla NO se inserta un criterio nuevo (antes se duplicaba)', async () => {
    responder = base({ criterios: p => (h.paso(p, 'update') ? falla('XX000', 'fallo') : ok({ id_criterios: 9 })) });
    const r = await pide('patch', '/criterios/4', { descripcion: 'Y' });
    assert.equal(r.status, 400);
    assert.equal(deTabla('criterios', 'insert').length, 0);
  });
});

// ---------- Calidad ----------
describe('instrumento de calidad', () => {
  test('respuestas: peso numérico; PATCH vacío → 400; peso negativo → 400', async () => {
    responder = base({ evaluacion_calidad_respuestas: () => ok({ id_respuesta: 2, descripcion: 'Sí', peso: '2.00' }) });
    const r = await pide('post', '/calidad/respuestas', { descripcion: 'Sí', peso: '2' });
    assert.equal(r.status, 201);
    assert.equal(r.body.peso, 2);
    const c = await pide('patch', '/calidad/respuestas/2', { peso: 3 });
    assert.equal(c.status, 200);
    assert.deepEqual(h.paso(deTabla('evaluacion_calidad_respuestas', 'update')[0], 'update')[1][0], { peso: 3 });
    assert.equal((await pide('patch', '/calidad/respuestas/2', {})).status, 400);
    assert.equal((await pide('post', '/calidad/respuestas', { descripcion: 'No', peso: -1 })).status, 400);
  });

  test('preguntas: alta, cambio y borrado en la revisión', async () => {
    responder = base({ evaluacion_calidad_preguntas: p => ok(h.paso(p, 'delete') ? [{ id_pregunta: 1 }] : { id_pregunta: 1, descripcion: '¿X?' }) });
    assert.equal((await pide('post', '/calidad/preguntas', { descripcion: '¿X?' })).status, 201);
    assert.equal((await pide('patch', '/calidad/preguntas/1', { descripcion: '¿Y?' })).status, 200);
    assert.equal((await pide('delete', '/calidad/preguntas/1')).status, 204);
  });

  test('PUT /calidad/umbral: la máxima la calcula la base; pasarse → 400 con su mensaje', async () => {
    responder = base({ 'rpc:fn_guardar_umbral_calidad': () => ok({ limite: 3.5, maxima: 4 }) });
    const r = await pide('put', '/calidad/umbral', { limite: 3.5 });
    assert.deepEqual(r.body, { limite: 3.5, maxima: 4, guardado: true });
    assert.deepEqual(rpcParams('fn_guardar_umbral_calidad'), { p_id_rev: 5, p_limite: 3.5 });
    assert.equal((await pide('put', '/calidad/umbral', { limite: 3, maxima: 99 })).status, 400, 'la máxima no la manda el cliente');
    responder = base({ 'rpc:fn_guardar_umbral_calidad': () => falla('22023', 'La puntuación mínima (5) no puede superar la máxima posible (4)') });
    const no = await pide('put', '/calidad/umbral', { limite: 5 });
    assert.equal(no.status, 400);
    assert.match(no.body.error, /no puede superar la máxima/);
  });
});

// ---------- Campos de extracción ----------
describe('campos de extracción', () => {
  test('POST sin orden lo pone al final; tipo no válido → 400', async () => {
    responder = base({ campos_extraccion: p => ok(h.paso(p, 'insert') ? { id_campo_extraccion: 9, descripcion: 'País', tipo: 'Texto', orden: 4 }
      : [{ id_campo_extraccion: 1, orden: 0 }, { id_campo_extraccion: 2, orden: 3 }]) });
    const r = await pide('post', '/campos-extraccion', { descripcion: 'País' });
    assert.equal(r.status, 201);
    assert.deepEqual(h.paso(deTabla('campos_extraccion', 'insert')[0], 'insert')[1][0], { descripcion: 'País', tipo: 'Texto', orden: 4, id_revision: 5 });
    assert.equal((await pide('post', '/campos-extraccion', { descripcion: 'X', tipo: 'Lista' })).status, 400);
  });

  test('PUT /campos-extraccion/orden: una sola operación (antes una petición por campo)', async () => {
    responder = base({ 'rpc:fn_ordenar_campos_extraccion': () => ok(2), campos_extraccion: () => ok([{ id_campo_extraccion: 2, descripcion: 'B', tipo: 'Texto', orden: 0 }]) });
    const r = await pide('put', '/campos-extraccion/orden', { ids: [2, 1] });
    assert.equal(r.status, 200);
    assert.deepEqual(rpcParams('fn_ordenar_campos_extraccion'), { p_id_rev: 5, p_ids: [2, 1] });
    assert.equal(r.body[0].id_campo_extraccion, 2);
    assert.equal((await pide('put', '/campos-extraccion/orden', { ids: [] })).status, 400);
  });

  test('PATCH y DELETE de un campo de la revisión', async () => {
    responder = base({ campos_extraccion: p => ok(h.paso(p, 'delete') ? [{ id_campo_extraccion: 1 }] : { id_campo_extraccion: 1, descripcion: 'Año', tipo: 'Entero', orden: 0 }) });
    assert.equal((await pide('patch', '/campos-extraccion/1', { tipo: 'Entero' })).status, 200);
    assert.equal((await pide('delete', '/campos-extraccion/1')).status, 204);
    assert.equal((await pide('patch', '/campos-extraccion/1', {})).status, 400);
  });
});

// ---------- IA ----------
describe('sugerencias de la IA', () => {
  const prompt = () => llamadasIA.at(-1).map(m => m.content).join('\n');

  test('tipo desconocido → 400 y un lector → 403, sin llamar a la IA', async () => {
    responder = base();
    assert.equal((await pide('post', '/ia/poema', {})).status, 400);
    responder = base({}, { escribe: false });
    assert.equal((await pide('post', '/ia/objetivo', {})).status, 403);
    assert.equal(llamadasIA.length, 0);
  });

  test('objetivo: se arma con lo GUARDADO en la revisión, no con lo que mande el cliente', async () => {
    responder = base();
    respuestaIA = () => '"Analizar el uso de tutores inteligentes."';
    assert.equal((await pide('post', '/ia/objetivo', { title: 'Otro título' })).status, 400, 'no se aceptan datos en el cuerpo');
    const r = await pide('post', '/ia/objetivo', {});
    assert.equal(r.status, 200);
    assert.equal(r.body.objetivo, 'Analizar el uso de tutores inteligentes.');
    assert.match(prompt(), /Título de la revisión: IA en educación/);
    assert.match(prompt(), /Metodología de la revisión: RSL/);
    assert.match(prompt(), /- País: Ecuador/);
    assert.doesNotMatch(prompt(), /Alcance/, 'los campos vacíos no se envían');
  });

  test('estructura: exige objetivo guardado; rellena por sigla o nombre los componentes del framework de la base', async () => {
    responder = base({}, { rev: { ...REV, objetivo: '  ' } });
    const sin = await pide('post', '/ia/estructura', { id_metodologia: 1 });
    assert.equal(sin.status, 400);
    assert.match(sin.body.error, /Guarda primero el objetivo/);
    assert.equal(llamadasIA.length, 0);

    responder = base();
    respuestaIA = () => '{"p": "Universitarios", "Intervención": "Tutores", "C": 7}';
    const r = await pide('post', '/ia/estructura', { id_metodologia: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.valores.map(v => [v.sigla, v.valor]), [['P', 'Universitarios'], ['I', 'Tutores'], ['C', '7'], ['O', '']]);
    assert.match(prompt(), /- "P": Población \(Quiénes\)/);
    assert.equal((await pide('post', '/ia/estructura', { id_metodologia: 77 })).status, 400, 'framework inexistente');
  });

  test('palabras clave: del framework guardado; el id del componente se valida (y si no, se busca por nombre)', async () => {
    responder = base({ componente_revision: () => ok([]) });
    const sin = await pide('post', '/ia/palabras-clave', {});
    assert.equal(sin.status, 400);
    assert.match(sin.body.error, /Guarda primero el framework/);

    responder = base();
    respuestaIA = () => JSON.stringify({ keywords: [
      { palabra_clave: 'students', id_componente: 1, sinonimos: ['pupils', 'Pupils', 'learners'] },
      { palabra_clave: 'tutor', id_componente: 99, componente: 'Intervención', sinonimos: 'ITS, tutoring system' },
      { palabra_clave: 'otro', id_componente: 42, sinonimos: [] },
      { palabra_clave: '' }
    ] });
    const r = await pide('post', '/ia/palabras-clave', {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.palabras_clave, [
      { palabra_clave: 'students', id_componente: 1, sinonimos: ['pupils', 'learners'], componente: 'Población', sigla: 'P' },
      { palabra_clave: 'tutor', id_componente: 2, sinonimos: ['ITS', 'tutoring system'], componente: 'Intervención', sigla: 'I' },
      { palabra_clave: 'otro', id_componente: null, sinonimos: [], componente: null, sigla: null }
    ]);
    assert.match(prompt(), /id 1 · Población \(P\): Estudiantes/);
    assert.doesNotMatch(prompt(), /Comparación/, 'solo los componentes con contenido');
  });

  test('cadena: con los términos GUARDADOS y sus sinónimos; sin términos → 400', async () => {
    responder = base({ palabras_clave: () => ok([]) });
    assert.equal((await pide('post', '/ia/cadena', { idioma: 'Inglés' })).status, 400);
    responder = base({ palabras_clave: () => ok([{ id_palabras_clave: 1, palabra_clave: 'tutor', sinonimos: [{ id_sinonimos: 1, sinonimo: 'ITS, chatbot' }] }]) });
    respuestaIA = () => ' ("tutor" OR "ITS") ';
    assert.equal((await pide('post', '/ia/cadena', {})).status, 400, 'el idioma es obligatorio');
    const r = await pide('post', '/ia/cadena', { idioma: 'Inglés' });
    assert.equal(r.body.cadena, '("tutor" OR "ITS")');
    assert.match(prompt(), /\("tutor" OR "ITS" OR "chatbot"\)/);
  });

  test('criterios: la categoría de la IA pasa a inclusion/exclusion; campos: tipo válido y cantidad por defecto', async () => {
    responder = base();
    respuestaIA = () => '{"criterios":[{"criterio":"Empíricos","categoria":"incluido"},{"criterio":"No revisados","categoria":"Exclusión"},{"criterio":""}]}';
    const r = await pide('post', '/ia/criterios', {});
    assert.deepEqual(r.body.criterios, [{ descripcion: 'Empíricos', tipo: 'inclusion' }, { descripcion: 'No revisados', tipo: 'exclusion' }]);
    respuestaIA = () => '{"questions":[{"pregunta":"¿Año?","tipo":"Entero"},{"pregunta":"¿País?","tipo":"Lista"}]}';
    const c = await pide('post', '/ia/campos-extraccion', {});
    assert.deepEqual(c.body.campos, [{ descripcion: '¿Año?', tipo: 'Entero' }, { descripcion: '¿País?', tipo: 'Texto' }]);
    assert.match(prompt(), /Genera 5 preguntas de extracción/);
  });

  test('límite propio («ia»): 22 sugerencias seguidas no chocan con el de 20 de las generaciones largas', async () => {
    responder = base();
    respuestaIA = () => 'Objetivo';
    const auth = await sesion();
    for (let i = 0; i < 22; i++) {
      const r = await request(app).post('/api/v1/revisiones/5/ia/objetivo').set('Authorization', auth).send({});
      assert.equal(r.status, 200, `petición ${i + 1}`);
    }
  });

  test('preguntas: usa el framework indicado (o el guardado) y el tipo de investigación de la revisión', async () => {
    responder = base();
    respuestaIA = () => '{"questions":["¿A?","¿B?","¿C?"]}';
    const r = await pide('post', '/ia/preguntas', { cantidad: 2, id_metodologia: 2 });
    assert.deepEqual(r.body.preguntas, ['¿A?', '¿B?']);
    assert.match(prompt(), /metodología "SPICE"/);
    assert.match(prompt(), /de tipo "cualitativa"/);
    responder = base({ componente_revision: () => ok([{ id_componente_revision: 9, id_componente: 16, palabra_clave: 'Aula', componente: { id_metodologia: 2 } }]) });
    await pide('post', '/ia/preguntas', {});
    assert.match(prompt(), /metodología "SPICE"/, 'sin indicar: el guardado en la revisión');
    responder = base({ componente_revision: () => ok([]) });
    await pide('post', '/ia/preguntas', {});
    assert.match(prompt(), /metodología "PICO"/, 'sin nada guardado: PICO, como antes');
    assert.equal((await pide('post', '/ia/preguntas', { cantidad: 50 })).status, 400);
  });
});
