# backend LiterIA (v3.0.0)

Backend Express del sistema LiterIA. Misma API de generación que la v2, más:
autenticación con el JWT de Supabase, auditoría automática de tokens, panel de administración
y los endpoints que requieren las mejoras de la base de datos (Tandas A, B y C).

## Puesta en marcha
```bash
npm install
cp .env.example .env     # completar SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY (mínimo)
npm run check
npm start
```

## Seguridad (heredada de v2 y ampliada)
Helmet, CORS con lista blanca, rate limiting global y por endpoint, validación zod en todos los cuerpos,
anti-SSRF en descargas de PDF, timeouts, manejador global de errores, JWT verificado con JWKS,
`service_role` solo en el servidor y solo para admin/auditoría, RLS siempre activo en las RPC de usuario.
