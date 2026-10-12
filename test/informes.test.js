// test/informes.test.js — Informes: secciones, versiones, generación con IA, PRISMA y Word.
// Sin red: Supabase, OpenAI y CrossRef simulados.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const h = require('./helpers');

// ---------- OpenAI y CrossRef simulados (antes de cargar la app: los prompts los importan al cargar) ----------
const llamadasIA = [];
let respuestaIA = () => '{}';
require.cache[path.join(__dirname, '../infra/openai.js')] = {
  id: 'openai-falso', filename: 'openai-falso', loaded: true,
  exports: {
    callOpenAI: async (messages, opts = {}) => {
      llamadasIA.push({ messages, opts });
      const ctx = require('../core/requestContext').getContext();     // como hace infra/openai: acumula el uso
      if (ctx) { ctx.usage.llamadas++; ctx.usage.tokens_entrada += 100; ctx.usage.tokens_salida += 50; ctx.usage.modelo = 'modelo-prueba'; }
      return respuestaIA(messages, opts);
    },
    embed: async () => []
  }
};
const crossref = require('../infra/crossref');
const ref = n => ({ DOI: `10.1/${n}`, title: [`Estudio ${n} sobre ia educación`], author: [{ family: `Pérez${n}`, given: 'Ana' }], issued: { 'date-parts': [[2021]] }, 'container-title': ['Revista'], abstract: 'ia educación' });
crossref.searchBilingual = async () => ({ items: [ref(1), ref(2)], keywordsEn: 'ai education' });

const request = require('supertest');
const app = require('../app');
const sb = require('../infra/supabase');

// ---------- Supabase simulado ----------
let responder, tokensUsados;
const consultas = [];
beforeEach(() => {
  llamadasIA.length = 0; consultas.length = 0; tokensUsados = [];
  respuestaIA = () => '{}';
  responder = () => ({ data: null, error: null });
  sb.forUser = tk => { tokensUsados.push(tk); return h.clienteFalso(p => { consultas.push(p); return responder(p); }); };
  sb.admin = () => h.clienteFalso(p => { consultas.push(['ADMIN', p]); return responder(p); });
  sb.adminDisponible = () => false;
});

const REV = { id_detalles_revision: 5, id_usuarios: 'u', titulo_revision: 'IA en educación superior', descripcion: 'Desc', objetivo: 'Analizar el uso de IA', tipo_revision: 'RSL' };
const esRpc = (p, fn) => h.esRpc(p, fn);
const rpcParams = (fn) => consultas.find(p => Array.isArray(p) && p[0][0] === 'rpc' && p[0][1][0] === fn)?.[0][1][1];
const pasos = (nombre) => consultas.filter(p => Array.isArray(p) && p[0] !== 'ADMIN' && h.paso(p, nombre));

/** Base mínima: revisión visible y con permiso de escritura, más lo que añada cada prueba. */
function base(extra = {}, { escribe = true, visible = true } = {}) {
  return p => {
    if (esRpc(p, 'owns_revision')) return { data: escribe, error: null };
    if (h.tabla(p) === 'detalles_revision' && !h.paso(p, 'update')) return { data: visible ? REV : null, error: null };
    for (const [clave, fn] of Object.entries(extra)) {
      if ((clave.startsWith('rpc:') && esRpc(p, clave.slice(4))) || h.tabla(p) === clave) return fn(p);
    }
    return { data: null, error: null };
  };
}

async function sesion() { return `Bearer ${await h.token()}`; }

const RESULTADOS_GUARDADOS = JSON.stringify({
  reflexion_inicial: ['De un total de 10 estudios…'],
  '¿Qué herramientas se usan?': ['Pérez (2021) describe tutores inteligentes.'],
  referencias: ['[1] Pérez (2021). Estudio.']
});
const METODOLOGIA_GUARDADA = JSON.stringify({ enfoque_metodologico: '<p>Enfoque RSL</p>', fases_prisma: 'Fases', procedimiento_busqueda: 'Proc', criterios_seleccion: 'IC1', proceso_cribado: 'Cribado' });

// ---------- Secciones ----------
describe('secciones', () => {
  test('GET devuelve las 8 secciones y sus valoraciones; null si no hay nada guardado', async () => {
    responder = base({ secciones_revision: () => ({ data: { id_seccion: 1, id_detalles_revision: 5, metodologia: METODOLOGIA_GUARDADA, calidadmetodologia: '1' }, error: null }) });
    const r = await request(app).get('/api/v1/revisiones/5/secciones').set('Authorization', await sesion());
    assert.equal(r.status, 200);
    assert.equal(r.body.metodologia, METODOLOGIA_GUARDADA);
    assert.equal(r.body.calidadmetodologia, '1');
    assert.equal(r.body.introduccion, null);
    assert.equal('id_seccion' in r.body, false);
  });

  test('GET de una revisión que no ve → 404', async () => {
    responder = base({}, { visible: false });
    assert.equal((await request(app).get('/api/v1/revisiones/5/secciones').set('Authorization', await sesion())).status, 404);
  });

  test('PATCH guarda SOLO esa sección con versión (fn_guardar_version_seccion)', async () => {
    responder = base({ 'rpc:fn_guardar_version_seccion': () => ({ data: 3, error: null }) });
    const r = await request(app).patch('/api/v1/revisiones/5/secciones/limitaciones').set('Authorization', await sesion())
      .send({ contenido: 'Las limitaciones son…' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { seccion: 'limitaciones', version: 3, origen: 'usuario' });
    assert.deepEqual(rpcParams('fn_guardar_version_seccion'),
      { p_id_rev: 5, p_seccion: 'limitaciones', p_contenido: 'Las limitaciones son…', p_origen: 'usuario', p_modelo: null });
    assert.equal(pasos('upsert').length, 0, 'ya no se reescribe la fila entera');
  });

  test('PATCH con id_generacion marca la versión como IA y la enlaza a la generación', async () => {
    responder = base({
      generaciones_ia: p => (h.paso(p, 'update')
        ? { data: [{ id_generacion: 9 }], error: null }
        : { data: { id_generacion: 9, id_detalles_revision: 5, seccion: 'discusion', modelo: 'modelo-x' }, error: null }),
      secciones_versiones: () => ({ data: { id_version: 44 }, error: null }),
      'rpc:fn_guardar_version_seccion': () => ({ data: 2, error: null })
    });
    const r = await request(app).patch('/api/v1/revisiones/5/secciones/discusion').set('Authorization', await sesion())
      .send({ contenido: '{"discusion":"…"}', id_generacion: 9 });
    assert.equal(r.status, 200);
    assert.equal(r.body.origen, 'ia');
    assert.equal(rpcParams('fn_guardar_version_seccion').p_modelo, 'modelo-x');
    const enlace = pasos('update').find(p => h.tabla(p) === 'generaciones_ia');
    assert.deepEqual(h.paso(enlace, 'update')[1][0], { id_version: 44 });
  });

  test('PATCH con una generación de otra sección → 400', async () => {
    responder = base({ generaciones_ia: () => ({ data: { id_generacion: 9, id_detalles_revision: 5, seccion: 'resumen', modelo: 'm' }, error: null }) });
    const r = await request(app).patch('/api/v1/revisiones/5/secciones/discusion').set('Authorization', await sesion())
      .send({ contenido: 'x', id_generacion: 9 });
    assert.equal(r.status, 400);
  });

  test('sección desconocida o campo extra → 400', async () => {
    const auth = await sesion();
    assert.equal((await request(app).patch('/api/v1/revisiones/5/secciones/calidadmetodologia').set('Authorization', auth).send({ contenido: 'x' })).status, 400);
    assert.equal((await request(app).patch('/api/v1/revisiones/5/secciones/resumen').set('Authorization', auth).send({ contenido: 'x', origen: 'ia' })).status, 400);
  });

  test('PUT valoración escribe solo su columna', async () => {
    responder = base({ secciones_revision: () => ({ data: { calidadtrabajorelacionado: '0' }, error: null }) });
    const r = await request(app).put('/api/v1/revisiones/5/secciones/trabajos_relacionados/valoracion').set('Authorization', await sesion()).send({ valor: 0 });
    assert.equal(r.status, 200);
    const up = pasos('upsert')[0];
    assert.deepEqual(h.paso(up, 'upsert')[1], [{ id_detalles_revision: 5, calidadtrabajorelacionado: '0' }, { onConflict: 'id_detalles_revision' }]);
    assert.equal((await request(app).put('/api/v1/revisiones/5/secciones/resumen/valoracion').set('Authorization', await sesion()).send({ valor: 2 })).status, 400);
  });

  test('versiones: historial y restaurar (404 si la versión no existe)', async () => {
    responder = base({
      'rpc:fn_historial_seccion': () => ({ data: [{ version: 2 }, { version: 1 }], error: null }),
      secciones_versiones: p => ({ data: h.paso(p, 'eq') && JSON.stringify(p).includes('"version",1') ? { id_version: 70 } : null, error: null }),
      'rpc:fn_restaurar_version_seccion': () => ({ data: 3, error: null })
    });
    const auth = await sesion();
    const hist = await request(app).get('/api/v1/revisiones/5/secciones/resumen/versiones').set('Authorization', auth);
    assert.deepEqual(hist.body.map(v => v.version), [2, 1]);
    const ok = await request(app).post('/api/v1/revisiones/5/secciones/resumen/versiones/1/restaurar').set('Authorization', auth);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { seccion: 'resumen', version: 3, restaurada: 1 });
    assert.deepEqual(rpcParams('fn_restaurar_version_seccion'), { p_id_version: 70 });
    assert.equal((await request(app).post('/api/v1/revisiones/5/secciones/resumen/versiones/9/restaurar').set('Authorization', auth)).status, 404);
  });
});

// ---------- Generación con IA ----------
describe('generar con IA', () => {
  test('un lector no puede generar: 403 y no se llama a OpenAI', async () => {
    responder = base({}, { escribe: false });
    const r = await request(app).post('/api/v1/revisiones/5/secciones/limitaciones/generar').set('Authorization', await sesion()).send({});
    assert.equal(r.status, 403);
    assert.equal(llamadasIA.length, 0);
  });

  test('el cliente no puede enviar contexto: solo paso, keywords y palabras', async () => {
    const r = await request(app).post('/api/v1/revisiones/5/secciones/conclusion/generar').set('Authorization', await sesion())
      .send({ results_summary: 'texto inventado' });
    assert.equal(r.status, 400);
    assert.equal(llamadasIA.length, 0);
  });

  test('resultados: lee estudios y extracción de la base, genera y registra la generación', async () => {
    responder = base({
      estudios: () => ({ data: [{ id_estudios: 1, estado: 'Aceptado', titulo: 'A' }, { id_estudios: 2, estado: 'Rechazado', titulo: 'B' }], error: null }),
      'rpc:fn_get_extraction_responses': () => ({ data: [{ id_estudios: 1, pregunta: '¿P1?', respuesta: 'r1', autores: 'Pérez', anio: '2021', titulo: 'A', revista: 'R', doi: '10.1/a', tipo: 'Texto' }], error: null }),
      'rpc:fn_registrar_generacion_ia': () => ({ data: 31, error: null })
    });
    respuestaIA = () => '{"secciones":{"¿P1?":["Pérez (2021) …"]}}';
    const r = await request(app).post('/api/v1/revisiones/5/secciones/resultados/generar').set('Authorization', await sesion()).send({});
    assert.equal(r.status, 200);
    assert.equal(r.body.seccion, 'resultados');
    assert.equal(r.body.id_generacion, 31);
    assert.match(r.body.resultado.reflexion_inicial, /De un total de 2 estudios, 1 fueron aceptados/);
    assert.deepEqual(r.body.resultado['¿P1?'], ['Pérez (2021) …']);
    assert.equal(r.body._meta.modelo, 'modelo-prueba');
    const reg = rpcParams('fn_registrar_generacion_ia');
    assert.equal(reg.p_seccion, 'resultados');
    assert.equal(reg.p_tokens_in, 100);
    assert.equal(reg.p_id_version, null);
    assert.deepEqual(reg.p_referencias, ['[1] Pérez (2021). A. R. https://doi.org/10.1/a']);
  });

  test('resultados sin datos de extracción → 400 con un motivo claro', async () => {
    responder = base({ estudios: () => ({ data: [{ id_estudios: 1, estado: 'Aceptado', titulo: 'A' }], error: null }),
      'rpc:fn_get_extraction_responses': () => ({ data: [], error: null }) });
    const r = await request(app).post('/api/v1/revisiones/5/secciones/resultados/generar').set('Authorization', await sesion()).send({});
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Extracción de datos/);
    assert.equal(llamadasIA.length, 0);
  });

  for (const paso of ['keywords', 'texto']) {
    test(`discusión (${paso}) sin Resultados guardados → 400 «primero guarda la sección Resultados»`, async () => {
      responder = base({ secciones_revision: () => ({ data: null, error: null }) });
      const r = await request(app).post('/api/v1/revisiones/5/secciones/discusion/generar').set('Authorization', await sesion()).send({ paso, keywords: 'ia' });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /primero guarda la sección «Resultados»/);
      assert.equal(llamadasIA.length, 0);
    });
  }

  test('discusión: usa los Resultados GUARDADOS y las palabras clave que envía el usuario', async () => {
    responder = base({ secciones_revision: () => ({ data: { resultados: RESULTADOS_GUARDADOS }, error: null }),
      'rpc:fn_registrar_generacion_ia': () => ({ data: 32, error: null }) });
    respuestaIA = () => '{"discusion":"Texto de discusión"}';
    const r = await request(app).post('/api/v1/revisiones/5/secciones/discusion/generar').set('Authorization', await sesion())
      .send({ keywords: 'tutores inteligentes' });
    assert.equal(r.status, 200);
    assert.equal(r.body.resultado.discusion, 'Texto de discusión');
    const prompt = llamadasIA[0].messages[1].content;
    assert.match(prompt, /Pérez \(2021\) describe tutores inteligentes/);
    assert.match(prompt, /De un total de 10 estudios/);
  });

  test('palabras clave de trabajos relacionados: usa título, descripción y criterios; no se registran como generación', async () => {
    responder = base({ criterios: () => ({ data: [{ id_criterios: 1, descripcion: 'Estudios desde 2015', tipo: 'inclusion' }], error: null }) });
    respuestaIA = () => 'ia, educación, tutores';
    const r = await request(app).post('/api/v1/revisiones/5/secciones/trabajos_relacionados/generar').set('Authorization', await sesion()).send({ paso: 'keywords' });
    assert.equal(r.status, 200);
    assert.equal(r.body.resultado.keywords, 'ia, educación, tutores');
    assert.equal(r.body.id_generacion, null);
    assert.match(llamadasIA[0].messages[1].content, /IA en educación superior Desc Estudios desde 2015/);
    assert.equal(rpcParams('fn_registrar_generacion_ia'), undefined);
  });

  test('trabajos relacionados (texto): palabras clave del usuario y referencias de CrossRef', async () => {
    responder = base({ criterios: () => ({ data: [{ descripcion: 'c1' }, { descripcion: 'c2' }], error: null }),
      secciones_revision: () => ({ data: null, error: null }),
      'rpc:fn_registrar_generacion_ia': () => ({ data: 33, error: null }) });
    respuestaIA = () => '{"trabajos_relacionados":"Texto"}';
    const r = await request(app).post('/api/v1/revisiones/5/secciones/trabajos_relacionados/generar').set('Authorization', await sesion())
      .send({ keywords: 'ia educación' });
    assert.equal(r.status, 200);
    assert.equal(r.body.resultado.references.length, 2);
    assert.match(llamadasIA[0].messages[1].content, /Criterios de selección: c1, c2/);
    assert.equal(rpcParams('fn_registrar_generacion_ia').p_referencias.length, 2);
  });

  test('metodología sin cadena de búsqueda global → 400 que lo dice', async () => {
    responder = base({ 'rpc:fn_get_ia_context': () => ({ data: [{ titulo_revision: 'T', objetivo: 'O', tipo_revision: 'RSL', frameworks: [], keywords: [{ componente: 'P', palabra: 'ia', sinonimos: [] }], global_search: '', per_base_search: [], bibliografias: [], inclusion_criteria: [], exclusion_criteria: [] }], error: null }) });
    const r = await request(app).post('/api/v1/revisiones/5/secciones/metodologia/generar').set('Authorization', await sesion()).send({});
    assert.equal(r.status, 400);
    assert.match(r.body.error, /cadena de búsqueda global/);
  });

  test('paso keywords en una sección sin ese paso → 400', async () => {
    const r = await request(app).post('/api/v1/revisiones/5/secciones/metodologia/generar').set('Authorization', await sesion()).send({ paso: 'keywords' });
    assert.equal(r.status, 400);
  });

  test('resumen: exige el número de palabras y usa lo guardado', async () => {
    responder = base({ secciones_revision: () => ({ data: { resultados: RESULTADOS_GUARDADOS, metodologia: METODOLOGIA_GUARDADA, conclusion: '{"conclusiones":"Concluimos que…"}' }, error: null }),
      'rpc:fn_registrar_generacion_ia': () => ({ data: 34, error: null }) });
    respuestaIA = () => '{"resumen":"Resumen breve"}';
    const auth = await sesion();
    const sin = await request(app).post('/api/v1/revisiones/5/secciones/resumen/generar').set('Authorization', auth).send({});
    assert.equal(sin.status, 400);
    assert.match(sin.body.error, /cuántas palabras/);
    const r = await request(app).post('/api/v1/revisiones/5/secciones/resumen/generar').set('Authorization', auth).send({ palabras: 150 });
    assert.equal(r.status, 200);
    assert.equal(r.body.resultado.resumen, 'Resumen breve');
    const prompt = llamadasIA.at(-1).messages[1].content;
    assert.match(prompt, /aproximadamente 150 palabras/);
    assert.match(prompt, /Enfoque RSL/);              // metodología en texto (sin etiquetas HTML)
    assert.doesNotMatch(prompt, /<p>/);
  });

  test('si registrar la generación falla, la generación igual se devuelve', async () => {
    responder = base({ secciones_revision: () => ({ data: { resultados: RESULTADOS_GUARDADOS, metodologia: METODOLOGIA_GUARDADA }, error: null }),
      'rpc:fn_registrar_generacion_ia': () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fn_registrar_generacion_ia' } }) });
    respuestaIA = () => 'Limitaciones…';
    const r = await request(app).post('/api/v1/revisiones/5/secciones/limitaciones/generar').set('Authorization', await sesion()).send({});
    assert.equal(r.status, 200);
    assert.equal(r.body.resultado.limitaciones, 'Limitaciones…');
    assert.equal(r.body.id_generacion, null);
  });
});

// ---------- PRISMA y perfil ----------
describe('PRISMA y perfil', () => {
  test('GET /prisma devuelve estudios y criterios de exclusión', async () => {
    responder = base({
      estudios: () => ({ data: [{ fuente_bibliografica: 'Scopus', estado: 'Aceptado', id_criterio: null }], error: null }),
      criterios: p => { assert.deepEqual(h.paso(p, 'eq') && p.filter(x => x[0] === 'eq').map(x => x[1]), [['id_detalles_revision', 5], ['tipo', 'exclusion']]); return { data: [{ id_criterios: 3, descripcion: 'EC1' }], error: null }; }
    });
    const r = await request(app).get('/api/v1/revisiones/5/prisma').set('Authorization', await sesion());
    assert.equal(r.status, 200);
    assert.equal(r.body.estudios.length, 1);
    assert.equal(r.body.criterios[0].descripcion, 'EC1');
  });

  test('GET /cuenta/perfil devuelve el perfil del usuario del token', async () => {
    const sub = h.nuevoId();
    responder = p => { assert.deepEqual(h.paso(p, 'eq')[1], ['id_usuarios', sub]); return { data: { id_usuarios: sub, nombre: 'Eduardo' }, error: null }; };
    const r = await request(app).get('/api/v1/cuenta/perfil').set('Authorization', `Bearer ${await h.token({ sub })}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.nombre, 'Eduardo');
  });
});

// ---------- Informes Word ----------
describe('informes Word', () => {
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const docx = Buffer.concat([Buffer.from('PK\u0003\u0004', 'latin1'), Buffer.alloc(200, 1)]);
  const fila = (ruta, extra = {}) => ({ id_informes_generados: 8, id_detalles_revision: 5, nombre_informe: 'Borrador.docx', ruta_archivo: ruta, fecha_generacion: '2026-10-09T10:00:00Z', ...extra });

  test('POST sube el .docx como el usuario y lo registra con la RUTA (no una URL pública)', async () => {
    let subida, insertada;
    responder = base({
      documentos: p => { subida = h.paso(p, 'upload')[1]; return { data: { path: subida[0] }, error: null }; },
      informes_generados: p => { insertada = h.paso(p, 'insert')[1][0]; return { data: { id_informes_generados: 8, ...insertada, fecha_generacion: 'x' }, error: null }; }
    });
    const r = await request(app).post('/api/v1/revisiones/5/informes').set('Authorization', await sesion()).set('Content-Type', DOCX).send(docx);
    assert.equal(r.status, 201);
    assert.match(subida[0], /^informes\/5\/Borrador_de_Articulo_\d+-\d+\.docx$/);
    assert.equal(subida[2].contentType, DOCX);
    assert.equal(insertada.ruta_archivo, subida[0]);
    assert.equal('ruta_archivo' in r.body, false);
  });

  test('POST: tipo incorrecto → 415; no es un Word → 400; lector → 403 sin subir nada', async () => {
    const auth = await sesion();
    responder = base();
    assert.equal((await request(app).post('/api/v1/revisiones/5/informes').set('Authorization', auth).send({ a: 1 })).status, 415);
    assert.equal((await request(app).post('/api/v1/revisiones/5/informes').set('Authorization', auth).set('Content-Type', DOCX).send(Buffer.from('hola'))).status, 400);
    responder = base({}, { escribe: false });
    assert.equal((await request(app).post('/api/v1/revisiones/5/informes').set('Authorization', auth).set('Content-Type', DOCX).send(docx)).status, 403);
    assert.equal(consultas.filter(p => JSON.stringify(p).includes('"upload"')).length, 0);
  });

  test('POST: si el registro falla, se borra el archivo subido', async () => {
    let borrado;
    responder = base({
      documentos: p => { if (h.paso(p, 'remove')) borrado = h.paso(p, 'remove')[1][0]; return { data: {}, error: null }; },
      informes_generados: () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } })
    });
    const r = await request(app).post('/api/v1/revisiones/5/informes').set('Authorization', await sesion()).set('Content-Type', DOCX).send(docx);
    assert.equal(r.status, 403);
    assert.match(borrado[0], /^informes\/5\//);
  });

  test('GET /archivo descarga a través del backend; también las filas antiguas con URL pública', async () => {
    let descargada;
    responder = base({
      informes_generados: () => ({ data: fila('https://x.supabase.co/storage/v1/object/public/documentos/informes/5/Borrador%20viejo.docx'), error: null }),
      documentos: p => { descargada = h.paso(p, 'download')[1][0]; return { data: new Blob([docx]), error: null }; }
    });
    const r = await request(app).get('/api/v1/revisiones/5/informes/8/archivo').set('Authorization', await sesion()).buffer(true).parse((res, cb) => { const b = []; res.on('data', c => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
    assert.equal(r.status, 200);
    assert.equal(descargada, 'informes/5/Borrador viejo.docx');
    assert.equal(r.headers['content-type'], DOCX);
    assert.match(r.headers['content-disposition'], /attachment/);
    assert.equal(r.body.length, docx.length);
  });

  test('GET /archivo: si Storage no deja leer al usuario, reintenta con service_role (la fila ya pasó RLS)', async () => {
    const lecturas = [];
    let respuestaUsuario = { data: null, error: { message: 'Object not found', statusCode: '404' } };
    responder = base({
      informes_generados: () => ({ data: fila('informes/5/a.docx'), error: null }),
      documentos: () => { lecturas.push('usuario'); return respuestaUsuario; }
    });
    // El cliente admin responde con el archivo; el del usuario, con "no encontrado"
    sb.admin = () => h.clienteFalso(p => { lecturas.push('admin'); return h.tabla(p) === 'documentos' ? { data: new Blob([docx]), error: null } : responder(p); });
    const auth = await sesion();

    sb.adminDisponible = () => false;
    assert.equal((await request(app).get('/api/v1/revisiones/5/informes/8/archivo').set('Authorization', auth)).status, 404);
    assert.deepEqual(lecturas, ['usuario']);

    lecturas.length = 0;
    sb.adminDisponible = () => true;
    const r = await request(app).get('/api/v1/revisiones/5/informes/8/archivo').set('Authorization', auth);
    assert.equal(r.status, 200);
    assert.deepEqual(lecturas, ['usuario', 'admin']);

    // Otros fallos de Storage (502) no se reintentan
    lecturas.length = 0;
    respuestaUsuario = { data: null, error: { message: 'Internal', statusCode: '500' } };
    assert.equal((await request(app).get('/api/v1/revisiones/5/informes/8/archivo').set('Authorization', auth)).status, 502);
    assert.deepEqual(lecturas, ['usuario']);
  });

  for (const forjada of ['estudios/99/privado.pdf', 'informes/7/de-otra-revision.docx', 'informes/5/../7/x.docx']) {
    test(`una fila manipulada (${forjada}) no se descarga ni se borra`, async () => {
      responder = base({
        informes_generados: p => (h.paso(p, 'delete') ? { data: [{ id_informes_generados: 8 }], error: null } : { data: fila(forjada), error: null }),
        documentos: () => { throw new Error('no debería tocar Storage'); }
      });
      const auth = await sesion();
      assert.equal((await request(app).get('/api/v1/revisiones/5/informes/8/archivo').set('Authorization', auth)).status, 404);
      assert.equal((await request(app).delete('/api/v1/revisiones/5/informes/8').set('Authorization', auth)).status, 204);
    });
  }

  test('DELETE borra el registro y el archivo; un lector recibe 403', async () => {
    let borrado;
    responder = base({
      informes_generados: p => (h.paso(p, 'delete') ? { data: [{ id_informes_generados: 8 }], error: null } : { data: fila('informes/5/a.docx'), error: null }),
      documentos: p => { borrado = h.paso(p, 'remove')[1][0]; return { data: [], error: null }; }
    });
    const auth = await sesion();
    assert.equal((await request(app).delete('/api/v1/revisiones/5/informes/8').set('Authorization', auth)).status, 204);
    assert.deepEqual(borrado, ['informes/5/a.docx']);
    responder = base({ informes_generados: p => (h.paso(p, 'delete') ? { data: [], error: null } : { data: fila('informes/5/a.docx'), error: null }) });
    assert.equal((await request(app).delete('/api/v1/revisiones/5/informes/8').set('Authorization', auth)).status, 403);
  });

  test('GET lista sin exponer la ruta interna', async () => {
    responder = base({ informes_generados: () => ({ data: [fila('informes/5/a.docx')], error: null }) });
    const r = await request(app).get('/api/v1/revisiones/5/informes').set('Authorization', await sesion());
    assert.equal(r.status, 200);
    assert.equal(r.body[0].nombre_informe, 'Borrador.docx');
    assert.equal('ruta_archivo' in r.body[0], false);
  });
});
