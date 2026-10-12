// test/helpers.js
// Entorno de pruebas aislado: NUNCA toca Supabase, OpenAI ni Gmail reales.
//  - NODE_ENV=test → config/env.js no lee el .env (las claves reales no se cargan).
//  - SUPABASE_URL apunta a un puerto cerrado: la descarga de JWKS falla al instante y el
//    backend verifica con el secreto HS256 de pruebas (la misma ruta de código que en proyectos antiguos).
//  - El cliente de Supabase se sustituye por uno simulado que responde lo que diga cada prueba.
const crypto = require('crypto');

const SECRETO_JWT = 'secreto-de-pruebas-hs256-0123456789abcdef';
const SUPABASE_URL = 'http://127.0.0.1:9';
const ORIGEN = 'http://localhost:4200';

for (const k of ['GMAIL_USER', 'GMAIL_PASS', 'CONTACT_TO', 'SUPABASE_SERVICE_ROLE_KEY', 'API_KEY', 'DOTENV_CONFIG_PATH']) delete process.env[k];
Object.assign(process.env, {
  NODE_ENV: 'test',
  OPENAI_API_KEY: 'sk-test-no-es-una-clave-real-000000',
  SUPABASE_URL,
  SUPABASE_ANON_KEY: 'anon-test-no-es-una-clave-real-000',
  SUPABASE_JWT_SECRET: SECRETO_JWT,
  AUTH_MODE: 'jwt',
  ALLOWED_ORIGINS: ORIGEN,
  RATE_LIMIT_IP_MAX: '1000',
  RATE_LIMIT_USER_MAX: '40'
});

const { SignJWT } = require('jose');

const nuevoId = () => crypto.randomUUID();

/** JWT como los de Supabase. `caducado: true` → expirado hace un minuto. */
async function token({ sub = nuevoId(), email = 'persona@uteq.edu.ec', rol, caducado = false, secreto = SECRETO_JWT } = {}) {
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT({ email, role: 'authenticated', app_metadata: rol ? { rol } : {} })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt(ahora - 120)
    .setExpirationTime(caducado ? ahora - 60 : ahora + 3600)
    .sign(new TextEncoder().encode(secreto));
}

/**
 * Cliente de Supabase simulado. Cada consulta encadenada (from().select().eq()…) se graba como
 * una lista de pasos [[metodo, args], …] y, al hacer await, se entrega a `responder(pasos)`,
 * que devuelve { data, error } como haría supabase-js.
 */
function clienteFalso(responder) {
  const consultas = [];
  const cadena = pasos => new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') {
        consultas.push(pasos);
        const r = Promise.resolve().then(() => responder(pasos));
        return r.then.bind(r);
      }
      return (...args) => cadena([...pasos, [prop, args]]);
    }
  });
  return {
    consultas,
    from: tabla => cadena([['from', [tabla]]]),
    rpc: (fn, params) => cadena([['rpc', [fn, params]]]),
    get storage() { return cadena([['storage', []]]); }
  };
}

/** Busca un paso por nombre: paso(pasos, 'eq') → ['eq', ['col', valor]] */
const paso = (pasos, nombre) => pasos.find(p => p[0] === nombre);
const tabla = pasos => paso(pasos, 'from')?.[1][0];
const esRpc = (pasos, fn) => pasos[0][0] === 'rpc' && pasos[0][1][0] === fn;

module.exports = { token, nuevoId, clienteFalso, paso, tabla, esRpc, ORIGEN };
