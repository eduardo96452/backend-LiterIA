// modules/referencias/referencias.routes.js
//   GET /api/v1/referencias/doi/:doi   metadatos de un DOI en CrossRef (para completar un estudio a mano)
// Sustituye a la llamada directa del navegador a CrossRef (DoiApiService).
const express = require('express');
const { asyncHandler: h } = require('../../core/asyncHandler');
const { HttpError } = require('../../core/httpError');
const { consultarDoi } = require('../../infra/academicas');
const { limpiarDoi } = require('../estudios/campos');

const router = express.Router();

const sinEtiquetas = t => String(t || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

router.get('/doi/:doi(*)', h(async (req, res) => {
  const doi = limpiarDoi(req.params.doi);
  if (!doi || doi.length > 300 || !/^10\.\d{4,9}\/\S+$/.test(doi)) {
    throw new HttpError(400, 'El DOI no tiene un formato válido (ej. 10.1109/ISPSD.2013.6694422).');
  }
  const item = await consultarDoi(doi);
  if (!item) throw new HttpError(404, 'DOI no encontrado en CrossRef.');
  res.json({
    doi: item.DOI,
    titulo: item.title?.[0] ?? null,
    autores: (item.author || []).map(a => ({ apellido: a.family || a.name || '', nombre: a.given || '' })),
    anio: item.issued?.['date-parts']?.[0]?.[0] ?? item.created?.['date-parts']?.[0]?.[0] ?? null,
    revista: item['container-title']?.[0] || null,
    volumen: item.volume || null,
    numero: item.issue || null,
    paginas: item.page || null,
    editorial: item.publisher || null,
    issn: item.ISSN?.[0] || null,
    tipo: item.type || null,
    url: item.URL || null,
    idioma: item.language || null,
    resumen: item.abstract ? sinEtiquetas(item.abstract).slice(0, 20000) : null
  });
}));

module.exports = router;
