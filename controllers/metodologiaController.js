// controllers/metodologiaController.js
const { callOpenAI } = require('../services/openaiService');
const { parseAiJson } = require('../utils/aiJson');

async function generateMetodologia(req, res) {
  const {
    titulo_revision, objetivo, tipo_revision, frameworks, keywords, global_search,
    per_base_search, bibliografias, inclusion_criteria, exclusion_criteria
  } = req.body;

  const incl = inclusion_criteria.map((c, i) => `IC${i + 1}: ${c}`).join('<br/>');
  const excl = exclusion_criteria.map((c, i) => `EC${i + 1}: ${c}`).join('<br/>');

  const prompt = `
Genera exactamente el siguiente JSON (sin texto adicional):

{
  "enfoque_metodologico": "<Texto académico-formal (1 párrafo mínimo) explicando qué es una Revisión Sistemática de Literatura (RSL), por qué es importante en este contexto y la razón de usar el protocolo ${tipo_revision}>",
  "fases_prisma": "<1 párrafo explicando cada fase del protocolo PRISMA: identificación, cribado e inclusión>",
  "procedimiento_busqueda": "<breve descripción del procedimiento de búsqueda y la matriz PICOC>",
  "tabla_picos": "<tabla HTML completa con clases Bootstrap: <table class='table table-striped table-bordered'>, <tr>, <th>, <td>>",
  "analisis_cadena_busqueda": "<breve explicación de cómo se creó la cadena de búsqueda global>",
  "cadena_busqueda_global": "<cadena de búsqueda global proporcionada, sin modificar>",
  "introduccion_bases_datos": "<texto introductorio breve sobre las bases de datos utilizadas>",
  "tabla_bases_datos": "<tabla HTML con clases Bootstrap>",
  "tabla_cadenas_busqueda": "<tabla HTML con clases Bootstrap>",
  "criterios_seleccion": "Los criterios de selección se dividen en criterios de inclusión y exclusión.<br/>Los criterios de inclusión son:<br/>${incl}<br/>Los criterios de exclusión son:<br/>${excl}",
  "proceso_cribado": "<texto breve explicando los pasos del cribado (título, resumen, texto completo) con referencia al diagrama PRISMA>"
}

Instrucciones:
- No inventes información; usa estrictamente los datos proporcionados.
- Tablas HTML con Bootstrap 5: cada <table> con class='table table-striped table-bordered', sin estilos inline.
- Tono académico-formal y preciso, sin opiniones ni suposiciones.

Datos:
Título de revisión: ${titulo_revision}
Objetivo: ${objetivo}
Tipo de revisión: ${tipo_revision}
Framework(s): ${frameworks.join(', ')}

Matriz PICOC:
${keywords.map(k => `- Componente: ${k.componente}\n  Palabra clave: ${k.palabra}\n  Sinónimos: ${k.sinonimos.join(', ')}`).join('\n')}

Criterios de inclusión:
${inclusion_criteria.map((c, i) => `IC${i + 1}: ${c}`).join('\n')}

Criterios de exclusión:
${exclusion_criteria.map((c, i) => `EC${i + 1}: ${c}`).join('\n')}

Bases bibliográficas utilizadas:
${bibliografias.map(b => `- ${b.nombre}: ${b.url}`).join('\n')}

Cadena global proporcionada:
${global_search}

Cadenas por base de datos:
${per_base_search.map(b => `- ${b.fuente}: ${b.cadena}`).join('\n')}`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en redacción académica y tablas HTML basadas solo en datos proporcionados. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 6500, json: true });

  res.json(parseAiJson(raw));
}

module.exports = { generateMetodologia };
