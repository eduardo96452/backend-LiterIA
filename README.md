# backend LiterIA (v3.0.0)

Backend Express del sistema LiterIA. Misma API de generación que la v2, más:
autenticación con el JWT de Supabase, auditoría automática de tokens, panel de administración
y los endpoints que requieren las mejoras de la base de datos (Tandas A, B y C).

## Requisitos previos
1. Base de datos creada con `literia_schema.sql` y, opcionalmente, `02_…tanda_a.sql`, `03_…tanda_b.sql`, `04_…tanda_c.sql`.
2. Node 18.17+.

## Puesta en marcha
```bash
npm install
cp .env.example .env     # completar SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY (mínimo)
npm run check
npm start
```

## Autenticación
`AUTH_MODE=jwt` (por defecto): cada petición a `/api/*` (salvo `/health` y `/contact`) lleva
`Authorization: Bearer <access_token de Supabase>`. El backend lo verifica con las claves públicas del
proyecto (JWKS) y deja `req.user = { id, email, rol }`. Las llamadas a la base se hacen **como ese usuario**
(RLS aplica), por lo que el backend nunca puede leer datos ajenos por error.

`AUTH_MODE=apikey`: compatibilidad con la cabecera `x-api-key`. Los endpoints v3 (`/importar`, `/cribado`,
`/referencias`, `/colaboradores`, `/semantica`, `/admin`) exigen igualmente el JWT, porque sin él no hay RLS.

## Endpoints

| Grupo | Método y ruta | Qué hace | Requiere en la BD |
|---|---|---|---|
| Base | `POST /api/generate-*` (21 endpoints) | Generación de secciones (sin cambios de contrato) | `literia_schema.sql` |
| Base | `GET /api/health`, `POST /api/contact` | Públicos | — |
| **Admin** | `GET /api/admin/resumen` | Conteos globales | `fn_admin_resumen` |
| | `GET /api/admin/usuarios?q=&page=&size=` | Listado paginado con último acceso | `fn_admin_usuarios` |
| | `GET /api/admin/uso?desde=&hasta=` | Consumo de IA por endpoint/usuario/día | `fn_admin_uso`, `auditoria_ia` |
| | `PATCH /api/admin/usuarios/:id/activo` `{activo}` | Bloquea/desbloquea login + marca perfil | `fn_admin_set_activo` + `SERVICE_ROLE_KEY` |
| | `PATCH /api/admin/usuarios/:id/rol` `{rol}` | Promueve/degrada admin | `fn_admin_set_rol` |
| **Tanda A** | `POST /api/importar/buscar` | Previsualiza resultados de OpenAlex / Semantic Scholar / CrossRef | — |
| | `POST /api/importar` | Importa N páginas con deduplicación | `fn_importar_estudios` |
| | `POST /api/cribado/sugerir` | IA sugiere Aceptado/Rechazado/Dudoso con criterio y confianza | `fn_guardar_sugerencia_cribado` |
| **Tanda B** | `POST /api/referencias/verificar` | Verifica DOIs contra CrossRef y marca discrepancias | `fn_verificar_referencia`, `fn_estado_referencias` |
| | `GET /api/referencias/doi/:doi` | Metadatos de un DOI para autocompletar | — |
| **Tanda C** | `POST /api/colaboradores/invitar` | Invita (y envía el correo si no tiene cuenta) | `fn_invitar_colaborador` |
| | `POST /api/semantica/indexar` | Trocea el PDF, calcula embeddings y guarda | `fn_guardar_fragmentos` (pgvector) |
| | `POST /api/semantica/buscar` | Búsqueda semántica o híbrida | `fn_buscar_semantico`, `fn_buscar_hibrido` |
| | `POST /api/semantica/preguntar` | Pregunta en lenguaje natural con citas a los fragmentos | `fn_buscar_semantico` |

Si llamas a un endpoint cuya tanda no está instalada, la base responde "function … does not exist" y el
backend lo devuelve como 400 con ese mensaje: es la señal de que falta ejecutar ese script.

## Auditoría y trazabilidad (Tanda B) — automático
Cada llamada a OpenAI registra una fila en `auditoria_ia` (usuario, endpoint, modelo, tokens, ms) sin tocar
los controladores. Además, toda respuesta JSON que usó IA incluye:
```json
"_meta": { "modelo": "gpt-4o-mini", "tokens_entrada": 1200, "tokens_salida": 800, "ms": 4300 }
```
El frontend puede pasar esos valores a `fn_registrar_generacion_ia` justo después de guardar la versión de la sección.

## Qué añadir en el frontend (Angular)
El interceptor entregado ya envía el `Bearer`. Para las mejoras hacen falta pantallas nuevas que llamen:
- **Admin**: `AdminService` → `/api/admin/*` y guard por `app_metadata.rol === 'admin'`.
- **Importación**: buscador con previsualización (`/importar/buscar`) y botón "Importar" (`/importar`).
- **Cribado IA**: botón "Sugerir con IA" en la pantalla de estudios → `/cribado/sugerir`; mostrar `cribado_sugerencias`.
- **Referencias**: botón "Verificar referencias" → `/referencias/verificar`; semáforo con `fn_estado_referencias`.
- **Colaboradores**: pantalla de equipo (`fn_equipo_revision`) + invitar (`/colaboradores/invitar`) + ruta `/invitacion?token=` que llame a `fn_aceptar_invitacion`.
- **Búsqueda semántica**: "Indexar PDFs" (`/semantica/indexar` con la URL firmada de cada PDF) y caja de búsqueda/preguntas.
- **Versiones, progreso, protocolo, kappa, meta-análisis, formato de citas**: se llaman directo con `supabase.rpc(...)`, no pasan por el backend.

## Seguridad (heredada de v2 y ampliada)
Helmet, CORS con lista blanca, rate limiting global y por endpoint, validación zod en todos los cuerpos,
anti-SSRF en descargas de PDF, timeouts, manejador global de errores, JWT verificado con JWKS,
`service_role` solo en el servidor y solo para admin/auditoría, RLS siempre activo en las RPC de usuario.
