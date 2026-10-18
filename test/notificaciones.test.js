// test/notificaciones.test.js — correos de los avisos (sql/012): cola, reserva, envío y errores.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const sb = require('../infra/supabase');
const env = require('../config/env');
const email = require('../infra/email');
const correo = require('../modules/notificaciones/correo');

const FILA = (id, extra = {}) => ({
  id, id_usuarios: 'u1', tipo: 'conflicto_cribado', titulo: 'Conflicto de cribado en «IA»', cuerpo: 'Dos revisores discrepan.',
  enlace: '/revision_datos?id=5', id_detalles_revision: 5, intentos: 0, ...extra
});

let cola, lectura, enviados, updates, fallarCorreo;
beforeEach(() => {
  cola = [FILA(1), FILA(2, { id_usuarios: 'u2', tipo: 'fase_completada', titulo: 'Fase completada', cuerpo: null, enlace: null, id_detalles_revision: null })];
  lectura = null; enviados = []; updates = []; fallarCorreo = false;
  env.GMAIL_USER = 'literia@example.com'; env.GMAIL_PASS = 'x';
  sb.adminDisponible = () => true;
  sb.admin = () => h.clienteFalso(p => {
    const tabla = h.tabla(p);
    if (tabla === 'notificaciones_correo') {
      const up = h.paso(p, 'update');
      if (up) {
        const id = p.find(x => x[0] === 'eq' && x[1][0] === 'id')[1][1];
        updates.push({ id, ...up[1][0] });
        const intentos = p.find(x => x[0] === 'eq' && x[1][0] === 'intentos');
        // La reserva solo vale si nadie la tomó antes
        if (intentos && intentos[1][1] !== cola.find(f => f.id === id)?.intentos) return { data: [], error: null };
        return { data: [{ id }], error: null };
      }
      return { data: lectura ?? cola.map(f => ({ ...f })), error: null };
    }
    if (tabla === 'usuarios') {
      return { data: [{ id_usuarios: 'u1', correo_electronico: 'ana@uni.edu', nombre: 'Ana', apellido: 'Pérez' },
                      { id_usuarios: 'u2', correo_electronico: 'luis@uni.edu', nombre_usuario: 'luis' }], error: null };
    }
    if (tabla === 'detalles_revision') return { data: [{ id_detalles_revision: 5, titulo_revision: 'IA en educación' }], error: null };
    return { data: null, error: null };
  });
  email.sendNotificationMail = async m => { if (fallarCorreo) throw new Error('SMTP caído'); enviados.push(m); };
});

describe('correos de los avisos (notificaciones_correo)', () => {
  test('envía los pendientes con el nombre, la revisión y el enlace, y los marca como enviados', async () => {
    assert.equal(await correo.enviarPendientes(), 2);
    assert.equal(enviados.length, 2);
    assert.deepEqual(
      { to: enviados[0].to, nombre: enviados[0].nombre, titulo: enviados[0].titulo, revision: enviados[0].revision, enlace: enviados[0].enlace },
      { to: 'ana@uni.edu', nombre: 'Ana Pérez', titulo: 'Conflicto de cribado en «IA»', revision: 'IA en educación', enlace: `${env.FRONTEND_URL}/revision_datos?id=5` });
    assert.equal(enviados[1].nombre, 'luis');
    assert.equal(enviados[1].enlace, null);
    assert.match(enviados[0].preferencias, /\/preferencias-notificacion$/);
    assert.ok(updates.some(u => u.id === 1 && u.intentos === 1), 'se reserva antes de enviar');
    assert.ok(updates.some(u => u.id === 1 && u.enviado_at), 'y se marca como enviado');
  });

  test('si el correo falla, se guarda el error y no se marca como enviado (se reintenta)', async () => {
    fallarCorreo = true;
    assert.equal(await correo.enviarPendientes(), 0);
    assert.ok(updates.some(u => u.id === 1 && /SMTP caído/.test(u.error)));
    assert.ok(!updates.some(u => u.enviado_at));
  });

  test('una fila que otro proceso ya reservó no se envía dos veces', async () => {
    cola = [FILA(1)];
    lectura = cola.map(f => ({ ...f }));    // lo que se leyó: intentos 0
    cola[0].intentos = 1;                    // y mientras tanto otro proceso la reservó
    assert.equal(await correo.enviarPendientes(), 0);
    assert.equal(enviados.length, 0);
  });

  test('sin service_role o sin Gmail no hace nada; sin sql/012 avisa y no rompe', async () => {
    sb.adminDisponible = () => false;
    assert.equal(await correo.enviarPendientes(), 0);
    sb.adminDisponible = () => true;
    env.GMAIL_PASS = '';
    assert.equal(await correo.enviarPendientes(), 0);
    env.GMAIL_PASS = 'x';
    sb.admin = () => h.clienteFalso(() => ({ data: null, error: { code: '42P01', message: 'relation "public.notificaciones_correo" does not exist' } }));
    assert.equal(await correo.enviarPendientes(), 0);
    assert.equal(enviados.length, 0);
  });

  test('el middleware deja pasar todas las peticiones (y solo programa el envío tras las que escriben)', () => {
    const pasan = [];
    for (const [metodo, status] of [['GET', 200], ['POST', 201], ['PATCH', 403]]) {
      const eventos = {};
      correo.trasEscritura({ method: metodo }, { statusCode: status, on: (n, f) => { eventos[n] = f; } }, () => pasan.push(metodo));
      assert.equal(typeof eventos.finish, metodo === 'GET' ? 'undefined' : 'function');
    }
    assert.deepEqual(pasan, ['GET', 'POST', 'PATCH']);
  });
});
