// test/api.test.js — se ejecuta con `npm test` (node:test + supertest, sin red ni base real).
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');            // primero: prepara el entorno de pruebas
const request = require('supertest');
const app = require('../app');
const sb = require('../infra/supabase');
const legacy = require('../legacy/routes');

// ---------- Supabase simulado ----------
let responder;           // cada prueba define qué responde la "base"
let cliente;             // último cliente creado (para inspeccionar las consultas)
let tokensUsados;        // tokens con los que el backend habló con la base
beforeEach(() => {
  tokensUsados = [];
  responder = () => ({ data: null, error: null });
  sb.forUser = tk => { tokensUsados.push(tk); cliente = h.clienteFalso(p => responder(p)); return cliente; };
  sb.adminDisponible = () => false;
});

const fila = (extra = {}) => ({
  id_detalles_revision: 5, id_usuarios: 'u-dueno', titulo_revision: 'IA en educación', objetivo: null,
  tipo_revision: 'RSL', descripcion: 'd', fecha_creacion: '2026-10-01T00:00:00Z', fecha_modificacion: '2026-10-02T00:00:00Z',
  alcance: null, pais: null, ciudad: null, area_conocimiento: null, tipo_investigacion: null, institucion: null, id_plantilla: null,
  ...extra
});

async function conSesion(opts = {}) {
  const sub = opts.sub || h.nuevoId();
  return { sub, auth: `Bearer ${await h.token({ ...opts, sub })}` };
}

// ---------- Autenticación ----------
describe('autenticación', () => {
  test('GET /api/health responde sin token', async () => {
    const r = await request(app).get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
  });

  test('/api/v1 sin token → 401', async () => {
    const r = await request(app).get('/api/v1/revisiones');
    assert.equal(r.status, 401);
  });

  test('token con otra firma → 401 (antes 403)', async () => {
    const malo = await h.token({ secreto: 'otro-secreto-que-no-es-el-del-proyecto-123' });
    const r = await request(app).get('/api/v1/revisiones').set('Authorization', `Bearer ${malo}`);
    assert.equal(r.status, 401);
    assert.match(r.body.error, /inválido o expirado/);
  });

  test('token caducado → 401, también en las rutas antiguas', async () => {
    const viejo = `Bearer ${await h.token({ caducado: true })}`;
    assert.equal((await request(app).get('/api/v1/revisiones').set('Authorization', viejo)).status, 401);
    assert.equal((await request(app).post('/api/generate-objective').set('Authorization', viejo).send({})).status, 401);
  });

  test('el backend consulta la base con el token del usuario (RLS como él)', async () => {
    const s = await conSesion();
    responder = () => ({ data: [], error: null });
    await request(app).get('/api/v1/revisiones').set('Authorization', s.auth).expect(200);
    assert.deepEqual(tokensUsados, [s.auth.slice(7)]);
  });
});

// ---------- /api/v1/revisiones ----------
describe('revisiones', () => {
  test('GET / lista; ?propias=true filtra por el dueño del token', async () => {
    const s = await conSesion();
    responder = () => ({ data: [fila()], error: null });
    const r = await request(app).get('/api/v1/revisiones').set('Authorization', s.auth);
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 1);
    assert.equal(h.paso(cliente.consultas[0], 'eq'), undefined);

    await request(app).get('/api/v1/revisiones?propias=true').set('Authorization', s.auth).expect(200);
    assert.deepEqual(h.paso(cliente.consultas[0], 'eq')[1], ['id_usuarios', s.sub]);
  });

  test('POST / crea con el dueño del token y sin fechas del cliente → 201', async () => {
    const s = await conSesion();
    let insertado;
    responder = p => { insertado = h.paso(p, 'insert')[1][0]; return { data: fila({ ...insertado, id_detalles_revision: 77 }), error: null }; };
    const r = await request(app).post('/api/v1/revisiones').set('Authorization', s.auth)
      .send({ titulo_revision: '  Revisión nueva ', tipo_revision: 'RSL', descripcion: 'x', pais: null });
    assert.equal(r.status, 201);
    assert.equal(r.body.id_detalles_revision, 77);
    assert.equal(insertado.id_usuarios, s.sub);
    assert.equal(insertado.titulo_revision, 'Revisión nueva');          // recortado por zod
    assert.equal('fecha_creacion' in insertado, false);
  });

  test('POST / rechaza id_usuarios en el cuerpo → 400', async () => {
    const s = await conSesion();
    const r = await request(app).post('/api/v1/revisiones').set('Authorization', s.auth)
      .send({ titulo_revision: 'x', id_usuarios: h.nuevoId() });
    assert.equal(r.status, 400);
    assert.ok(r.body.details.some(d => /id_usuarios/.test(d.mensaje) || d.campo === ''));
  });

  test('POST / sin título → 400 con el campo señalado', async () => {
    const s = await conSesion();
    const r = await request(app).post('/api/v1/revisiones').set('Authorization', s.auth).send({ descripcion: 'x' });
    assert.equal(r.status, 400);
    assert.ok(r.body.details.some(d => d.campo === 'titulo_revision'));
  });

  test('GET /abc → 400; GET /:id que no ve → 404', async () => {
    const s = await conSesion();
    assert.equal((await request(app).get('/api/v1/revisiones/abc').set('Authorization', s.auth)).status, 400);
    responder = () => ({ data: null, error: null });
    const r = await request(app).get('/api/v1/revisiones/999').set('Authorization', s.auth);
    assert.equal(r.status, 404);
    assert.deepEqual(h.paso(cliente.consultas[0], 'eq')[1], ['id_detalles_revision', 999]);
  });

  test('PATCH vacío → 400; PATCH válido → 200 sin tocar fechas ni dueño', async () => {
    const s = await conSesion();
    assert.equal((await request(app).patch('/api/v1/revisiones/5').set('Authorization', s.auth).send({})).status, 400);
    assert.equal((await request(app).patch('/api/v1/revisiones/5').set('Authorization', s.auth)
      .send({ id_usuarios: s.sub })).status, 400);
    let cambios;
    responder = p => { cambios = h.paso(p, 'update')[1][0]; return { data: fila(cambios), error: null }; };
    const r = await request(app).patch('/api/v1/revisiones/5').set('Authorization', s.auth).send({ objetivo: 'Analizar…' });
    assert.equal(r.status, 200);
    assert.deepEqual(cambios, { objetivo: 'Analizar…' });
  });

  test('PATCH en una revisión de solo lectura → 403', async () => {
    const s = await conSesion();
    responder = p => (h.paso(p, 'update') ? { data: null, error: null } : { data: fila(), error: null });
    const r = await request(app).patch('/api/v1/revisiones/5').set('Authorization', s.auth).send({ objetivo: 'x' });
    assert.equal(r.status, 403);
  });

  test('DELETE de quien no es propietario → 403 y no borra archivos', async () => {
    const s = await conSesion();
    responder = p => {
      if (p[0][0] === 'storage') throw new Error('no debería tocar Storage');
      if (h.paso(p, 'delete')) return { data: [], error: null };          // RLS no dejó borrar
      if (h.tabla(p) === 'estudios') return { data: [{ id_estudios: 7 }], error: null };
      return { data: fila(), error: null };
    };
    const r = await request(app).delete('/api/v1/revisiones/5').set('Authorization', s.auth);
    assert.equal(r.status, 403);
  });

  test('DELETE del propietario → 204 y limpia informes y PDFs de sus estudios', async () => {
    const s = await conSesion();
    const borrados = [];
    responder = p => {
      if (p[0][0] === 'storage') {
        const listar = h.paso(p, 'list');
        if (listar) {
          const contenido = { 'informes/5': [{ id: 'a', name: 'informe.docx' }], 'estudios/7': [{ id: 'b', name: '1_art.pdf' }] };
          return { data: contenido[listar[1][0]] || [], error: null };
        }
        borrados.push(...h.paso(p, 'remove')[1][0]);
        return { data: [], error: null };
      }
      if (h.paso(p, 'delete')) return { data: [{ id_detalles_revision: 5 }], error: null };
      if (h.tabla(p) === 'estudios') {
        assert.deepEqual(h.paso(p, 'not')[1], ['url_pdf_articulo', 'is', null]);
        return { data: [{ id_estudios: 7 }, { id_estudios: 9 }], error: null };
      }
      return { data: fila(), error: null };
    };
    const r = await request(app).delete('/api/v1/revisiones/5').set('Authorization', s.auth);
    assert.equal(r.status, 204);
    assert.deepEqual(borrados.sort(), ['estudios/7/1_art.pdf', 'informes/5/informe.docx']);
  });

  test('PUT /:id/preferencia manda null en lo que no cambia', async () => {
    const s = await conSesion();
    let params;
    responder = p => {
      if (h.esRpc(p, 'fn_marcar_revision')) { params = p[0][1][1]; return { data: { favorita: true, oculta: false }, error: null }; }
      return { data: fila(), error: null };
    };
    const r = await request(app).put('/api/v1/revisiones/5/preferencia').set('Authorization', s.auth).send({ favorita: true });
    assert.equal(r.status, 200);
    assert.deepEqual(params, { p_id_rev: 5, p_favorita: true, p_oculta: null });
    assert.equal((await request(app).put('/api/v1/revisiones/5/preferencia').set('Authorization', s.auth).send({})).status, 400);
  });

  test('GET /:id/progreso devuelve las fases; sin permiso (42501) → 403', async () => {
    const s = await conSesion();
    responder = p => (h.esRpc(p, 'fn_progreso_revision')
      ? { data: { progreso_total: 40, fases: [{ clave: 'planificacion', nombre: 'Planificación', porcentaje: 100 }] }, error: null }
      : { data: null, error: null });
    const r = await request(app).get('/api/v1/revisiones/5/progreso').set('Authorization', s.auth);
    assert.equal(r.status, 200);
    assert.equal(r.body.progreso_total, 40);
    responder = () => ({ data: null, error: { code: '42501', message: 'No autorizado sobre esta revisión' } });
    assert.equal((await request(app).get('/api/v1/revisiones/5/progreso').set('Authorization', s.auth)).status, 403);
  });

  test('un error de permisos de la base (42501) llega como 403', async () => {
    const s = await conSesion();
    responder = () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "detalles_revision"' } });
    const r = await request(app).post('/api/v1/revisiones').set('Authorization', s.auth).send({ titulo_revision: 'x' });
    assert.equal(r.status, 403);
  });
});

// ---------- /api/v1/dashboard ----------
describe('dashboard', () => {
  test('combina el progreso con favoritas y ocultas en una sola respuesta', async () => {
    const s = await conSesion();
    responder = p => {
      if (h.esRpc(p, 'fn_progreso_usuario')) {
        return { data: [{ id_detalles_revision: 5, titulo_revision: 'A', progreso: '42.5', estudios: 10, aceptados: 3 },
                        { id_detalles_revision: 6, titulo_revision: 'B', progreso: null, estudios: 0, aceptados: 0 }], error: null };
      }
      if (h.tabla(p) === 'preferencias_revision') return { data: [{ id_detalles_revision: 6, favorita: true, oculta: false }], error: null };
      throw new Error('consulta inesperada');
    };
    const r = await request(app).get('/api/v1/dashboard').set('Authorization', s.auth);
    assert.equal(r.status, 200);
    assert.equal(r.body.progreso_disponible, true);
    assert.deepEqual(r.body.revisiones.map(x => [x.id_detalles_revision, x.progreso, x.favorita]), [[5, 42.5, false], [6, 0, true]]);
  });

  test('si fn_progreso_usuario no está instalada (PGRST202) usa la tabla como respaldo', async () => {
    const s = await conSesion();
    responder = p => {
      if (h.esRpc(p, 'fn_progreso_usuario')) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fn_progreso_usuario without parameters in the schema cache' } };
      if (h.tabla(p) === 'preferencias_revision') return { data: [], error: null };
      return { data: [fila()], error: null };
    };
    const r = await request(app).get('/api/v1/dashboard').set('Authorization', s.auth);
    assert.equal(r.status, 200);
    assert.equal(r.body.progreso_disponible, false);
    assert.equal(r.body.revisiones[0].progreso, 0);
  });
});

// ---------- /api/v1/catalogos ----------
describe('catálogos', () => {
  test('GET /plantillas consulta como el usuario y devuelve la lista', async () => {
    const s = await conSesion();
    responder = p => {
      assert.equal(h.tabla(p), 'plantillas_formato');
      return { data: [{ id_plantilla: 1, nombre: 'APA 7', estilo_cita: 'apa7', cita_en_texto: '(Autor, año)', descripcion: null }], error: null };
    };
    const r = await request(app).get('/api/v1/catalogos/plantillas').set('Authorization', s.auth);
    assert.equal(r.status, 200);
    assert.equal(r.body[0].estilo_cita, 'apa7');
    assert.deepEqual(tokensUsados, [s.auth.slice(7)]);
    assert.match(r.headers['cache-control'], /private/);
  });

  test('sin token → 401', async () => {
    assert.equal((await request(app).get('/api/v1/catalogos/plantillas')).status, 401);
  });
});

// ---------- Límites, CORS y rutas ----------
describe('límites, CORS y rutas', () => {
  test('el límite es por usuario: A recibe 429 y B sigue entrando', async () => {
    const a = await conSesion(); const b = await conSesion();
    responder = () => ({ data: [], error: null });
    let ultimo;
    for (let i = 0; i < 41; i++) ultimo = await request(app).get('/api/v1/revisiones').set('Authorization', a.auth);
    assert.equal(ultimo.status, 429);
    assert.equal((await request(app).get('/api/v1/revisiones').set('Authorization', b.auth)).status, 200);
  });

  test('CORS: el preflight de DELETE desde el frontend está permitido', async () => {
    const r = await request(app).options('/api/v1/revisiones/5')
      .set('Origin', h.ORIGEN).set('Access-Control-Request-Method', 'DELETE');
    assert.equal(r.status, 204);
    assert.match(r.headers['access-control-allow-methods'], /DELETE/);
    assert.match(r.headers['access-control-allow-methods'], /PUT/);
  });

  test('CORS: un origen no permitido recibe 403', async () => {
    const r = await request(app).get('/api/health').set('Origin', 'https://sitio-ajeno.example');
    assert.equal(r.status, 403);
  });

  test('las 41 rutas antiguas siguen montadas igual en /api', () => {
    const rutas = [];
    (function walk(stack, prefijo) {
      for (const l of stack) {
        if (l.route) rutas.push(`${Object.keys(l.route.methods)[0].toUpperCase()} ${prefijo}${l.route.path}`);
        else if (l.name === 'router') walk(l.handle.stack, prefijo + (l.regexp.fast_slash ? '' : '/admin'));
      }
    })(legacy.stack, '');
    const esperadas = ['GET /health', 'POST /contact', 'POST /generate-objetive', 'POST /generate-objective',
      'POST /methodology-structure', 'POST /research-questions', 'POST /generate-keywords', 'POST /generate-search-string',
      'POST /generate-criteria', 'POST /generate-quality-questions', 'POST /generate-data-extraction-questions',
      'POST /generate-extraction-suggestions', 'POST /generate-introduction', 'POST /generate-introduction-keywords',
      'POST /generate-trabajos-relacionados', 'POST /trabaRelaKeywords', 'POST /generate-resultados', 'POST /generate-discusion',
      'POST /generate-discussion', 'POST /generate-discussion-keywords', 'POST /generate-limitaciones', 'POST /generate-conclusion',
      'POST /generate-resumen', 'POST /generate-metodologia', 'POST /importar/buscar', 'POST /importar', 'POST /cribado/sugerir',
      'POST /referencias/verificar', 'GET /referencias/doi/:doi(*)', 'POST /cuenta/aviso-inicio-sesion', 'POST /cuenta/cerrar-sesion',
      'POST /colaboradores/invitar', 'POST /semantica/indexar', 'POST /semantica/buscar', 'POST /semantica/preguntar',
      'GET /admin/resumen', 'GET /admin/usuarios', 'GET /admin/uso', 'PATCH /admin/usuarios/:id/activo',
      'POST /admin/usuarios/:id/rol/codigo', 'PATCH /admin/usuarios/:id/rol'];
    assert.deepEqual(rutas, esperadas);
  });

  test('ruta antigua de IA: cuerpo inválido → 400 sin llamar a OpenAI', async () => {
    const s = await conSesion();
    const r = await request(app).post('/api/generate-objective').set('Authorization', s.auth).send({ title: 'x' });
    assert.equal(r.status, 400);
  });

  test('ruta de administración con un usuario normal → 403; id que no es uuid → 400', async () => {
    const s = await conSesion();
    assert.equal((await request(app).get('/api/admin/resumen').set('Authorization', s.auth)).status, 403);
    const adm = await conSesion({ rol: 'admin' });
    assert.equal((await request(app).patch('/api/admin/usuarios/123/activo').set('Authorization', adm.auth).send({ activo: false })).status, 400);
  });

  test('ruta v1 desconocida → 404 (no cae en las antiguas)', async () => {
    const s = await conSesion();
    const r = await request(app).get('/api/v1/no-existe').set('Authorization', s.auth);
    assert.equal(r.status, 404);
  });
});
