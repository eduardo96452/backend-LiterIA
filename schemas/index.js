// schemas/index.js
// Esquemas zod de TODOS los endpoints: tipos, obligatoriedad y límites de tamaño.
// Los límites evitan prompts gigantes (costo en tokens) y cargas maliciosas.
const { z } = require('zod');

const str = (max, min = 1) => z.string().trim().min(min).max(max);
const optStr = max => z.string().trim().max(max).optional();
const strArr = (maxItems, maxLen = 5000) => z.array(z.string().trim().max(maxLen)).max(maxItems);
// Cualquier valor JSON, acotado por su tamaño serializado
const bounded = (maxChars) => z.unknown().refine(
  v => JSON.stringify(v ?? '').length <= maxChars,
  { message: `Contenido demasiado grande (máx. ${maxChars} caracteres)` }
);

const objective = z.object({
  title: str(300),
  methodology: str(100),
  description: str(3000),
  alcance: optStr(300),
  pais: optStr(100),
  ciudad: optStr(100),
  area_conocimiento: optStr(200),
  tipo_investigacion: optStr(200),
  institucion: optStr(200)
});

const methodologyStructure = z.object({
  methodology: str(20),
  title: str(300),
  objective: str(2000)
});

const researchQuestions = z.object({
  title: str(300),
  objective: str(2000),
  methodology: str(100),
  numQuestions: z.coerce.number().int().min(1).max(10).optional(),
  tipoInvestigacion: optStr(200)
});

const keywords = z.object({
  methodologyData: z.record(z.string().max(100), bounded(3000)).refine(
    o => Object.keys(o).length > 0 && Object.keys(o).length <= 20,
    { message: 'methodologyData debe tener entre 1 y 20 campos' }
  )
});

const searchString = z.object({
  keywords: z.array(z.object({
    palabra_clave: str(150),
    sinonimos: z.array(z.string().trim().max(150)).max(10).default([])
  })).min(1).max(30),
  idioma: str(50)
});

const titleObjective = z.object({ title: str(300), objective: str(2000) });

const dataExtraction = titleObjective.extend({
  numberOfQuestions: z.coerce.number().int().min(1).max(20)
});

const suggestions = z.object({
  url: z.string().trim().url().max(2000),
  title: str(500),
  questions: z.array(z.object({
    pregunta: str(500),
    tipoRespuesta: z.enum(['Texto', 'Booleano', 'Entero', 'Decimal', 'Fecha']).default('Texto')
  })).min(1).max(30)
});

const introduction = z.object({
  title: str(300),
  description: str(3000),
  objective: str(2000),
  methodology: bounded(15000).optional(),
  results_summary: bounded(15000).optional(),
  discussion_summary: strArr(20).default([]),
  conclusions: z.string().trim().max(8000).default(''),
  keywords: z.string().trim().max(500).default(''),
  research_questions: strArr(10, 500).default([])
});

const introductionKeywords = z.object({
  title: str(300),
  objective: str(2000),
  description: z.string().trim().max(3000).default(''),
  methodology: bounded(15000).optional(),
  results_summary: bounded(15000).optional(),
  discussion_summary: strArr(20).default([]),
  conclusions: z.string().trim().max(8000).default(''),
  research_questions: strArr(10, 500).default([])
});

const trabajosRelacionados = z.object({
  title: str(300),
  keywords: str(500),
  criterios_seleccion: str(3000),
  description: z.string().trim().max(3000).default('')
});

const trabaRelaKeywords = z.object({
  text: str(20000),
  n: z.coerce.number().int().min(1).max(20).default(7)
});

const resultados = z.object({
  studies_data: z.array(z.object({
    status: z.string().trim().max(50).default('')
  }).passthrough()).min(1).max(500),
  extraction_data: z.array(z.object({
    pregunta: str(500),
    respuesta: z.string().trim().max(5000).default(''),
    autores: z.string().trim().max(500).default('Autor desconocido'),
    anio: z.coerce.string().max(10).default('s.f.'),
    titulo: z.string().trim().max(500).default('Sin título'),
    revista: z.string().trim().max(300).default(''),
    doi: z.string().trim().max(200).default('')
  })).min(1).max(500)
});

const discussion = z.object({
  reflexion_inicial: strArr(20),
  referencias: strArr(50),
  keywords: str(500)
}).passthrough().refine(o => JSON.stringify(o).length <= 60000, { message: 'Cuerpo demasiado grande' });

const discussionKeywords = z.object({
  reflexion_inicial: strArr(20),
  referencias: strArr(50),
  n: z.coerce.number().int().min(1).max(20).default(8)
}).passthrough().refine(o => JSON.stringify(o).length <= 60000, { message: 'Cuerpo demasiado grande' });

const limitaciones = z.object({
  methodological_issues: z.object({
    enfoque_metodologico: z.string().max(5000).default(''),
    fases_prisma: z.string().max(5000).default(''),
    procedimiento_busqueda: z.string().max(5000).default(''),
    criterios_seleccion: z.string().max(5000).default(''),
    proceso_cribado: z.string().max(5000).default('')
  }),
  search_limitations: z.object({
    reflexion_inicial: strArr(20).default([]),
    preguntas: z.record(z.string().max(500), strArr(50)).default({}),
    referencias: strArr(50).default([])
  })
});

const conclusion = z.object({
  results_summary: bounded(30000),
  discussion_summary: strArr(20),
  objective: str(2000),
  research_questions: strArr(10, 500).min(1)
});

const resumen = z.object({
  title: str(300),
  objective: str(2000),
  methodology: bounded(15000),
  results_summary: bounded(30000),
  discussion_summary: bounded(15000),
  conclusions: str(8000),
  word_count: z.coerce.number().int().min(50).max(500)
});

const metodologia = z.object({
  titulo_revision: str(300),
  objetivo: str(2000),
  tipo_revision: z.string().trim().max(100).default('RSL'),
  frameworks: strArr(10, 100).default([]),
  keywords: z.array(z.object({
    componente: z.string().trim().max(100).default(''),
    palabra: z.string().trim().max(150).default(''),
    sinonimos: z.array(z.string().trim().max(150)).max(10).default([])
  })).min(1).max(30),
  global_search: str(3000),
  per_base_search: z.array(z.object({
    fuente: z.string().trim().max(100).default(''),
    cadena: z.string().trim().max(3000).default('')
  })).max(20).default([]),
  bibliografias: z.array(z.object({
    nombre: z.string().trim().max(100).default(''),
    url: z.string().trim().max(500).default('')
  })).max(20).default([]),
  inclusion_criteria: strArr(20, 500).default([]),
  exclusion_criteria: strArr(20, 500).default([])
});

const contact = z.object({
  name: str(100),
  email: z.string().trim().email().max(254),
  message: str(5000)
});

/* ---------- v3: administración y mejoras (Tandas A, B, C) ---------- */
const id = z.coerce.number().int().positive();
const uuid = z.string().uuid();

const adminActivo = z.object({ activo: z.boolean() });
const adminRol = z.object({ rol: z.enum(['admin', 'usuario']) });

const importarBase = {
  fuente: z.enum(['openalex', 'semantic_scholar', 'crossref']),
  cadena: str(2000),
  anioDesde: z.coerce.number().int().min(1900).max(2100).optional(),
  anioHasta: z.coerce.number().int().min(1900).max(2100).optional(),
  tipo: optStr(50),
  idioma: optStr(10),
  pagina: z.coerce.number().int().min(1).max(200).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(50)
};
const importarBuscar = z.object(importarBase);
const importar = z.object({ ...importarBase, id_detalles_revision: id, paginas: z.coerce.number().int().min(1).max(10).default(1) });

const cribadoSugerir = z.object({
  id_detalles_revision: id,
  ids_estudios: z.array(id).max(50).optional(),
  solo_sin_clasificar: z.boolean().default(true),
  max: z.coerce.number().int().min(1).max(50).default(20)
});

const referenciasVerificar = z.object({
  id_detalles_revision: id,
  ids_referencias: z.array(id).max(200).optional(),
  solo_pendientes: z.boolean().default(true)
});

const invitar = z.object({
  id_detalles_revision: id,
  correo: z.string().trim().email().max(254),
  rol: z.enum(['revisor', 'lector']).default('revisor')
});

const semanticaIndexar = z.object({ id_estudios: id, url: z.string().trim().url().max(2000) });
const semanticaBuscar = z.object({
  id_detalles_revision: id, consulta: str(500),
  limite: z.coerce.number().int().min(1).max(50).default(10), hibrida: z.boolean().default(false)
});
const semanticaPreguntar = z.object({ id_detalles_revision: id, pregunta: str(1000) });

module.exports = {
  adminActivo, adminRol, importarBuscar, importar, cribadoSugerir, referenciasVerificar, invitar,
  semanticaIndexar, semanticaBuscar, semanticaPreguntar, uuid,
  objective, methodologyStructure, researchQuestions, keywords, searchString,
  criteria: titleObjective, qualityQuestions: titleObjective, dataExtraction, suggestions,
  introduction, introductionKeywords, trabajosRelacionados, trabaRelaKeywords, resultados,
  discussion, discussionKeywords, limitaciones, conclusion, resumen, metodologia, contact
};
