// modules/informes/informes.routes.js
// Se monta en /api/v1/revisiones/:id (mergeParams).
//
//   GET    /secciones                                   texto guardado de las 8 secciones + valoraciones
//   PATCH  /secciones/:seccion            {contenido, id_generacion?}  guarda SOLO esa sección y deja versión
//   PUT    /secciones/:seccion/valoracion {valor: 1|0}
//   POST   /secciones/:seccion/generar    {paso?, keywords?, palabras?}  IA con el contexto leído de la base
//   GET    /secciones/:seccion/versiones                historial
//   POST   /secciones/:seccion/versiones/:version/restaurar
//   GET    /prisma                                      estudios y criterios de exclusión para el diagrama
//   GET    /informes                                    Word generados
//   POST   /informes                      (cuerpo: el .docx)  sube y registra (201)
//   GET    /informes/:idInforme/archivo                 descarga
//   DELETE /informes/:idInforme                         borra registro y archivo (204)
const express = require('express');
const limites = require('../../core/rateLimit');
const { validate } = require('../../core/validate');
const { asyncHandler: h } = require('../../core/asyncHandler');
const { contexto } = require('../../core/contexto');
const S = require('./informes.schemas');
const svc = require('./informes.service');
const { generar } = require('./generacion');

const router = express.Router({ mergeParams: true });
const p = esquema => validate(esquema, 'params');
const P = req => req.valid.params;

/* ---------- Secciones ---------- */

router.get('/secciones', p(S.params),
  h(async (req, res) => res.json(await svc.secciones(contexto(req), P(req).id))));

router.patch('/secciones/:seccion', p(S.paramsSeccion), validate(S.guardar),
  h(async (req, res) => res.json(await svc.guardar(contexto(req), P(req).id, P(req).seccion, req.body))));

router.put('/secciones/:seccion/valoracion', p(S.paramsSeccion), validate(S.valoracion),
  h(async (req, res) => res.json(await svc.valorar(contexto(req), P(req).id, P(req).seccion, req.body.valor))));

// Las palabras clave son baratas; el texto de una sección es lo que cuesta.
const limiteIA = (req, res, next) => (req.body?.paso === 'keywords' ? next() : limites.costoso(req, res, next));
router.post('/secciones/:seccion/generar', p(S.paramsSeccion), validate(S.generar), limiteIA,
  h(async (req, res) => res.json(await generar(contexto(req), P(req).id, P(req).seccion, req.body))));

router.get('/secciones/:seccion/versiones', p(S.paramsSeccion),
  h(async (req, res) => res.json(await svc.historial(contexto(req), P(req).id, P(req).seccion))));

router.post('/secciones/:seccion/versiones/:version/restaurar', p(S.paramsVersion),
  h(async (req, res) => res.json(await svc.restaurar(contexto(req), P(req).id, P(req).seccion, P(req).version))));

/* ---------- PRISMA ---------- */

router.get('/prisma', p(S.params),
  h(async (req, res) => res.json(await svc.prisma(contexto(req), P(req).id))));

/* ---------- Informes Word ---------- */

router.get('/informes', p(S.params),
  h(async (req, res) => res.json(await svc.listarInformes(contexto(req), P(req).id))));

// El .docx llega como cuerpo binario (no JSON): es pequeño y así el navegador no toca Storage.
router.post('/informes', p(S.params), express.raw({ type: svc.DOCX, limit: svc.MAX_DOCX }),
  h(async (req, res) => res.status(201).json(await svc.subirInforme(contexto(req), P(req).id, req.body))));

router.get('/informes/:idInforme/archivo', p(S.paramsInforme),
  h(async (req, res) => {
    const { nombre, contenido, tipo } = await svc.descargarInforme(contexto(req), P(req).id, P(req).idInforme);
    res.set({
      'Content-Type': tipo,
      'Content-Length': contenido.length,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      'Cache-Control': 'private, no-store'
    });
    res.end(contenido);
  }));

router.delete('/informes/:idInforme', p(S.paramsInforme),
  h(async (req, res) => { await svc.borrarInforme(contexto(req), P(req).id, P(req).idInforme); res.status(204).end(); }));

module.exports = router;
