// services/pdfService.js  (antes dentro de suggestionsController)
const axios = require('axios');
const pdfParse = require('pdf-parse');
const env = require('../config/env');
const { assertSafeUrl } = require('../utils/safeUrl');
const { HttpError } = require('../utils/httpError');

/** Descarga un PDF de forma segura: URL validada (anti-SSRF), sin redirecciones, tamaño y tiempo acotados. */
async function downloadPdf(rawUrl) {
  const url = await assertSafeUrl(rawUrl);
  let resp;
  try {
    resp = await axios.get(url.href, {
      responseType: 'arraybuffer', timeout: 20_000, maxRedirects: 0,
      maxContentLength: env.PDF_MAX_BYTES, maxBodyLength: env.PDF_MAX_BYTES,
      headers: { Accept: 'application/pdf', 'User-Agent': 'LiteriaBackend/3.0' },
      validateStatus: s => s === 200
    });
  } catch (err) {
    if (err.code === 'ERR_FR_MAX_BODY_LENGTH_EXCEEDED' || /maxContentLength/i.test(err.message)) throw new HttpError(413, 'El PDF supera el tamaño máximo permitido.');
    if (err.response && [301, 302, 303, 307, 308].includes(err.response.status)) throw new HttpError(400, 'La URL redirige; proporcione el enlace directo al PDF.');
    throw new HttpError(400, 'No se pudo descargar el PDF desde la URL indicada.');
  }
  const buf = Buffer.from(resp.data);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'El recurso descargado no es un PDF.');
  return buf;
}

/** Texto completo (acotado) y por páginas. */
async function extractText(buf, { maxPages = 60, maxChars = 120_000 } = {}) {
  const pages = [];
  let parsed;
  try {
    parsed = await pdfParse(buf, {
      max: maxPages,
      pagerender: pageData => pageData.getTextContent().then(tc => {
        const text = tc.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
        pages.push(text);
        return text;
      })
    });
  } catch { throw new HttpError(422, 'No se pudo leer el contenido del PDF.'); }
  const fullText = (parsed.text || '').slice(0, maxChars);
  if (!fullText.trim()) throw new HttpError(422, 'El PDF no contiene texto extraíble.');
  return { fullText, pages };
}

/** Trocea el texto por páginas en fragmentos de ~size caracteres con solapamiento. */
function chunkPages(pages, { size = 1500, overlap = 200 } = {}) {
  const chunks = [];
  let orden = 0;
  pages.forEach((text, i) => {
    if (!text) return;
    for (let start = 0; start < text.length; start += size - overlap) {
      const slice = text.slice(start, start + size).trim();
      if (slice.length < 80) continue;
      chunks.push({ orden: ++orden, pagina: i + 1, texto: slice });
      if (start + size >= text.length) break;
    }
  });
  return chunks;
}

module.exports = { downloadPdf, extractText, chunkPages };
