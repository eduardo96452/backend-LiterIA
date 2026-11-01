// test/marca.test.js — El nombre de la aplicación en los correos sale de APP_NOMBRE (por defecto,
// LiterIA), para poder cambiarlo sin tocar el código.
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');                                        // NODE_ENV=test y variables de prueba

const enviados = [];
require.cache[require.resolve('nodemailer')] = {
  id: 'nodemailer-falso', filename: 'nodemailer-falso', loaded: true,
  exports: { createTransport: () => ({ sendMail: async m => { enviados.push(m); } }) }
};

const env = require('../config/env');
const email = require('../infra/email');
const { correo } = require('../infra/correo-plantillas');

describe('nombre de la aplicación (APP_NOMBRE)', () => {
  const original = env.APP_NOMBRE;
  const correoAntes = env.mailEnabled;
  after(() => { env.APP_NOMBRE = original; env.mailEnabled = correoAntes; });

  test('por defecto es LiterIA', () => {
    assert.equal(original, process.env.APP_NOMBRE || 'LiterIA');
  });

  test('cabecera, pie y texto plano usan el nombre configurado (y lo escapan)', () => {
    env.APP_NOMBRE = 'Criba & Co';
    const { html, text } = correo({ asunto: 'A', resumen: 'R', titulo: 'T', parrafos: ['p'] });
    assert.match(html, /Criba &amp; Co<\/td>/);
    assert.match(html, /Criba &amp; Co · Revisiones sistemáticas/);
    assert.match(text, /Criba & Co · Revisiones sistemáticas/);
    assert.doesNotMatch(html + text, /LiterIA/);
  });

  test('el remitente y el asunto de un aviso también', async () => {
    env.APP_NOMBRE = 'Criba';
    env.mailEnabled = true;                                  // como en correos.test.js: nodemailer es falso
    enviados.length = 0;
    await email.sendNewSessionMail({ to: 'eva@uteq.edu.ec', nombre: 'Eva', dispositivo: 'Firefox', ip: '1.2.3.4', fecha: new Date(), enlaceSesiones: 'https://x/sesiones-activas' });
    assert.equal(enviados.length, 1);
    assert.match(enviados[0].from, /^"Criba" </);
    assert.equal(enviados[0].subject, 'Nuevo inicio de sesión en tu cuenta de Criba');
  });
});
