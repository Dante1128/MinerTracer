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
contracts/minertrace/        contrato Soroban (Rust): laboratorios, análisis versionados, marketplace con garantía
scripts/desplegar-testnet.mjs  cuentas de prueba + despliegue del contrato en testnet
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
npm test               # unitarias (canonicalización, validación) + flujo completo con PGlite en memoria
npm run typecheck
npm run contrato:test  # pruebas del contrato Soroban (cargo test)
```

## Fase 2: contrato Soroban (`contracts/minertrace`)

Un solo contrato, en Rust con `soroban-sdk` 28, que hace dos cosas:

- **Registro de análisis.** El administrador autoriza o revoca laboratorios (`add_lab`, `revoke_lab`, `is_lab`).
  Un laboratorio activo registra cada versión de un análisis con `submit_analysis`: el hash SHA-256 que calcula
  `server/src/integridad/canonico.ts`, el `hash_anterior` y la pureza en puntos básicos (92.50 % = 9250).
  Las versiones nunca se sobrescriben: la versión N+1 debe apuntar al hash de la N y venir del mismo laboratorio.
  La versión 1 crea el lote con su dueño.
- **Marketplace con garantía.** Estados del lote: `Certificado → EnVenta → EnGarantia → Vendido`, o `EnDisputa`.
  1. El dueño publica el lote con un precio (`list_batch`).
  2. El comprador paga al contrato, que retiene el dinero (`buy`).
  3. Un laboratorio distinto del que certificó el lote puede registrar un contra-análisis (`counter_analysis`).
     Si la pureza difiere más que la tolerancia, el lote pasa a `EnDisputa`.
  4. Sin disputa, el comprador confirma (`confirm`): el vendedor cobra y el lote cambia de dueño.
     En disputa, el comprador recupera el dinero (`refund`) y el lote queda bloqueado hasta que el laboratorio
     cuyo resultado se discutió registre un análisis nuevo.

El pago usa la interfaz estándar de tokens de Soroban: en testnet, el contrato del XLM nativo. Para usar otro token,
como USDC, basta con indicar su contrato al desplegar. Los errores son un enum tipado (`Error`), cada acción emite
un evento y cada escritura extiende el TTL del almacenamiento persistente.

### Desplegar en testnet

Requisitos: Rust con el target `wasm32v1-none` y el [Stellar CLI](https://developers.stellar.org/docs/tools/cli/install-cli).

```bash
rustup target add wasm32v1-none
npm run contrato:test        # 12 pruebas
npm run contrato:desplegar   # cuentas de prueba + despliegue + laboratorios autorizados
```

El script:

1. Crea con friendbot, o reutiliza, cinco identidades del CLI: `minertrace-admin`, `minertrace-lab-a`,
   `minertrace-lab-b`, `minertrace-vendedor` y `minertrace-comprador`. Sus claves quedan en la configuración
   global del CLI (`~/.config/stellar`), no en el repositorio. Para ver una: `stellar keys secret <nombre>`.
2. Compila el contrato y lo despliega. El constructor recibe el admin, el token y la tolerancia.
3. Autoriza los dos laboratorios e imprime el `CONTRACT_ID`.

Variables opcionales: `TOKEN_CONTRATO` (contrato del token; por defecto, el XLM nativo) y `TOLERANCIA_BPS`
(por defecto 200, es decir 2.00 %).

Testnet se reinicia periódicamente y borra cuentas y contratos. Si pasa, vuelva a ejecutar el script:
refondea las mismas identidades y despliega un contrato nuevo.

## Pendiente

- **Etapa 2:** `AnclajeStellar` (`ANCLAJE=stellar`) que registre los análisis en el contrato y verifique contra él.
- **Etapa 3:** marketplace en el frontend con Freighter.
- **Etapa 4:** firma del laboratorio con su propia wallet.
