// test/consensus-uso.test.js — v3.17: cuánto queda y cuánto cuesta Consensus.
// La API de Consensus no da el saldo: LiterIA apunta cada búsqueda (con la huella de la clave, nunca
// la clave), recuerda las claves agotadas y el panel de administración lo resume. Sin red ni base real.
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const request = require('supertest');
const app = require('../app');
const env = require('../config/env');
const sb = require('../infra/supabase');
const consensus = require('../infra/consensus');
const uso = require('../infra/consensusUso');
const { resumirConsensus, limites } = require('../modules/admin/consensus.resumen');

const CLAVE_A = 'clave-uno-SECRETA-000000000001';
const CLAVE_B = 'clave-dos-SECRETA-000000000002';
const HA = uso.huella(CLAVE_A), HB = uso.huella(CLAVE_B);
const original = { get: consensus._http.get, clave: env.CONSENSUS_API_KEY, forUser: sb.forUser, admin: sb.admin, disp: sb.adminDisponible };

let escrituras, responderBase, responderAdmin;
const espera = () => new Promise(r => setTimeout(r, 15));   // las escrituras van sin await
const error = (status, data) => { const e = new Error(String(status)); e.response = { status, data, headers: {} }; return e; };

beforeEach(() => {
  escrituras = [];
  responderBase = () => ({ data: null, error: null });
  responderAdmin = () => ({ data: null, error: null });
  consensus._reiniciar();
  uso._reiniciar();
  env.CONSENSUS_API_KEY = `${CLAVE_A},${CLAVE_B}`;
  sb.adminDisponible = () => true;
  sb.admin = () => h.clienteFalso(p => { escrituras.push(p); return responderBase(p); });
  sb.forUser = () => h.clienteFalso(p => { escrituras.push(['USUARIO', p]); return responderAdmin(p); });
});
afterEach(() => {
  consensus._http.get = original.get; env.CONSENSUS_API_KEY = original.clave;
  sb.forUser = original.forUser; sb.admin = original.admin; sb.adminDisponible = original.disp;
});

const inserciones = tabla => escrituras.filter(p => Array.isArray(p) && h.tabla(p) === tabla && h.paso(p, 'insert')).map(p => h.paso(p, 'insert')[1][0]);
const upserts = tabla => escrituras.filter(p => Array.isArray(p) && h.tabla(p) === tabla && h.paso(p, 'upsert')).map(p => h.paso(p, 'upsert')[1][0]);

describe('registro de las búsquedas (infra/consensusUso)', () => {
  test('cada búsqueda se apunta con la huella de la clave y lo que cobra Consensus; la caché no gasta', async () => {
    consensus._http.get = async () => ({ data: { results: Array.from({ length: 20 }, (_, i) => ({ title: `A${i}` })) } });
    await consensus.buscar('generative AI feedback');
    await consensus.buscar('generative AI feedback');            // la misma: de la caché
    await espera();
    const filas = inserciones('consensus_uso');
    assert.equal(filas.length, 2);
    assert.deepEqual({ clave: filas[0].clave, resultados: filas[0].resultados, llamadas: filas[0].llamadas, estado: filas[0].estado, cache: filas[0].desde_cache },
      { clave: HA, resultados: 20, llamadas: 1, estado: 200, cache: false });
    assert.deepEqual({ clave: filas[1].clave, llamadas: filas[1].llamadas, cache: filas[1].desde_cache }, { clave: null, llamadas: 0, cache: true });
    assert.ok(!JSON.stringify(escrituras).includes('SECRETA'), 'la clave nunca llega a la base');
  });

  test('1 llamada por cada 100 artículos, mínimo 1', () => {
    assert.deepEqual([0, 1, 20, 100, 101, 250].map(uso.llamadasDe), [1, 1, 1, 1, 2, 3]);
  });

  test('si Consensus agota una clave: se guarda el mes y el motivo, y la búsqueda sigue con la otra', async () => {
    consensus._http.get = async (_url, opts) => {
      if (opts.headers['x-api-key'] === CLAVE_A) throw error(429, { detail: 'You have used all included searches' });
      return { data: { results: [{ title: 'de la dos' }] } };
    };
    assert.equal((await consensus.buscar('x')).results[0].title, 'de la dos');
    await espera();
    const [marca] = upserts('consensus_claves');
    assert.equal(marca.clave, HA);
    assert.equal(marca.agotada_mes, uso.mesISO());
    assert.equal(marca.ultimo_error_estado, 429);
    // Un intento fallido (no cobra) y la búsqueda buena con la clave 2
    assert.deepEqual(inserciones('consensus_uso').map(f => [f.clave, f.estado, f.llamadas]), [[HA, 429, 0], [HB, 200, 1]]);
  });

  test('tras un reinicio, una clave que la base da por agotada este mes no se vuelve a probar', async () => {
    const pedidas = [];
    responderBase = p => (h.tabla(p) === 'consensus_claves' && h.paso(p, 'select') ? { data: [{ clave: HA }], error: null } : { data: null, error: null });
    consensus._http.get = async (_url, opts) => { pedidas.push(opts.headers['x-api-key']); return { data: { results: [] } }; };
    await consensus.buscar('y');
    assert.deepEqual(pedidas, [CLAVE_B]);
    const [a, b] = consensus.estadoClaves();
    assert.equal(a.motivo.status, 429);
    assert.equal(b.apartada_hasta, null);
  });

  test('sin sql/016 (no existe la tabla) avisa una vez y deja de intentarlo', async () => {
    responderBase = () => ({ data: null, error: { code: '42P01', message: 'relation "public.consensus_uso" does not exist' } });
    consensus._http.get = async () => ({ data: { results: [] } });
    await consensus.buscar('uno'); await espera();
    const antes = escrituras.length;
    await consensus.buscar('dos'); await espera();
    assert.equal(escrituras.length, antes, 'no insiste en cada búsqueda');
  });

  test('estadoClaves: huella y los 4 últimos caracteres, nunca la clave', () => {
    const lista = consensus.estadoClaves();
    assert.deepEqual(lista.map(e => [e.posicion, e.huella, e.final]), [[1, HA, '0001'], [2, HB, '0002']]);
    assert.ok(!JSON.stringify(lista).includes('SECRETA'));
  });
});

describe('resumen de Consensus para el panel', () => {
  const ahora = new Date('2026-11-13T12:00:00Z');
  const estados = [
    { huella: HA, posicion: 1, final: '0001', apartada_hasta: null, motivo: null },
    { huella: HB, posicion: 2, final: '0002', apartada_hasta: null, motivo: null }
  ];

  test('plan gratuito agotado y otro en uso: lo que queda, el ritmo y cuándo se agotaría', () => {
    const r = resumirConsensus(estados, {
      claves: [
        { clave: HA, ajustes: { plan: 'free', agotada_mes: '2026-11-01', ultimo_error: 'You have used all included searches', ultimo_error_fecha: '2026-11-12T10:00:00Z' }, llamadas: 30, busquedas: 30 },
        { clave: HB, ajustes: null, llamadas: 12, busquedas: 12 }
      ],
      cache: 6
    }, ahora);
    const [a, b] = r.claves;
    assert.deepEqual([a.estado, a.usadas, a.quedan, a.agotada_el], ['agotada', 30, 0, '2026-11-12T10:00:00Z']);
    assert.deepEqual([b.estado, b.usadas, b.quedan, b.maximo], ['en_uso', 12, 18, 30]);
    // 42 de 60 en 12,5 días: unas 3,4 por día; a la clave 2 le quedan 18 → hacia el 18 de noviembre
    assert.equal(b.agotara_el, '2026-11-18');
    assert.deepEqual([r.total.quedan, r.total.usadas, r.total.maximo, r.total.cache, r.total.costo_mes], [18, 42, 60, 6, 0]);
    assert.equal(r.renueva, '2026-12-01');
  });

  test('plan Pro con uso adicional: llamadas extra a US$ 0,05 más lo que se paga al mes', () => {
    const r = resumirConsensus([estados[0]], {
      claves: [{ clave: HA, ajustes: { plan: 'pro', uso_adicional: true, costo_mensual: 15 }, llamadas: 540 }]
    }, ahora);
    const [a] = r.claves;
    assert.deepEqual([a.incluidas, a.maximo, a.extra, a.costo_extra, a.costo_mes, a.quedan, a.quedan_incluidas], [500, 1000, 40, 2, 17, 460, 0]);
  });

  test('lo que marca el panel de Consensus (sincronizado este mes) manda sobre la cuenta de LiterIA', () => {
    const r = resumirConsensus([estados[0]], {
      claves: [{ clave: HA, ajustes: { plan: 'free', sync_usadas: 20, sync_fecha: '2026-11-10T00:00:00Z' }, llamadas: 25, llamadas_tras_sync: 3 }]
    }, ahora);
    assert.equal(r.claves[0].usadas, 23);
    // Una sincronización del mes pasado ya no vale
    const viejo = resumirConsensus([estados[0]], {
      claves: [{ clave: HA, ajustes: { plan: 'free', sync_usadas: 20, sync_fecha: '2026-10-28T00:00:00Z' }, llamadas: 5, llamadas_tras_sync: 9 }]
    }, ahora);
    assert.equal(viejo.claves[0].usadas, 5);
  });

  test('clave rechazada o con la facturación pendiente (en memoria); la siguiente pasa a estar en uso', () => {
    const r = resumirConsensus([
      { ...estados[0], motivo: { status: 401, msg: 'invalid key' }, apartada_hasta: '2026-11-13T20:00:00Z' },
      { ...estados[1], motivo: { status: 402, msg: 'billing' } },
      { huella: 'c'.repeat(16), posicion: 3 }, { huella: 'd'.repeat(16), posicion: 4 }
    ], { claves: [] }, ahora);
    assert.deepEqual(r.claves.map(c => c.estado), ['rechazada', 'facturacion', 'en_uso', 'en_espera']);
    assert.equal(r.claves[0].motivo, 'invalid key');
  });

  test('sin datos de la base (falta sql/016) o sin claves', () => {
    const r = resumirConsensus(estados, null, ahora, true);
    assert.equal(r.sin_registro, true);
    assert.deepEqual(r.claves.map(c => [c.estado, c.usadas, c.quedan]), [['en_uso', 0, 30], ['en_espera', 0, 30]]);
    assert.equal(resumirConsensus([], null, ahora).configurada, false);
  });

  test('gasto de los meses anteriores con los planes de ahora', () => {
    const r = resumirConsensus([estados[0]], {
      claves: [{ clave: HA, ajustes: { plan: 'pro', uso_adicional: true, costo_mensual: 10 } }],
      historial: [{ mes: '2026-10', clave: HA, llamadas: 520 }, { mes: '2026-09', clave: HA, llamadas: 100 }]
    }, ahora);
    assert.deepEqual(r.historial, [{ mes: '2026-09', llamadas: 100, costo: 10 }, { mes: '2026-10', llamadas: 520, costo: 11 }]);
  });

  test('límites de cada plan', () => {
    assert.deepEqual(limites('free', { uso_adicional: true }), { incluidas: 30, maximo: 30, usoAdicional: false });
    assert.deepEqual(limites('deep', { uso_adicional: true }), { incluidas: 2000, maximo: 10000, usoAdicional: true });
    assert.deepEqual(limites('enterprise', { incluidas: 5000, maximo: 8000 }), { incluidas: 5000, maximo: 8000, usoAdicional: true });
  });
});

describe('rutas del panel: /api/v1/admin/consensus', () => {
  const admin = async () => `Bearer ${await h.token({ rol: 'admin' })}`;

  test('el resumen, solo para administradores', async () => {
    responderAdmin = p => (h.esRpc(p, 'fn_admin_consensus')
      ? { data: { claves: [{ clave: HA, ajustes: { plan: 'free' }, llamadas: 7, busquedas: 7 }], cache: 1, por_dia: [{ dia: '2026-11-02', busquedas: 7, llamadas: 7, cache: 1 }] }, error: null }
      : { data: null, error: null });
    const r = await request(app).get('/api/v1/admin/consensus').set('Authorization', await admin());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.claves.length, 2);
    assert.deepEqual([r.body.claves[0].usadas, r.body.claves[0].quedan, r.body.claves[0].final], [7, 23, '0001']);
    assert.deepEqual(h.paso(escrituras.find(e => e[0] === 'USUARIO')[1], 'rpc')[1][1], { p_claves: [HA, HB] });
    assert.ok(!JSON.stringify(r.body).includes('SECRETA'), 'la clave no sale del servidor');

    const normal = await request(app).get('/api/v1/admin/consensus').set('Authorization', `Bearer ${await h.token()}`);
    assert.equal(normal.status, 403);
  });

  test('sin sql/016: 200 con lo que hay en memoria y el aviso', async () => {
    responderAdmin = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fn_admin_consensus(p_claves)' } });
    const r = await request(app).get('/api/v1/admin/consensus').set('Authorization', await admin());
    assert.equal(r.status, 200);
    assert.equal(r.body.sin_registro, true);
  });

  test('guardar el plan: valida, aplica los límites del plan y puede volver a probar la clave', async () => {
    const auth = await admin();
    assert.equal((await request(app).put('/api/v1/admin/consensus/claves/zzz').set('Authorization', auth).send({ plan: 'free' })).status, 400);
    assert.equal((await request(app).put(`/api/v1/admin/consensus/claves/${'f'.repeat(16)}`).set('Authorization', auth).send({ plan: 'free' })).status, 404);
    assert.equal((await request(app).put(`/api/v1/admin/consensus/claves/${HA}`).set('Authorization', auth).send({ plan: 'enterprise' })).status, 400);
    assert.equal((await request(app).put(`/api/v1/admin/consensus/claves/${HA}`).set('Authorization', auth).send({ plan: 'gold' })).status, 400);

    // La clave 1 estaba apartada (agotada): al pasar a Pro con uso adicional se vuelve a probar
    consensus._http.get = async () => { throw error(429, { detail: 'You have used all included searches' }); };
    await assert.rejects(consensus.buscar('agota'));
    assert.ok(consensus.estadoClaves()[0].apartada_hasta);

    responderAdmin = p => (h.esRpc(p, 'fn_admin_consensus') ? { data: { claves: [] }, error: null } : { data: null, error: null });
    const r = await request(app).put(`/api/v1/admin/consensus/claves/${HA}`).set('Authorization', auth)
      .send({ plan: 'pro', uso_adicional: true, nombre: 'Cuenta del grupo', costo_mensual: 15, sync_usadas: 503, reactivar: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const guardar = escrituras.filter(e => e[0] === 'USUARIO').map(e => e[1]).find(p => h.esRpc(p, 'fn_admin_guardar_consensus_clave'));
    assert.deepEqual(h.paso(guardar, 'rpc')[1][1], {
      p_clave: HA, p_nombre: 'Cuenta del grupo', p_plan: 'pro', p_incluidas: 500, p_maximo: 1000, p_uso_adicional: true,
      p_costo_mensual: 15, p_sync_usadas: 503, p_reactivar: true
    });
    assert.equal(consensus.estadoClaves()[0].apartada_hasta, null, 'la clave vuelve a usarse');
    assert.ok(Array.isArray(r.body.claves), 'devuelve el resumen actualizado');
  });
});
