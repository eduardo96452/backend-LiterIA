// services/openaiService.js
// services/openaiService.js
const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');
const { HttpError } = require('../utils/httpError');
const { getContext } = require('../middlewares/requestContext');
const { registrarLlamadaIA } = require('./auditService');

const MAX_OUTPUT_TOKENS = 16_000;

/** gpt-5*, o1, o3, o4… usan la API de razonamiento (parámetros distintos). */
const esModeloDeRazonamiento = (m) => /^(gpt-5|o\d)/i.test(m);

const client = axios.create({
  baseURL: 'https://api.openai.com/v1',
  timeout: env.OPENAI_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` }
});

function acumular(model, usage, ms, exito) {
  const ctx = getContext();
  const tokensIn = usage?.prompt_tokens || 0, tokensOut = usage?.completion_tokens || 0;
  if (ctx) {
    ctx.usage.llamadas += 1;
    ctx.usage.tokens_entrada += tokensIn;
    ctx.usage.tokens_salida += tokensOut;
    ctx.usage.modelo = model;
  }
  // auditoría por llamada (sin await: no retrasa la respuesta)
  registrarLlamadaIA({ userId: ctx?.userId, endpoint: ctx?.endpoint, modelo: model, tokensEntrada: tokensIn, tokensSalida: tokensOut, ms, exito });
}

function traducirError(error) {
  if (error instanceof HttpError) return error;
  const status = error.response?.status;
  logger.error('openai_error', { status, code: error.code, message: error.response?.data?.error?.message || error.message });
  if (status === 429) return new HttpError(503, 'Servicio de IA saturado, intente más tarde.');
  if (error.code === 'ECONNABORTED') return new HttpError(504, 'Tiempo de espera agotado con el servicio de IA.');
  return new HttpError(502, 'Error al procesar la solicitud con el servicio de IA.');
}

/**
 * Chat Completions. Devuelve el texto. El consumo de tokens se registra solo (contexto + auditoria_ia).
 * @param {Array<{role:string, content:string}>} messages
 * @param {{ model?:string, temperature?:number, maxTokens?:number, json?:boolean }} [opts]
 */
async function callOpenAI(messages, opts = {}) {
  const { model = env.OPENAI_MODEL, temperature = 0.3, maxTokens = 4000, json = false } = opts;
  const limite = Math.min(maxTokens, MAX_OUTPUT_TOKENS);
  const body = { model, messages };
  if (esModeloDeRazonamiento(model)) {
    // Familia GPT-5 / o-series: no aceptan max_tokens ni temperatura personalizada.
    // Los tokens de razonamiento consumen el mismo presupuesto, por eso se deja margen.
    body.max_completion_tokens = Math.min(limite * 2, MAX_OUTPUT_TOKENS);
    body.reasoning_effort = env.OPENAI_REASONING_EFFORT;
  } else {
    body.temperature = temperature;
    body.max_tokens = limite;
  }
  if (json) body.response_format = { type: 'json_object' };
  const t0 = Date.now();
  try {
    const { data } = await client.post('/chat/completions', body);
    const content = data?.choices?.[0]?.message?.content;
    acumular(model, data?.usage, Date.now() - t0, true);
    if (typeof content !== 'string') throw new HttpError(502, 'Respuesta vacía del servicio de IA.');
    return content.trim();
  } catch (error) {
    if (!(error instanceof HttpError)) acumular(model, null, Date.now() - t0, false);
    throw traducirError(error);
  }
}

/**
 * Embeddings (para la búsqueda semántica, Tanda C). Acepta hasta 100 textos por llamada.
 * @returns {Promise<number[][]>}
 */
async function embed(texts, model = env.OPENAI_EMBEDDING_MODEL) {
  const input = (Array.isArray(texts) ? texts : [texts]).map(t => String(t).slice(0, 8000));
  const t0 = Date.now();
  try {
    const { data } = await client.post('/embeddings', { model, input });
    acumular(model, { prompt_tokens: data?.usage?.prompt_tokens || 0 }, Date.now() - t0, true);
    return (data?.data || []).sort((a, b) => a.index - b.index).map(d => d.embedding);
  } catch (error) {
    acumular(model, null, Date.now() - t0, false);
    throw traducirError(error);
  }
}

module.exports = { callOpenAI, embed };
