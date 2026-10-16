// infra/correo-plantillas.js
// Plantilla común de los correos de LiterIA: HTML con tablas y estilos en línea (lo único que
// respetan Gmail, Outlook y los clientes móviles) y su versión en texto plano. Todo lo que llega
// de fuera (nombres, títulos, mensajes) se escapa aquí.
const path = require('path');

/** Logo incrustado en el propio correo (no depende de que el cliente cargue imágenes remotas). */
const LOGO = { filename: 'literia.png', path: path.join(__dirname, '..', 'assets', 'correo', 'literia.png'), cid: 'logo@literia' };

const C = {
  fondo: '#EEF3F8',
  tarjeta: '#FFFFFF',
  tinta: '#1B2F4B',
  texto: '#33465E',
  suave: '#5A6B7F',
  borde: '#D9E2EC',
  acento: '#2F6DB5',
  aviso: '#FFF6E5',
  avisoBorde: '#F2C66D'
};
const FUENTE = "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const escapar = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Texto con saltos de línea → párrafo HTML con <br>. */
const conSaltos = s => escapar(s).replace(/\r?\n/g, '<br>');

/**
 * @param {object} o
 * @param {string} o.asunto            asunto (también el <title>)
 * @param {string} o.resumen           línea que muestran los clientes junto al asunto (preheader)
 * @param {string} o.titulo
 * @param {string} [o.saludo]          «Hola, Ana:»
 * @param {string[]} [o.parrafos]      texto plano (se escapa)
 * @param {string} [o.destacado]       bloque resaltado (título de la revisión, código…)
 * @param {boolean} [o.codigo]         el destacado es un código: letra grande y espaciada
 * @param {[string, string][]} [o.detalles]  filas etiqueta/valor
 * @param {{ texto: string, url: string }} [o.boton]
 * @param {string} [o.aviso]           recuadro de aviso (seguridad, caducidad)
 * @param {string} [o.pie]             por qué recibe el correo
 * @param {string} [o.logo]            dirección del logo (por defecto, el incrustado en el correo)
 * @returns {{ html: string, text: string }}
 */
function correo(o) {
  const parrafos = (o.parrafos ?? []).map(p =>
    `<p style="margin:0 0 14px;font:15px/1.6 ${FUENTE};color:${C.texto};">${conSaltos(p)}</p>`).join('');

  const destacado = o.destacado ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;">
      <tr><td style="padding:14px 18px;background:${C.fondo};border-left:4px solid ${C.acento};border-radius:6px;
        font:${o.codigo ? `700 28px/1.2 ${FUENTE};letter-spacing:6px;text-align:center` : `600 16px/1.5 ${FUENTE}`};color:${C.tinta};">
        ${conSaltos(o.destacado)}
      </td></tr>
    </table>` : '';

  const detalles = o.detalles?.length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border:1px solid ${C.borde};border-radius:6px;border-collapse:separate;">
      ${o.detalles.map(([k, v], i) => `
      <tr>
        <td style="padding:10px 14px;${i ? `border-top:1px solid ${C.borde};` : ''}font:13px/1.4 ${FUENTE};color:${C.suave};width:38%;vertical-align:top;">${escapar(k)}</td>
        <td style="padding:10px 14px;${i ? `border-top:1px solid ${C.borde};` : ''}font:600 14px/1.4 ${FUENTE};color:${C.tinta};vertical-align:top;">${conSaltos(v)}</td>
      </tr>`).join('')}
    </table>` : '';

  const boton = o.boton ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;">
      <tr><td style="border-radius:6px;background:${C.acento};">
        <a href="${escapar(o.boton.url)}" target="_blank"
           style="display:inline-block;padding:12px 24px;font:600 15px/1.2 ${FUENTE};color:#FFFFFF;text-decoration:none;border-radius:6px;">
          ${escapar(o.boton.texto)}
        </a>
      </td></tr>
    </table>
    <p style="margin:0 0 18px;font:12px/1.5 ${FUENTE};color:${C.suave};">
      Si el botón no funciona, copia este enlace en el navegador:<br>
      <a href="${escapar(o.boton.url)}" style="color:${C.acento};word-break:break-all;">${escapar(o.boton.url)}</a>
    </p>` : '';

  const aviso = o.aviso ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 8px;">
      <tr><td style="padding:12px 16px;background:${C.aviso};border:1px solid ${C.avisoBorde};border-radius:6px;font:13px/1.55 ${FUENTE};color:${C.texto};">
        ${conSaltos(o.aviso)}
      </td></tr>
    </table>` : '';

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapar(o.asunto)}</title>
</head>
<body style="margin:0;padding:0;background:${C.fondo};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapar(o.resumen)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.fondo};">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
      <tr><td style="padding:0 4px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;"><img src="${o.logo ?? `cid:${LOGO.cid}`}" width="40" height="40" alt="" style="display:block;border-radius:8px;"></td>
          <td style="vertical-align:middle;padding-left:10px;font:700 19px/1 ${FUENTE};color:${C.tinta};">LiterIA</td>
        </tr></table>
      </td></tr>
      <tr><td style="background:${C.tarjeta};border:1px solid ${C.borde};border-radius:10px;padding:28px 28px 20px;">
        <h1 style="margin:0 0 16px;font:700 21px/1.3 ${FUENTE};color:${C.tinta};">${escapar(o.titulo)}</h1>
        ${o.saludo ? `<p style="margin:0 0 14px;font:15px/1.6 ${FUENTE};color:${C.texto};">${escapar(o.saludo)}</p>` : ''}
        ${parrafos}${destacado}${detalles}${boton}${aviso}
      </td></tr>
      <tr><td style="padding:16px 8px 0;font:12px/1.55 ${FUENTE};color:${C.suave};text-align:center;">
        ${o.pie ? `${escapar(o.pie)}<br>` : ''}LiterIA · Revisiones sistemáticas de la literatura asistidas por IA
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    o.titulo, '',
    o.saludo,
    ...(o.parrafos ?? []),
    o.destacado,
    ...(o.detalles ?? []).map(([k, v]) => `${k}: ${v}`),
    o.boton ? `${o.boton.texto}: ${o.boton.url}` : null,
    o.aviso,
    '',
    '—',
    o.pie,
    'LiterIA · Revisiones sistemáticas de la literatura asistidas por IA'
  ].filter(l => l !== undefined && l !== null).join('\n').replace(/\n{3,}/g, '\n\n');

  return { html, text };
}

module.exports = { correo, escapar, LOGO };
