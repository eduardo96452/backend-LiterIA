// test/estudios.test.js — Estudios: lista, alta con duplicados, edición, PDF, calidad,
// importación, cribado y DOI. Sin red: Supabase, OpenAI y las bases académicas simulados.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const h = require('./helpers');

// ---------- Bases académicas y CrossRef simuladas (antes de cargar la app) ----------
const llamadasFuentes = [];
let paginasFuente = () => ({ items: [], total: 0 });
let doiFalso = async () => null;
require.cache[path.join(__dirname, '../infra/academicas.js')] = {
  id: 'academicas-falso', filename: 'academicas-falso', loaded: true,
  exports: {
    FUENTES: {
      openalex: async q => { llamadasFuentes.push(q); return paginasFuente(q); },
      semantic_scholar: async q => { llamadasFuentes.push(q); return paginasFuente(q); },
      crossref: async q => { llamadasFuentes.push(q); return paginasFuente(q); }
    },
    consultarDoi: doi => doiFalso(doi),
    limpiarDoi: d => d
  }
};
// ---------- IA simulada ----------
const llamadasIA = [];
let respuestaIA = () => '{}';
require.cache[path.join(__dirname, '../infra/openai.js')] = {
  id: 'openai-falso', filename: 'openai-falso', loaded: true,
  exports: { callOpenAI: async (m, o) => { llamadasIA.push(m); return respuestaIA(m, o); }, embed: async () => [] }
};

const request = require('supertest');
const app = require('../app');
const sb = require('../infra/supabase');
const { normalizarTitulo, limpiarDoi } = require('../modules/estudios/campos');
const { rutaDelPdf, nombreSeguro } = require('../modules/estudios/estudios.service');
const { buscarDuplicado, similitud } = require('../modules/estudios/duplicados');

// ---------- Supabase simulado ----------
let responder;
const consultas = [];
beforeEach(() => {
  consultas.length = 0; llamadasIA.length = 0; llamadasFuentes.length = 0;
  respuestaIA = () => '{}';
  paginasFuente = () => ({ items: [], total: 0 });
  doiFalso = async () => null;
  responder = () => ({ data: null, error: null });
  sb.forUser = () => h.clienteFalso(p => { consultas.push(p); return responder(p); });
  sb.admin = () => h.clienteFalso(p => { consultas.push(['ADMIN', p]); return responder(p); });
  sb.adminDisponible = () => false;
});

const REV = { id_detalles_revision: 5, id_usuarios: 'u', titulo_revision: 'IA en educación', objetivo: 'Analizar la IA', tipo_revision: 'RSL' };
const CRITERIOS = [
  { id_criterios: 1, descripcion: 'Estudios empíricos', tipo: 'inclusion' },
  { id_criterios: 2, descripcion: 'Idioma no inglés', tipo: 'exclusion' }
];
const esRpc = (p, fn) => Array.isArray(p) && p[0] && p[0][0] === 'rpc' && p[0][1][0] === fn;
const rpcParams = fn => consultas.find(p => esRpc(p, fn))?.[0][1][1];
const deTabla = (tabla, paso) => consultas.filter(p => Array.isArray(p) && p[0] !== 'ADMIN' && h.tabla(p) === tabla && (!paso || h.paso(p, paso)));
const almacen = op => consultas.map(p => (p[0] === 'ADMIN' ? p[1] : p)).filter(p => p[0]?.[0] === 'storage' && h.paso(p, op));
const ok = data => ({ data, error: null });

function base(extra = {}, { escribe = true, visible = true } = {}) {
  return p => {
    if (esRpc(p, 'owns_revision')) return ok(escribe);
    if (h.tabla(p) === 'detalles_revision') return ok(visible ? REV : null);
    for (const [clave, fn] of Object.entries(extra)) {
      if ((clave.startsWith('rpc:') && esRpc(p, clave.slice(4))) || h.tabla(p) === clave) return fn(p);
    }
    if (h.tabla(p) === 'criterios') return ok(CRITERIOS);
    return ok(null);
  };
}
const sesion = async () => `Bearer ${await h.token()}`;
const estudio = (o = {}) => ({ id_estudios: 10, id_detalles_revision: 5, titulo: 'Tutores inteligentes', estado: 'Sin clasificar', id_criterio: null, doi: null, url_pdf_articulo: null, ...o });

// ---------- Normalización ----------
describe('normalización', () => {
  test('títulos comparables sin tildes, mayúsculas ni signos; DOI sin prefijos', () => {
    assert.equal(normalizarTitulo('Deep-Learning: A Review!'), normalizarTitulo('  deep learning — a REVIEW '));
    assert.equal(normalizarTitulo('Educación'), 'educacion');
    assert.equal(limpiarDoi('https://doi.org/10.1/ABC '), '10.1/ABC');
    assert.equal(limpiarDoi('doi: 10.1/x'), '10.1/x');
    assert.equal(limpiarDoi('  '), null);
  });
  test('rutas de PDF: solo dentro de estudios/<id>/, también desde URL pública antigua', () => {
    assert.equal(rutaDelPdf(10, 'estudios/10/1_a.pdf'), 'estudios/10/1_a.pdf');
    assert.equal(rutaDelPdf(10, 'https://x.supabase.co/storage/v1/object/public/documentos/estudios/10/a%20b.pdf'), 'estudios/10/a b.pdf');
    for (const malo of ['estudios/11/a.pdf', 'estudios/10/../11/a.pdf', 'estudios/10/sub/a.pdf', 'informes/10/a.pdf', 'estudios/10/', 'https://otro.org/a.pdf']) {
      assert.equal(rutaDelPdf(10, malo), null, malo);
    }
    assert.equal(nombreSeguro('C:\\Users\\Ana\\Mi artículo (final).PDF'), 'Mi_articulo_final.pdf');
    assert.equal(nombreSeguro('../../.pdf'), 'articulo.pdf');
  });
});

// ---------- Lista ----------
describe('lista', () => {
  test('GET devuelve tiene_pdf y la sugerencia de la IA, sin la ruta interna del PDF', async () => {
    responder = base({ estudios: () => ok([
      estudio({ url_pdf_articulo: 'estudios/10/a.pdf', cribado_sugerencias: [{ sugerencia: 'Aceptado', id_criterio: 1, confianza: '0.8', justificacion: 'J', revisada: false }] }),
      estudio({ id_estudios: 11, cribado_sugerencias: [] })
    ]) });
    const r = await request(app).get('/api/v1/revisiones/5/estudios').set('Authorization', await sesion());
    assert.equal(r.status, 200);
    assert.equal(r.body[0].tiene_pdf, true);
    assert.equal('url_pdf_articulo' in r.body[0], false);
    assert.deepEqual(r.body[0].sugerencia, { sugerencia: 'Aceptado', id_criterio: 1, confianza: 0.8, justificacion: 'J', revisada: false, fecha: null });
    assert.equal(r.body[1].sugerencia, null);
    assert.equal(r.body[1].tiene_pdf, false);
  });

  test('más de 1000 estudios: se leen por páginas (antes se cortaba en 1000)', async () => {
    responder = base({ estudios: p => {
      const [desde] = h.paso(p, 'range')[1];
      const n = desde === 0 ? 1000 : desde === 1000 ? 3 : 0;
      return ok(Array.from({ length: n }, (_, i) => estudio({ id_estudios: desde + i + 1 })));
    } });
    const r = await request(app).get('/api/v1/revisiones/5/estudios').set('Authorization', await sesion());
    assert.equal(r.body.length, 1003);
  });

  test('revisión que no ve → 404', async () => {
    responder = base({ estudios: () => ok([]) }, { visible: false });
    assert.equal((await request(app).get('/api/v1/revisiones/5/estudios').set('Authorization', await sesion())).status, 404);
  });
});

// ---------- Alta ----------
describe('alta', () => {
  const existentes = () => ok([{ id_estudios: 1, titulo: 'Deep Learning: a review', doi: '10.1/AAA', estado: 'Sin clasificar' }]);

  test('lote: marca duplicados por título normalizado o DOI, también dentro del propio lote', async () => {
    responder = base({ estudios: p => (h.paso(p, 'insert') ? ok(h.paso(p, 'insert')[1][0].map((f, i) => ({ ...f, id_estudios: 100 + i }))) : existentes()) });
    const r = await request(app).post('/api/v1/revisiones/5/estudios').set('Authorization', await sesion()).send({ estudios: [
      { titulo: 'DEEP-LEARNING — A Review', autores: 'A' },          // mismo título
      { titulo: 'Otro', doi: 'https://doi.org/10.1/aaa' },          // mismo DOI
      { titulo: 'Nuevo estudio', doi: '10.2/x' },
      { titulo: 'nuevo   estudio' },                                // repetido en el lote
      { titulo: 'Incluido', estado: 'Aceptado', id_criterio: 1 }
    ] });
    assert.equal(r.status, 201);
    assert.equal(r.body.creados, 5);
    assert.equal(r.body.duplicados, 3);
    const filas = h.paso(deTabla('estudios', 'insert')[0], 'insert')[1][0];
    assert.deepEqual(filas.map(f => f.estado), ['Duplicado', 'Duplicado', 'Sin clasificar', 'Duplicado', 'Aceptado']);
    assert.equal(filas[1].doi, '10.1/aaa');
    assert.ok(filas.every(f => f.id_detalles_revision === 5));
    assert.equal(filas[4].id_criterio, 1);
    assert.equal(filas[0].id_criterio, null);
    assert.equal(deTabla('estudios', 'insert').length, 1, 'un solo insert para todo el lote (antes, dos peticiones por estudio)');
  });

  test('criterio de otro tipo o de otra revisión → 400; campos no permitidos → 400', async () => {
    responder = base({ estudios: existentes });
    const auth = await sesion();
    let r = await request(app).post('/api/v1/revisiones/5/estudios').set('Authorization', auth).send({ estudios: [{ titulo: 'X', estado: 'Aceptado', id_criterio: 2 }] });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /criterio de inclusión/);
    r = await request(app).post('/api/v1/revisiones/5/estudios').set('Authorization', auth).send({ estudios: [{ titulo: 'X', estado: 'Rechazado', id_criterio: 99 }] });
    assert.match(r.body.error, /no pertenece a esta revisión/);
    for (const extra of [{ url_pdf_articulo: 'estudios/1/a.pdf' }, { id_detalles_revision: 9 }, { origen: 'openalex' }]) {
      r = await request(app).post('/api/v1/revisiones/5/estudios').set('Authorization', auth).send({ estudios: [{ titulo: 'X', ...extra }] });
      assert.equal(r.status, 400, JSON.stringify(extra));
    }
    assert.equal(deTabla('estudios', 'insert').length, 0);
  });

  test('un lector no puede crear (403 antes de tocar la tabla)', async () => {
    responder = base({ estudios: existentes }, { escribe: false });
    const r = await request(app).post('/api/v1/revisiones/5/estudios').set('Authorization', await sesion()).send({ estudios: [{ titulo: 'X' }] });
    assert.equal(r.status, 403);
    assert.equal(deTabla('estudios', 'insert').length, 0);
  });

  test('sin el SQL 004: si el DOI de un duplicado choca, se reintenta guardándolo sin DOI', async () => {
    let intentos = 0;
    responder = base({ estudios: p => {
      if (!h.paso(p, 'insert')) return existentes();
      intentos++;
      const filas = h.paso(p, 'insert')[1][0];
      if (filas.some(f => f.doi === '10.1/AAA')) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "ux_estudios_rev_doi"' } };
      return ok(filas.map((f, i) => ({ ...f, id_estudios: 200 + i })));
    } });
    const r = await request(app).post('/api/v1/revisiones/5/estudios').set('Authorization', await sesion()).send({ estudios: [{ titulo: 'Repetido', doi: '10.1/AAA' }] });
    assert.equal(r.status, 201);
    assert.equal(intentos, 2);
    assert.equal(r.body.estudios[0].estado, 'Duplicado');
    assert.equal(r.body.estudios[0].doi, null);
  });

  test('si el choque de DOI no es de un duplicado (carrera con otro usuario) → 409', async () => {
    responder = base({ estudios: p => (h.paso(p, 'insert') ? { data: null, error: { code: '23505', message: 'dup' } } : ok([])) });
    const r = await request(app).post('/api/v1/revisiones/5/estudios').set('Authorization', await sesion()).send({ estudios: [{ titulo: 'Z', doi: '10.9/z' }] });
    assert.equal(r.status, 409);
  });
});

// ---------- Edición ----------
describe('edición', () => {
  test('Duplicado o Sin clasificar limpian el criterio; el DOI se normaliza', async () => {
    responder = base({ estudios: p => (h.paso(p, 'update') ? ok([{ ...estudio(), ...h.paso(p, 'update')[1][0] }]) : ok(estudio({ estado: 'Aceptado', id_criterio: 1 }))) });
    const r = await request(app).patch('/api/v1/revisiones/5/estudios/10').set('Authorization', await sesion())
      .send({ estado: 'Duplicado', doi: 'https://doi.org/10.5/Q', id_criterio: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(h.paso(deTabla('estudios', 'update')[0], 'update')[1][0], { doi: '10.5/Q', estado: 'Duplicado', id_criterio: null });
  });

  test('incluir con un criterio de exclusión → 400; cambiar solo el criterio respeta el estado actual', async () => {
    responder = base({ estudios: p => (h.paso(p, 'update') ? ok([{ ...estudio(), ...h.paso(p, 'update')[1][0] }]) : ok(estudio({ estado: 'Rechazado', id_criterio: 2 }))) });
    const auth = await sesion();
    let r = await request(app).patch('/api/v1/revisiones/5/estudios/10').set('Authorization', auth).send({ estado: 'Aceptado', id_criterio: 2 });
    assert.equal(r.status, 400);
    r = await request(app).patch('/api/v1/revisiones/5/estudios/10').set('Authorization', auth).send({ id_criterio: 1 });
    assert.equal(r.status, 400, 'un estudio descartado no puede llevar un criterio de inclusión');
    r = await request(app).patch('/api/v1/revisiones/5/estudios/10').set('Authorization', auth).send({ titulo: 'Nuevo título' });
    assert.equal(r.status, 200);
    assert.deepEqual(h.paso(deTabla('estudios', 'update').at(-1), 'update')[1][0], { titulo: 'Nuevo título' });
  });

  test('DOI repetido → 409 con mensaje claro; RLS sin filas → 403; estudio de otra revisión → 404', async () => {
    const auth = await sesion();
    responder = base({ estudios: p => (h.paso(p, 'update') ? { data: null, error: { code: '23505', message: 'dup' } } : ok(estudio())) });
    let r = await request(app).patch('/api/v1/revisiones/5/estudios/10').set('Authorization', auth).send({ doi: '10.1/x' });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /otro estudio con ese DOI/);
    responder = base({ estudios: p => (h.paso(p, 'update') ? ok([]) : ok(estudio())) });
    assert.equal((await request(app).patch('/api/v1/revisiones/5/estudios/10').set('Authorization', auth).send({ titulo: 'x' })).status, 403);
    responder = base({ estudios: () => ok(null) });
    assert.equal((await request(app).patch('/api/v1/revisiones/5/estudios/10').set('Authorization', auth).send({ titulo: 'x' })).status, 404);
  });

  test('al decidir sobre un estudio con sugerencia de la IA, se registra si se siguió', async () => {
    responder = base({
      estudios: p => (h.paso(p, 'update') ? ok([{ ...estudio(), ...h.paso(p, 'update')[1][0] }]) : ok(estudio({ cribado_sugerencias: [{ sugerencia: 'Aceptado' }] }))),
      'rpc:fn_aplicar_decision_cribado': () => ok(null)
    });
    const r = await request(app).patch('/api/v1/revisiones/5/estudios/10').set('Authorization', await sesion()).send({ estado: 'Aceptado', id_criterio: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(rpcParams('fn_aplicar_decision_cribado'), { p_id_estudio: 10, p_estado_final: 'Aceptado', p_id_criterio: 1 });
  });

  test('sin cambios o campos no editables → 400', async () => {
    const auth = await sesion();
    assert.equal((await request(app).patch('/api/v1/revisiones/5/estudios/10').set('Authorization', auth).send({})).status, 400);
    assert.equal((await request(app).patch('/api/v1/revisiones/5/estudios/10').set('Authorization', auth).send({ url_pdf_articulo: 'estudios/99/x.pdf' })).status, 400);
    assert.equal((await request(app).patch('/api/v1/revisiones/5/estudios/10').set('Authorization', auth).send({ estado: 'Dudoso' })).status, 400);
  });
});

// ---------- Borrado ----------
describe('borrado', () => {
  test('DELETE borra el estudio y su carpeta de PDF; un lector recibe 403 sin tocar Storage', async () => {
    responder = base({
      estudios: p => (h.paso(p, 'delete') ? ok([{ id_estudios: 10 }]) : ok(estudio({ url_pdf_articulo: 'estudios/10/a.pdf' }))),
      documentos: p => (h.paso(p, 'list') ? ok([{ id: 'x', name: 'a.pdf' }]) : ok([]))
    });
    const auth = await sesion();
    assert.equal((await request(app).delete('/api/v1/revisiones/5/estudios/10').set('Authorization', auth)).status, 204);
    assert.deepEqual(h.paso(almacen('remove')[0], 'remove')[1][0], ['estudios/10/a.pdf']);

    consultas.length = 0;
    responder = base({ estudios: p => (h.paso(p, 'delete') ? ok([]) : ok(estudio())) });
    assert.equal((await request(app).delete('/api/v1/revisiones/5/estudios/10').set('Authorization', auth)).status, 403);
    assert.equal(almacen('list').length + almacen('remove').length, 0);
  });
});

// ---------- PDF ----------
describe('PDF', () => {
  test('subida en dos pasos: URL firmada para estudios/<id>/ y confirmación (borra el anterior)', async () => {
    responder = base({
      estudios: p => (h.paso(p, 'update') ? ok([{ ...estudio(), ...h.paso(p, 'update')[1][0] }]) : ok(estudio({ url_pdf_articulo: 'estudios/10/viejo.pdf' }))),
      documentos: p => {
        if (h.paso(p, 'createSignedUploadUrl')) return ok({ signedUrl: 'https://sb/upload?token=t', token: 't', path: h.paso(p, 'createSignedUploadUrl')[1][0] });
        if (h.paso(p, 'list')) return ok([{ id: 'n', name: '1700_Mi_articulo.pdf' }]);
        return ok([]);
      }
    });
    const auth = await sesion();
    let r = await request(app).post('/api/v1/revisiones/5/estudios/10/pdf/subida').set('Authorization', auth).send({ nombre: 'Mi artículo.pdf', tamano: 1024 });
    assert.equal(r.status, 200);
    assert.match(r.body.ruta, /^estudios\/10\/\d+_Mi_articulo\.pdf$/);
    assert.equal(r.body.url, 'https://sb/upload?token=t');

    r = await request(app).put('/api/v1/revisiones/5/estudios/10/pdf').set('Authorization', auth).send({ ruta: 'estudios/10/1700_Mi_articulo.pdf' });
    assert.equal(r.status, 200);
    assert.equal(r.body.tiene_pdf, true);
    assert.deepEqual(h.paso(deTabla('estudios', 'update')[0], 'update')[1][0], { url_pdf_articulo: 'estudios/10/1700_Mi_articulo.pdf' });
    assert.deepEqual(h.paso(almacen('remove')[0], 'remove')[1][0], ['estudios/10/viejo.pdf']);
  });

  test('validaciones: no PDF, más de 50 MB, ruta de otro estudio o archivo inexistente', async () => {
    responder = base({ estudios: () => ok(estudio()), documentos: () => ok([]) });
    const auth = await sesion();
    assert.equal((await request(app).post('/api/v1/revisiones/5/estudios/10/pdf/subida').set('Authorization', auth).send({ nombre: 'a.exe', tamano: 10 })).status, 400);
    assert.equal((await request(app).post('/api/v1/revisiones/5/estudios/10/pdf/subida').set('Authorization', auth).send({ nombre: 'a.pdf', tamano: 51 * 1024 * 1024 })).status, 400);
    for (const ruta of ['estudios/11/a.pdf', 'estudios/10/../11/a.pdf', 'estudios/10/a.exe', 'informes/5/a.pdf']) {
      assert.equal((await request(app).put('/api/v1/revisiones/5/estudios/10/pdf').set('Authorization', auth).send({ ruta })).status, 400, ruta);
    }
    const r = await request(app).put('/api/v1/revisiones/5/estudios/10/pdf').set('Authorization', auth).send({ ruta: 'estudios/10/no-existe.pdf' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /No se encontró el PDF/);
    assert.equal(deTabla('estudios', 'update').length, 0);
  });

  test('una ruta de otro estudio se rechaza aunque el archivo exista', async () => {
    responder = base({
      estudios: p => (h.paso(p, 'update') ? ok([estudio()]) : ok(estudio())),
      documentos: p => (h.paso(p, 'list') ? ok([{ id: 'x', name: h.paso(p, 'list')[1][1].search }]) : ok([]))
    });
    const auth = await sesion();
    for (const ruta of ['estudios/11/a.pdf', 'estudios/10/sub/a.pdf', 'informes/5/a.pdf']) {
      assert.equal((await request(app).put('/api/v1/revisiones/5/estudios/10/pdf').set('Authorization', auth).send({ ruta })).status, 400, ruta);
    }
    assert.equal(deTabla('estudios', 'update').length, 0);
    assert.equal((await request(app).put('/api/v1/revisiones/5/estudios/10/pdf').set('Authorization', auth).send({ ruta: 'estudios/10/1_a.pdf' })).status, 200);
  });

  test('un lector no puede pedir URL de subida', async () => {
    responder = base({ estudios: () => ok(estudio()) }, { escribe: false });
    assert.equal((await request(app).post('/api/v1/revisiones/5/estudios/10/pdf/subida').set('Authorization', await sesion()).send({ nombre: 'a.pdf', tamano: 10 })).status, 403);
  });

  test('GET: URL firmada de lectura; enlace externo tal cual; ruta manipulada → 404; reintento con service_role', async () => {
    const auth = await sesion();
    responder = base({ estudios: () => ok(estudio({ url_pdf_articulo: 'estudios/10/a.pdf' })), documentos: p => ok({ signedUrl: `https://sb/leer/${h.paso(p, 'createSignedUrl')[1][0]}` }) });
    let r = await request(app).get('/api/v1/revisiones/5/estudios/10/pdf').set('Authorization', auth);
    assert.deepEqual(r.body, { url: 'https://sb/leer/estudios/10/a.pdf' });
    assert.equal(r.headers['cache-control'], 'no-store');

    responder = base({ estudios: () => ok(estudio({ url_pdf_articulo: 'https://arxiv.org/pdf/1.pdf' })) });
    r = await request(app).get('/api/v1/revisiones/5/estudios/10/pdf').set('Authorization', auth);
    assert.deepEqual(r.body, { url: 'https://arxiv.org/pdf/1.pdf', externo: true });

    responder = base({ estudios: () => ok(estudio({ url_pdf_articulo: 'estudios/99/ajeno.pdf' })), documentos: () => { throw new Error('no debería firmar'); } });
    assert.equal((await request(app).get('/api/v1/revisiones/5/estudios/10/pdf').set('Authorization', auth)).status, 404);

    let usuario = true;
    responder = base({ estudios: () => ok(estudio({ url_pdf_articulo: 'estudios/10/a.pdf' })),
      documentos: () => (usuario ? { data: null, error: { message: 'Object not found', statusCode: '404' } } : ok({ signedUrl: 'https://sb/admin' })) });
    sb.adminDisponible = () => true;
    const adminOriginal = sb.admin;
    sb.admin = () => { usuario = false; return adminOriginal(); };
    r = await request(app).get('/api/v1/revisiones/5/estudios/10/pdf').set('Authorization', auth);
    assert.deepEqual(r.body, { url: 'https://sb/admin' });
  });

  test('DELETE pdf: quita la referencia y el archivo', async () => {
    responder = base({ estudios: p => (h.paso(p, 'update') ? ok([estudio()]) : ok(estudio({ url_pdf_articulo: 'estudios/10/a.pdf' }))), documentos: () => ok([]) });
    assert.equal((await request(app).delete('/api/v1/revisiones/5/estudios/10/pdf').set('Authorization', await sesion())).status, 204);
    assert.deepEqual(h.paso(deTabla('estudios', 'update')[0], 'update')[1][0], { url_pdf_articulo: null });
    assert.deepEqual(h.paso(almacen('remove')[0], 'remove')[1][0], ['estudios/10/a.pdf']);
  });
});

// ---------- Calidad ----------
describe('calidad', () => {
  test('GET junta preguntas, respuestas, umbral y evaluaciones; de las repetidas se queda la más reciente', async () => {
    responder = base({
      evaluacion_calidad_preguntas: () => ok([{ id_pregunta: 1, descripcion: '¿Diseño claro?' }]),
      evaluacion_calidad_respuestas: () => ok([{ id_respuesta: 7, descripcion: 'Sí', peso: '1.00' }, { id_respuesta: 8, descripcion: 'No', peso: '0' }]),
      puntuaciones_evaluacion: () => ok({ puntuacion_limite: '2.5', puntuacion_maxima: '5' }),
      calidad_estudios: () => ok([
        { id_calidad: 1, id_estudios: 10, id_pregunta: 1, id_respuesta: 8, peso: '0', fecha_evaluacion: '2026-01-01' },
        { id_calidad: 2, id_estudios: 10, id_pregunta: 1, id_respuesta: 7, peso: '1', fecha_evaluacion: '2026-02-01' },
        { id_calidad: 5, id_estudios: 11, id_pregunta: 1, id_respuesta: 7, peso: '1', fecha_evaluacion: '2026-03-01' },
        { id_calidad: 6, id_estudios: 11, id_pregunta: 1, id_respuesta: 8, peso: '0', fecha_evaluacion: '2026-03-01' }
      ])
    });
    const r = await request(app).get('/api/v1/revisiones/5/calidad').set('Authorization', await sesion());
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.umbral, { limite: 2.5, maxima: 1 }, 'máxima = 1 pregunta × peso mayor 1, no la guardada (5, vieja)');
    assert.equal(r.body.respuestas[0].peso, 1);
    assert.deepEqual(r.body.evaluaciones, {
      10: [{ id_pregunta: 1, id_respuesta: 7, peso: 1 }],
      11: [{ id_pregunta: 1, id_respuesta: 8, peso: 0 }]      // misma fecha: gana la fila más nueva
    });
    const ev = deTabla('calidad_estudios')[0];
    assert.deepEqual(h.paso(ev, 'eq')[1], ['estudios.id_detalles_revision', 5], 'una sola consulta para toda la revisión');
  });

  test('PUT guarda la evaluación completa con la función (el peso no lo manda el cliente)', async () => {
    responder = base({
      estudios: () => ok(estudio()),
      'rpc:fn_guardar_calidad_estudio': () => ok({ respondidas: 1, total: 1 }),
      calidad_estudios: () => ok([{ id_calidad: 3, id_estudios: 10, id_pregunta: 1, id_respuesta: 7, peso: '1', fecha_evaluacion: 'x' }])
    });
    const auth = await sesion();
    const r = await request(app).put('/api/v1/revisiones/5/estudios/10/calidad').set('Authorization', auth).send({ respuestas: [{ id_pregunta: 1, id_respuesta: 7 }] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { respondidas: 1, total: 1, evaluacion: [{ id_pregunta: 1, id_respuesta: 7, peso: 1 }] });
    assert.deepEqual(rpcParams('fn_guardar_calidad_estudio'), { p_id_estudio: 10, p_respuestas: [{ id_pregunta: 1, id_respuesta: 7 }] });
    assert.equal((await request(app).put('/api/v1/revisiones/5/estudios/10/calidad').set('Authorization', auth).send({ respuestas: [{ id_pregunta: 1, id_respuesta: 7, peso: 99 }] })).status, 400);
  });

  test('sin el SQL 004 (función no instalada): borra e inserta con el peso de la base', async () => {
    responder = base({
      estudios: () => ok(estudio()),
      'rpc:fn_guardar_calidad_estudio': () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fn_guardar_calidad_estudio' } }),
      evaluacion_calidad_preguntas: () => ok([{ id_pregunta: 1 }, { id_pregunta: 2 }]),
      evaluacion_calidad_respuestas: () => ok([{ id_respuesta: 7, peso: '1.5' }]),
      calidad_estudios: p => (h.paso(p, 'insert') ? ok(h.paso(p, 'insert')[1][0]) : ok([]))
    });
    const auth = await sesion();
    let r = await request(app).put('/api/v1/revisiones/5/estudios/10/calidad').set('Authorization', auth)
      .send({ respuestas: [{ id_pregunta: 1, id_respuesta: 7 }, { id_pregunta: 2, id_respuesta: 7 }] });
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 3);
    assert.equal(deTabla('calidad_estudios', 'delete').length, 1);
    assert.deepEqual(h.paso(deTabla('calidad_estudios', 'insert')[0], 'insert')[1][0].map(f => f.peso), [1.5, 1.5]);

    r = await request(app).put('/api/v1/revisiones/5/estudios/10/calidad').set('Authorization', auth).send({ respuestas: [{ id_pregunta: 3, id_respuesta: 7 }] });
    assert.equal(r.status, 400, 'pregunta de otra revisión');
  });
});

// ---------- Importación ----------
describe('importación', () => {
  const item = (titulo, doi) => ({ titulo, doi, autores: 'X' });

  test('buscar marca los resultados que ya están en la revisión', async () => {
    paginasFuente = () => ({ items: [item('Deep learning, a review', null), item('Nuevo', '10.1/aaa'), item('Otro', null)], total: 3 });
    responder = base({ estudios: () => ok([{ id_estudios: 1, titulo: 'Deep Learning: A Review', doi: '10.1/AAA', estado: 'Sin clasificar' }]) });
    const r = await request(app).post('/api/v1/revisiones/5/importar/buscar').set('Authorization', await sesion()).send({ fuente: 'openalex', cadena: 'deep learning' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.resultados.map(x => x.ya_en_revision), [true, true, false]);
  });

  test('importar quita los títulos que ya estaban y suma esos descartes a los duplicados', async () => {
    paginasFuente = q => (q.pagina === 1
      ? { items: [item('Deep learning, a review', null), item('A', '10.2/a'), item('a.', null)], total: 3 }
      : { items: [], total: 3 });
    responder = base({
      estudios: () => ok([{ id_estudios: 1, titulo: 'Deep Learning: A Review', doi: null, estado: 'Sin clasificar' }]),
      'rpc:fn_importar_estudios': p => ok({ id_importacion: 4, recibidos: p[0][1][1].p_estudios.length, importados: 1, duplicados: 0 })
    });
    const r = await request(app).post('/api/v1/revisiones/5/importar').set('Authorization', await sesion())
      .send({ fuente: 'openalex', cadena: 'x', paginas: 2, porPagina: 3 });
    assert.equal(r.status, 200);
    assert.deepEqual(rpcParams('fn_importar_estudios').p_estudios.map(e => e.titulo), ['A']);
    assert.equal(rpcParams('fn_importar_estudios').p_id_rev, 5);
    assert.equal(r.body.recibidos, 3);
    assert.equal(r.body.importados, 1);
    assert.equal(r.body.duplicados, 2);
  });

  test('un lector no puede importar', async () => {
    responder = base({}, { escribe: false });
    const r = await request(app).post('/api/v1/revisiones/5/importar').set('Authorization', await sesion()).send({ fuente: 'crossref', cadena: 'x' });
    assert.equal(r.status, 403);
    assert.equal(llamadasFuentes.length, 0);
  });
});

// ---------- Cribado ----------
describe('cribado', () => {
  test('sugerir: exige poder escribir antes de llamar a la IA', async () => {
    responder = base({}, { escribe: false });
    const r = await request(app).post('/api/v1/revisiones/5/cribado/sugerir').set('Authorization', await sesion()).send({ ids_estudios: [10], solo_sin_clasificar: false, max: 1 });
    assert.equal(r.status, 403);
    assert.equal(llamadasIA.length, 0);
  });

  test('sugerir: guarda la sugerencia y la devuelve; sin criterios → 400', async () => {
    respuestaIA = () => JSON.stringify({ sugerencia: 'Rechazado', id_criterio: 2, confianza: 0.9, justificacion: 'No es en inglés' });
    responder = base({ estudios: () => ok([estudio({ resumen: 'R' })]), 'rpc:fn_guardar_sugerencia_cribado': () => ok(1) });
    const auth = await sesion();
    let r = await request(app).post('/api/v1/revisiones/5/cribado/sugerir').set('Authorization', auth).send({ ids_estudios: [10], solo_sin_clasificar: false, max: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.sugerencias[0], { id_estudios: 10, sugerencia: 'Rechazado', id_criterio: 2, confianza: 0.9, justificacion: 'No es en inglés' });
    assert.equal(rpcParams('fn_guardar_sugerencia_cribado').p_id_estudio, 10);
    assert.match(JSON.stringify(llamadasIA[0]), /Analizar la IA/);

    responder = base({ criterios: () => ok([]) });
    r = await request(app).post('/api/v1/revisiones/5/cribado/sugerir').set('Authorization', auth).send({});
    assert.equal(r.status, 400);
  });

  test('sugerir: una copia de otro estudio recibe «Duplicado» sin llamar a la IA', async () => {
    respuestaIA = () => JSON.stringify({ sugerencia: 'Rechazado', id_criterio: 2, confianza: 0.99, justificacion: 'IA' });
    responder = base({
      estudios: () => ok([
        estudio({ titulo: 'Memory forensics for fileless malware detection', anio: 2021, resumen: 'R' }),
        estudio({ id_estudios: 11, titulo: 'Memory Forensics for Fileless-Malware Detection.', anio: 2022, resumen: 'R' })
      ]),
      'rpc:fn_guardar_sugerencia_cribado': () => ok(1)
    });
    const r = await request(app).post('/api/v1/revisiones/5/cribado/sugerir').set('Authorization', await sesion())
      .send({ ids_estudios: [10, 11], solo_sin_clasificar: false, max: 2 });
    assert.equal(r.status, 200);
    const porId = Object.fromEntries(r.body.sugerencias.map(x => [x.id_estudios, x]));
    assert.equal(porId[10].sugerencia, 'Rechazado', 'el original lo decide la IA');
    assert.equal(porId[11].sugerencia, 'Duplicado');
    assert.equal(porId[11].id_original, 10);
    assert.equal(porId[11].confianza, 1);
    assert.match(porId[11].justificacion, /mismo trabajo que «Memory forensics for fileless malware detection» \(n\.º 10, 2021\): tienen el mismo título/);
    assert.equal(llamadasIA.length, 1, 'solo se gastan tokens en el original');
    const guardadas = consultas.filter(p => esRpc(p, 'fn_guardar_sugerencia_cribado')).map(p => p[0][1][1]);
    assert.deepEqual(guardadas.map(g => [g.p_id_estudio, g.p_sugerencia, g.p_modelo === 'deteccion-duplicados']).sort(),
      [[10, 'Rechazado', false], [11, 'Duplicado', true]]);
  });

  test('sugerir: sin sql/009 la sugerencia «Duplicado» se devuelve aunque no se guarde', async () => {
    responder = base({
      estudios: () => ok([estudio({ doi: '10.1/abc' }), estudio({ id_estudios: 11, titulo: 'Otro título', doi: 'https://doi.org/10.1/ABC' })]),
      'rpc:fn_guardar_sugerencia_cribado': p => (p[0][1][1].p_sugerencia === 'Duplicado'
        ? { data: null, error: { code: '23514', message: 'new row for relation "cribado_sugerencias" violates check constraint "cribado_sugerencias_sugerencia_check"' } }
        : ok(1))
    });
    respuestaIA = () => JSON.stringify({ sugerencia: 'Aceptado', id_criterio: 1, confianza: 0.8, justificacion: 'IA' });
    const r = await request(app).post('/api/v1/revisiones/5/cribado/sugerir').set('Authorization', await sesion())
      .send({ ids_estudios: [10, 11], solo_sin_clasificar: false, max: 2 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.errores, []);
    assert.match(r.body.sugerencias.find(x => x.id_estudios === 11).justificacion, /tienen el mismo DOI/);
  });

  test('buscarDuplicado: DOI, título casi idéntico con año compatible; el original no se marca', () => {
    const todos = [
      { id_estudios: 1, titulo: 'Detecting malware in RAM with Volatility', anio: 2020, doi: null, estado: 'Aceptado' },
      { id_estudios: 2, titulo: 'Detecting malware in RAM with Volatility 3', anio: 2021, doi: null, estado: 'Sin clasificar' },
      { id_estudios: 3, titulo: 'Detecting malware in RAM with Volatility', anio: 2015, doi: null, estado: 'Sin clasificar' },
      { id_estudios: 4, titulo: 'Something else entirely', anio: 2020, doi: '10.5/X', estado: 'Sin clasificar' },
      { id_estudios: 5, titulo: 'Different title', anio: 2020, doi: 'doi:10.5/x', estado: 'Sin clasificar' },
      { id_estudios: 6, titulo: 'Detecting malware in RAM with Volatility', anio: 2020, doi: null, estado: 'Duplicado' }
    ];
    assert.equal(buscarDuplicado(todos[0], todos), null, 'el primero es el original');
    const d2 = buscarDuplicado(todos[1], todos);
    assert.equal(d2.original.id_estudios, 1);
    assert.equal(d2.motivo, 'titulo_similar');
    assert.ok(d2.similitud >= 0.85 && d2.similitud < 1);
    assert.equal(buscarDuplicado(todos[2], todos).motivo, 'titulo_exacto', 'título idéntico: el año no importa');
    assert.equal(buscarDuplicado(todos[4], todos).motivo, 'doi');
    assert.ok(similitud('memory forensics', 'memory forensic') > 0.7);
    assert.equal(similitud('abc', ''), 0);
  });

  test('cribado independiente: mis decisiones, registrar (criterio validado), resolver y kappa', async () => {
    responder = base({
      estudios: () => ok([estudio(), estudio({ id_estudios: 11 })]),
      cribado_revisor: () => ok([{ id_estudios: 11, decision: 'Rechazado', id_criterio: 2, comentario: 'c' }]),
      'rpc:fn_registrar_cribado_revisor': () => ok(1),
      'rpc:fn_conflictos_cribado': () => ok([{ id_estudios: 10 }]),
      'rpc:fn_resolver_conflicto_cribado': () => ok(null),
      'rpc:fn_kappa_cohen': () => ok({ n: 3, kappa: 0.5 })
    });
    const auth = await sesion();
    let r = await request(app).get('/api/v1/revisiones/5/cribado/mio').set('Authorization', auth);
    assert.equal(r.body[1].miDecision, 'Rechazado');
    assert.equal(r.body[0].miDecision, undefined);

    r = await request(app).post('/api/v1/revisiones/5/cribado/decisiones').set('Authorization', auth).send({ id_estudios: 10, decision: 'Rechazado', id_criterio: 1 });
    assert.equal(r.status, 400, 'criterio de inclusión para rechazar');
    r = await request(app).post('/api/v1/revisiones/5/cribado/decisiones').set('Authorization', auth).send({ id_estudios: 10, decision: 'Dudoso', id_criterio: 2, comentario: 'no sé' });
    assert.equal(r.status, 200);
    assert.deepEqual(rpcParams('fn_registrar_cribado_revisor'), { p_id_estudio: 10, p_decision: 'Dudoso', p_id_criterio: null, p_comentario: 'no sé' });

    assert.equal((await request(app).post('/api/v1/revisiones/5/cribado/conflictos/10/resolver').set('Authorization', auth).send({ decision: 'Dudoso' })).status, 400);
    r = await request(app).post('/api/v1/revisiones/5/cribado/conflictos/10/resolver').set('Authorization', auth).send({ decision: 'Rechazado', id_criterio: 2 });
    assert.equal(r.status, 200);
    assert.deepEqual(rpcParams('fn_resolver_conflicto_cribado'), { p_id_estudio: 10, p_decision_final: 'Rechazado', p_id_criterio: 2 });

    const a = h.nuevoId(), b = h.nuevoId();
    r = await request(app).get(`/api/v1/revisiones/5/cribado/kappa?a=${a}&b=${b}`).set('Authorization', auth);
    assert.deepEqual(r.body, { n: 3, kappa: 0.5 });
    assert.equal((await request(app).get(`/api/v1/revisiones/5/cribado/kappa?a=${a}&b=${a}`).set('Authorization', auth)).status, 400);
    assert.equal((await request(app).get('/api/v1/revisiones/5/cribado/kappa?a=x&b=y').set('Authorization', auth)).status, 400);
  });

  test('el propietario resuelve: si la base dice que no lo es → 403', async () => {
    responder = base({ estudios: () => ok(estudio()), 'rpc:fn_resolver_conflicto_cribado': () => ({ data: null, error: { code: '42501', message: 'Solo el propietario resuelve los conflictos de cribado' } }) });
    const r = await request(app).post('/api/v1/revisiones/5/cribado/conflictos/10/resolver').set('Authorization', await sesion()).send({ decision: 'Aceptado' });
    assert.equal(r.status, 403);
  });
});

// ---------- Planificación (lectura) y DOI ----------
describe('planificación y DOI', () => {
  test('criterios, bases y cadenas; 404 si no ve la revisión', async () => {
    responder = base({ bases_bibliograficas: () => ok([{ id_base_bibliografica: 1, nombre: 'Scopus', url: '' }]), cadenas_busqueda: () => ok([{ fuente: 'global', cadena_busqueda: '"ia"' }]) });
    const auth = await sesion();
    assert.deepEqual((await request(app).get('/api/v1/revisiones/5/criterios').set('Authorization', auth)).body, CRITERIOS);
    assert.equal((await request(app).get('/api/v1/revisiones/5/bases').set('Authorization', auth)).body[0].nombre, 'Scopus');
    assert.equal((await request(app).get('/api/v1/revisiones/5/cadenas').set('Authorization', auth)).body[0].fuente, 'global');
    responder = base({}, { visible: false });
    assert.equal((await request(app).get('/api/v1/revisiones/5/criterios').set('Authorization', auth)).status, 404);
  });

  test('DOI: formato, encontrado (con autores, URL y resumen) y no encontrado', async () => {
    const auth = await sesion();
    assert.equal((await request(app).get('/api/v1/referencias/doi/hola').set('Authorization', auth)).status, 400);
    doiFalso = async doi => (doi === '10.1109/ISPSD.2013.6694422' ? {
      DOI: doi, title: ['Un título'], author: [{ given: 'Ana', family: 'Pérez' }], issued: { 'date-parts': [[2013]] },
      'container-title': ['Revista'], publisher: 'IEEE', type: 'proceedings-article', URL: 'https://doi.org/x', abstract: '<jats:p>Resumen</jats:p>'
    } : null);
    let r = await request(app).get('/api/v1/referencias/doi/https://doi.org/10.1109/ISPSD.2013.6694422').set('Authorization', auth);
    assert.equal(r.status, 200);
    assert.equal(r.body.titulo, 'Un título');
    assert.deepEqual(r.body.autores, [{ apellido: 'Pérez', nombre: 'Ana' }]);
    assert.equal(r.body.anio, 2013);
    assert.equal(r.body.resumen, 'Resumen');
    r = await request(app).get('/api/v1/referencias/doi/10.1234/no-existe').set('Authorization', auth);
    assert.equal(r.status, 404);
  });

  test('todo /api/v1 de estudios exige sesión', async () => {
    assert.equal((await request(app).get('/api/v1/revisiones/5/estudios')).status, 401);
    assert.equal((await request(app).get('/api/v1/referencias/doi/10.1/x')).status, 401);
  });
});
