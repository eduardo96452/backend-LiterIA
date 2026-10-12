// ia/cribado.js
// Prompt de la sugerencia de cribado (movido sin cambios desde legacy/controllers/cribadoController.js).
// La decisión final siempre es humana: esto solo propone.
const { callOpenAI } = require('../infra/openai');
const { parseAiJson } = require('./aiJson');

/**
 * Pide a la IA una sugerencia de cribado para un estudio. Devuelve
 * { sugerencia: 'Aceptado'|'Rechazado'|'Dudoso', id_criterio, confianza, justificacion }.
 * El id_criterio solo se acepta si es uno de los criterios recibidos.
 */
async function sugerirCribado(estudio, criterios, objetivo) {
  const lista = criterios.map(c => `[${c.id_criterios}] (${c.tipo}) ${c.descripcion}`).join('\n');
  const prompt = `
Eres un revisor experto en revisiones sistemáticas. Decide si el estudio debe incluirse aplicando ESTRICTAMENTE los criterios.

Objetivo de la revisión: ${objetivo || '(no indicado)'}

Criterios (con su id):
${lista}

Estudio:
- Título: ${estudio.titulo}
- Autores: ${estudio.autores || 'desconocidos'} (${estudio.anio || 's.f.'})
- Revista: ${estudio.revista || 'desconocida'}
- Resumen: ${(estudio.resumen || 'sin resumen').slice(0, 3000)}

Reglas:
1. "Rechazado" si incumple cualquier criterio de exclusión o no cumple alguno de inclusión verificable.
2. "Aceptado" si cumple todos los de inclusión y ninguno de exclusión.
3. "Dudoso" si el resumen no permite verificarlo.
4. Indica el id del criterio determinante y una justificación de 1-2 frases basada en el texto.

Devuelve solo JSON: {"sugerencia":"Aceptado|Rechazado|Dudoso","id_criterio":<id o null>,"confianza":<0..1>,"justificacion":"..."}`;

  const raw = await callOpenAI([
    { role: 'system', content: 'Eres un revisor metodológico riguroso. Respondes solo JSON.' },
    { role: 'user', content: prompt }
  ], { temperature: 0.1, maxTokens: 400, json: true });

  const out = parseAiJson(raw);
  const sugerencia = ['Aceptado', 'Rechazado', 'Dudoso'].includes(out.sugerencia) ? out.sugerencia : 'Dudoso';
  const idCriterio = criterios.some(c => c.id_criterios === Number(out.id_criterio)) ? Number(out.id_criterio) : null;
  const confianza = Math.max(0, Math.min(1, Number(out.confianza) || 0));
  const justificacion = String(out.justificacion || '').slice(0, 1000);

  return { sugerencia, id_criterio: idCriterio, confianza, justificacion };
}

module.exports = { sugerirCribado };
