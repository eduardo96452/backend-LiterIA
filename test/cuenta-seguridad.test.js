// test/cuenta-seguridad.test.js — cambiar la contraseña (con la actual, o sin ella desde el enlace de
// recuperación), cambiar el correo y el ORCID del perfil. Supabase Auth simulado (sin red).
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const request = require('supertest');
const app = require('../app');
const sb = require('../infra/supabase');
const authRest = require('../infra/authRest');
const { orcidValido } = require('../modules/cuenta/cuenta.schemas');

const YO = 'a3c1d2e4-0000-4000-8000-0000000000bb';
const CORREO = 'ana@uni.edu';
let llamadas, contrasenaReal, usuarioAuth, fallarPut;

const errorAuth = (status, data) => Object.assign(new Error('auth'), { response: { status, data } });

beforeEach(() => {
  llamadas = []; contrasenaReal = 'Vieja#2024'; fallarPut = null;
  usuarioAuth = { id: YO, email: CORREO, new_email: null };
  authRest._http.post = async (url, cuerpo, cfg = {}) => {
    llamadas.push({ m: 'POST', url, cuerpo, auth: cfg.headers?.Authorization, params: cfg.params });
    if (url.startsWith('/token')) {
      if (cuerpo.email === CORREO && cuerpo.password === contrasenaReal) return { data: { access_token: 'temporal-123', refresh_token: 'renovar-123' } };
      throw errorAuth(400, { code: 'invalid_credentials', msg: 'Invalid login credentials' });
    }
    if (url === '/logout') return { data: null };
    throw new Error(`POST inesperado ${url}`);
  };
  authRest._http.put = async (url, cuerpo, cfg = {}) => {
    llamadas.push({ m: 'PUT', url, cuerpo, auth: cfg.headers?.Authorization, params: cfg.params });
    if (fallarPut) throw fallarPut;
    if (cuerpo.email) return { data: { ...usuarioAuth, new_email: cuerpo.email } };
    return { data: usuarioAuth };
  };
  authRest._http.get = async (url, cfg = {}) => {
    llamadas.push({ m: 'GET', url, auth: cfg.headers?.Authorization });
    return { data: usuarioAuth };
  };
  sb.forUser = () => h.clienteFalso(() => ({ data: { id_usuarios: YO, correo_electronico: CORREO, nombre: 'Ana', orcid: null }, error: null }));
});

const ahora = () => Math.floor(Date.now() / 1000);
const sesion = async (extra = {}) => `Bearer ${await h.token({ sub: YO, email: CORREO, ...extra })}`;
const pide = async (metodo, ruta, cuerpo, extra) => {
  const r = request(app)[metodo](`/api/v1/cuenta${ruta}`).set('Authorization', await sesion(extra));
  return cuerpo ? r.send(cuerpo) : r;
};

describe('cambiar la contraseña', () => {
  test('con la sesión de siempre hay que escribir la actual; desde el enlace de recuperación, no', async () => {
    let r = await pide('get', '/contrasena', null, { amr: [{ method: 'password', timestamp: ahora() - 60 }] });
    assert.deepEqual(r.body, { requiere_actual: true, recuperacion: false });
    r = await pide('get', '/contrasena', null, { amr: [{ method: 'recovery', timestamp: ahora() - 120 }] });
    assert.deepEqual(r.body, { requiere_actual: false, recuperacion: true });
    // El enlace de recuperación vale una hora
    r = await pide('get', '/contrasena', null, { amr: [{ method: 'recovery', timestamp: ahora() - 2 * 3600 }] });
    assert.equal(r.body.requiere_actual, true);
  });

  test('comprueba la actual abriendo una sesión nueva, cambia con ella y se la da al navegador; la vieja se cierra', async () => {
    const auth = await sesion();
    const r = await request(app).put('/api/v1/cuenta/contrasena').set('Authorization', auth).send({ actual: 'Vieja#2024', nueva: 'Nueva#2025' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { cambiada: true, recuperacion: false, sesion: { access_token: 'temporal-123', refresh_token: 'renovar-123' } });
    const [tokenPost, put, logout] = llamadas;
    assert.equal(tokenPost.url, '/token?grant_type=password');
    assert.deepEqual(tokenPost.cuerpo, { email: CORREO, password: 'Vieja#2024' });
    assert.equal(put.auth, 'Bearer temporal-123');
    assert.deepEqual(put.cuerpo, { password: 'Nueva#2025', current_password: 'Vieja#2024' });
    assert.equal(logout.url, '/logout');
    assert.equal(logout.auth, auth, 'se cierra la sesión con la que llegó la petición');
    assert.deepEqual(logout.params, { scope: 'local' });
  });

  test('actual incorrecta → 400 y no se cambia nada', async () => {
    const r = await pide('put', '/contrasena', { actual: 'Otra#2024', nueva: 'Nueva#2025' });
    assert.equal(r.status, 400);
    assert.match(r.body.error?.message || JSON.stringify(r.body), /contraseña actual no es correcta/);
    assert.equal(llamadas.filter(l => l.m === 'PUT').length, 0);
  });

  test('sin la actual (y sin venir del enlace) → 400; igual a la actual → 400', async () => {
    let r = await pide('put', '/contrasena', { nueva: 'Nueva#2025' });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /Escribe tu contraseña actual/);
    r = await pide('put', '/contrasena', { actual: 'Vieja#2024', nueva: 'Vieja#2024' });
    assert.equal(r.status, 400);
    assert.equal(llamadas.length, 0);
  });

  test('desde el enlace de recuperación: sin la actual, con la sesión del propio enlace', async () => {
    const r = await pide('put', '/contrasena', { nueva: 'Nueva#2025' }, { amr: [{ method: 'recovery', timestamp: ahora() - 30 }] });
    assert.equal(r.status, 200);
    assert.equal(r.body.recuperacion, true);
    assert.equal(r.body.sesion, null, 'sigue con la sesión del enlace');
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].m, 'PUT');
    assert.match(llamadas[0].auth, /^Bearer ey/);   // el token de la petición, no uno temporal
    assert.deepEqual(llamadas[0].cuerpo, { password: 'Nueva#2025' });
  });

  test('las reglas de la contraseña también se comprueban en el servidor', async () => {
    for (const nueva of ['corta#1A', 'sinmayuscula#1', 'SinNumero#', 'SinEspecial12']) {
      const r = await pide('put', '/contrasena', { actual: 'Vieja#2024', nueva: nueva === 'corta#1A' ? 'c#1A' : nueva });
      assert.equal(r.status, 400, nueva);
    }
    assert.equal(llamadas.length, 0);
  });

  test('errores de Supabase con mensajes claros; la sesión temporal se cierra igual', async () => {
    fallarPut = errorAuth(422, { code: 'weak_password', msg: 'Password is known to be weak' });
    let r = await pide('put', '/contrasena', { actual: 'Vieja#2024', nueva: 'Nueva#2025' });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /débil|filtraciones/);
    assert.ok(llamadas.some(l => l.url === '/logout' && l.auth === 'Bearer temporal-123'), 'si falla, cierra la sesión nueva');
    fallarPut = errorAuth(429, { code: 'over_request_rate_limit' });
    r = await pide('put', '/contrasena', { actual: 'Vieja#2024', nueva: 'Nueva#2025' });
    assert.equal(r.status, 429);
  });
});

describe('cambiar el correo', () => {
  test('pide la contraseña actual; Supabase envía la confirmación con el enlace de vuelta al perfil', async () => {
    const r = await pide('post', '/correo', { nuevo: ' Nuevo@Uni.edu ', actual: 'Vieja#2024' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { cambiado: false, correo: CORREO, pendiente: 'nuevo@uni.edu' });
    const put = llamadas.find(l => l.m === 'PUT');
    assert.deepEqual(put.cuerpo, { email: 'nuevo@uni.edu' });
    assert.equal(put.auth, 'Bearer temporal-123');
    assert.match(put.params.redirect_to, /\/Perfil\?correo=confirmado$/);
    assert.ok(llamadas.some(l => l.url === '/logout'));
  });

  test('contraseña mala, mismo correo o correo ya usado → error y nada pendiente', async () => {
    let r = await pide('post', '/correo', { nuevo: 'nuevo@uni.edu', actual: 'mala' });
    assert.equal(r.status, 400);
    r = await pide('post', '/correo', { nuevo: 'ANA@uni.edu', actual: 'Vieja#2024' });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /ya es el correo de tu cuenta/);
    fallarPut = errorAuth(422, { code: 'email_exists', msg: 'A user with this email address has already been registered' });
    r = await pide('post', '/correo', { nuevo: 'otra@uni.edu', actual: 'Vieja#2024' });
    assert.equal(r.status, 409);
    r = await pide('post', '/correo', { nuevo: 'no-es-correo', actual: 'Vieja#2024' });
    assert.equal(r.status, 400);
  });

  test('GET /perfil dice qué correo espera confirmación', async () => {
    usuarioAuth.new_email = 'nuevo@uni.edu';
    const r = await pide('get', '/perfil');
    assert.equal(r.status, 200);
    assert.equal(r.body.correo_pendiente, 'nuevo@uni.edu');
    assert.equal(r.body.correo_electronico, CORREO);
  });

  test('si Supabase Auth no responde, el perfil sale igual (sin correo pendiente)', async () => {
    authRest._http.get = async () => { throw errorAuth(503, {}); };
    const r = await pide('get', '/perfil');
    assert.equal(r.status, 200);
    assert.equal(r.body.correo_pendiente, null);
  });
});

describe('ORCID del perfil', () => {
  test('formato y dígito de control (ISO 7064 11,2)', () => {
    for (const ok of ['0000-0002-1825-0097', '0000-0001-5109-3700', '0000-0002-1694-233X', '0000-0003-2984-3637']) assert.ok(orcidValido(ok), ok);
    for (const malo of ['0000-0002-1825-0098', '0000-0002-1825-009', '0000000218250097', '0000-0002-1694-2330']) assert.ok(!orcidValido(malo), malo);
  });

  test('PATCH /perfil: se acepta pegado como enlace y se guarda solo el identificador; uno inválido → 400', async () => {
    let r = await pide('patch', '/perfil', { orcid: 'https://orcid.org/0000-0002-1694-233x' });
    assert.equal(r.status, 200);
    r = await pide('patch', '/perfil', { orcid: '0000-0002-1825-0098' });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /dígito|control|ORCID/);
    r = await pide('patch', '/perfil', { orcid: '' });
    assert.equal(r.status, 200, 'vacío lo borra');
  });
});
