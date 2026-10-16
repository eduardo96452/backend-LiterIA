// test/correos.test.js — Correos en HTML (plantilla común): contenido, escape de lo que llega de
// fuera, texto plano alternativo, logo incrustado e IP/fecha legibles. Sin red: nodemailer simulado.
const { test, describe, beforeEach } = require('node:test');
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
const { ipLegible, fechaLegible } = require('../modules/cuenta/cuenta.service');

describe('plantilla de correo', () => {
  test('escapa lo que llega de fuera y genera también texto plano', () => {
    const { html, text } = correo({
      asunto: 'A', resumen: 'R', titulo: 'Título <b>', saludo: 'Hola, <img src=x>:',
      parrafos: ['Uno\nDos'], destacado: '"<script>alert(1)</script>"', detalles: [['Rol', 'lector & más']],
      boton: { texto: 'Abrir', url: 'https://app.ejemplo/x?a=1&b="2"' }
    });
    assert.doesNotMatch(html, /<script>|<img src=x>|<b>/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /lector &amp; más/);
    assert.match(html, /Uno<br>Dos/);
    assert.match(html, /href="https:\/\/app\.ejemplo\/x\?a=1&amp;b=&quot;2&quot;"/);
    assert.match(html, /src="cid:logo@literia"/);
    assert.match(text, /Abrir: https:\/\/app\.ejemplo\/x\?a=1&b="2"/);
    assert.match(text, /Rol: lector & más/);
  });
});

describe('correos enviados', () => {
  beforeEach(() => { enviados.length = 0; env.mailEnabled = true; });

  test('invitación: nombre de quien invita, rol explicado, botón y logo adjunto', async () => {
    await email.sendInvitationMail({
      to: 'ana@x.com', invitadoPor: 'luis@uni.edu', nombreInvitador: 'Luis Mora', rol: 'revisor',
      tituloRevision: 'IA <en> educación', enlace: 'https://rslaia1.web.app/invitacion?token=t1'
    });
    const m = enviados[0];
    assert.equal(m.to, 'ana@x.com');
    assert.match(m.subject, /^Luis Mora te invitó a la revisión "IA <en> educación"$/);
    assert.match(m.html, /Luis Mora \(luis@uni\.edu\)/);
    assert.match(m.html, /IA &lt;en&gt; educación/);
    assert.match(m.html, /revisor \(puede editar la revisión\)/);
    assert.match(m.html, /href="https:\/\/rslaia1\.web\.app\/invitacion\?token=t1"/);
    assert.match(m.text, /Aceptar la invitación: https:\/\/rslaia1\.web\.app\/invitacion\?token=t1/);
    assert.equal(m.attachments[0].cid, 'logo@literia');
    assert.ok(require('fs').existsSync(m.attachments[0].path), 'el logo existe en assets/correo');
  });

  test('inicio de sesión: saludo con nombre, detalles y enlace a sesiones activas', async () => {
    await email.sendNewSessionMail({
      to: 'ana@x.com', nombre: 'Ana', dispositivo: 'Chrome en Windows', ip: ipLegible('::1'),
      fecha: 'lunes', enlaceSesiones: 'https://rslaia1.web.app/sesiones-activas'
    });
    const m = enviados[0];
    assert.match(m.html, /Hola, Ana:/);
    assert.match(m.html, /Este mismo equipo \(conexión local\)/);
    assert.match(m.html, /Revisar sesiones activas/);
    assert.match(m.text, /Dirección IP: Este mismo equipo/);
  });

  test('contacto: responde a quien escribe y el mensaje no se interpreta como HTML', async () => {
    await email.sendContactMail({ name: 'Eva\r\nBcc: x@y.z', email: 'eva@x.com', message: 'Hola <a href=x>clic</a>\nGracias' });
    const m = enviados[0];
    assert.equal(m.replyTo, 'eva@x.com');
    assert.doesNotMatch(m.subject, /[\r\n]/);
    assert.match(m.html, /Hola &lt;a href=x&gt;clic&lt;\/a&gt;<br>Gracias/);
  });

  test('código de administrador: el código destacado y su caducidad', async () => {
    await email.sendAdminCodeMail({ to: 'admin@x.com', codigo: '482913', destinatario: 'eva@x.com', minutos: 10 });
    const m = enviados[0];
    assert.equal(m.subject, 'Código de confirmación: 482913');
    assert.match(m.html, /482913/);
    assert.match(m.html, /caduca en 10 minutos/);
  });
});

describe('IP y fecha del aviso de sesión', () => {
  test('IP sin prefijo IPv4-en-IPv6 y la local dicha con palabras', () => {
    assert.equal(ipLegible('::ffff:190.12.3.4'), '190.12.3.4');
    assert.equal(ipLegible('127.0.0.1'), 'Este mismo equipo (conexión local)');
    assert.equal(ipLegible(''), 'No disponible');
    assert.equal(ipLegible('2800:bf0::1'), '2800:bf0::1');
  });

  test('fecha en español con la zona horaria indicada', () => {
    const f = fechaLegible(new Date('2026-10-12T20:20:00Z'));
    assert.match(f, /12 de octubre de 2026/);
    assert.match(f, /3:20/);
    assert.match(f, /\(hora de Ecuador\)$/);
  });
});
