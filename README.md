---
title: MinerTrace
emoji: ⛏️
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# MinerTrace — Fase 1

Trazabilidad e integridad de análisis minerales. El diseño completo está en [MinerTrace.md](MinerTrace.md).
Para usar y presentar la aplicación (vistas, credenciales, wallet, transacciones y guiones de demo), vea [GUIA.md](GUIA.md).

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
  - `analista@lab002.test` y `supervisor@lab002.test`: segundo laboratorio (`LAB-002`), para contra-análisis

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
  anclaje/AnclajeMock.ts     anclaje simulado (ANCLAJE=mock)
  anclaje/AnclajeStellar.ts  anclaje en el contrato Soroban de testnet (ANCLAJE=stellar)
  anclaje/procesador.ts      anclaje asíncrono con reintentos y espera exponencial
  servicios/registro.ts      alta de lotes, análisis y correcciones (versiones)
  servicios/verificacion.ts  recalcula hash, consulta el anclaje, valida la firma y el PDF
  db/esquema.ts              tablas + triggers de solo inserción
  rutas/                     API del laboratorio, pública y de demostración
web/src/
  paginas/                   Inicio, Verificar, ResultadoLote, Login, Panel, NuevoAnalisis, DetalleAnalisis
  componentes/               formulario de análisis, escáner QR, verificación, insignias
server/src/mercado/          marketplace: estado comercial desde el contrato, transacciones para la wallet, indexador de eventos
web/src/wallet.tsx           conexión con Freighter (testnet), firma de transacciones
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
- **Interfaz de anclaje:** `anclar` recibe el análisis completo (laboratorio, lote, versión, hash anterior, pureza,
  dueño), no solo el hash, porque el contrato registra todo eso y la transacción la firma el laboratorio.
  `consultarAnclaje` recibe también `(analisis_id, version)`: se lee el estado del contrato, porque el RPC de
  Stellar solo conserva las transacciones unos días.
- **Verificación independiente:** `GET /api/publico/analisis/:id/v/:version/canonico.json` devuelve el texto exacto
  que se hasheó; `sha256sum` sobre ese archivo da el hash anclado.

## Pruebas

```bash
npm test               # unitarias (canonicalización, validación) + flujo completo con PGlite en memoria
npm run typecheck
npm run contrato:test  # pruebas del contrato Soroban (cargo test)
npm run test:testnet   # integración real contra el contrato en testnet (ver "Anclaje real")
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
  5. **Plazo de la garantía:** si el comprador no confirma ni hay disputa antes de que venza el plazo
     (7 días por defecto, contados desde la compra), el vendedor puede cobrar (`claim`) y el lote pasa al
     comprador, igual que si hubiera confirmado. En disputa no se puede cobrar: solo cabe el reembolso.

El pago usa la interfaz estándar de tokens de Soroban: en testnet, el contrato del XLM nativo. Para usar otro token,
como USDC, basta con indicar su contrato al desplegar. Los errores son un enum tipado (`Error`), cada acción emite
un evento y cada escritura extiende el TTL del almacenamiento persistente.

### Desplegar en testnet

Requisitos: Rust con el target `wasm32v1-none` y el [Stellar CLI](https://developers.stellar.org/docs/tools/cli/install-cli).

```bash
rustup target add wasm32v1-none
npm run contrato:test        # 15 pruebas
npm run contrato:desplegar   # cuentas de prueba + despliegue + laboratorios autorizados
```

El script:

1. Crea con friendbot, o reutiliza, cinco identidades del CLI: `minertrace-admin`, `minertrace-lab-a`,
   `minertrace-lab-b`, `minertrace-vendedor` y `minertrace-comprador`. Sus claves quedan en la configuración
   global del CLI (`~/.config/stellar`), no en el repositorio. Para ver una: `stellar keys secret <nombre>`.
2. Compila el contrato y lo despliega. El constructor recibe el admin, el token y la tolerancia.
3. Autoriza los dos laboratorios e imprime el `CONTRACT_ID`.

Variables opcionales: `TOKEN_CONTRATO` (contrato del token; por defecto, el XLM nativo), `TOLERANCIA_BPS`
(por defecto 200, es decir 2.00 %) y `PLAZO_GARANTIA_DIAS` (por defecto 7) o `PLAZO_GARANTIA_SEG` (en segundos;
por ejemplo 20 para probar el cobro por vencimiento con `test-testnet/garantia.testnet.test.ts`, que con un plazo
largo se omite).

El contrato no se puede modificar una vez desplegado: si cambia su código, vuelva a desplegarlo y actualice
`STELLAR_CONTRATO_ID` (y empiece con una base de datos nueva).

Testnet se reinicia periódicamente y borra cuentas y contratos. Si pasa, vuelva a ejecutar el script:
refondea las mismas identidades y despliega un contrato nuevo.

## Anclaje real en Stellar (`ANCLAJE=stellar`)

Con `ANCLAJE=stellar`, `AnclajeStellar` (`server/src/anclaje/AnclajeStellar.ts`) registra cada versión con
`submit_analysis` en el contrato, y la verificación lee el contrato (`get_analysis`, `is_lab`), nunca la base de datos.
El enlace de cada transacción lleva a stellar.expert (testnet).

1. Despliegue el contrato: `npm run contrato:desplegar` (imprime el `CONTRACT_ID`).
2. En `server/.env` (ver `server/.env.example`):
   ```bash
   ANCLAJE=stellar
   STELLAR_CONTRATO_ID=C...                 # el que imprimió el script
   STELLAR_SECRETO_LAB_001=S...             # stellar keys secret minertrace-lab-a
   STELLAR_SECRETO_LAB_002=S...             # stellar keys secret minertrace-lab-b
   STELLAR_DUENO_DEMO=G...                  # opcional: stellar keys public-key minertrace-vendedor
   ```
3. Use una base de datos nueva (otro `DATOS_DIR` o borre `server/datos/`): las cuentas de los laboratorios
   sembrados en modo mock no son las de testnet.
4. `npm run dev`. La semilla ancla el lote de ejemplo en el contrato en unos segundos.

**Quién firma:** el laboratorio, con su wallet (ver "El laboratorio firma con su propia wallet"). Las claves
`STELLAR_SECRETO_*` solo sirven para la semilla, las pruebas y `FIRMA_LABORATORIO=servidor`. Nunca las suba al repositorio.

El contrato es persistente: si reinicia la base de datos, despliegue también un contrato nuevo. Si no, los
`analisis_id` de la base nueva (`AN-2026-0001`…) chocarían con los ya registrados y el anclaje fallaría con
"El contrato ya tiene otra versión…". Si el servidor se cae después de enviar una transacción, el reintento no
duplica nada: encuentra el registro en el contrato y recupera el ID de la transacción desde sus eventos.

`npm run test:testnet` ejecuta la prueba de integración: registra, ancla, corrige, verifica y detecta un fraude
contra el contrato real. Necesita `STELLAR_CONTRATO_ID`, `STELLAR_SECRETO_LAB_001` y `STELLAR_SECRETO_LAB_002`
y usa códigos de lote y análisis únicos en cada ejecución.

## Marketplace con garantía (requiere `ANCLAJE=stellar`)

Vendedores y compradores no tienen usuario ni contraseña: se identifican con su wallet
[Freighter](https://www.freighter.app/) en la red **Testnet**.

| Ruta | Para | Qué hace |
|---|---|---|
| `/mercado` | todos | Lotes en venta leídos del contrato: pureza certificada, laboratorio, precio, estado |
| `/mercado/:loteId` | comprador | Verificación completa del análisis + estado comercial + **Comprar** (firma `buy`) |
| `/mis-lotes` | dueño / comprador | Publicar con precio (`list_batch`), confirmar la recepción (`confirm`) o pedir el reembolso en disputa (`refund`) |
| `/laboratorio/contra-analisis` | segundo laboratorio | Contra-análisis de un lote en garantía (`counter_analysis`) |
| `/verificar/:loteId` | todos | Además del análisis: estado comercial, contra-análisis y línea de tiempo |

**Cómo se firma:** el servidor arma la transacción sin firmar (`POST /api/mercado/transacciones`), Freighter
la muestra y la firma en el navegador, y el servidor la envía y espera la confirmación
(`POST /api/mercado/transacciones/enviar`). El servidor nunca ve la clave de la wallet, y solo envía la
invocación pedida, a este contrato y desde la cuenta indicada. La web solo carga `@stellar/freighter-api`.

**Estado y línea de tiempo:** el estado comercial siempre se lee del contrato. Un indexador copia los eventos
del contrato en la tabla `eventos_contrato` (el RPC solo los conserva unos días) para mostrar la línea de tiempo:
certificado, publicado, comprado, contra-análisis, vendido o reembolsado.

**Contra-análisis:** se sella con su propio registro canónico (`"tipo":"contra_analisis"`) y se registra en el
contrato. La página pública lo verifica contra el contrato y ofrece su registro canónico y su PDF.
Lo firma la wallet del laboratorio, igual que los análisis.

**Para probarlo:** importe en Freighter las cuentas de prueba (`stellar keys secret minertrace-vendedor` y
`minertrace-comprador`), o use cuentas propias fondeadas con friendbot. Registre un lote indicando como dueño
la dirección del vendedor y siga el flujo: publicar → comprar → (contra-análisis) → confirmar o reembolsar.

`npm run test:testnet` incluye una prueba del marketplace con cuentas nuevas fondeadas con friendbot.

## Datos de demostración en testnet

Con el servidor en marcha (`npm run dev`, con `ANCLAJE=stellar`) y las cuentas del script de despliegue:

```bash
npm run demo:poblar
```

Registra 18 lotes de minería boliviana (oro, plata, estaño y otros) usando la API, igual que la web, y firma
cada paso con la cuenta que correspondería en Freighter (laboratorio, vendedor o comprador). Todo queda en el
contrato de testnet:

| Estado tras poblar | Oro | Plata | Estaño | Otros |
|---|---|---|---|---|
| En venta | 0508 (300 XLM) | 0512 (110 XLM) | 0457, 0501, 0515, 0517 (certifica LAB-002) | 0506 wolframio (LAB-002) |
| Vendido (contra-análisis dentro de tolerancia) | 0509 | 0502, 0513 | | |
| En garantía: el comprador puede confirmar | 0510 | | 0516 | 0503 zinc |
| En disputa: el comprador puede pedir el reembolso | 0511 | | | 0504 plomo |
| Certificado con corrección (v1 y v2) | | 0514 | 0505 | |
| Esperando la firma del laboratorio con Freighter | 0518 | | | 0507 antimonio |

Todos los códigos son `LT-2026-XXXX`. Las transacciones del contrato se ven en
`https://stellar.expert/explorer/testnet/contract/<STELLAR_CONTRATO_ID>`.

Los lotes que ya existen se omiten, así que se puede volver a ejecutar.

## El laboratorio firma con su propia wallet

Con `FIRMA_LABORATORIO=wallet` (por defecto), el servidor no firma los análisis del portal:

1. El analista registra el análisis. Queda guardado como **pendiente**: registrar nunca depende de la red.
2. En el detalle del análisis aparece **Firmar y anclar con Freighter**. El servidor arma `submit_analysis`
   con el hash que él calculó; Freighter muestra la transacción y el laboratorio la firma.
3. El servidor la envía y **solo marca `anclado` después de leer el contrato** y comprobar que esa versión
   existe con el mismo hash y la cuenta del laboratorio.

**Convivencia con el procesador asíncrono:** el procesador ya no firma esos análisis; los **reconcilia**.
Cada minuto busca en el contrato los que esperan firma. Si la transacción llegó a la red, pero el navegador
se cerró antes de avisar o se firmó desde otro equipo, la encuentra y recupera su ID desde los eventos.
Solo firma los análisis marcados con `firma_servidor` (la semilla, cuando hay `STELLAR_SECRETO_LAB_001`).

El contra-análisis sigue el mismo principio: preparar (el servidor sella el registro) → firmar con Freighter →
enviar. Se guarda solo si el contrato registró exactamente ese hash.

Para probarlo, importe en Freighter la cuenta del laboratorio (`stellar keys secret minertrace-lab-a`) y
conéctela en el portal. `FIRMA_LABORATORIO=servidor` conserva el modo anterior (firma el servidor con
`STELLAR_SECRETO_*`), útil para desarrollar sin Freighter.

## Pendiente

- **Retirar una publicación:** el contrato no tiene `unlist_batch`; un lote publicado sin comprador no se puede retirar.
- **Firma con passkeys para el técnico de laboratorio (evaluado, no implementado).** El camino vigente es el
  [Smart Account Kit](https://github.com/stellar/smart-account-kit) (SDK oficial sobre las cuentas inteligentes de
  OpenZeppelin, con verificación WebAuthn/secp256r1 en la cadena desde el protocolo 21). Implica:
  la cuenta del laboratorio pasa a ser un contrato (dirección `C…`) con una passkey por técnico;
  desplegar el contrato de cuenta y el verificador WebAuthn en testnet; autorizar esa dirección `C…` con `add_lab`;
  que el servidor (o un relayer) pague las comisiones, porque una cuenta contrato no puede ser origen de la
  transacción (la passkey firma la entrada de autorización, no el sobre); y cargar el SDK de Stellar en la web.
  El contrato MinerTrace no cambia: `require_auth` acepta cuentas contrato. El kit no está auditado y pide
  `@stellar/stellar-sdk` ^16.3 (el servidor usa la 17). Estimación: 3 a 5 días de trabajo, más pruebas en dispositivos.
