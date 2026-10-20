// test/acceso-revision.test.js — Una revisión solo la abre su equipo, también los administradores
// (la base les deja leerlas todas para el panel de administración).
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const request = require('supertest');
const app = require('../app');
const sb = require('../infra/supabase');
const { soloEquipo } = require('../core/accesoRevision');

const REV = { id_detalles_revision: 5, id_usuarios: 'otra-persona', titulo_revision: 'Revisión de otra persona' };
const esRpc = (p, fn) => Array.isArray(p) && p[0] && p[0][0] === 'rpc' && p[0][1][0] === fn;
const consultas = [];
let esDelEquipo;

beforeEach(() => {
  consultas.length = 0;
  soloEquipo._reiniciar();
  esDelEquipo = false;
  sb.forUser = () => h.clienteFalso(p => {
    consultas.push(p);
    // Como la base: fn_equipo_revision exige can_read_revision() (sin excepción para administradores)
    if (esRpc(p, 'fn_equipo_revision')) {
      return esDelEquipo ? { data: [{ id_usuarios: 'yo', rol: 'revisor' }], error: null }
        : { data: null, error: { code: '42501', message: 'No autorizado sobre esta revisión' } };
    }
    // RLS con la política rev_admin_select: un administrador LEE cualquier revisión
    if (h.tabla(p) === 'detalles_revision') return { data: REV, error: null };
    return { data: [], error: null };
  });
});

const pide = async (ruta, o = {}) => request(app).get(`/api/v1${ruta}`).set('Authorization', `Bearer ${await h.token(o)}`);
const llamadasEquipo = () => consultas.filter(p => esRpc(p, 'fn_equipo_revision')).length;

describe('acceso a una revisión por su número', () => {
  test('un administrador que no es del equipo recibe 404 en la revisión y en todo lo que cuelga de ella', async () => {
    for (const ruta of ['/revisiones/5', '/revisiones/5/estudios', '/revisiones/5/planificacion', '/revisiones/5/extraccion', '/revisiones/5/referencias']) {
      const r = await pide(ruta, { rol: 'admin' });
      assert.equal(r.status, 404, ruta);
      assert.match(r.body.error, /no tienes acceso/);
    }
    assert.ok(!consultas.some(p => h.tabla(p) === 'detalles_revision'), 'ni siquiera se lee la revisión');
  });

  test('un administrador del equipo entra; la comprobación se recuerda un minuto', async () => {
    esDelEquipo = true;
    const yo = { rol: 'admin', sub: h.nuevoId() };
    const r = await pide('/revisiones/5', yo);
    assert.equal(r.status, 200);
    assert.equal(r.body.titulo_revision, 'Revisión de otra persona');
    assert.equal((await pide('/revisiones/5/estudios', yo)).status, 200);
    assert.equal(llamadasEquipo(), 1, 'la segunda petición no vuelve a consultar el equipo');
  });

  test('a un usuario normal no se le añade ninguna consulta: lo decide RLS como siempre', async () => {
    const r = await pide('/revisiones/5');
    assert.equal(r.status, 200);
    assert.equal(llamadasEquipo(), 0);
  });

  test('ids no válidos los sigue rechazando la ruta (400), sin consultar el equipo', async () => {
    const r = await pide('/revisiones/abc', { rol: 'admin' });
    assert.equal(r.status, 400);
    assert.equal(llamadasEquipo(), 0);
  });
});
