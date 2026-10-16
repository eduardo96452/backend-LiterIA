// modules/informes/informes.routes.js
// Se monta en /api/v1/revisiones/:id (mergeParams).
//
//   GET    /secciones                                   texto guardado de las 8 secciones + valoraciones
//   PATCH  /secciones/:seccion            {contenido, id_generacion?}  guarda SOLO esa sección y deja versión
//   PUT    /secciones/:seccion/valoracion {valor: 1|0}
//   POST   /secciones/:seccion/generar    {paso?, keywords?, palabras?, indicaciones?}  IA con el contexto leído de la base
//   GET    /secciones/:seccion/versiones                historial
//   POST   /secciones/:seccion/versiones/:version/restaurar
//   GET    /prisma                                      estudios y criterios de exclusión para el diagrama
//   GET    /referencias                                 registro de referencias con el formato de la plantilla
//   POST   /referencias                   {doi}         añade una referencia desde CrossRef (201)
//   DELETE /referencias/:idRef                          quita una referencia (no las de estudios incluidos) (204)
//   PUT    /redaccion/idioma              {idioma}      idioma del artículo: es | en
//   GET    /redaccion/plantilla                         plantilla Word de la revista (o null) (sql/011)
//   PUT    /redaccion/plantilla?nombre=…  (cuerpo: el .docx)  sube o sustituye la plantilla
//   PATCH  /redaccion/plantilla           {mapeo?, usar?}  estilos de la plantilla por parte del artículo
//   GET    /redaccion/plantilla/archivo                 descarga la plantilla
//   DELETE /redaccion/plantilla                         quita la plantilla (204)
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
const refs = require('./referencias/referencias.service');
const plantilla = require('./plantilla');

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

/* ---------- Referencias e idioma del artículo ---------- */

router.get('/referencias', p(S.params),
  h(async (req, res) => res.json(await refs.listar(contexto(req), P(req).id))));

router.post('/referencias', p(S.params), validate(S.nuevaReferencia),
  h(async (req, res) => res.status(201).json(await refs.agregarPorDoi(contexto(req), P(req).id, req.body.doi))));

router.delete('/referencias/:idRef', p(S.paramsReferencia),
  h(async (req, res) => { await refs.borrar(contexto(req), P(req).id, P(req).idRef); res.status(204).end(); }));

router.put('/redaccion/idioma', p(S.params), validate(S.idioma),
  h(async (req, res) => res.json(await refs.cambiarIdioma(contexto(req), P(req).id, req.body.idioma))));

/* ---------- Plantilla Word de la revista ---------- */

router.get('/redaccion/plantilla', p(S.params),
  h(async (req, res) => res.json(await plantilla.obtener(contexto(req), P(req).id))));

router.put('/redaccion/plantilla', p(S.params), validate(S.nombrePlantilla, 'query'),
  express.raw({ type: svc.DOCX, limit: svc.MAX_DOCX }),
  h(async (req, res) => res.json(await plantilla.subir(contexto(req), P(req).id, req.body, req.valid.query?.nombre))));

router.patch('/redaccion/plantilla', p(S.params), validate(S.plantilla),
  h(async (req, res) => res.json(await plantilla.actualizar(contexto(req), P(req).id, req.body))));

router.get('/redaccion/plantilla/archivo', p(S.params),
  h(async (req, res) => {
    const { nombre, contenido, tipo } = await plantilla.descargar(contexto(req), P(req).id);
    res.set({
      'Content-Type': tipo,
      'Content-Length': contenido.length,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      'Cache-Control': 'private, no-store'
    });
    res.end(contenido);
  }));

router.delete('/redaccion/plantilla', p(S.params),
  h(async (req, res) => { await plantilla.borrar(contexto(req), P(req).id); res.status(204).end(); }));

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
