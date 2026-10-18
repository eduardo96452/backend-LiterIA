// test/cuenta-eliminar.test.js — eliminar la propia cuenta (GET /cuenta/eliminacion, DELETE /cuenta).
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const request = require('supertest');
const app = require('../app');
const sb = require('../infra/supabase');

const YO = 'a3c1d2e4-0000-4000-8000-0000000000aa';
let responder, borrados, usuariosAuth, consultas;

beforeEach(() => {
  borrados = []; consultas = [];
  usuariosAuth = [{ id: YO, app_metadata: {} }];
  responder = p => {
    consultas.push(p);
    const tabla = h.tabla(p);
    if (tabla === 'detalles_revision') {
      if (h.paso(p, 'delete')) return { data: [{ id_detalles_revision: 7 }], error: null };
      if (h.paso(p, 'maybeSingle')) return { data: { id_detalles_revision: 7, id_usuarios: YO, titulo_revision: 'Mi revisión' }, error: null };
      return { data: [{ id_detalles_revision: 7, titulo_revision: 'Mi revisión', colaboradores_revision: [{ count: 2 }] }], error: null };
    }
    if (tabla === 'colaboradores_revision') return { data: null, error: null, count: 3 };
    if (tabla === 'estudios') return { data: [], error: null };
    return { data: null, error: null };
  };
  sb.forUser = () => h.clienteFalso(p => responder(p));
  sb.adminDisponible = () => true;
  sb.admin = () => ({
    ...h.clienteFalso(p => responder(p)),
    auth: { admin: {
      deleteUser: async id => { borrados.push(id); return { error: null }; },
      listUsers: async () => ({ data: { users: usuariosAuth }, error: null })
    } }
  });
});

const sesion = async (extra = {}) => `Bearer ${await h.token({ sub: YO, email: 'Ana@Uni.edu', ...extra })}`;

describe('eliminar la cuenta', () => {
  test('GET /eliminacion: revisiones propias (con cuántas personas más) y colaboraciones', async () => {
    const r = await request(app).get('/api/v1/cuenta/eliminacion').set('Authorization', await sesion());
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.revisiones, [{ id: 7, titulo: 'Mi revisión', colaboradores: 2 }]);
    assert.equal(r.body.colaboraciones, 3);
    assert.equal(r.body.disponible, true);
  });

  test('sin escribir el correo de la cuenta no se borra nada', async () => {
    const r = await request(app).delete('/api/v1/cuenta').set('Authorization', await sesion()).send({ confirmacion: 'otro@uni.edu' });
    assert.equal(r.status, 400);
    assert.deepEqual(borrados, []);
    assert.equal(consultas.filter(p => h.paso(p, 'delete')).length, 0);
  });

  test('con el correo (sin importar mayúsculas): borra las revisiones propias y después el usuario', async () => {
    const r = await request(app).delete('/api/v1/cuenta').set('Authorization', await sesion()).send({ confirmacion: ' ana@uni.edu ' });
    assert.equal(r.status, 204);
    assert.ok(consultas.some(p => h.tabla(p) === 'detalles_revision' && h.paso(p, 'delete')), 'borra la revisión propia');
    assert.deepEqual(borrados, [YO]);
  });

  test('el único administrador no puede borrarse; si hay otro, sí', async () => {
    usuariosAuth = [{ id: YO, app_metadata: { rol: 'admin' } }];
    let r = await request(app).delete('/api/v1/cuenta').set('Authorization', await sesion({ rol: 'admin' })).send({ confirmacion: 'ana@uni.edu' });
    assert.equal(r.status, 409);
    assert.deepEqual(borrados, []);
    usuariosAuth.push({ id: 'otro', app_metadata: { rol: 'admin' } });
    r = await request(app).delete('/api/v1/cuenta').set('Authorization', await sesion({ rol: 'admin' })).send({ confirmacion: 'ana@uni.edu' });
    assert.equal(r.status, 204);
  });

  test('sin service_role en el servidor responde 503 y no toca nada', async () => {
    sb.adminDisponible = () => false;
    const r = await request(app).delete('/api/v1/cuenta').set('Authorization', await sesion()).send({ confirmacion: 'ana@uni.edu' });
    assert.equal(r.status, 503);
    assert.deepEqual(borrados, []);
  });
});
