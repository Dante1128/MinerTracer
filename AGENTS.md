# AGENTS.md

Guía para agentes de código que trabajan en MinerTrace. El diseño completo está en [MinerTrace.md](MinerTrace.md)
y el arranque para personas en [README.md](README.md).

## Qué es

Trazabilidad e integridad de análisis minerales. Cada análisis se convierte en un registro canónico
(JCS, RFC 8785), se hashea con SHA-256 y el hash se ancla en una blockchain. En la Fase 1 el anclaje
está **simulado** (`AnclajeMock`); Stellar llega en la Fase 2 (busque `TODO WEB3`).

## Estructura

Dos paquetes independientes, cada uno con su `package.json` y `node_modules`:

- `server/` — backend: Node 22+, Express 5, TypeScript ejecutado con `tsx` (sin paso de compilación).
  Base de datos PGlite (por defecto, en `server/datos/`) o PostgreSQL si hay `DATABASE_URL`.
- `web/` — frontend: React 19, Vite, Tailwind 4, React Router, PWA.
- `package.json` raíz — solo scripts que delegan en `server/` y `web/`.
- `scripts/dev.mjs` — lanza ambos en paralelo.

En desarrollo Vite (puerto 5173) redirige `/api` a la API en el puerto 3000. En producción la API sirve `web/dist`.

## Comandos (desde la raíz)

```bash
npm run instalar     # instala server/ y web/
npm run dev          # API :3000 + web :5173
npm test             # pruebas del servidor (node:test + PGlite en memoria)
npm run typecheck    # tsc en server/ y web/
npm run build        # compila web/dist
```

Antes de dar un cambio por terminado, ejecute `npm run typecheck` y `npm test`.

## Convenciones

- **Todo en español:** nombres de variables, funciones, archivos, rutas, comentarios y mensajes de error
  (`crearApp`, `rutasLaboratorio`, `ErrorHttp`, `paginas/`, `componentes/`). Mantenga ese idioma.
- Módulos ES con importaciones que incluyen la extensión `.ts` (`import { config } from './config.ts'`).
  `tsconfig` usa `verbatimModuleSyntax` y `erasableSyntaxOnly`: use `import type` para tipos
  y no use `enum`, `namespace` ni parámetros de propiedad en constructores.
- Configuración solo a través de `server/src/config.ts`; documente cada variable nueva en `server/.env.example`.
- Los errores HTTP se lanzan como `ErrorHttp(estado, mensaje)` y la validación con `ErrorValidacion`;
  el manejador central de `app.ts` los convierte en JSON.
- Los tipos de la API del lado del cliente viven en `web/src/api.ts`; actualícelos si cambia una respuesta.
- Pruebas con `node:test` y `node:assert/strict` en `server/test/`.

## Reglas de integridad (no romper)

- **Solo inserción:** los triggers de `server/src/db/esquema.ts` impiden `UPDATE`/`DELETE` sobre campos sellados
  y reemplazar un `tx_id` ya anclado. Una corrección es una **nueva versión** enlazada por `hash_anterior`,
  nunca una edición.
- **La verificación nunca confía en el hash guardado en la fila:** lo recalcula desde los datos actuales
  (`servicios/verificacion.ts`). No introduzca atajos que lean el hash almacenado.
- **No cambie el formato del registro canónico** (`integridad/canonico.ts`) sin versionarlo: invalidaría
  todos los hashes ya anclados.
- La interfaz `ServicioAnclaje` es fija; los proveedores nuevos se registran en `server/src/anclaje/index.ts`.
- El endpoint `/api/demo` (simular fraude) solo existe con `DEMO_ALTERAR=true` y nunca en producción.
- `JWT_SECRET` es obligatorio en producción.

## Datos de ejemplo

`server/src/semilla.ts` crea el lote `LT-2026-0457` y los usuarios `analista@lab001.test` y
`supervisor@lab001.test` (contraseña `minertrace123`). Para reiniciar PGlite, borre `server/datos/`.

## Git

- No agregue líneas `Co-Authored-By` ni firmas de herramientas de IA en commits ni PRs.
- No suba `.env`, `server/datos/`, `dist/` ni `node_modules/`.
