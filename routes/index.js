// routes/index.js
// Un solo router: autenticación + rate limit + validación por ruta.
// Las rutas ORIGINALES se conservan para no romper el frontend; se añaden alias con la ortografía correcta.
const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { auth, requireAdmin, requireUserToken } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const { asyncHandler } = require('../middlewares/asyncHandler');
const S = require('../schemas');

const { generateObjective } = require('../controllers/objectivesController');
const { generateMethodologyStructure } = require('../controllers/methodologyController');
const { generateResearchQuestions } = require('../controllers/researchQuestionsController');
const { generateKeywords } = require('../controllers/keywordsController');
const { generateSearchString } = require('../controllers/searchStringController');
const { generateCriteria } = require('../controllers/criteriaController');
const { generateQualityQuestions } = require('../controllers/qualityQuestionsController');
const { generateDataExtractionQuestions } = require('../controllers/dataExtractionController');
const { generateExtractionSuggestions } = require('../controllers/suggestionsController');
const { generateIntroduction } = require('../controllers/introductionController');
const { generateIntroductionKeywords } = require('../controllers/introductionKeywordsController');
const { generateTrabajosRelacionados } = require('../controllers/trabajosRelacionadosController');
const { generatetrabaRelaKeywords } = require('../controllers/trabaRelaKeywordsController');
const { generateResultados } = require('../controllers/resultadosController');
const { generateDiscussion } = require('../controllers/discussionController');
const { discussionKeywordsController } = require('../controllers/discussionKeywordsController');
const { generateLimitaciones } = require('../controllers/limitacionesController');
const { generateConclusion } = require('../controllers/conclusionController');
const { generateResumen } = require('../controllers/resumenController');
const { generateMetodologia } = require('../controllers/metodologiaController');
const { sendContactMessage } = require('../controllers/contactController');
// v3
const adminCtl = require('../controllers/adminController');
const importacionCtl = require('../controllers/importacionController');
const cribadoCtl = require('../controllers/cribadoController');
const referenciasCtl = require('../controllers/referenciasController');
const colaboradoresCtl = require('../controllers/colaboradoresController');
const semanticaCtl = require('../controllers/semanticaController');

const router = express.Router();

const limiterOpts = { standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Demasiadas solicitudes, intente más tarde.' } };
const globalLimiter = rateLimit({ ...limiterOpts, windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX });
const heavyLimiter  = rateLimit({ ...limiterOpts, windowMs: 15 * 60 * 1000, max: 10 });  // endpoints costosos
const contactLimiter = rateLimit({ ...limiterOpts, windowMs: 60 * 60 * 1000, max: 5 });   // anti-spam

router.use(globalLimiter);

// Público (sin API key), útil para monitoreo
router.get('/health', (_req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()) }));

// Contacto: sin API key (formulario público) pero con límite estricto
router.post('/contact', contactLimiter, validate(S.contact), asyncHandler(sendContactMessage));

// Todo lo que sigue requiere autenticación (JWT de Supabase por defecto; ver AUTH_MODE)
router.use(auth);

const post = (paths, ...handlers) => [].concat(paths).forEach(p => router.post(p, ...handlers));

post(['/generate-objetive', '/generate-objective'],          validate(S.objective),            asyncHandler(generateObjective));
post('/methodology-structure',                               validate(S.methodologyStructure), asyncHandler(generateMethodologyStructure));
post('/research-questions',                                  validate(S.researchQuestions),    asyncHandler(generateResearchQuestions));
post('/generate-keywords',                                   validate(S.keywords),             asyncHandler(generateKeywords));
post('/generate-search-string',                              validate(S.searchString),         asyncHandler(generateSearchString));
post('/generate-criteria',                                   validate(S.criteria),             asyncHandler(generateCriteria));
post('/generate-quality-questions',                          validate(S.qualityQuestions),     asyncHandler(generateQualityQuestions));
post('/generate-data-extraction-questions',                  validate(S.dataExtraction),       asyncHandler(generateDataExtractionQuestions));
post('/generate-extraction-suggestions',    heavyLimiter,    validate(S.suggestions),          asyncHandler(generateExtractionSuggestions));
post('/generate-introduction',              heavyLimiter,    validate(S.introduction),         asyncHandler(generateIntroduction));
post('/generate-introduction-keywords',                      validate(S.introductionKeywords), asyncHandler(generateIntroductionKeywords));
post('/generate-trabajos-relacionados',     heavyLimiter,    validate(S.trabajosRelacionados), asyncHandler(generateTrabajosRelacionados));
post('/trabaRelaKeywords',                                   validate(S.trabaRelaKeywords),    asyncHandler(generatetrabaRelaKeywords));
post('/generate-resultados',                heavyLimiter,    validate(S.resultados),           asyncHandler(generateResultados));
post(['/generate-discusion', '/generate-discussion'], heavyLimiter, validate(S.discussion),    asyncHandler(generateDiscussion));
post('/generate-discussion-keywords',                        validate(S.discussionKeywords),   asyncHandler(discussionKeywordsController));
post('/generate-limitaciones',                               validate(S.limitaciones),         asyncHandler(generateLimitaciones));
post('/generate-conclusion',                                 validate(S.conclusion),           asyncHandler(generateConclusion));
post('/generate-resumen',                                    validate(S.resumen),              asyncHandler(generateResumen));
post('/generate-metodologia',               heavyLimiter,    validate(S.metodologia),          asyncHandler(generateMetodologia));

/* ---------- v3: mejoras. Todos necesitan el JWT del usuario porque llaman RPC con RLS ---------- */
router.use(requireUserToken);

// Tanda A
post('/importar/buscar',                                     validate(S.importarBuscar),       asyncHandler(importacionCtl.buscar));
post('/importar',                           heavyLimiter,    validate(S.importar),             asyncHandler(importacionCtl.importar));
post('/cribado/sugerir',                    heavyLimiter,    validate(S.cribadoSugerir),       asyncHandler(cribadoCtl.sugerir));
// Tanda B
post('/referencias/verificar',              heavyLimiter,    validate(S.referenciasVerificar), asyncHandler(referenciasCtl.verificar));
router.get('/referencias/doi/:doi(*)',                                                         asyncHandler(referenciasCtl.porDoi));
// Tanda C
post('/colaboradores/invitar',              contactLimiter,  validate(S.invitar),              asyncHandler(colaboradoresCtl.invitar));
post('/semantica/indexar',                  heavyLimiter,    validate(S.semanticaIndexar),     asyncHandler(semanticaCtl.indexar));
post('/semantica/buscar',                                    validate(S.semanticaBuscar),      asyncHandler(semanticaCtl.buscar));
post('/semantica/preguntar',                heavyLimiter,    validate(S.semanticaPreguntar),   asyncHandler(semanticaCtl.preguntar));

/* ---------- Administración: JWT con app_metadata.rol = 'admin' ---------- */
const adminRouter = express.Router();
adminRouter.use(requireAdmin);
adminRouter.get('/resumen',              asyncHandler(adminCtl.resumen));
adminRouter.get('/usuarios',             asyncHandler(adminCtl.usuarios));
adminRouter.get('/uso',                  asyncHandler(adminCtl.uso));
adminRouter.patch('/usuarios/:id/activo', validate(S.adminActivo), asyncHandler(adminCtl.setActivo));
adminRouter.patch('/usuarios/:id/rol',    validate(S.adminRol),    asyncHandler(adminCtl.setRol));
router.use('/admin', adminRouter);

module.exports = router;
