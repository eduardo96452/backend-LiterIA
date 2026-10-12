// legacy/routes.js
// Rutas /api/* que usaba el frontend antes de /api/v1. Se conservan tal cual (mismos paths, cuerpos y
// respuestas) para que el frontend anterior siga funcionando mientras se publica el nuevo.
// Desde la v3.5.0 el frontend nuevo solo usa /api/health y /api/contact (legacy/publicas.js): con
// LEGACY_API=off en el .env solo quedan esas dos y todo lo demás responde 404.
// Cambios de la fase 1: límites por usuario en lugar de por IP (core/rateLimit.js) y
// validación del :id de las rutas de administración.
const express = require('express');
const { z } = require('zod');
const limites = require('../core/rateLimit');
const { auth, requireAdmin, requireUserToken } = require('../core/auth');
const { validate } = require('../core/validate');
const { asyncHandler } = require('../core/asyncHandler');
const S = require('./schemas');

const { generateObjective } = require('./controllers/objectivesController');
const { generateMethodologyStructure } = require('./controllers/methodologyController');
const { generateResearchQuestions } = require('./controllers/researchQuestionsController');
const { generateKeywords } = require('./controllers/keywordsController');
const { generateSearchString } = require('./controllers/searchStringController');
const { generateCriteria } = require('./controllers/criteriaController');
const { generateQualityQuestions } = require('./controllers/qualityQuestionsController');
const { generateDataExtractionQuestions } = require('./controllers/dataExtractionController');
const { generateExtractionSuggestions } = require('./controllers/suggestionsController');
const { generateIntroduction } = require('./controllers/introductionController');
const { generateIntroductionKeywords } = require('./controllers/introductionKeywordsController');
const { generateTrabajosRelacionados } = require('./controllers/trabajosRelacionadosController');
const { generatetrabaRelaKeywords } = require('./controllers/trabaRelaKeywordsController');
const { generateResultados } = require('./controllers/resultadosController');
const { generateDiscussion } = require('./controllers/discussionController');
const { discussionKeywordsController } = require('./controllers/discussionKeywordsController');
const { generateLimitaciones } = require('./controllers/limitacionesController');
const { generateConclusion } = require('./controllers/conclusionController');
const { generateResumen } = require('./controllers/resumenController');
const { generateMetodologia } = require('./controllers/metodologiaController');
// v3
const adminCtl = require('./controllers/adminController');
const importacionCtl = require('./controllers/importacionController');
const cribadoCtl = require('./controllers/cribadoController');
const referenciasCtl = require('./controllers/referenciasController');
const colaboradoresCtl = require('./controllers/colaboradoresController');
const cuentaCtl = require('./controllers/cuentaController');
const semanticaCtl = require('./controllers/semanticaController');

const router = express.Router();

// El límite por IP se aplica antes, en app.js, a todo /api.

// Públicas: /health (monitoreo) y /contact (formulario sin sesión, límite estricto)
router.use(require('./publicas'));

// Todo lo que sigue requiere autenticación (JWT de Supabase por defecto; ver AUTH_MODE)
router.use(auth);
router.use(limites.usuario);

const post = (paths, ...handlers) => [].concat(paths).forEach(p => router.post(p, ...handlers));

post(['/generate-objetive', '/generate-objective'],          validate(S.objective),            asyncHandler(generateObjective));
post('/methodology-structure',                               validate(S.methodologyStructure), asyncHandler(generateMethodologyStructure));
post('/research-questions',                                  validate(S.researchQuestions),    asyncHandler(generateResearchQuestions));
post('/generate-keywords',                                   validate(S.keywords),             asyncHandler(generateKeywords));
post('/generate-search-string',                              validate(S.searchString),         asyncHandler(generateSearchString));
post('/generate-criteria',                                   validate(S.criteria),             asyncHandler(generateCriteria));
post('/generate-quality-questions',                          validate(S.qualityQuestions),     asyncHandler(generateQualityQuestions));
post('/generate-data-extraction-questions',                  validate(S.dataExtraction),       asyncHandler(generateDataExtractionQuestions));
post('/generate-extraction-suggestions',    limites.costoso, validate(S.suggestions),          asyncHandler(generateExtractionSuggestions));
post('/generate-introduction',              limites.costoso, validate(S.introduction),         asyncHandler(generateIntroduction));
post('/generate-introduction-keywords',                      validate(S.introductionKeywords), asyncHandler(generateIntroductionKeywords));
post('/generate-trabajos-relacionados',     limites.costoso, validate(S.trabajosRelacionados), asyncHandler(generateTrabajosRelacionados));
post('/trabaRelaKeywords',                                   validate(S.trabaRelaKeywords),    asyncHandler(generatetrabaRelaKeywords));
post('/generate-resultados',                limites.costoso, validate(S.resultados),           asyncHandler(generateResultados));
post(['/generate-discusion', '/generate-discussion'], limites.costoso, validate(S.discussion),    asyncHandler(generateDiscussion));
post('/generate-discussion-keywords',                        validate(S.discussionKeywords),   asyncHandler(discussionKeywordsController));
post('/generate-limitaciones',                               validate(S.limitaciones),         asyncHandler(generateLimitaciones));
post('/generate-conclusion',                                 validate(S.conclusion),           asyncHandler(generateConclusion));
post('/generate-resumen',                                    validate(S.resumen),              asyncHandler(generateResumen));
post('/generate-metodologia',               limites.costoso, validate(S.metodologia),          asyncHandler(generateMetodologia));

/* ---------- v3: mejoras. Todos necesitan el JWT del usuario porque llaman RPC con RLS ---------- */
router.use(requireUserToken);

// Tanda A
post('/importar/buscar',                                     validate(S.importarBuscar),       asyncHandler(importacionCtl.buscar));
post('/importar',                           limites.costoso, validate(S.importar),             asyncHandler(importacionCtl.importar));
post('/cribado/sugerir',                    limites.costoso, validate(S.cribadoSugerir),       asyncHandler(cribadoCtl.sugerir));
// Tanda B
post('/referencias/verificar',              limites.costoso, validate(S.referenciasVerificar), asyncHandler(referenciasCtl.verificar));
router.get('/referencias/doi/:doi(*)',                                                         asyncHandler(referenciasCtl.porDoi));
// Tanda C
post('/cuenta/aviso-inicio-sesion',          limites.correo,  asyncHandler(cuentaCtl.avisoInicioSesion));
post('/cuenta/cerrar-sesion',                limites.costoso, asyncHandler(cuentaCtl.cerrarSesion));

post('/colaboradores/invitar',              limites.correo,  validate(S.invitar),              asyncHandler(colaboradoresCtl.invitar));
post('/semantica/indexar',                  limites.costoso, validate(S.semanticaIndexar),     asyncHandler(semanticaCtl.indexar));
post('/semantica/buscar',                                    validate(S.semanticaBuscar),      asyncHandler(semanticaCtl.buscar));
post('/semantica/preguntar',                limites.costoso, validate(S.semanticaPreguntar),   asyncHandler(semanticaCtl.preguntar));

/* ---------- Administración: JWT con app_metadata.rol = 'admin' ---------- */
const adminRouter = express.Router();
const idUsuario = validate(z.object({ id: S.uuid }), 'params');
adminRouter.use(requireAdmin);
adminRouter.get('/resumen',              asyncHandler(adminCtl.resumen));
adminRouter.get('/usuarios',             asyncHandler(adminCtl.usuarios));
adminRouter.get('/uso',                  asyncHandler(adminCtl.uso));
adminRouter.patch('/usuarios/:id/activo', idUsuario, validate(S.adminActivo), asyncHandler(adminCtl.setActivo));
adminRouter.post('/usuarios/:id/rol/codigo', idUsuario, limites.correo, asyncHandler(adminCtl.pedirCodigoRol));
adminRouter.patch('/usuarios/:id/rol',    idUsuario, validate(S.adminRol),    asyncHandler(adminCtl.setRol));
router.use('/admin', adminRouter);

module.exports = router;
