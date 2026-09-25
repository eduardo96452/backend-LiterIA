// middlewares/requestContext.js
// Contexto por petición (AsyncLocalStorage): permite que openaiService registre el consumo de
// tokens en auditoria_ia sabiendo QUÉ usuario y QUÉ endpoint lo generaron, sin tocar los
// 21 controladores. Además añade `_meta` (modelo, tokens, ms) a cada respuesta JSON para que
// el frontend pueda llamar a fn_registrar_generacion_ia (Tanda B).
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();

function requestContext(req, res, next) {
  const ctx = {
    userId: null,
    endpoint: req.path,
    startedAt: Date.now(),
    usage: { tokens_entrada: 0, tokens_salida: 0, llamadas: 0, modelo: null }
  };
  const originalJson = res.json.bind(res);
  res.json = body => {
    if (body && typeof body === 'object' && !Array.isArray(body) && ctx.usage.llamadas > 0 && res.statusCode < 400) {
      body._meta = {
        modelo: ctx.usage.modelo,
        tokens_entrada: ctx.usage.tokens_entrada,
        tokens_salida: ctx.usage.tokens_salida,
        ms: Date.now() - ctx.startedAt
      };
    }
    return originalJson(body);
  };
  als.run(ctx, () => next());
}

const getContext = () => als.getStore();

module.exports = { requestContext, getContext };
