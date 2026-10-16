// test/fase5.test.js — Fase 5: extracción de datos (con IA sobre el PDF), equipo e invitaciones,
// cuenta (perfil, foto, preferencias, sesiones), notificaciones, países, administración y
// LEGACY_API=off. Sin red: Supabase, OpenAI, el PDF y el correo simulados.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const h = require('./helpers');

// ---------- IA y PDF simulados (antes de cargar la app) ----------
const llamadasIA = [];
let respuestaIA = () => '{}';
require.cache[path.join(__dirname, '../infra/openai.js')] = {
  id: 'openai-falso', filename: 'openai-falso', loaded: true,
  exports: { callOpenAI: async (m, o) => { llamadasIA.push(m); return respuestaIA(m, o); }, embed: async () => [] }
};
const descargas = [];
let textoPdf = 'Tutores inteligentes en la universidad: estudio en Ecuador con 120 estudiantes';
require.cache[path.join(__dirname, '../infra/pdf.js')] = {
  id: 'pdf-falso', filename: 'pdf-falso', loaded: true,
  exports: {
    downloadPdf: async url => { descargas.push(url); return Buffer.from('%PDF-1.7 externo'); },
    extractText: async buf => { descargas.push(`texto:${buf.subarray(0, 8).toString('latin1')}`); return { fullText: textoPdf, pages: [] }; },
    chunkPages: () => []
  }
};

const request = require('supertest');
const app = require('../app');
const env = require('../config/env');
const sb = require('../infra/supabase');
const email = require('../infra/email');
const admin = require('../modules/admin/admin.service');
const cuenta = require('../modules/cuenta/cuenta.service');
const { paises } = require('../modules/catalogos/paises');

// ---------- Supabase simulado ----------
let responder;
const consultas = [];
beforeEach(() => {
  consultas.length = 0; llamadasIA.length = 0; descargas.length = 0;
  respuestaIA = () => '{}';
  textoPdf = 'Tutores inteligentes en la universidad: estudio en Ecuador con 120 estudiantes';
  responder = () => ({ data: null, error: null });
  sb.forUser = () => h.clienteFalso(p => { consultas.push(p); return responder(p); });
  sb.admin = () => h.clienteFalso(p => { consultas.push(['ADMIN', p]); return responder(p); });
  sb.adminDisponible = () => false;
});

const REV = { id_detalles_revision: 5, id_usuarios: 'u', titulo_revision: 'IA en educación' };
const esRpc = (p, fn) => Array.isArray(p) && p[0] && p[0][0] === 'rpc' && p[0][1][0] === fn;
const sinAdmin = () => consultas.filter(p => p[0] !== 'ADMIN');
const rpcParams = fn => sinAdmin().find(p => esRpc(p, fn))?.[0][1][1];
const llamo = fn => sinAdmin().some(p => esRpc(p, fn));
const deTabla = (tabla, paso) => sinAdmin().filter(p => h.tabla(p) === tabla && (!paso || h.paso(p, paso)));
const almacen = op => consultas.map(p => (p[0] === 'ADMIN' ? p[1] : p)).filter(p => p[0]?.[0] === 'storage' && h.paso(p, op));
const ok = data => ({ data, error: null });
const falla = (code, message) => ({ data: null, error: { code, message } });

function base(extra = {}, { escribe = true, visible = true } = {}) {
  return p => {
    if (esRpc(p, 'owns_revision')) return ok(escribe);
    if (h.tabla(p) === 'detalles_revision') return ok(visible ? REV : null);
    for (const [clave, fn] of Object.entries(extra)) {
      if ((clave.startsWith('rpc:') && esRpc(p, clave.slice(4))) || h.tabla(p) === clave) return fn(p);
    }
    return ok(null);
  };
}
// Un usuario nuevo por prueba: el límite por usuario de las pruebas es de 40 peticiones por minuto
let ID_USUARIO = h.nuevoId();
beforeEach(() => { ID_USUARIO = h.nuevoId(); });
const sesion = async (o = {}) => `Bearer ${await h.token({ sub: ID_USUARIO, ...o })}`;
const pide = async (metodo, ruta, cuerpo, o) => {
  const r = request(app)[metodo](`/api/v1${ruta}`).set('Authorization', await sesion(o));
  return cuerpo === undefined ? r : r.send(cuerpo);
};

/* ======================================================================== Extracción */

const CAMPOS = [
  { id_campo_extraccion: 1, descripcion: 'País del estudio', tipo: 'Texto', orden: 0 },
  { id_campo_extraccion: 2, descripcion: '¿Aleatorizado?', tipo: 'Booleano', orden: 1 },
  { id_campo_extraccion: 3, descripcion: 'Tamaño de muestra', tipo: 'Entero', orden: 2 },
  { id_campo_extraccion: 4, descripcion: 'Fecha de publicación', tipo: 'Fecha', orden: 3 }
];
const FILA_RPC = (o = {}) => ({ id_estudios: 10, titulo: 'Tutores inteligentes en la universidad', autores: 'Ruiz', anio: 2024, revista: 'R',
  doi: '10.1/x', estado: 'Aceptado', url_pdf_articulo: null, fuente_bibliografica: null, id_detalles_revision: 5, totalPeso: '3.5', limite: 2, done: false, ...o });
const ESTUDIO = (o = {}) => ({ id_estudios: 10, id_detalles_revision: 5, titulo: 'Tutores inteligentes en la universidad', url_pdf_articulo: null, url_pdf_externo: null, ...o });

describe('extracción: lectura', () => {
  test('GET /extraccion: estudios con puntuación y PDF, campos en orden y la respuesta MÁS RECIENTE de cada campo', async () => {
    responder = base({
      'rpc:fn_get_studies_with_score_done': () => ({ data: [FILA_RPC({ url_pdf_articulo: 'estudios/10/a.pdf', done: true }), FILA_RPC({ id_estudios: 11, totalPeso: 2 })], error: null, count: 2 }),
      campos_extraccion: () => ok(CAMPOS),
      puntuaciones_evaluacion: () => ok({ puntuacion_limite: '2' }),
      respuestas_extraccion: () => ({ data: [
        { id_estudios: 10, id_campo_extraccion: 1, valor: 'Perú', fecha: '2026-01-01T00:00:00Z', id_respuesta_extraccion: 1 },
        { id_estudios: 10, id_campo_extraccion: 1, valor: 'Ecuador', fecha: '2026-02-01T00:00:00Z', id_respuesta_extraccion: 2 },
        { id_estudios: 10, id_campo_extraccion: 2, valor: 'false', fecha: '2026-02-01T00:00:00Z', id_respuesta_extraccion: 7 },
        { id_estudios: 10, id_campo_extraccion: 2, valor: 'TRUE', fecha: '2026-02-01T00:00:00Z', id_respuesta_extraccion: 8 },
        { id_estudios: 11, id_campo_extraccion: 2, valor: 'false', fecha: '2026-02-01T00:00:00Z', id_respuesta_extraccion: 4 },
        { id_estudios: 11, id_campo_extraccion: 3, valor: '120', fecha: '2026-02-01T00:00:00Z', id_respuesta_extraccion: 5 },
        { id_estudios: 99, id_campo_extraccion: 3, valor: 'de un estudio que ya no pasa el umbral', fecha: '2026-02-01', id_respuesta_extraccion: 6 }
      ], error: null, count: 6 })
    });
    const r = await pide('get', '/revisiones/5/extraccion');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.revision, { id_detalles_revision: 5, titulo_revision: 'IA en educación' });
    assert.equal(r.body.limite, 2);
    assert.deepEqual(r.body.campos.map(c => c.id_campo_extraccion), [1, 2, 3, 4]);
    assert.deepEqual(r.body.estudios[0], { id_estudios: 10, titulo: 'Tutores inteligentes en la universidad', autores: 'Ruiz', anio: 2024, revista: 'R',
      doi: '10.1/x', puntuacion: 3.5, tiene_pdf: true, done: true, respuestas: { 1: 'Ecuador', 2: true } });
    assert.deepEqual(r.body.estudios[1].respuestas, { 2: false, 3: '120' });
    assert.equal(r.body.estudios[1].tiene_pdf, false);
    assert.equal(rpcParams('fn_get_studies_with_score_done').id_revision, 5);
    const q = deTabla('respuestas_extraccion')[0];
    assert.deepEqual(h.paso(q, 'in')[1], ['id_campo_extraccion', [1, 2, 3, 4]]);
    assert.deepEqual(h.paso(q, 'order')[1][0], 'id_respuesta_extraccion', 'orden estable para leer por páginas');
    assert.ok(h.paso(q, 'range'), 'las respuestas se leen por páginas (Supabase corta en 1000)');
  });

  test('sin campos no se piden respuestas; revisión que no ve → 404', async () => {
    responder = base({ 'rpc:fn_get_studies_with_score_done': () => ok([FILA_RPC()]), campos_extraccion: () => ok([]) });
    const r = await pide('get', '/revisiones/5/extraccion');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.estudios[0].respuestas, {});
    assert.equal(deTabla('respuestas_extraccion').length, 0);
    responder = base({}, { visible: false });
    assert.equal((await pide('get', '/revisiones/5/extraccion')).status, 404);
  });
});

describe('extracción: guardar', () => {
  test('PUT …/extraccion: una llamada transaccional con los valores como texto; done solo si llega', async () => {
    responder = base({ 'rpc:fn_guardar_extraccion_estudio': () => ok({ respondidas: 3, done: false }) });
    const r = await pide('put', '/revisiones/5/estudios/10/extraccion', { respuestas: [
      { id_campo_extraccion: 1, valor: '  Ecuador ' }, { id_campo_extraccion: 2, valor: true }, { id_campo_extraccion: 3, valor: 120 }, { id_campo_extraccion: 4, valor: null }] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { respondidas: 3, done: false });
    assert.deepEqual(rpcParams('fn_guardar_extraccion_estudio'), { p_id_rev: 5, p_id_estudio: 10, p_done: null, p_respuestas: [
      { id_campo_extraccion: 1, valor: 'Ecuador' }, { id_campo_extraccion: 2, valor: 'true' }, { id_campo_extraccion: 3, valor: '120' }, { id_campo_extraccion: 4, valor: '' }] });

    consultas.length = 0;
    await pide('put', '/revisiones/5/estudios/10/extraccion', { respuestas: [], done: true });
    assert.equal(rpcParams('fn_guardar_extraccion_estudio').p_done, true);
  });

  test('PUT …/extraccion/estado: solo la marca; errores de la base legibles', async () => {
    responder = base({ 'rpc:fn_guardar_extraccion_estudio': () => ok({ respondidas: 2, done: true }) });
    let r = await pide('put', '/revisiones/5/estudios/10/extraccion/estado', { done: true });
    assert.deepEqual(r.body, { respondidas: 2, done: true });
    assert.deepEqual(rpcParams('fn_guardar_extraccion_estudio'), { p_id_rev: 5, p_id_estudio: 10, p_respuestas: null, p_done: true });

    responder = base({ 'rpc:fn_guardar_extraccion_estudio': () => falla('22023', 'Guarda primero las respuestas de este estudio') });
    r = await pide('put', '/revisiones/5/estudios/10/extraccion/estado', { done: true });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'Guarda primero las respuestas de este estudio');
    responder = base({ 'rpc:fn_guardar_extraccion_estudio': () => falla('P0002', 'Estudio no encontrado en esta revisión') });
    assert.equal((await pide('put', '/revisiones/5/estudios/10/extraccion/estado', { done: false })).status, 404);
  });

  test('validación: campo repetido, campo de más, done no booleano → 400 sin tocar la base; lector → 403', async () => {
    responder = base();
    for (const cuerpo of [
      { respuestas: [{ id_campo_extraccion: 1, valor: 'a' }, { id_campo_extraccion: 1, valor: 'b' }] },
      { respuestas: [{ id_campo_extraccion: 1, valor: 'a', id_estudios: 99 }] },
      { respuestas: [], done: 'si' },
      { respuestas: [{ id_campo_extraccion: 1, valor: { a: 1 } }] },
      { respuestas: [{ id_campo_extraccion: 1, valor: 'x'.repeat(20001) }] }
    ]) {
      const r = await pide('put', '/revisiones/5/estudios/10/extraccion', cuerpo);
      assert.equal(r.status, 400, JSON.stringify(cuerpo).slice(0, 80));
    }
    assert.equal(llamo('fn_guardar_extraccion_estudio'), false);
    responder = base({}, { escribe: false });
    const r = await pide('put', '/revisiones/5/estudios/10/extraccion', { respuestas: [] });
    assert.equal(r.status, 403);
    assert.equal(llamo('fn_guardar_extraccion_estudio'), false);
  });
});

describe('extracción: sugerencias de la IA', () => {
  const IA_OK = JSON.stringify({ respuestas: [
    { id: 'C1', encontrado: true, valor: 'Ecuador', evidencia: 'estudio en Ecuador con 120 estudiantes', pagina: null },
    { id: 'C2', encontrado: true, valor: 'Sí', evidencia: '', pagina: null },
    { id: 'C3', encontrado: true, valor: '120 estudiantes', evidencia: 'con 120 participantes inventados', pagina: 2 },
    { id: 'C4', encontrado: true, valor: '2024-03-05', evidencia: '', pagina: null }
  ] });

  test('lee el PDF del bucket (no una URL), propone por campo y convierte la fecha al formato del formulario', async () => {
    respuestaIA = () => IA_OK;
    responder = base({
      estudios: () => ok(ESTUDIO({ url_pdf_articulo: 'estudios/10/123_articulo.pdf' })),
      campos_extraccion: () => ok(CAMPOS),
      documentos: () => ok(new Blob([Buffer.from('%PDF-1.4 del bucket')]))
    });
    const r = await pide('post', '/revisiones/5/estudios/10/extraccion/sugerir', {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.sugerencias, { 1: 'Ecuador', 2: true, 3: 120, 4: '2024-03-05' });
    assert.deepEqual(r.body.evidencias, {
      1: { cita: 'estudio en Ecuador con 120 estudiantes', pagina: null, verificada: true },
      3: { cita: 'con 120 participantes inventados', pagina: 2, verificada: false }      // no está en el PDF: sin verificar
    });
    assert.deepEqual(r.body.no_reportados, []);
    assert.deepEqual(h.paso(almacen('download')[0], 'download')[1], ['estudios/10/123_articulo.pdf']);
    assert.deepEqual(descargas, ['texto:%PDF-1.4'], 'no descarga ninguna URL');
    const prompt = llamadasIA[0][1].content;
    assert.match(prompt, /C1\. País del estudio — tipo Texto/);
    assert.match(prompt, /C4\. Fecha de publicación — tipo Fecha/);
    assert.match(prompt, /estudio «Tutores inteligentes en la universidad»/);
    assert.match(prompt, /Responde TODOS los campos/);

    // Sin un valor claro no hay propuesta: «Sin información» ya no se toma como Sí; en un campo de
    // texto, «no reportado» es la respuesta; los que falten se piden otra vez (una sola)
    let vuelta = 0;
    respuestaIA = () => (++vuelta === 1
      ? '{"respuestas":[{"id":"C1","encontrado":false,"valor":null},{"id":"C2","valor":"Sin información"},{"id":"C4","valor":"05/03/2024"}]}'
      : '{"respuestas":[{"id":"C3","encontrado":true,"valor":"varios"}]}');
    llamadasIA.length = 0;
    const r2 = await pide('post', '/revisiones/5/estudios/10/extraccion/sugerir', {});
    assert.deepEqual(r2.body.sugerencias, { 1: 'No reportado en el estudio.', 4: '2024-03-05' });
    assert.deepEqual(r2.body.no_reportados, [1, 2, 3]);
    assert.equal(llamadasIA.length, 2, 'una segunda llamada solo con el campo que faltó');
    assert.match(llamadasIA[1][1].content, /C3\. Tamaño de muestra/);
    assert.doesNotMatch(llamadasIA[1][1].content, /C1\. País/);
  });

  test('si el usuario no puede leer el PDF por las políticas de Storage, lo lee el servidor (la fila ya pasó RLS)', async () => {
    respuestaIA = () => IA_OK;
    let usuario = true;
    responder = base({
      estudios: () => ok(ESTUDIO({ url_pdf_articulo: 'estudios/10/a.pdf' })), campos_extraccion: () => ok(CAMPOS),
      documentos: () => (usuario ? { data: null, error: { message: 'Object not found', statusCode: '404' } } : ok(new Blob([Buffer.from('%PDF-1.4')])))
    });
    sb.adminDisponible = () => true;
    const original = sb.admin;
    sb.admin = () => { usuario = false; return original(); };
    const r = await pide('post', '/revisiones/5/estudios/10/extraccion/sugerir', {});
    assert.equal(r.status, 200);
  });

  test('sin PDF: usa la URL que manda la pantalla o el enlace abierto de la importación; sin nada → 400', async () => {
    respuestaIA = () => IA_OK;
    responder = base({ estudios: () => ok(ESTUDIO()), campos_extraccion: () => ok(CAMPOS) });
    let r = await pide('post', '/revisiones/5/estudios/10/extraccion/sugerir', { url: 'https://arxiv.org/pdf/1.pdf' });
    assert.equal(r.status, 200);
    assert.equal(descargas[0], 'https://arxiv.org/pdf/1.pdf');

    descargas.length = 0;
    responder = base({ estudios: () => ok(ESTUDIO({ url_pdf_externo: 'https://oa.org/x.pdf' })), campos_extraccion: () => ok(CAMPOS) });
    r = await pide('post', '/revisiones/5/estudios/10/extraccion/sugerir', {});
    assert.equal(descargas[0], 'https://oa.org/x.pdf');

    // Con PDF propio, la URL del cuerpo se ignora; un enlace externo guardado se descarga
    descargas.length = 0;
    responder = base({ estudios: () => ok(ESTUDIO({ url_pdf_articulo: 'https://revista.org/a.pdf' })), campos_extraccion: () => ok(CAMPOS) });
    r = await pide('post', '/revisiones/5/estudios/10/extraccion/sugerir', { url: 'https://otra.org/b.pdf' });
    assert.equal(descargas[0], 'https://revista.org/a.pdf');

    responder = base({ estudios: () => ok(ESTUDIO()), campos_extraccion: () => ok(CAMPOS) });
    r = await pide('post', '/revisiones/5/estudios/10/extraccion/sugerir', {});
    assert.equal(r.status, 400);
    assert.match(r.body.error, /no tiene PDF/);
  });

  test('PDF de otro artículo → 412 sin gastar IA; ruta de otro estudio → 404; sin campos → 400; lector → 403', async () => {
    textoPdf = 'Un texto sobre cultivos de cacao en la costa';
    responder = base({ estudios: () => ok(ESTUDIO({ url_pdf_articulo: 'https://revista.org/a.pdf' })), campos_extraccion: () => ok(CAMPOS) });
    let r = await pide('post', '/revisiones/5/estudios/10/extraccion/sugerir', {});
    assert.equal(r.status, 412);
    assert.equal(llamadasIA.length, 0);

    responder = base({ estudios: () => ok(ESTUDIO({ url_pdf_articulo: 'estudios/99/ajeno.pdf' })), campos_extraccion: () => ok(CAMPOS),
      documentos: () => { throw new Error('no debería descargar'); } });
    assert.equal((await pide('post', '/revisiones/5/estudios/10/extraccion/sugerir', {})).status, 404);

    responder = base({ estudios: () => ok(ESTUDIO({ url_pdf_articulo: 'https://revista.org/a.pdf' })), campos_extraccion: () => ok([]) });
    r = await pide('post', '/revisiones/5/estudios/10/extraccion/sugerir', {});
    assert.equal(r.status, 400);
    assert.match(r.body.error, /no tiene campos/);

    responder = base({}, { escribe: false });
    assert.equal((await pide('post', '/revisiones/5/estudios/10/extraccion/sugerir', {})).status, 403);
    assert.equal((await pide('post', '/revisiones/5/estudios/10/extraccion/sugerir', { url: 'no es url' })).status, 400);
  });
});

/* ======================================================================== Equipo */

describe('equipo e invitaciones', () => {
  test('GET /equipo y /mi-rol (por el usuario del token); revisión que no ve → 404', async () => {
    const MIEMBROS = [
      { id_usuarios: 'otro', nombre: 'Ana', correo: 'ana@x.com', rol: 'propietario', estado: 'activo', fecha_alta: '2026-01-01', es_creador: true },
      { id_usuarios: ID_USUARIO, nombre: 'Yo', correo: 'yo@x.com', rol: 'lector', estado: 'activo', fecha_alta: '2026-01-02', es_creador: false }
    ];
    responder = base({ 'rpc:fn_equipo_revision': () => ok(MIEMBROS) });
    let r = await pide('get', '/revisiones/5/equipo');
    assert.deepEqual(r.body, MIEMBROS);
    assert.deepEqual(rpcParams('fn_equipo_revision'), { p_id_rev: 5 });
    r = await pide('get', '/revisiones/5/mi-rol');
    assert.deepEqual(r.body, { rol: 'lector' });
    responder = base({ 'rpc:fn_equipo_revision': () => ok(MIEMBROS.slice(0, 1)) });
    assert.deepEqual((await pide('get', '/revisiones/5/mi-rol')).body, { rol: null });
    responder = base({ 'rpc:fn_equipo_revision': () => ok(MIEMBROS) }, { visible: false });
    assert.equal((await pide('get', '/revisiones/5/equipo')).status, 404);
  });

  test('invitar: la revisión sale de la URL y el correo se normaliza; sin correo configurado devuelve el enlace', async () => {
    responder = base({ 'rpc:fn_invitar_colaborador': () => ok({ tipo: 'invitacion_enviada', id_invitacion: 3, token: 'tok-1', correo: 'ana@x.com' }) });
    const r = await pide('post', '/revisiones/5/equipo/invitaciones', { correo: '  Ana@X.com ', rol: 'lector' });
    assert.equal(r.status, 201);
    assert.deepEqual(rpcParams('fn_invitar_colaborador'), { p_id_rev: 5, p_correo: 'ana@x.com', p_rol: 'lector' });
    assert.deepEqual(r.body, { tipo: 'invitacion_enviada', id_invitacion: 3, correo: 'ana@x.com', correo_enviado: false, token: 'tok-1' });
    for (const cuerpo of [{ correo: 'no-es-correo' }, { correo: 'a@x.com', rol: 'propietario' }, { correo: 'a@x.com', id_detalles_revision: 9 }]) {
      assert.equal((await pide('post', '/revisiones/5/equipo/invitaciones', cuerpo)).status, 400);
    }
  });

  test('invitar con correo configurado: el token NO vuelve al cliente (solo le llega al invitado)', async () => {
    const enviados = [];
    const original = email.sendInvitationMail;
    email.sendInvitationMail = async m => { enviados.push(m); };
    env.mailEnabled = true;
    try {
      responder = base({ 'rpc:fn_invitar_colaborador': () => ok({ tipo: 'invitacion_enviada', id_invitacion: 3, token: 'tok-2', correo: 'ana@x.com' }) });
      const r = await pide('post', '/revisiones/5/equipo/invitaciones', { correo: 'ana@x.com' });
      assert.deepEqual(r.body, { tipo: 'invitacion_enviada', id_invitacion: 3, correo: 'ana@x.com', correo_enviado: true });
      assert.equal(enviados[0].to, 'ana@x.com');
      assert.match(enviados[0].enlace, /\/invitacion\?token=tok-2$/);
      assert.equal(enviados[0].tituloRevision, 'IA en educación');
    } finally {
      email.sendInvitationMail = original;
      env.mailEnabled = false;
    }
  });

  test('cambiar rol y quitar: solo el propietario (lo decide la base); uid inválido → 400', async () => {
    responder = base({ 'rpc:fn_cambiar_rol_colaborador': () => ok(null), 'rpc:fn_quitar_colaborador': () => ok(null) });
    const uid = h.nuevoId();
    let r = await pide('patch', `/revisiones/5/equipo/${uid}`, { rol: 'revisor' });
    assert.deepEqual(r.body, { id_usuarios: uid, rol: 'revisor' });
    assert.deepEqual(rpcParams('fn_cambiar_rol_colaborador'), { p_id_rev: 5, p_id_usuario: uid, p_rol: 'revisor' });
    r = await pide('delete', `/revisiones/5/equipo/${uid}`);
    assert.equal(r.status, 204);
    assert.deepEqual(rpcParams('fn_quitar_colaborador'), { p_id_rev: 5, p_id_usuario: uid });

    responder = base({ 'rpc:fn_cambiar_rol_colaborador': () => falla('42501', 'Solo el propietario puede cambiar roles') });
    r = await pide('patch', `/revisiones/5/equipo/${uid}`, { rol: 'lector' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'Solo el propietario puede cambiar roles');
    assert.equal((await pide('patch', '/revisiones/5/equipo/123', { rol: 'lector' })).status, 400);
    assert.equal((await pide('patch', `/revisiones/5/equipo/${uid}`, { rol: 'admin' })).status, 400);
  });

  test('aceptar invitación: el token va en el cuerpo; el mensaje de la base llega tal cual', async () => {
    const token = h.nuevoId();
    responder = () => ok({ id_detalles_revision: 5, rol: 'revisor' });
    let r = await pide('post', '/invitaciones/aceptar', { token });
    assert.deepEqual(r.body, { id_detalles_revision: 5, rol: 'revisor' });
    assert.deepEqual(rpcParams('fn_aceptar_invitacion'), { p_token: token });
    responder = () => falla('P0001', 'La invitación fue enviada a otra dirección de correo');
    r = await pide('post', '/invitaciones/aceptar', { token });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'La invitación fue enviada a otra dirección de correo');
    assert.equal((await pide('post', '/invitaciones/aceptar', { token: 'x' })).status, 400);
  });

  test('la ruta antigua /api/colaboradores/invitar responde igual que antes', async () => {
    responder = base({ 'rpc:fn_invitar_colaborador': () => ok({ tipo: 'agregado_directo', id_usuarios: 'x', rol: 'revisor' }) });
    const r = await request(app).post('/api/colaboradores/invitar').set('Authorization', await sesion())
      .send({ id_detalles_revision: 5, correo: 'a@x.com', rol: 'revisor' });
    assert.deepEqual(r.body, { tipo: 'agregado_directo', id_usuarios: 'x', rol: 'revisor', correo_enviado: false });
  });
});

/* ======================================================================== Cuenta */

describe('cuenta', () => {
  const PERFIL = { id_usuarios: ID_USUARIO, nombre_usuario: 'yo', correo_electronico: 'yo@x.com', nombre: 'Ana', apellido: null,
    institucion: null, ruta_imagen: null, orcid: null, profesion: null, pais: 'Ecuador' };

  test('PATCH /perfil: solo los campos editables, del usuario del token; el correo no se acepta', async () => {
    responder = p => ok({ ...PERFIL, nombre: 'Ana María', pais: null });
    let r = await pide('patch', '/cuenta/perfil', { nombre: ' Ana María ', pais: '' });
    assert.equal(r.status, 200);
    const q = deTabla('usuarios', 'update')[0];
    assert.deepEqual(h.paso(q, 'update')[1][0], { nombre: 'Ana María', pais: null });
    assert.deepEqual(h.paso(q, 'eq')[1], ['id_usuarios', ID_USUARIO]);
    for (const cuerpo of [{ correo_electronico: 'otro@x.com' }, { ruta_imagen: 'https://x' }, {}, { nombre: 'x'.repeat(101) }]) {
      assert.equal((await pide('patch', '/cuenta/perfil', cuerpo)).status, 400, JSON.stringify(cuerpo).slice(0, 40));
    }
    responder = () => ok(null);
    assert.equal((await pide('patch', '/cuenta/perfil', { nombre: 'x' })).status, 404);
  });

  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);
  const subirFoto = async (buf, tipo = 'image/png') => request(app).put('/api/v1/cuenta/avatar')
    .set('Authorization', await sesion()).set('Content-Type', tipo).send(buf);

  test('PUT /avatar: va a la carpeta del usuario, guarda la URL pública y borra la foto anterior SOLO si era suya', async () => {
    let anterior = `http://127.0.0.1:9/storage/v1/object/public/avatars/${ID_USUARIO}/1.png`;
    responder = p => {
      if (h.tabla(p) === 'usuarios') return ok(h.paso(p, 'update') ? { ...PERFIL, ruta_imagen: h.paso(p, 'update')[1][0].ruta_imagen } : { ...PERFIL, ruta_imagen: anterior });
      return ok({});
    };
    let r = await subirFoto(PNG);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const subida = h.paso(almacen('upload')[0], 'upload')[1];
    assert.match(subida[0], new RegExp(`^${ID_USUARIO}/\\d+\\.png$`));
    assert.equal(subida[2].contentType, 'image/png');
    assert.equal(h.paso(almacen('upload')[0], 'from')[1][0], 'avatars');
    assert.equal(r.body.ruta_imagen, `http://127.0.0.1:9/storage/v1/object/public/avatars/${subida[0]}`);
    assert.deepEqual(h.paso(almacen('remove')[0], 'remove')[1][0], [`${ID_USUARIO}/1.png`]);

    consultas.length = 0;
    anterior = 'http://127.0.0.1:9/storage/v1/object/public/avatars/path/to/file/de-otro.png';
    r = await subirFoto(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50)]), 'image/jpeg');
    assert.equal(r.status, 200);
    assert.match(h.paso(almacen('upload')[0], 'upload')[1][0], /\.jpg$/);
    assert.equal(almacen('remove').length, 0, 'una foto fuera de su carpeta no se borra');
  });

  test('PUT /avatar: el contenido manda (no el Content-Type); otro formato → 415; más de 2 MB → 413', async () => {
    responder = p => ok(h.tabla(p) === 'usuarios' ? PERFIL : {});
    let r = await subirFoto(Buffer.from('GIF89a…'), 'image/png');
    assert.equal(r.status, 415);
    r = await subirFoto(Buffer.from('hola'), 'text/plain');
    assert.equal(r.status, 415);
    r = await subirFoto(Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]));
    assert.equal(r.status, 413);
    assert.match(r.body.error, /2 MB/);
    assert.equal(almacen('upload').length, 0);
  });

  test('PUT /avatar: si las políticas de Storage no dejan subir al usuario, sube el servidor (ruta propia)', async () => {
    let usuario = true;
    responder = p => {
      if (h.tabla(p) === 'usuarios') return ok(PERFIL);
      if (h.paso(p, 'upload') && usuario) return { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } };
      return ok({});
    };
    sb.adminDisponible = () => true;
    const original = sb.admin;
    sb.admin = () => { usuario = false; return original(); };
    const r = await subirFoto(PNG);
    assert.equal(r.status, 200);
    assert.ok(consultas.some(p => p[0] === 'ADMIN' && h.paso(p[1], 'upload')));
  });

  test('preferencias: GET y PUT con solo las claves conocidas', async () => {
    responder = () => ok({ id_usuarios: ID_USUARIO, invitaciones: true, fases: false });
    assert.equal((await pide('get', '/cuenta/preferencias-notificacion')).body.fases, false);
    await pide('put', '/cuenta/preferencias-notificacion', { fases: true, desactivar_todo: false });
    assert.deepEqual(rpcParams('fn_guardar_preferencias_notificacion'), { p_valores: { fases: true, desactivar_todo: false } });
    assert.equal((await pide('put', '/cuenta/preferencias-notificacion', { otra: true })).status, 400);
    assert.equal((await pide('put', '/cuenta/preferencias-notificacion', { fases: 'si' })).status, 400);
  });

  test('sesiones: lista, vigente y cerrar (una o todas) con bloqueo breve por service_role', async () => {
    responder = p => (esRpc(p, 'fn_mis_sesiones') ? ok([{ id: 'a', es_actual: true }]) : esRpc(p, 'fn_sesion_vigente') ? ok(false)
      : esRpc(p, 'fn_cerrar_sesion') ? ok(true) : esRpc(p, 'fn_cerrar_otras_sesiones') ? ok(3) : ok({}));
    assert.deepEqual((await pide('get', '/cuenta/sesiones')).body, [{ id: 'a', es_actual: true }]);
    assert.deepEqual((await pide('get', '/cuenta/sesion-vigente')).body, { vigente: false });

    const id = h.nuevoId();
    let r = await pide('post', '/cuenta/sesiones/cerrar', { id });
    assert.deepEqual(r.body, { cerradas: 1, bloqueo: null });
    assert.deepEqual(rpcParams('fn_cerrar_sesion'), { p_id: id });

    const bloqueos = [];
    env.adminEnabled = true;
    sb.admin = () => ({ auth: { admin: { updateUserById: async (u, o) => { bloqueos.push([u, o]); return { error: null }; } } } });
    try {
      const antes = responder;
      responder = p => (esRpc(p, 'fn_cerrar_sesion') ? ok(false) : antes(p));
      r = await pide('post', '/cuenta/sesiones/cerrar', { id });
      assert.deepEqual(r.body, { cerradas: 0, bloqueo: null }, 'si no se cerró nada, no se bloquea la cuenta');
      responder = antes;
      r = await pide('post', '/cuenta/sesiones/cerrar', { todas: true });
      assert.deepEqual(r.body, { cerradas: 3, bloqueo: '10s' });
      assert.deepEqual(bloqueos, [[ID_USUARIO, { ban_duration: '10s' }]]);
    } finally { env.adminEnabled = false; }

    for (const cuerpo of [{}, { id: 'x' }, { todas: false }, { id, todas: true }]) {
      assert.equal((await pide('post', '/cuenta/sesiones/cerrar', cuerpo)).status, 400, JSON.stringify(cuerpo));
    }
  });

  test('aviso de inicio de sesión: sin correo configurado no falla', async () => {
    const r = await pide('post', '/cuenta/aviso-inicio-sesion', {});
    assert.deepEqual(r.body, { enviado: false, motivo: 'correo_no_configurado' });
    assert.equal(cuenta.describirDispositivo('Mozilla/5.0 (Windows NT 10.0) Chrome/120'), 'Chrome en Windows');
  });
});

/* ======================================================================== Notificaciones y países */

describe('notificaciones y países', () => {
  test('GET /notificaciones con filtros; POST /leidas con ids o todas', async () => {
    responder = p => (esRpc(p, 'fn_marcar_notificaciones') ? ok(4) : ok([{ id_notificacion: 1, leida: false }]));
    let r = await pide('get', '/notificaciones?solo_no_leidas=true&limite=50');
    assert.deepEqual(r.body, [{ id_notificacion: 1, leida: false }]);
    assert.deepEqual(rpcParams('fn_mis_notificaciones'), { p_solo_no_leidas: true, p_limite: 50 });
    consultas.length = 0;
    await pide('get', '/notificaciones');
    assert.deepEqual(rpcParams('fn_mis_notificaciones'), { p_solo_no_leidas: false, p_limite: 30 });
    assert.equal((await pide('get', '/notificaciones?limite=500')).status, 400);

    r = await pide('post', '/notificaciones/leidas', { ids: [1, 2] });
    assert.deepEqual(r.body, { marcadas: 4 });
    assert.deepEqual(rpcParams('fn_marcar_notificaciones'), { p_ids: [1, 2] });
    consultas.length = 0;
    await pide('post', '/notificaciones/leidas', {});
    assert.deepEqual(rpcParams('fn_marcar_notificaciones'), { p_ids: null });
    assert.equal((await pide('post', '/notificaciones/leidas', { ids: [] })).status, 400);
  });

  test('GET /catalogos/paises: en español, ordenados, sin servicio externo', async () => {
    const r = await pide('get', '/catalogos/paises');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 250);
    assert.ok(r.body.some(p => p.codigo === 'EC' && p.nombre === 'Ecuador'));
    assert.ok(r.body.some(p => p.codigo === 'ES' && p.nombre === 'España'));
    const nombres = r.body.map(p => p.nombre);
    assert.deepEqual(nombres, [...nombres].sort((a, b) => a.localeCompare(b, 'es')));
    assert.equal(consultas.length, 0);
    assert.equal(paises(), paises(), 'se calcula una vez');
  });
});

/* ======================================================================== Administración */

describe('administración', () => {
  const comoAdmin = { rol: 'admin' };

  test('un usuario normal recibe 403 en todo /admin; el admin llega a las funciones', async () => {
    for (const ruta of ['/admin/resumen', '/admin/revisiones', '/admin/catalogos/metodologias']) {
      assert.equal((await pide('get', ruta)).status, 403, ruta);
    }
    responder = () => ok({ usuarios_total: 3 });
    assert.deepEqual((await pide('get', '/admin/resumen', undefined, comoAdmin)).body, { usuarios_total: 3 });
  });

  test('usuarios y uso: parámetros validados', async () => {
    responder = () => ok([{ id_usuarios: 'a', total: 41 }]);
    let r = await pide('get', '/admin/usuarios?q=ana&page=2&size=20', undefined, comoAdmin);
    assert.deepEqual(r.body, { usuarios: [{ id_usuarios: 'a', total: 41 }], total: 41, page: 2 });
    assert.deepEqual(rpcParams('fn_admin_usuarios'), { q: 'ana', p_page: 2, p_size: 20 });
    assert.equal((await pide('get', '/admin/usuarios?size=500', undefined, comoAdmin)).status, 400);
    await pide('get', '/admin/uso?desde=2026-01-01T00:00:00&hasta=2026-01-31T23:59:59', undefined, comoAdmin);
    assert.ok(rpcParams('fn_admin_uso').desde.startsWith('2026-01-01'));
    assert.equal((await pide('get', '/admin/uso?desde=ayer', undefined, comoAdmin)).status, 400);
  });

  test('revisiones de toda la plataforma con su propietario (en otra consulta) y comodines como texto', async () => {
    responder = p => (h.tabla(p) === 'usuarios'
      ? ok([{ id_usuarios: 'u1', nombre_usuario: 'ana', correo_electronico: 'ana@x.com' }])
      : { data: [{ id_detalles_revision: 1, titulo_revision: 'A', id_usuarios: 'u1' }, { id_detalles_revision: 2, titulo_revision: 'B', id_usuarios: 'u2' }], error: null, count: 57 });
    const r = await pide('get', '/admin/revisiones?q=50%25_x&page=3&size=10', undefined, comoAdmin);
    assert.equal(r.body.total, 57);
    assert.deepEqual(r.body.revisiones[0].usuarios, { nombre_usuario: 'ana', correo_electronico: 'ana@x.com' });
    assert.equal(r.body.revisiones[1].usuarios, null);
    const q = deTabla('detalles_revision')[0];
    assert.deepEqual(h.paso(q, 'range')[1], [20, 29]);
    assert.deepEqual(h.paso(q, 'ilike')[1], ['titulo_revision', '%50\\%\\_x%']);
  });

  test('activar/desactivar y rol: no sobre uno mismo; promover exige el código (compartido con la ruta antigua)', async () => {
    const otro = h.nuevoId();
    let r = await pide('patch', `/admin/usuarios/${ID_USUARIO}/activo`, { activo: false }, comoAdmin);
    assert.equal(r.status, 400);
    const bloqueos = [];
    sb.admin = () => ({ auth: { admin: { updateUserById: async (u, o) => { bloqueos.push([u, o]); return { error: null }; } } } });
    responder = () => ok(null);
    r = await pide('patch', `/admin/usuarios/${otro}/activo`, { activo: false }, comoAdmin);
    assert.deepEqual(r.body, { id: otro, activo: false });
    assert.deepEqual(bloqueos, [[otro, { ban_duration: '876000h' }]]);

    r = await pide('patch', `/admin/usuarios/${otro}/rol`, { rol: 'admin' }, comoAdmin);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /caducado/);
    admin.CODIGOS.set(`${ID_USUARIO}:${otro}`, { codigo: '123456', expira: Date.now() + 60_000, intentos: 0 });
    r = await pide('patch', `/admin/usuarios/${otro}/rol`, { rol: 'admin', codigo: '000000' }, comoAdmin);
    assert.equal(r.body.error, 'El código no es correcto.');
    r = await request(app).patch(`/api/admin/usuarios/${otro}/rol`).set('Authorization', await sesion(comoAdmin)).send({ rol: 'admin', codigo: '123456' });
    assert.equal(r.status, 200, 'la ruta antigua usa los mismos códigos');
    assert.deepEqual(rpcParams('fn_admin_set_rol'), { p_id: otro, p_rol: 'admin' });
    assert.equal(admin.CODIGOS.size, 0);
    assert.equal((await pide('post', `/admin/usuarios/${otro}/rol/codigo`, {}, comoAdmin)).status, 503, 'sin correo configurado');
  });

  test('catálogos: crear, editar, borrar y sigla; duplicado → 409 con mensaje propio', async () => {
    responder = () => ok({ id_metodologia: 7, nombre: 'PEO' });
    let r = await pide('post', '/admin/catalogos/metodologias', { nombre: ' PEO ', descripcion: '' }, comoAdmin);
    assert.equal(r.status, 201);
    assert.deepEqual(rpcParams('fn_admin_guardar_metodologia'), { p_id: null, p_nombre: 'PEO', p_descripcion: null });
    consultas.length = 0;
    await pide('put', '/admin/catalogos/metodologias/7', { nombre: 'PEO', descripcion: 'Población, exposición, resultado' }, comoAdmin);
    assert.equal(rpcParams('fn_admin_guardar_metodologia').p_id, 7);
    r = await pide('delete', '/admin/catalogos/metodologias/7', undefined, comoAdmin);
    assert.equal(r.status, 204);
    assert.deepEqual(rpcParams('fn_admin_borrar_metodologia'), { p_id: 7 });

    await pide('post', '/admin/catalogos/componentes', { id_metodologia: 7, nombre: 'Exposición', sigla: 'e' }, comoAdmin);
    assert.deepEqual(rpcParams('fn_admin_guardar_componente'), { p_id: null, p_id_metodologia: 7, p_nombre: 'Exposición', p_descripcion: null, p_sigla: 'E' });
    responder = () => ok('EX');
    r = await pide('get', '/admin/catalogos/componentes/sigla?nombre=Exposici%C3%B3n&id_metodologia=7', undefined, comoAdmin);
    assert.deepEqual(r.body, { sigla: 'EX' });
    assert.deepEqual(rpcParams('fn_sigla_sugerida'), { p_nombre: 'Exposición', p_id_metodologia: 7 });

    responder = () => falla('23505', 'duplicate key value violates unique constraint');
    r = await pide('post', '/admin/catalogos/metodologias', { nombre: 'PICO' }, comoAdmin);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'Ya existe una metodología con ese nombre.');
    responder = () => falla('P0001', 'Las metodologías del sistema no se pueden eliminar');
    r = await pide('delete', '/admin/catalogos/metodologias/1', undefined, comoAdmin);
    assert.equal(r.body.error, 'Las metodologías del sistema no se pueden eliminar');

    assert.equal((await pide('post', '/admin/catalogos/plantillas', { nombre: 'X', estilo_cita: 'APA', cita_en_texto: 'otra' }, comoAdmin)).status, 400);
    responder = () => ok([{ id_componente: 1 }]);
    await pide('get', '/admin/catalogos/componentes?id_metodologia=3', undefined, comoAdmin);
    assert.deepEqual(h.paso(deTabla('componente')[0], 'eq')[1], ['id_metodologia', 3]);
  });
});

/* ======================================================================== LEGACY_API=off */

describe('LEGACY_API=off', () => {
  test('solo quedan /api/health y /api/contact; /api/v1 sigue igual', async () => {
    const rutas = ['../routes', '../app'].map(r => require.resolve(r));
    env.legacyApi = false;
    rutas.forEach(r => delete require.cache[r]);
    try {
      const app2 = require('../app');
      const auth = await sesion();
      assert.equal((await request(app2).get('/api/health')).status, 200);
      assert.equal((await request(app2).post('/api/contact').send({})).status, 400, 'el formulario sigue validando');
      for (const [m, ruta] of [['post', '/api/generate-objective'], ['post', '/api/generate-extraction-suggestions'],
        ['post', '/api/colaboradores/invitar'], ['get', '/api/admin/resumen'], ['post', '/api/cuenta/cerrar-sesion']]) {
        assert.equal((await request(app2)[m](ruta).set('Authorization', auth).send({})).status, 404, ruta);
      }
      responder = () => ok([]);
      assert.equal((await request(app2).get('/api/v1/notificaciones').set('Authorization', auth)).status, 200);
    } finally {
      env.legacyApi = true;
      rutas.forEach(r => delete require.cache[r]);
      require('../app');
    }
  });
});
