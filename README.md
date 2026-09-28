# MinerTrace — Fase 1

Trazabilidad e integridad de análisis minerales. El diseño completo está en [MinerTrace.md](MinerTrace.md).

Esta fase incluye la aplicación web completa y el backend, con el hashing real (RFC 8785 + SHA-256).
El **anclaje en Stellar está simulado** (`AnclajeMock`); ver la sección 17 del documento para la Fase 2.

## Arranque rápido

Requisitos: Node.js 22 o superior (probado con 24).

```bash
npm run instalar          # instala server/ y web/
cp server/.env.example server/.env
npm run dev               # API en :3000 + web en http://localhost:5173
```

- Página del proyecto: http://localhost:5173
- Verificador público: http://localhost:5173/verificar/LT-2026-0457 (lote de ejemplo, 75% Sn)
- Portal del laboratorio: http://localhost:5173/laboratorio
  - `analista@lab001.test` / `minertrace123` (registra lotes y análisis)
  - `supervisor@lab001.test` / `minertrace123` (además registra correcciones)

Por defecto la base de datos es **PGlite** (PostgreSQL embebido en `server/datos/`), sin nada que instalar.
Para usar el PostgreSQL local, cree la base y defina `DATABASE_URL` en `server/.env`:

```bash
"C:\Program Files\PostgreSQL\16\bin\createdb.exe" -U postgres minertrace
# DATABASE_URL=postgres://postgres:CONTRASEÑA@localhost:5432/minertrace
```

Para empezar de cero con PGlite, borre `server/datos/`.

### Producción (un solo proceso)

```bash
npm run build             # compila web/dist
NODE_ENV=production JWT_SECRET=... npm start   # la API también sirve el frontend en :3000
```

## Demostración del fraude (sección 13)

1. Ingrese como analista y abra el análisis `AN-2026-0001`.
2. En el recuadro rojo **Simular fraude**, cambie 75.00 por 95.00 y pulse **Alterar**.
   Esto desactiva el trigger de solo inserción, modifica la pureza, recalcula el hash guardado en la fila
   y reemplaza el PDF, igual que haría un intermediario con acceso directo a la base de datos.
3. Abra la vista pública: **✕ Registro alterado**. El hash recalculado ya no coincide con el anclado
   y la huella del PDF tampoco.

Solo está disponible con `DEMO_ALTERAR=true` y nunca con `NODE_ENV=production`.

## Estructura

```
server/src/
  integridad/canonico.ts     registro canónico, JCS (RFC 8785), SHA-256, salt
  anclaje/ServicioAnclaje.ts interfaz fija del servicio de anclaje
  anclaje/AnclajeMock.ts     Fase 1 (TODO WEB3 → AnclajeStellar)
  anclaje/procesador.ts      anclaje asíncrono con reintentos y espera exponencial
  servicios/registro.ts      alta de lotes, análisis y correcciones (versiones)
  servicios/verificacion.ts  recalcula hash, consulta el anclaje, valida la firma y el PDF
  db/esquema.ts              tablas + triggers de solo inserción
  rutas/                     API del laboratorio, pública y de demostración
web/src/
  paginas/                   Inicio, Verificar, ResultadoLote, Login, Panel, NuevoAnalisis, DetalleAnalisis
  componentes/               formulario de análisis, escáner QR, verificación, insignias
```

## Decisiones de diseño

- **Registro canónico:** incluye los datos del lote, el SHA-256 del PDF, un `salt` aleatorio, el número de versión
  y el `hash_anterior`. El salt se publica junto al registro canónico para que la verificación independiente funcione.
- **Solo inserción en la base de datos:** los triggers impiden `UPDATE` o `DELETE` sobre los campos sellados
  y que se reemplace un `tx_id` ya anclado. Una corrección es una nueva versión enlazada por hash.
- **La verificación nunca confía en el hash guardado en la fila:** lo recalcula a partir de los datos actuales
  y lo compara con el anclado, porque quien altera los datos puede alterar también esa columna.
- **Interfaz de anclaje:** `anclar(hash, laboratorioId)` recibe también el laboratorio (el documento solo pasa el hash),
  porque en Stellar la transacción debe firmarse con la clave de ese laboratorio.
- **Verificación independiente:** `GET /api/publico/analisis/:id/v/:version/canonico.json` devuelve el texto exacto
  que se hasheó; `sha256sum` sobre ese archivo da el hash anclado.

## Pruebas

```bash
npm test          # unitarias (canonicalización, validación) + flujo completo con PGlite en memoria
npm run typecheck
```

## Pendiente: Fase 2 (Web3)

Busque `TODO WEB3` en el código. Resumen: implementar `AnclajeStellar` (MEMO_HASH en Testnet),
registrarlo en `server/src/anclaje/index.ts` con `ANCLAJE=stellar`, devolver la URL del explorador en `urlExplorador`,
guardar las claves de forma segura y re-anclar o marcar como prueba los anclajes simulados.
