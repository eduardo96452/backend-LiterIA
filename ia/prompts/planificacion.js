// ia/prompts/planificacion.js
// Prompts de la pantalla de Planificación. Los usan las rutas nuevas (POST /api/v1/revisiones/:id/ia/:tipo,
// que leen los datos GUARDADOS de la revisión) y las antiguas /api/* mientras existan.
//
// objetivo, preguntas, cadena, criterios, calidad y camposExtraccion son el mismo texto que tenían
// los controladores de legacy/ (comprobado): reciben el mismo cuerpo y devuelven lo mismo.
// estructura y palabrasClave son nuevos: antes el texto traía fijos PICO, PICOC, PICOTT y SPICE (y una
// numeración global de componentes que suponía los id de la base); ahora se arman con los componentes
// del framework que haya en la base, así que sirven también para los que añada un administrador.
const { callOpenAI } = require('../../infra/openai');
const { parseAiJson } = require('../aiJson');

/* ---------- Mismo texto que legacy ---------- */

/** Cuerpo de POST /api/generate-objective. Devuelve el objetivo (texto). */
async function objetivo({ title, methodology, description, alcance, pais, ciudad, area_conocimiento, tipo_investigacion, institucion }) {
  const optional = [
    alcance && `- Alcance: ${alcance}`,
    pais && `- País: ${pais}`,
    ciudad && `- Ciudad: ${ciudad}`,
    area_conocimiento && `- Área de Conocimiento: ${area_conocimiento}`,
    tipo_investigacion && `- Tipo de Investigación: ${tipo_investigacion}`,
    institucion && `- Institución: ${institucion}`
  ].filter(Boolean);
  const extraSection = optional.length ? `\nInformación adicional:\n${optional.join('\n')}` : '';

  const prompt = `
1. Usa los siguientes datos para elaborar un objetivo en un solo enunciado de tono académico:
- Título de la revisión: ${title}
- Metodología de la revisión: ${methodology}
- Descripción breve: ${description}${extraSection}

2. El objetivo debe seguir la fórmula: (verbo en infinitivo) + (qué cosa) + (cómo) + (para qué)
3. No excedas las 30 palabras en tu respuesta final.
4. No uses enumeraciones, viñetas ni explicaciones adicionales; la frase debe ser fluida y concisa.
5. Redacta en estilo académico, sin listas ni puntos.`;

  return callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en investigación académica.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 200 });
}

/** Cuerpo de POST /api/research-questions. Devuelve las preguntas (string[]). */
async function preguntas({ title, objective, methodology, numQuestions = 3, tipoInvestigacion }) {
  const investigationPart = tipoInvestigacion ? `y considerando que la investigación es de tipo "${tipoInvestigacion}" ` : '';

  const prompt = `
Eres un asistente experto en investigación académica.
Con base en la metodología "${methodology}", el título "${title}" y el objetivo "${objective}" ${investigationPart}
genera ${numQuestions} preguntas de investigación en formato JSON.
Ejemplo de salida:
{ "questions": ["¿Cómo ha evolucionado el uso de la inteligencia artificial en la detección de enfermedades?", "Pregunta 2..."] }
Devuelve únicamente el JSON sin ningún texto adicional.`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en investigación académica. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 1500, json: true });

  const parsed = parseAiJson(raw);
  return Array.isArray(parsed.questions) ? parsed.questions.map(String).slice(0, numQuestions) : [];
}

/** Cuerpo de POST /api/generate-search-string. Devuelve la cadena booleana (texto). */
async function cadena({ keywords, idioma }) {
  const keywordsString = keywords
    .map(({ palabra_clave, sinonimos }) => {
      const terms = [palabra_clave, ...sinonimos].map(t => t.trim()).filter(Boolean).map(t => `"${t}"`).join(' OR ');
      return `(${terms})`;
    })
    .join(' AND ');

  const prompt = `
Utilizando únicamente la siguiente información, genera una cadena de búsqueda avanzada en formato booleano:
- Palabras clave y sinónimos: ${keywordsString}
- Idioma en que debe estar la cadena: ${idioma}

La cadena final NO debe incluir la mención explícita del idioma.
Cada término va entre comillas; usa "OR" para combinar sinónimos y "AND" para unir grupos.
Proporciona únicamente la cadena final sin explicaciones adicionales.`;

  return callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en la generación de cadenas de búsqueda académicas.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 800 });
}

/** Cuerpo de POST /api/generate-criteria. Devuelve [{ criterio, categoria }] tal como los da la IA. */
async function criterios({ title, objective }) {
  const prompt = `
Eres un experto en revisiones sistemáticas de literatura.
Basado en el siguiente estudio:
- Título: ${title}
- Objetivo: ${objective}

Genera criterios de inclusión y exclusión. Devuelve estrictamente este JSON:
{ "criterios": [ { "criterio": "Texto del criterio 1", "categoria": "incluido" }, { "criterio": "Texto del criterio 2", "categoria": "excluido" } ] }
Usa lenguaje académico, claro y directo. Sin explicaciones adicionales.`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en metodología científica. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 1500, json: true });

  const parsed = parseAiJson(raw);
  return Array.isArray(parsed) ? parsed : (Array.isArray(parsed.criterios) ? parsed.criterios : []);
}

/** Cuerpo de POST /api/generate-quality-questions. Devuelve las preguntas (string[]). */
async function calidad({ title, objective }) {
  const prompt = `
Eres un experto en metodología de investigación y evaluación crítica de estudios.
Con base en:
- Título: ${title}
- Objetivo: ${objective}

Genera preguntas de evaluación de calidad para determinar si un estudio debe ser aceptado en una revisión sistemática.
Deben abordar: diseño metodológico, relevancia, validez de resultados, claridad del reporte y riesgo de sesgo.
Devuelve estrictamente este JSON: { "quality_questions": ["Pregunta 1", "Pregunta 2"] }
Sin texto adicional.`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en revisión sistemática. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 1500, json: true });

  const parsed = parseAiJson(raw);
  return Array.isArray(parsed.quality_questions) ? parsed.quality_questions.map(String) : [];
}

const TIPOS_CAMPO = new Set(['Booleano', 'Texto', 'Decimal', 'Entero', 'Fecha']);

/** Cuerpo de POST /api/generate-data-extraction-questions. Devuelve [{ pregunta, tipo }]. */
async function camposExtraccion({ title, objective, numberOfQuestions }) {
  const prompt = `
Eres un experto en revisiones sistemáticas de literatura.
Basado en el siguiente estudio:
- Título: ${title}
- Objetivo: ${objective}

Genera ${numberOfQuestions} preguntas de extracción de datos. Devuelve estrictamente este JSON:
{ "questions": [ { "pregunta": "Texto de la pregunta", "tipo": "Booleano" } ] }
donde "tipo" es uno de: "Booleano", "Texto", "Decimal", "Entero", "Fecha". Sin texto adicional.`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en metodología científica. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 2000, json: true });

  const parsed = parseAiJson(raw);
  const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.questions) ? parsed.questions : []);
  return list
    .filter(q => q && typeof q.pregunta === 'string')
    .map(q => ({ pregunta: q.pregunta, tipo: TIPOS_CAMPO.has(q.tipo) ? q.tipo : 'Texto' }))
    .slice(0, numberOfQuestions);
}

/* ---------- Con los componentes del framework guardados en la base ---------- */

const texto = v => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const normal = s => texto(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Rellena cada componente del framework.
 * @param {{ metodologia: string, titulo: string, objetivo: string,
 *           componentes: { id_componente: number, sigla: string, nombre: string, descripcion?: string }[] }} datos
 * @returns {Promise<Record<number, string>>} texto por id_componente ('' si la IA no lo dio)
 */
async function estructura({ metodologia, titulo, objetivo: obj, componentes }) {
  const ejemplo = { P: 'Pacientes con diagnósticos convencionales', I: 'Aplicación de modelos de aprendizaje profundo',
    C: 'Resultados con métodos tradicionales', O: 'Medir la efectividad y precisión de la IA en el diagnóstico' };

  const prompt = `
Eres un asistente experto en metodología de investigación.
Con base en el framework "${metodologia}", el título "${titulo}" y el objetivo "${obj}",
devuelve exclusivamente un objeto JSON con EXACTAMENTE estas claves y un texto desarrollado en cada una:
${componentes.map(c => `- "${c.sigla}": ${c.nombre}${c.descripcion ? ` (${c.descripcion})` : ''}`).join('\n')}

Ejemplo de formato (para PICO):
${JSON.stringify(ejemplo)}

No incluyas explicaciones ni texto adicional.`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en investigación académica. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 1000, json: true });

  const parsed = parseAiJson(raw);
  const plano = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const porClave = new Map(Object.entries(plano).map(([k, v]) => [normal(k), texto(v)]));
  return Object.fromEntries(componentes.map(c => [c.id_componente,
    porClave.get(normal(c.sigla)) || porClave.get(normal(c.nombre)) || '']));
}

/**
 * Palabras clave y sinónimos a partir del framework guardado.
 * @param {{ metodologia: string,
 *           componentes: { id_componente: number, sigla: string, nombre: string, valor: string }[] }} datos
 *        (solo los componentes con contenido)
 * @returns {Promise<{ palabra_clave: string, id_componente: number|null, sinonimos: string[] }[]>}
 */
async function palabrasClave({ metodologia, componentes }) {
  const prompt = `
Eres un experto en terminología científica y metodología de investigación. Este es el framework "${metodologia}" de una revisión sistemática, con el contenido de cada componente:
${componentes.map(c => `- id ${c.id_componente} · ${c.nombre} (${c.sigla}): ${c.valor}`).join('\n')}

Extrae palabras clave significativas de cada componente. Para cada palabra clave genera de 2 a 5 sinónimos relevantes e indica en "id_componente" el id del componente del que sale (uno de: ${componentes.map(c => c.id_componente).join(', ')}).

Devuelve estrictamente un JSON con esta forma:
{ "keywords": [ { "palabra_clave": "...", "id_componente": ${componentes[0]?.id_componente ?? 1}, "sinonimos": ["..."] } ] }
No incluyas texto adicional.`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un asistente experto en terminología científica. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { maxTokens: 3000, json: true });

  const parsed = parseAiJson(raw);
  const lista = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.keywords) ? parsed.keywords : []);
  const porId = new Map(componentes.map(c => [Number(c.id_componente), c]));
  const porNombre = new Map(componentes.flatMap(c => [[normal(c.nombre), c], [normal(c.sigla), c]]));

  return lista
    .filter(k => k && texto(k.palabra_clave))
    .slice(0, 40)
    .map(k => {
      const comp = porId.get(Number(k.id_componente))
        ?? porNombre.get(normal(k.componente)) ?? porNombre.get(normal(k.metodologia)) ?? porNombre.get(normal(k.sigla));
      const sin = Array.isArray(k.sinonimos) ? k.sinonimos : texto(k.sinonimos).split(',');
      const vistos = new Set();
      return {
        palabra_clave: texto(k.palabra_clave).slice(0, 150),
        id_componente: comp ? Number(comp.id_componente) : null,
        sinonimos: sin.map(texto).filter(s => s && !vistos.has(s.toLowerCase()) && vistos.add(s.toLowerCase()))
          .slice(0, 10).map(s => s.slice(0, 150))
      };
    });
}

module.exports = { objetivo, preguntas, cadena, criterios, calidad, camposExtraccion, estructura, palabrasClave, TIPOS_CAMPO };
