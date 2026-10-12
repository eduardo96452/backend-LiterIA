// ia/prompts/limitaciones.js
// Generación con IA de la sección «Limitaciones». Recibe los datos ya validados (con los
// esquemas de legacy/schemas.js) y devuelve el objeto que antes respondía el controlador.
// La usan la ruta antigua /api/generate-* y la nueva /api/v1/revisiones/:id/secciones/:seccion/generar.
const { callOpenAI } = require('../../infra/openai');

async function texto(datos) {
  const { methodological_issues: mi, search_limitations: sl } = datos;

  const preguntasEntries = Object.entries(sl.preguntas)
    .map(([preg, respuestas]) => `- ${preg}:\n    • ${respuestas.join('\n    • ')}`)
    .join('\n\n');

  const prompt = `
Con base en la siguiente información, redacta la sección de Limitaciones de un artículo científico:

1) Problemas metodológicos (RSL + PRISMA):
   • Enfoque metodológico: ${mi.enfoque_metodologico}
   • Fases PRISMA: ${mi.fases_prisma}
   • Procedimiento de búsqueda: ${mi.procedimiento_busqueda}
   • Criterios de selección: ${mi.criterios_seleccion}
   • Proceso de cribado: ${mi.proceso_cribado}

2) Limitaciones derivadas de la revisión de resultados:
   • Reflexión inicial:
${sl.reflexion_inicial.join('\n\n')}

3) Limitaciones relacionadas con el detalle de preguntas:
${preguntasEntries}

4) Referencias de los estudios usados en resultados:
${sl.referencias.join('\n\n')}

Instrucciones:
- Describe de manera clara y concisa las principales limitaciones que afectan la interpretación de los hallazgos.
- Tono académico-formal. Máximo 2 párrafos. No agregues nada que no esté aquí.`;

  const limitaciones = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en redacción académica.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 2048 });

  return ({ limitaciones });
}

module.exports = { texto };
