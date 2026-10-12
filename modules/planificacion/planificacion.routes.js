// modules/planificacion/planificacion.routes.js
// Se monta en /api/v1/revisiones/:id (mergeParams). El objetivo se guarda con PATCH /revisiones/:id.
//
//   GET    /planificacion                      todo lo de la pantalla en una petición
//   PUT    /metodologia                        framework y sus componentes {id_metodologia, componentes:[…]}
//   POST   /preguntas            PATCH, DELETE /preguntas/:p           preguntas de investigación
//   POST   /palabras-clave       PUT, DELETE /palabras-clave/:k        con su componente y sinónimos
//   GET    /bases   POST /bases  PUT, DELETE /bases/:b                 renombrar o borrar arrastra su cadena
//   GET    /cadenas              PUT, DELETE /cadenas/:fuente           «global» o el nombre de una base
//   GET    /criterios POST /criterios PATCH, DELETE /criterios/:c
//   POST   /calidad/preguntas    PATCH, DELETE /calidad/preguntas/:p
//   POST   /calidad/respuestas   PATCH, DELETE /calidad/respuestas/:r  (el peso nuevo se aplica a lo ya evaluado)
//   PUT    /calidad/umbral                     {limite}; la máxima la calcula la base
//   GET    /campos-extraccion    POST, PATCH, DELETE /campos-extraccion/:c
//   PUT    /campos-extraccion/orden            {ids:[…]} en una sola operación
//   POST   /ia/:tipo                           sugerencias de la IA (límite «ia»: 60 cada 15 min); no guarda nada
const express = require('express');
const limites = require('../../core/rateLimit');
const { validate } = require('../../core/validate');
const { asyncHandler: h } = require('../../core/asyncHandler');
const { contexto } = require('../../core/contexto');
const sb = require('../../infra/supabase');
const S = require('./planificacion.schemas');
const svc = require('./planificacion.service');
const ia = require('./ia.service');
const revisiones = require('../revisiones/revisiones.service');

const router = express.Router({ mergeParams: true });
const p = esquema => validate(esquema, 'params');
const P = req => req.valid.params;
const conId = p(S.params);
const c = req => contexto(req);
const ok = (res, valor) => res.json(valor);
const nada = res => res.status(204).end();

/* ---------- Lecturas que ya usaban Estudios y Equipo (fase 3) ---------- */

function datos({ data, error }) {
  if (error) throw sb.fromSupabaseError(error);
  return data || [];
}
/** 404 si la revisión no existe o no la ve; si la ve, sus filas (RLS decide). */
const leer = consulta => h(async (req, res) => {
  const ctx = c(req), id = P(req).id;
  const [, filas] = await Promise.all([revisiones.obtener(ctx, id), consulta(sb.forUser(ctx.token), id)]);
  res.json(datos(filas));
});

router.get('/criterios', conId, leer((cl, id) => cl.from('criterios').select('id_criterios, descripcion, tipo')
  .eq('id_detalles_revision', id).order('fecha_ingreso', { ascending: true })));

router.get('/bases', conId, leer((cl, id) => cl.from('bases_bibliograficas').select('id_base_bibliografica, nombre, url')
  .eq('id_revision', id).order('id_base_bibliografica')));

router.get('/cadenas', conId, leer((cl, id) => cl.from('cadenas_busqueda').select('id_cadenas_busqueda, fuente, cadena_busqueda')
  .eq('id_detalles_revision', id).order('id_cadenas_busqueda')));

/* ---------- Pantalla completa ---------- */

router.get('/planificacion', conId, h(async (req, res) => ok(res, await svc.obtener(c(req), P(req).id))));

/* ---------- Framework ---------- */

router.put('/metodologia', conId, validate(S.metodologia),
  h(async (req, res) => ok(res, await svc.guardarMetodologia(c(req), P(req).id, req.body))));

/* ---------- Preguntas de investigación ---------- */

router.post('/preguntas', conId, validate(S.pregunta),
  h(async (req, res) => res.status(201).json(await svc.crearPregunta(c(req), P(req).id, req.body))));
router.patch('/preguntas/:p', p(S.conPregunta), validate(S.pregunta),
  h(async (req, res) => ok(res, await svc.cambiarPregunta(c(req), P(req).id, P(req).p, req.body))));
router.delete('/preguntas/:p', p(S.conPregunta),
  h(async (req, res) => { await svc.borrarPregunta(c(req), P(req).id, P(req).p); nada(res); }));

/* ---------- Palabras clave ---------- */

router.post('/palabras-clave', conId, validate(S.palabra),
  h(async (req, res) => res.status(201).json(await svc.guardarPalabra(c(req), P(req).id, null, req.body))));
router.put('/palabras-clave/:k', p(S.conPalabra), validate(S.palabra),
  h(async (req, res) => ok(res, await svc.guardarPalabra(c(req), P(req).id, P(req).k, req.body))));
router.delete('/palabras-clave/:k', p(S.conPalabra),
  h(async (req, res) => { await svc.borrarPalabra(c(req), P(req).id, P(req).k); nada(res); }));

/* ---------- Bases y cadenas ---------- */

router.post('/bases', conId, validate(S.base),
  h(async (req, res) => res.status(201).json(await svc.guardarBase(c(req), P(req).id, null, req.body))));
router.put('/bases/:b', p(S.conBase), validate(S.base),
  h(async (req, res) => ok(res, await svc.guardarBase(c(req), P(req).id, P(req).b, req.body))));
router.delete('/bases/:b', p(S.conBase),
  h(async (req, res) => ok(res, await svc.borrarBase(c(req), P(req).id, P(req).b))));

router.put('/cadenas/:fuente', p(S.conFuente), validate(S.cadena),
  h(async (req, res) => ok(res, await svc.guardarCadena(c(req), P(req).id, P(req).fuente, req.body))));
router.delete('/cadenas/:fuente', p(S.conFuente),
  h(async (req, res) => { await svc.borrarCadena(c(req), P(req).id, P(req).fuente); nada(res); }));

/* ---------- Criterios ---------- */

router.post('/criterios', conId, validate(S.criterio),
  h(async (req, res) => res.status(201).json(await svc.crearCriterio(c(req), P(req).id, req.body))));
router.patch('/criterios/:c', p(S.conCriterio), validate(S.criterioCambio),
  h(async (req, res) => ok(res, await svc.cambiarCriterio(c(req), P(req).id, P(req).c, req.body))));
router.delete('/criterios/:c', p(S.conCriterio),
  h(async (req, res) => { await svc.borrarCriterio(c(req), P(req).id, P(req).c); nada(res); }));

/* ---------- Instrumento de calidad ---------- */

router.post('/calidad/preguntas', conId, validate(S.preguntaCalidad),
  h(async (req, res) => res.status(201).json(await svc.crearPreguntaCalidad(c(req), P(req).id, req.body))));
router.patch('/calidad/preguntas/:p', p(S.conPregunta), validate(S.preguntaCalidad),
  h(async (req, res) => ok(res, await svc.cambiarPreguntaCalidad(c(req), P(req).id, P(req).p, req.body))));
router.delete('/calidad/preguntas/:p', p(S.conPregunta),
  h(async (req, res) => { await svc.borrarPreguntaCalidad(c(req), P(req).id, P(req).p); nada(res); }));

router.post('/calidad/respuestas', conId, validate(S.respuesta),
  h(async (req, res) => res.status(201).json(await svc.crearRespuesta(c(req), P(req).id, req.body))));
router.patch('/calidad/respuestas/:r', p(S.conRespuesta), validate(S.respuestaCambio),
  h(async (req, res) => ok(res, await svc.cambiarRespuesta(c(req), P(req).id, P(req).r, req.body))));
router.delete('/calidad/respuestas/:r', p(S.conRespuesta),
  h(async (req, res) => { await svc.borrarRespuesta(c(req), P(req).id, P(req).r); nada(res); }));

router.put('/calidad/umbral', conId, validate(S.umbral),
  h(async (req, res) => ok(res, await svc.guardarUmbral(c(req), P(req).id, req.body))));

/* ---------- Campos de extracción ---------- */

router.get('/campos-extraccion', conId, h(async (req, res) => ok(res, await svc.listarCampos(c(req), P(req).id))));
router.put('/campos-extraccion/orden', conId, validate(S.orden),
  h(async (req, res) => ok(res, await svc.ordenarCampos(c(req), P(req).id, req.body.ids))));
router.post('/campos-extraccion', conId, validate(S.campo),
  h(async (req, res) => res.status(201).json(await svc.crearCampo(c(req), P(req).id, req.body))));
router.patch('/campos-extraccion/:c', p(S.conCampo), validate(S.campoCambio),
  h(async (req, res) => ok(res, await svc.cambiarCampo(c(req), P(req).id, P(req).c, req.body))));
router.delete('/campos-extraccion/:c', p(S.conCampo),
  h(async (req, res) => { await svc.borrarCampo(c(req), P(req).id, P(req).c); nada(res); }));

/* ---------- Sugerencias de la IA ---------- */

/** El cuerpo se valida con el esquema del tipo (tras validar el tipo en la URL). */
const cuerpoIa = (req, res, next) => validate(S.ia[req.valid.params.tipo])(req, res, next);

router.post('/ia/:tipo', p(S.conTipoIa), cuerpoIa, limites.ia,
  h(async (req, res) => ok(res, await ia.sugerir(c(req), P(req).id, P(req).tipo, req.body))));

module.exports = router;
