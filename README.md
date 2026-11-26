---
title: MinerTrace
emoji: ⛏️
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# MinerTrace — comercialización P2P con análisis verificables

Trazabilidad e integridad de análisis minerales. El diseño completo está en [MinerTrace.md](MinerTrace.md).
Para usar y presentar la aplicación (vistas, credenciales, wallet, transacciones y guiones de demo), vea [GUIA.md](GUIA.md);
para la explicación técnica de la capa blockchain (Stellar, contrato Soroban, hashing, firmas), vea [TECNICO.md](TECNICO.md).
La organización de modelos, controladores y vistas está en [ARQUITECTURA.md](ARQUITECTURA.md).

Incluye anuncios de compra y venta, ofertas, acuerdos con importes explícitos, pago en garantía,
recepción y resolución de incidencias, apoyados por informes de laboratorio verificables.
Con `ANCLAJE=mock` se simula el anclaje; con `ANCLAJE=stellar` el contrato Soroban opera en **testnet**.
La capa comercial v2 requiere un contrato nuevo con `get_comercio().version = 2`; el diseño inicial de
`MinerTrace.md` conserva referencias a fases anteriores.

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

Conserve las bases de datos anteriores. Para probar otro contrato use una carpeta nueva mediante el
lanzador comercial siguiente; nunca mezcle registros anclados a contratos distintos.

### Arranque comercial aislado

Necesita las dependencias instaladas, Freighter en Testnet y las cuentas de laboratorio existentes en
`server/.env` (`STELLAR_CUENTA_LAB_001/002` o sus claves de desarrollo). El lanzador reutiliza esa
configuración sin mostrar claves ni modificar el archivo.

```powershell
# Usa el contrato comercial de demostración guardado en scripts/comercio-testnet.json:
npm run dev:comercio

# Para crear OTRO contrato (por ejemplo, tras un reinicio de testnet):
npm run contrato:desplegar
# El despliegue actualiza la referencia pública; también puede indicar otro ID explícitamente:
$env:COMERCIO_CONTRATO_ID="C..."
npm run dev:comercio
```

Abra `http://localhost:5173/comercio`. La referencia incluida se desplegó el 26 de noviembre de 2026 en
[Stellar Testnet](https://stellar.expert/explorer/testnet/contract/CDW23R3BPE3UAV3E7ZMUTEIP2PFM4KDYNDIQCCPRPJWEQS634XMQWNYP).
Los reinicios de testnet pueden invalidarla. En PowerShell puede usar `npm.cmd` si la política local bloquea `npm.ps1`.

El lanzador crea o reutiliza `server/datos-comercio-<identificador-corto>/`, fuerza PGlite y transmite al
proceso hijo `ANCLAJE=stellar` y el contrato indicado. **No escribe `.env`, no borra datos y no usa la
base PostgreSQL que pudiera tener configurada.** Para volver a una demo anterior, detenga los procesos y
arranque con su configuración anterior. Detenga la vista previa antes de iniciar otra API sobre la misma
carpeta PGlite: esa base embebida debe usarse desde un único proceso. Cambiar únicamente el código local
no actualiza un contrato desplegado.

### Producción (un solo proceso)

```bash
npm run build             # compila web/dist
# Configure JWT_SECRET, ORIGEN_PUBLICO y SMTP en server/.env (vea PRODUCCION.md).
npm run cuenta:crear      # crea el laboratorio y su primer supervisor por invitación
NODE_ENV=production npm start   # la API también sirve el frontend en :3000
```

La preparación completa está en [PRODUCCION.md](PRODUCCION.md). El arranque de
producción no crea usuarios demo. El supervisor administra su equipo desde
**Usuarios** y cada persona elige su contraseña mediante un enlace de correo.
**Mi cuenta** permite cambiar contraseña y cerrar todas las sesiones; el acceso
incluye recuperación. Las sesiones usan cookies HttpOnly y protección CSRF; ya
no se guardan credenciales en localStorage.

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
  modelos/                  consultas del laboratorio por entidad
  controladores/            validación HTTP y respuestas de la API
  comercio/                 perfiles, anuncios, negociación, evidencias y cálculos del comercio v2
  integridad/canonico.ts     registro canónico, JCS (RFC 8785), SHA-256, salt
  anclaje/ServicioAnclaje.ts interfaz fija del servicio de anclaje
  anclaje/AnclajeMock.ts     anclaje simulado (ANCLAJE=mock)
  anclaje/AnclajeStellar.ts  anclaje en el contrato Soroban de testnet (ANCLAJE=stellar)
  anclaje/procesador.ts      anclaje asíncrono con reintentos y espera exponencial
  servicios/registro.ts      alta de lotes, análisis y correcciones (versiones)
  servicios/verificacion.ts  recalcula hash, consulta el anclaje, valida la firma y el PDF
  db/esquema.ts              tablas + triggers de solo inserción
  rutas/                     URLs y middlewares del laboratorio, comercio y verificación pública
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

## Contrato Soroban y comercio v2 (`contracts/minertrace`)

Un solo contrato, en Rust con `soroban-sdk` 28, que hace dos cosas:

- **Registro de análisis.** El administrador autoriza o revoca laboratorios (`add_lab`, `revoke_lab`, `is_lab`).
  Un laboratorio activo registra cada versión de un análisis con `submit_analysis`: el hash SHA-256 que calcula
  `server/src/integridad/canonico.ts`, el `hash_anterior` y la pureza en puntos básicos (92.50 % = 9250).
  Las versiones nunca se sobrescriben: la versión N+1 debe apuntar al hash de la N y venir del mismo laboratorio.
  La versión 1 crea el lote con su dueño.
- **Marketplace con garantía.** Estados del lote: `Certificado → EnVenta → EnGarantia → Vendido`, o `EnDisputa`.
  1. Las partes negocian en `/comercio`; el vendedor firma el acuerdo y reserva el lote (`reservar_venta`).
     El catálogo de precio fijo conserva `list_batch`.
  2. El comprador financia precio + comisión con `financiar_orden`, que comprueba orden, total,
     análisis y versión esperados. El contrato retiene ambos importes y empieza el plazo de entrega.
  3. Un laboratorio distinto del que certificó el lote puede registrar un contra-análisis (`counter_analysis`).
     Si la pureza difiere más que la tolerancia, el lote pasa a `EnDisputa`.
  4. El comprador registra recepción o el laboratorio certificador atestigua la entrega. Desde ese momento
     empieza el plazo de inspección. Sin disputa, `confirm` reconoce recepción y libera el pago.
  5. Vencida la inspección (7 días por defecto) con recepción acreditada y sin disputa, el vendedor cobra con
     `claim`. Sin entrega, vencido su plazo (24 horas por defecto), el comprador puede cancelar si no hay
     recepción, contra-análisis ni incidencia física.
  6. Una discrepancia de pureza exige devolución acreditada antes de `refund`; una incidencia física necesita
     arbitraje del administrador. El reembolso devuelve precio + comisión. Una disputa por pureza mantiene
     bloqueado el lote hasta una nueva certificación del laboratorio correspondiente.

La comisión del comprador es **1 %**, con mínimo de **20 unidades del token de pago** en el despliegue por
defecto. Al completar la venta, el vendedor puede recibir una ayuda al ensayo de hasta **0,25 % del precio**,
limitada por gasto acreditado por el laboratorio, máximo de **100 tokens** y comisión disponible. Se paga
una sola vez por lote. El vendedor recibe precio + ayuda; la plataforma, comisión − ayuda. No se paga ayuda
ni comisión a la plataforma si hay reembolso. El gas de Stellar y los gastos externos se muestran separados.
Si el token es XLM, los importes son XLM de testnet: **no son bolivianos ni hay conversión implícita**.

El pago usa la interfaz estándar de tokens de Soroban: en testnet, el contrato del XLM nativo. Para usar otro token,
como USDC, basta con indicar su contrato al desplegar. Los errores son un enum tipado (`Error`), cada acción emite
un evento y cada escritura extiende el TTL del almacenamiento persistente.

### Desplegar en testnet

Requisitos: Rust con el target `wasm32v1-none` y el [Stellar CLI](https://developers.stellar.org/docs/tools/cli/install-cli).

```bash
rustup target add wasm32v1-none
npm run contrato:test        # pruebas del contrato y sus reglas comerciales
npm run contrato:desplegar   # cuentas de prueba + despliegue + laboratorios autorizados
```

El script:

1. Crea con friendbot, o reutiliza, las identidades del CLI `minertrace-admin`, `minertrace-lab-a`,
   `minertrace-lab-b`, `minertrace-vendedor`, `minertrace-comprador` y seis vendedores adicionales de demostración
   (`minertrace-vendedor-huanuni`, `-potosi`, `-tipuani`, `-sansimon`, `-colquiri`, `-chojlla`). Los nombres de
   cooperativas son ejemplos sintéticos, sin verificación de identidad. Sus claves quedan en la configuración
   global del CLI (`~/.config/stellar`), no en el repositorio. Para ver una: `stellar keys secret <nombre>`.
2. Compila el contrato y lo despliega. El constructor recibe el admin, el token y la tolerancia.
3. Configura el comercio v2, autoriza los dos laboratorios e imprime el `CONTRACT_ID`.

Variables opcionales: `TOKEN_CONTRATO` (contrato del token; por defecto, el XLM nativo), `TOLERANCIA_BPS`
(por defecto 200, es decir 2.00 %) y `PLAZO_GARANTIA_DIAS` (por defecto 7) o `PLAZO_GARANTIA_SEG` (en segundos;
por ejemplo 20 para probar el cobro por vencimiento con `test-testnet/garantia.testnet.test.ts`, que con un plazo
largo se omite). `PLAZO_ENTREGA_SEG` cambia el plazo de entrega; `COMISION_MINIMA_TOKEN` y
`REINTEGRO_MAXIMO_TOKEN` expresan mínimo y tope en el token configurado; el script consulta sus decimales
y convierte exactamente a unidades mínimas. `DESTINATARIO_PLATAFORMA` elige la cuenta pública receptora
de la comisión neta. Estas variables se exportan al entorno del comando de despliegue; están documentadas
en `server/.env.example`.

`TOKEN_NATIVO=false` habilita el activo **USDC de prueba emitido por el script**; no representa dólares reales
ni el USDC de un emisor comercial. Se crean las líneas de confianza de las cuentas demo y de la plataforma.
Si esta última es una wallet externa, su dueño debe preparar y autorizar su línea antes del despliegue.
El valor por defecto sigue siendo XLM; la demo comercial de 2.000 XLM usa el contrato de referencia existente.
El recorrido validado en red usa XLM; la opción de USDC sintético conserva pendiente su validación en Testnet.

El contrato no tiene actualización de código: si cambia su lógica, despliegue uno nuevo. Use
`npm run dev:comercio` para conservar la base anterior y crear otra aislada. Las tarifas y destinatario sí
pueden configurarse por el administrador; solo afectan publicaciones futuras. Las condiciones ya
publicadas quedan congeladas.

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
3. Use una base de datos nueva (otro `DATOS_DIR`, conservando el anterior): las cuentas de los laboratorios
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

## Pantallas comerciales (requieren `ANCLAJE=stellar` y contrato v2)

Vendedores y compradores conectan [Freighter](https://www.freighter.app/) en **Testnet**, firman un desafío
de acceso y completan su perfil comercial. La firma de acceso no autoriza pagos; cada operación económica
requiere otra firma. Las sesiones usan cookies HttpOnly y protección CSRF.

| Ruta | Para | Qué hace |
|---|---|---|
| `/comercio` | todos | Anuncios de compra/venta, búsqueda y acceso al intercambio P2P |
| `/comercio/nuevo` | cuenta comercial | Publicar condiciones, precio y vigencia; venta asociada a un lote certificado |
| `/comercio/anuncios/:id` | partes | Proponer ofertas, negociar y aceptar un acuerdo |
| `/comercio/perfil` | cuenta comercial | Identidad comercial y datos de contacto |
| `/operaciones` y `/operaciones/:id` | comprador/vendedor | Reserva, financiación, importes, entrega, evidencia e incidencias |
| `/laboratorio/comercio` | laboratorio certificador | Acreditar gasto de ensayo antes de reservar; atestiguar entrega o devolución |
| `/revision` | administrador del contrato | Revisar incidencias y firmar una resolución explícita |
| `/mercado` | todos | Directorio de vendedores y lotes en venta leídos del contrato, con acceso a la negociación P2P |
| `/mercado/vendedor/:id` | todos | Perfil público declarado del vendedor, sus anuncios P2P y sus lotes en venta |
| `/mercado/:loteId` | comprador | Verificación del análisis y compra con total/análisis esperados (`financiar_orden`) |
| `/mis-lotes` | dueño / comprador | Publicar con precio (`list_batch`), confirmar la recepción (`confirm`) o pedir el reembolso en disputa (`refund`) |
| `/laboratorio/contra-analisis` | segundo laboratorio | Contra-análisis de un lote en garantía (`counter_analysis`) |
| `/verificar/:loteId` | todos | Además del análisis: estado comercial, contra-análisis y línea de tiempo |

**Cómo se firma:** el servidor arma la transacción sin firmar (`POST /api/mercado/comercial/preparar`), Freighter
la muestra y la firma en el navegador, y el servidor la envía y espera la confirmación
(`POST /api/mercado/comercial/enviar`). El servidor nunca ve la clave de la wallet, y solo envía la
invocación pedida, a este contrato y desde la cuenta indicada. La web solo carga `@stellar/freighter-api`.

**Estado y línea de tiempo:** el estado comercial siempre se lee del contrato. Un indexador copia los eventos
del contrato en la tabla `eventos_contrato` (el RPC solo los conserva unos días) para mostrar la línea de tiempo:
certificado, publicado, comprado, contra-análisis, vendido o reembolsado.

**Contra-análisis:** se sella con su propio registro canónico (`"tipo":"contra_analisis"`) y se registra en el
contrato. La página pública lo verifica contra el contrato y ofrece su registro canónico y su PDF.
Lo firma la wallet del laboratorio, igual que los análisis.

**Para probarlo:** importe en Freighter las cuentas de prueba (`stellar keys secret minertrace-vendedor` y
`minertrace-comprador`), o use cuentas propias fondeadas con friendbot. Registre un lote indicando como dueño
la dirección del vendedor y siga el flujo: anunciar → ofertar → acordar → reservar → financiar → acreditar
entrega → confirmar, o abrir incidencia. Un reembolso de metal entregado exige acreditar su devolución.

`npm run test:testnet` incluye una prueba del marketplace con cuentas nuevas fondeadas con friendbot.

## Datos de demostración

Los laboratorios, informes y lotes de ejemplo son **sintéticos**. La nueva demo comercial se prepara desde
las pantallas de registro, anuncios y operaciones; no constituye evidencia de origen minero comprobado.

Puede cargar una demo comercial completa mediante el script de desarrollo, exclusivamente en el contrato
comercial de referencia y en un puerto local separado:

```powershell
# Primera terminal: API en :3018 y web en :5173.
$env:PORT="3018"
npm.cmd run dev:comercio
# Segunda terminal:
npm.cmd run demo:comercio -- --url http://localhost:3018
```

El script verifica contrato, red, token, tarifas y firma con wallet antes de crear datos. Necesita las identidades
CLI `minertrace-vendedor`, `minertrace-comprador` y el laboratorio configurado. Crea un anuncio abierto y una venta
cerrada de **2.000 XLM de Testnet**: comprador paga 2.020, vendedor recibe 2.005 y plataforma 15. El ensayo sintético
de 50 se refleja como gasto externo; el script no paga ese servicio. Volver a ejecutarlo reutiliza los registros
y comprueba la liquidación, sin borrar datos. No se ejecuta automáticamente al arrancar el portal.

El poblado histórico siguiente fue diseñado para el flujo anterior de laboratorio/mercado. Sus escenarios
de disputa deben acreditar devolución antes de reembolsar en un contrato v2:

```bash
npm run demo:poblar
```

Registra 18 lotes sintéticos inspirados en minería boliviana (oro, plata, estaño y otros), repartidos entre seis
vendedores de demostración. Usa la API, igual que la web, y firma cada paso con la cuenta que correspondería
en Freighter (laboratorio, vendedor o comprador). Requiere haber preparado esas identidades con el despliegue.
Todo queda en el
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

- **Retirar una publicación:** comercio v2 dispone de `cancelar_venta` para ventas aún sin financiar.
- **Firma con passkeys para el técnico de laboratorio (evaluado, no implementado).** El camino vigente es el
  [Smart Account Kit](https://github.com/stellar/smart-account-kit) (SDK oficial sobre las cuentas inteligentes de
  OpenZeppelin, con verificación WebAuthn/secp256r1 en la cadena desde el protocolo 21). Implica:
  la cuenta del laboratorio pasa a ser un contrato (dirección `C…`) con una passkey por técnico;
  desplegar el contrato de cuenta y el verificador WebAuthn en testnet; autorizar esa dirección `C…` con `add_lab`;
  que el servidor (o un relayer) pague las comisiones, porque una cuenta contrato no puede ser origen de la
  transacción (la passkey firma la entrada de autorización, no el sobre); y cargar el SDK de Stellar en la web.
  El contrato MinerTrace no cambia: `require_auth` acepta cuentas contrato. El kit no está auditado y pide
  `@stellar/stellar-sdk` ^16.3 (el servidor usa la 17). Estimación: 3 a 5 días de trabajo, más pruebas en dispositivos.
