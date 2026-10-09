# MinerTrace — Guía completa del proyecto y de la demo

Todo lo construido hasta ahora: qué hace el sistema, cada vista y sus funciones, credenciales, cómo conectar
una wallet, cómo ver las transacciones en Stellar testnet, el contrato, y guiones para la demo.

> El diseño original está en [MinerTrace.md](MinerTrace.md) y la instalación en [README.md](README.md).

## Índice

1. [Qué es MinerTrace](#1-qué-es-minertrace)
2. [Flujo completo y roles](#2-flujo-completo-y-roles)
3. [Qué es real y qué es de prueba](#3-qué-es-real-y-qué-es-de-prueba)
4. [Arrancar la aplicación](#4-arrancar-la-aplicación)
5. [Credenciales y cuentas](#5-credenciales-y-cuentas)
6. [Conectar la wallet (Freighter)](#6-conectar-la-wallet-freighter)
7. [Cada vista: acceso y funciones](#7-cada-vista-acceso-y-funciones)
8. [El contrato en Stellar](#8-el-contrato-en-stellar)
9. [Ver las transacciones en testnet](#9-ver-las-transacciones-en-testnet)
10. [Datos de la demo (19 lotes)](#10-datos-de-la-demo-19-lotes)
11. [Guiones para la demo](#11-guiones-para-la-demo)
12. [Arquitectura y tecnologías](#12-arquitectura-y-tecnologías)
13. [Limitaciones y pendientes](#13-limitaciones-y-pendientes)
14. [Problemas frecuentes](#14-problemas-frecuentes)

---

## 1. Qué es MinerTrace

Un **marketplace de lotes minerales cuya clave es la certificación del laboratorio**. El informe de laboratorio
define el precio de un lote, pero suele ser un PDF o un registro que cualquiera con acceso puede cambiar
(un 75 % de pureza que se vende como 95 %). MinerTrace lo resuelve en tres capas:

1. **Certificación sellada.** Cada análisis se convierte en un registro canónico (JSON RFC 8785) y se calcula
   su huella SHA-256, que incluye la huella del PDF. Esa huella se registra en un **contrato inteligente en
   Stellar**, firmada por la wallet del laboratorio. Nadie puede cambiar el análisis sin que se note.
2. **Verificación pública.** Cualquiera escanea el QR del lote y el sistema recalcula la huella desde los datos
   actuales y la compara con la del contrato: **íntegro** o **alterado**.
3. **Venta con garantía.** El dueño publica el lote; el comprador paga y el **contrato retiene el dinero**.
   Un segundo laboratorio puede hacer un **contra-análisis**: si la pureza difiere más que la tolerancia (2 %),
   el lote entra en **disputa** y el comprador recupera su dinero. Si todo está bien, el comprador confirma y
   el vendedor cobra. Si el comprador no responde en 7 días, el vendedor puede cobrar.

**Qué garantiza y qué no:** garantiza que el resultado registrado no se alteró después, quién lo registró y
cuándo. No garantiza que la medición física sea correcta: eso depende del laboratorio y sus acreditaciones.
Por eso existe el contra-análisis.

---

## 2. Flujo completo y roles

### 2.1 Los actores

| Rol | Quién es en la vida real | Cómo se identifica | Qué hace | Qué **no** puede hacer |
|---|---|---|---|---|
| **Administrador** | MinerTrace o una autoridad minera | Wallet `minertrace-admin` (solo por consola) | Autoriza y revoca laboratorios en el contrato | Cambiar análisis, mover el dinero en garantía, comprar ni vender por otros |
| **Laboratorio certificador** (LAB-001) | Laboratorio acreditado (ISO/IEC 17025) | Usuarios con contraseña + wallet del laboratorio (`lab-a`) | El **analista** registra lotes y análisis; el **supervisor** además corrige; ambos firman con la wallet del laboratorio | Editar o borrar un análisis ya registrado (solo agregar versiones); contra-analizar sus propios lotes |
| **Laboratorio de contraste** (LAB-002) | Segundo laboratorio independiente | Usuarios con contraseña + wallet `lab-b` | Hace **contra-análisis** de lotes vendidos por otros laboratorios; también puede certificar sus propios lotes | Contra-analizar un lote que no está en garantía, o hacerlo dos veces en la misma venta |
| **Dueño / vendedor** | Cooperativa minera o productor | Solo su wallet (`vendedor`) | Publica sus lotes con precio; cobra al confirmar el comprador o al vencer la garantía | Comprar su propio lote; cobrar antes del plazo o con el lote en disputa; publicar un lote en disputa |
| **Comprador** | Comercializadora, exportadora, fundición | Solo su wallet (`comprador`) | Compra (paga en garantía), confirma la recepción o pide el reembolso si hay disputa | Recuperar el dinero sin una disputa; confirmar una compra ajena |
| **Verificador público** | Auditor, regulador, aduana, cualquier persona | Ninguna (sin cuenta) | Verifica un lote con su código o QR y comprueba la evidencia en el explorador | Modificar nada |
| **Contrato MinerTrace** | Programa en la blockchain (árbitro automático) | Dirección `CAHKM…` | Guarda las huellas, custodia el dinero y aplica las reglas | Ser modificado por nadie, ni siquiera por MinerTrace |
| **Servidor MinerTrace** | La aplicación | — | Guarda los datos completos y los PDF, calcula las huellas, arma las transacciones y las envía | Firmar por las wallets (no tiene sus claves) ni marcar como anclado algo que no esté en el contrato |

### 2.2 El flujo de punta a punta

```
 ① ALTA DEL LABORATORIO           Administrador ──add_lab──► Contrato
          │
          ▼
 ② CERTIFICACIÓN                  Laboratorio (analista)
   muestra → análisis físico →    registra lote + análisis + PDF en el portal
                                   │  servidor: registro canónico → SHA-256 (huella)
                                   ▼
                                  Freighter (wallet del laboratorio) firma
                                   │  submit_analysis(hash, pureza, dueño…)
                                   ▼
                                  Contrato guarda la huella ──► lote CERTIFICADO
                                  Portal genera el QR para pegar en el lote
          │
          │   (si hubo un error) ③ CORRECCIÓN: supervisor registra la versión 2,
          │                         enlazada a la 1; se firma igual. La 1 nunca se borra.
          ▼
 ④ VERIFICACIÓN (en cualquier momento, por cualquiera)
   QR o código → el servidor recalcula la huella con los datos actuales
   → la compara con la del contrato → ÍNTEGRO o ALTERADO
          │
          ▼
 ⑤ PUBLICACIÓN                    Dueño ──list_batch(precio)──► Contrato ──► EN VENTA
          │                       (la venta copia la pureza certificada)
          ▼
 ⑥ COMPRA                         Comprador ──buy──► paga el precio AL CONTRATO ──► EN GARANTÍA
          │                       (vence en 7 días)
          ▼
 ⑦ CONTROL (opcional)             Laboratorio de contraste ──counter_analysis──►
          │                         diferencia ≤ 2,00 → sigue EN GARANTÍA
          │                         diferencia > 2,00 → EN DISPUTA
          ▼
 ⑧ CIERRE
   ┌─ sin disputa: comprador ──confirm──► el contrato paga al vendedor ──► VENDIDO (dueño = comprador)
   ├─ sin respuesta del comprador en 7 días: vendedor ──claim──► cobra ──► VENDIDO
   └─ en disputa: comprador ──refund──► recupera su dinero; el lote queda bloqueado
                  → el laboratorio certificador reanaliza (nueva versión) → vuelve a CERTIFICADO
          │
          ▼
 ⑨ REVENTA                        El nuevo dueño puede publicarlo otra vez (vuelve a ⑤)
```

### 2.3 Estados de un lote en el contrato

```
                    list_batch               buy
   CERTIFICADO ─────────────────► EN VENTA ───────► EN GARANTÍA ──confirm / claim──► VENDIDO
        ▲                                                │                              │
        │                                  counter_analysis                       list_batch
        │                                  fuera de tolerancia                    (reventa)
        │                                                ▼                              │
        └── nuevo análisis del laboratorio ◄── refund ── EN DISPUTA                     ▼
            certificador                                                            EN VENTA
```

### 2.4 Quién hace cada paso, dónde y con qué firma

| # | Paso | Rol | Dónde en la app | Cuenta en Freighter | Función del contrato | Resultado |
|---|---|---|---|---|---|---|
| 1 | Autorizar laboratorio | Administrador | Consola (`npm run contrato:desplegar`) | `admin` | `add_lab` | El laboratorio puede certificar |
| 2 | Registrar lote y análisis | Analista | Laboratorio → **Registrar análisis** | — | — | Guardado como *pendiente* |
| 3 | Firmar y anclar | Analista o supervisor | Detalle del análisis → **Firmar y anclar** | `lab-a` (o `lab-b`) | `submit_analysis` | **Certificado**; QR disponible |
| 4 | Corregir | Supervisor | Detalle → **Registrar corrección** | `lab-a` | `submit_analysis` (v2) | Versión nueva enlazada |
| 5 | Verificar | Cualquiera | **Verificar** / QR | — | lectura (`get_analysis`, `is_lab`) | Íntegro o alterado |
| 6 | Publicar | Dueño | **Mis lotes** → Publicar | `vendedor` | `list_batch` | **En venta** |
| 7 | Comprar | Comprador | **Mercado** → lote → Comprar | `comprador` | `buy` | **En garantía**; dinero en el contrato |
| 8 | Contra-análisis | Otro laboratorio | Laboratorio → **Contra-análisis** | `lab-b` | `counter_analysis` | Sigue en garantía o **en disputa** |
| 9a | Confirmar | Comprador | **Mis lotes** → Confirmar | `comprador` | `confirm` | **Vendido**; el vendedor cobra |
| 9b | Reembolso | Comprador | **Mis lotes** → Pedir reembolso | `comprador` | `refund` | Dinero devuelto; lote bloqueado |
| 9c | Cobro por vencimiento | Vendedor | **Mis lotes** → Cobrar | `vendedor` | `claim` | **Vendido** |
| 10 | Desbloquear tras disputa | Laboratorio certificador | Registrar análisis o corrección + firmar | `lab-a` | `submit_analysis` | Vuelve a **Certificado** |

### 2.5 El recorrido del dinero

```
            buy                         confirm  o  claim
Comprador ───────► CONTRATO (garantía) ─────────────────► Vendedor
    ▲                     │
    └──────── refund ─────┘   (solo si hay disputa por contra-análisis)
```

Nadie, ni MinerTrace ni el administrador, puede sacar el dinero del contrato por otro camino.

### 2.6 Qué pasa si alguien hace trampa

| Intento | Qué lo impide | Qué se ve |
|---|---|---|
| Alguien con acceso a la base de datos cambia 75 % por 95 % | La huella recalculada ya no coincide con la del contrato | **Registro alterado** en la verificación pública |
| Se reemplaza el PDF del informe | El SHA-256 del PDF forma parte de la huella | "El informe PDF fue reemplazado o modificado" |
| El laboratorio quiere "editar" un resultado ya registrado | El contrato no permite sobrescribir versiones | Solo puede publicar una corrección, que queda visible en el historial |
| Un laboratorio no autorizado (o revocado) registra análisis | `require_auth` + lista de laboratorios del contrato | El contrato lo rechaza; los análisis de un laboratorio revocado dejan de valer para vender |
| El laboratorio midió mal (o mintió) desde el inicio | El contra-análisis de otro laboratorio | **En disputa**: el comprador recupera su dinero |
| El vendedor quiere cobrar sin entregar | El dinero está en el contrato | Solo cobra cuando el comprador confirma, o a los 7 días si no hubo disputa |
| El comprador recibe y no confirma nunca | Plazo de garantía | A los 7 días el vendedor cobra con `claim` |
| Alguien quiere firmar en nombre de otro | Cada operación exige la firma de la wallet correspondiente | La transacción no se acepta |

---

## 3. Qué es real y qué es de prueba

| Elemento | ¿Real? | Detalle |
|---|---|---|
| Registros en la blockchain | **Real** | Contrato Soroban desplegado en Stellar **testnet**; cada transacción es pública y verificable en stellar.expert |
| Firmas | **Real** | Cada análisis lo firma la cuenta del laboratorio; cada compra, la del comprador (Freighter) |
| Pagos en garantía | **Real (con dinero de prueba)** | Se transfieren XLM de testnet al contrato y del contrato al vendedor o al comprador |
| Valor del dinero | De prueba | Los XLM de testnet no tienen valor; se obtienen gratis con *friendbot* |
| Laboratorios, usuarios y lotes | Datos de demostración | Creados por la semilla y por `npm run demo:poblar` |
| Botón "Simular fraude" | Simulación a propósito | Imita a alguien que altera la base de datos, para mostrar que se detecta |
| Modo `ANCLAJE=mock` | Simulado | Existe para desarrollar sin red; **la demo usa `ANCLAJE=stellar`** |

**Testnet** es la red de pruebas oficial de Stellar: funciona igual que la red principal (mainnet), con los
mismos contratos y exploradores, pero su dinero es de prueba. Pasar a mainnet solo exige desplegar el
contrato allí y usar dinero real (por ejemplo USDC); el código no cambia.

---

## 4. Arrancar la aplicación

Requisitos: Node.js 22+, el [Stellar CLI](https://developers.stellar.org/docs/tools/cli/install-cli) y Freighter
en el navegador. Desde la carpeta del proyecto, en Git Bash:

```bash
npm run instalar     # solo la primera vez
npm run dev          # API en :3000 y web en :5173
```

Abra **http://localhost:5173**. La consola debe decir `anclaje: stellar (testnet · contrato CAHKM…)`.

`server/.env` (no se sube a git) ya está configurado así:

| Variable | Valor | Para qué |
|---|---|---|
| `ANCLAJE` | `stellar` | Anclaje real en el contrato |
| `FIRMA_LABORATORIO` | `wallet` | El laboratorio firma con Freighter |
| `STELLAR_CONTRATO_ID` | `CAHKMOKFXWD3OTMT45SBLSWHCN7Y2PPQVZJIL6VBQYIMW3ZH22XVQFYK` | El contrato |
| `STELLAR_SECRETO_LAB_001/002` | (claves) | Solo para anclar el lote de ejemplo y para las pruebas |
| `STELLAR_DUENO_DEMO` | vendedor | Dueño del lote de ejemplo |
| `DEMO_ALTERAR` | `true` | Muestra el botón "Simular fraude" |

La configuración simulada anterior quedó en `server/.env.mock` y su base en `server/datos-mock`.

---

## 5. Credenciales y cuentas

### Usuarios del portal del laboratorio (correo + contraseña)

Contraseña de todos: **`minertrace123`**

| Correo | Persona | Laboratorio | Rol | Puede |
|---|---|---|---|---|
| `analista@lab001.test` | Ana Quispe | LAB-001 · Laboratorio Minero Andino | analista | Registrar lotes y análisis, firmarlos, contra-análisis de lotes de LAB-002 |
| `supervisor@lab001.test` | Carlos Mamani | LAB-001 | supervisor | Todo lo anterior **+ correcciones** (versiones nuevas) |
| `analista@lab002.test` | Rosa Condori | LAB-002 · Laboratorio de Contraste del Sur | analista | Igual, para LAB-002; hace los **contra-análisis** de lotes de LAB-001 |
| `supervisor@lab002.test` | Jorge Choque | LAB-002 | supervisor | Igual + correcciones |

### Wallets de Stellar testnet (se usan en Freighter, sin contraseña)

| Cuenta | Para qué | Dirección pública |
|---|---|---|
| `minertrace-lab-a` | Firma los análisis de **LAB-001** | `GCPCQ6JVHRMUZ7QPVDCK2AW3DRKU3WOXIPIUO72PKS2BA6W2M4UZHQWF` |
| `minertrace-lab-b` | Firma los análisis y contra-análisis de **LAB-002** | `GA4T7QXPQEMLTMR2GRSK327HKIY5QKAIXSQQBW4HH5J762Y422YO4VMU` |
| `minertrace-vendedor` | **Dueño/vendedor** de todos los lotes de la demo | `GBJZFZ52JRTIPAHXCXQPQ4OJKMVKOIGJDGOOYDPRQYEUZKBO3FQJPSSL` |
| `minertrace-comprador` | **Comprador** (~18 500 XLM de prueba) | `GDRILNQTFSNQA3HXC2BWSGVCPIJ3URVOXHKKRNM6P6IK7EJPRQYXTD5R` |
| `minertrace-admin` | Administrador del contrato (autoriza laboratorios; solo por consola) | `GD5C42D6F23JAKEULOZMDSDBHPPPFSCVVNODMTGMGCJDYD7UE64ZBVOM` |

Las **claves secretas** están solo en tu computadora (Stellar CLI). Para verlas e importarlas en Freighter:

```bash
stellar keys secret minertrace-lab-a
stellar keys secret minertrace-lab-b
stellar keys secret minertrace-vendedor
stellar keys secret minertrace-comprador
```

> Son cuentas de **testnet**: no tienen dinero real. Aun así, no las publiques ni las subas al repositorio.

**Regla clave:** las personas del laboratorio entran con correo y contraseña, pero lo que se registra en la
blockchain lo firma **la wallet del laboratorio**. Para firmar como LAB-001, Freighter debe tener seleccionada
la cuenta `lab-a`; la app avisa si conectas otra.

---

## 6. Conectar la wallet (Freighter)

1. Instala la extensión **Freighter** desde [freighter.app](https://www.freighter.app/) (Chrome, Brave, Firefox o Edge)
   y crea una wallet con una contraseña local (o desbloquea la existente).
2. **Cambia la red a Testnet**: en Freighter, abre el selector de red (arriba) y elige **Testnet**.
3. **Importa las cuentas de la demo**: en el menú de cuentas, elige la opción de **importar una clave secreta**
   y pega la clave que da `stellar keys secret minertrace-comprador`. Repite con `vendedor`, `lab-a` y `lab-b`.
   Ponles nombre (Comprador, Vendedor, Lab A, Lab B) para cambiar entre ellas con facilidad.
4. En la app, pulsa **Conectar wallet** (arriba a la derecha) y acepta en Freighter.
5. ✅ El botón muestra tu dirección abreviada. Si aparece **"Red incorrecta"** en rojo, Freighter no está en Testnet.
6. Para actuar como otro rol, **cambia de cuenta en Freighter**: la app lo detecta sola en unos segundos.

**Con una cuenta propia nueva** (por ejemplo, para que alguien del público compre): crea una cuenta en Freighter
en Testnet y fondéala con *friendbot* (el botón de fondeo de Freighter en testnet, o
`https://friendbot.stellar.org/?addr=<TU_DIRECCIÓN>`). Con eso ya puede comprar. Para que **venda**, el laboratorio
debe registrar un lote poniendo esa dirección como dueño.

---

## 7. Cada vista: acceso y funciones

La barra superior siempre muestra: **Verificar · Mercado · Mis lotes · Laboratorio · [wallet]**.
Al iniciar sesión como laboratorio aparece una segunda barra: **Panel · Registrar análisis · Contra-análisis**.

### 7.1 Inicio — `/`
- **Acceso:** logo de MinerTrace. Público.
- **Funciones:** explica el problema, cómo funciona en 4 pasos, qué garantiza y qué no; botones a
  **Verificar un lote**, **Ver el mercado** y **Portal del laboratorio**; atajo al lote de ejemplo.

### 7.2 Verificar — `/verificar`
- **Acceso:** menú **Verificar**. Público.
- **Funciones:** escribir el código del lote (ej. `LT-2026-0509`) o **escanear el QR** con la cámara del
  celular o la computadora; lleva al resultado de verificación.

### 7.3 Resultado de verificación — `/verificar/LT-…`
- **Acceso:** desde Verificar, escaneando el QR impreso, o con el enlace "Vista pública". Público.
- **Funciones:**
  - **Veredicto** en grande: ✓ *Registro íntegro*, ✕ *Registro alterado* (con los motivos), … *Anclaje pendiente*.
  - **Datos del análisis:** pureza, análisis y versión, método, fecha, analista, observaciones, composición
    química en barras y **enlace al PDF** del informe.
  - **Evidencia de integridad:** tres comprobaciones (los datos producen el mismo hash que el anclado; lo
    registró la cuenta del laboratorio y sigue autorizada; el PDF coincide), hash recalculado, hash anclado,
    transacción con **"Ver en el explorador ↗"**, fecha y cuenta firmante, SHA-256 del PDF.
  - **"Verificar por su cuenta"**: descarga del **registro canónico** (el texto exacto que se hasheó) e
    instrucciones para calcular el SHA-256 con cualquier herramienta y compararlo en el explorador.
  - **Historial de versiones** si hubo correcciones (cada versión con su veredicto y motivo).
  - **Estado comercial** (leído del contrato): estado, dueño, pureza certificada, precio, vendedor, comprador,
    vencimiento de la garantía y resultado del contra-análisis.
  - **Contra-análisis** registrados, con su propia verificación, PDF, registro canónico y transacción.
  - **Línea de tiempo** con cada evento del contrato (certificado, publicado, comprado, contra-análisis,
    vendido, reembolsado o cobrado por vencimiento) y su enlace a la transacción.

### 7.4 Mercado — `/mercado`
- **Acceso:** menú **Mercado**. Público (para comprar hace falta la wallet).
- **Funciones:** tarjetas de los lotes **en venta**, leídos del contrato: código, mineral, peso, origen,
  **pureza certificada**, precio en XLM y laboratorio que certificó. Clic en una tarjeta → detalle.

### 7.5 Detalle de mercado — `/mercado/LT-…`
- **Acceso:** clic en un lote del Mercado. Público; para comprar, wallet del comprador.
- **Funciones:** estado comercial y botón **"Comprar por N XLM"** (firma `buy` en Freighter), con los pasos
  *Preparando → Firme en Freighter → Enviando → Confirmada* y el enlace a la transacción. Avisa si la
  verificación no da "íntegro" antes de comprar. Debajo: la verificación completa del análisis.
- **Errores que muestra:** firma rechazada, red equivocada, **fondos insuficientes** (con el precio y el saldo),
  el vendedor no puede comprar su propio lote.

### 7.6 Mis lotes — `/mis-lotes`
- **Acceso:** menú **Mis lotes** o clic en el botón de la wallet. Requiere wallet conectada.
- **Funciones según el rol de la cuenta conectada:**

| Cuenta | Estado del lote | Botón / información |
|---|---|---|
| Dueño | Certificado o Vendido | **Publicar en el mercado** con precio (firma `list_batch`) |
| Vendedor | En venta | "Publicado: esperando comprador" |
| Vendedor | En garantía | Quién compró y desde cuándo puede cobrar; al vencer, **Cobrar** (firma `claim`) |
| Vendedor | En disputa | Aviso: el comprador puede pedir el reembolso |
| Dueño | En disputa, ya reembolsado | Bloqueado hasta que el laboratorio registre un análisis nuevo |
| Comprador | En garantía | **Confirmar recepción y liberar el pago** (firma `confirm`) y fecha límite |
| Comprador | En disputa | **Pedir reembolso** (firma `refund`) |

### 7.7 Login del laboratorio — `/laboratorio/login`
- **Acceso:** menú **Laboratorio** (si no hay sesión, redirige aquí).
- **Funciones:** correo y contraseña (ver sección 5). En desarrollo muestra los usuarios de prueba.

### 7.8 Panel — `/laboratorio`
- **Acceso:** menú **Laboratorio** o **Panel**. Requiere sesión.
- **Funciones:** totales (análisis, lotes, pendientes de anclaje); tabla de análisis con lote, pureza, fecha y
  estado (**Anclado**, **Pendiente**, **Falta la firma del laboratorio**); pestaña **Lotes** con enlace a la
  vista pública; botones **+ Registrar análisis** y **Contra-análisis**.

### 7.9 Registrar análisis — `/laboratorio/nuevo`
- **Acceso:** **Registrar análisis** (barra del portal) o **+ Registrar análisis** (panel). Requiere sesión.
- **Funciones:**
  1. **Lote:** elegir uno existente o crear uno nuevo: código (opcional; si no, se genera), tipo de mineral,
     peso en kg, coordenadas, origen y **dirección Stellar del dueño** (quien podrá venderlo).
  2. **Resultados:** fecha y hora, método (FRX, ensayo al fuego, ICP-OES, AAS, volumetría…), pureza,
     composición química por elemento (símbolos químicos; debe sumar ≤ 100 %), observaciones y **PDF** del informe.
- Al guardar, el análisis queda **pendiente** y se abre su detalle para firmarlo.

### 7.10 Detalle del análisis — `/laboratorio/analisis/AN-…`
- **Acceso:** clic en un análisis del panel. Requiere sesión del laboratorio dueño.
- **Funciones:**
  - **Firmar y anclar con Freighter** (si falta la firma): muestra la cuenta del laboratorio, avisa si la wallet
    conectada no es esa, firma `submit_analysis`; el servidor comprueba el contrato y lo marca **Anclado**.
  - Veredicto, datos y evidencia (igual que la vista pública).
  - **Código QR del lote**, listo para **imprimir** y pegar en el lote, y enlace a la vista pública.
  - **Registrar corrección** (solo supervisor): crea la versión N+1 enlazada a la anterior, con motivo; el
    original nunca se modifica. Luego se firma igual.
  - **Simular fraude** (solo demo, recuadro rojo): cambia la pureza directamente en la base de datos y
    reemplaza el PDF, como haría un intermediario. La verificación pasa a **Registro alterado**.

### 7.11 Contra-análisis — `/laboratorio/contra-analisis`
- **Acceso:** **Contra-análisis** (barra del portal). Requiere sesión; se usa con el **otro** laboratorio.
- **Funciones:** lista de lotes **en garantía**, sin contra-análisis, certificados por **otro** laboratorio
  (nadie contra-analiza lo suyo). Se elige el lote, se cargan los resultados y el PDF, y se firma con la wallet
  del laboratorio (`counter_analysis`). Resultado: diferencia en puntos y si el lote **pasó a disputa**
  (diferencia > 2,00) o sigue en garantía.

---

## 8. El contrato en Stellar

| Dato | Valor |
|---|---|
| Red | Stellar **testnet** (protocolo 29) |
| Contrato MinerTrace | **`CAHKMOKFXWD3OTMT45SBLSWHCN7Y2PPQVZJIL6VBQYIMW3ZH22XVQFYK`** |
| Token de pago | XLM nativo (contrato `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`); admite USDC u otro por configuración |
| Tolerancia de pureza | 200 puntos básicos = **2,00 %** |
| Plazo de garantía | 604 800 s = **7 días** |
| Lenguaje | Rust, `soroban-sdk` 28 · código en `contracts/minertrace/src/lib.rs` · 15 pruebas |

### En qué se basa

Un **contrato inteligente Soroban** (la plataforma de contratos de Stellar) que cumple dos funciones:

1. **Notario de análisis.** Guarda por cada `(análisis, versión)` el hash SHA-256, el laboratorio, el lote, el
   hash anterior, la pureza y la fecha del ledger. Solo laboratorios autorizados por el administrador pueden
   registrar; las versiones nunca se sobrescriben y cada corrección debe apuntar al hash de la anterior.
2. **Garantía de pago (escrow).** El contrato custodia el pago entre la compra y la confirmación, con reglas
   que nadie (ni MinerTrace) puede saltarse: solo el comprador confirma o pide reembolso, el contra-análisis
   lo hace otro laboratorio, y el vendedor solo cobra sin confirmación al vencer el plazo.

### Funciones

| Función | Quién firma | Qué hace |
|---|---|---|
| `add_lab(lab, nombre)` / `revoke_lab(lab)` | administrador | Autoriza o revoca un laboratorio |
| `submit_analysis(lab, lote_id, dueno, analisis_id, version, hash, hash_anterior, pureza_bps)` | laboratorio | Registra una versión de un análisis (la v1 crea el lote con su dueño) |
| `list_batch(dueno, lote_id, precio)` | dueño | Publica el lote; copia la pureza certificada en la venta |
| `buy(comprador, lote_id)` | comprador | Paga el precio al contrato: **en garantía**; fija el vencimiento |
| `counter_analysis(lab, lote_id, hash, pureza_bps)` | otro laboratorio | Contra-análisis; si difiere más que la tolerancia → **en disputa** |
| `confirm(comprador, lote_id)` | comprador | Libera el pago al vendedor; el lote cambia de dueño |
| `refund(comprador, lote_id)` | comprador | En disputa: devuelve el dinero y bloquea el lote |
| `claim(vendedor, lote_id)` | vendedor | Vencido el plazo sin confirmación ni disputa, cobra |
| `get_analysis`, `get_batch`, `get_sale`, `get_counter_analysis`, `listed_batches`, `is_lab`, `get_lab`, `get_config` | nadie (lectura) | Consultas que usa la verificación y el mercado |

**Estados de un lote:** `Certificado → EnVenta → EnGarantia → Vendido`, o `EnGarantia → EnDisputa`
(reembolso) → vuelve a `Certificado` cuando el laboratorio registra un análisis nuevo.

**Eventos** (lo que muestra la línea de tiempo): `analisis_registrado`, `lote_publicado`, `lote_comprado`,
`contra_analisis_registrado`, `venta_confirmada`, `reembolsado`, `pago_reclamado`, `laboratorio_agregado`,
`laboratorio_revocado`, `configurado`.

**Errores** (26, en español en la app): por ejemplo *El laboratorio no está autorizado*, *Esa versión ya está
registrada*, *El hash anterior no coincide*, *El lote está en disputa*, *Todavía no venció el plazo de la garantía*.

---

## 9. Ver las transacciones en testnet

Todo se ve en **[stellar.expert](https://stellar.expert/explorer/testnet)**, el explorador público de Stellar:

| Qué | Enlace |
|---|---|
| **El contrato** (todas sus llamadas y eventos) | https://stellar.expert/explorer/testnet/contract/CAHKMOKFXWD3OTMT45SBLSWHCN7Y2PPQVZJIL6VBQYIMW3ZH22XVQFYK |
| Cuenta del comprador (saldo y pagos) | https://stellar.expert/explorer/testnet/account/GDRILNQTFSNQA3HXC2BWSGVCPIJ3URVOXHKKRNM6P6IK7EJPRQYXTD5R |
| Cuenta del vendedor (cobros) | https://stellar.expert/explorer/testnet/account/GBJZFZ52JRTIPAHXCXQPQ4OJKMVKOIGJDGOOYDPRQYEUZKBO3FQJPSSL |
| Cuenta del laboratorio LAB-001 (firmas) | https://stellar.expert/explorer/testnet/account/GCPCQ6JVHRMUZ7QPVDCK2AW3DRKU3WOXIPIUO72PKS2BA6W2M4UZHQWF |

**Desde la app:** cada verificación tiene **"Ver en el explorador ↗"** y cada evento de la línea de tiempo,
**"transacción ↗"**.

**Ejemplo completo — doré de oro `LT-2026-0509` (vendido):**

| Paso | Transacción |
|---|---|
| Certificado por LAB-001 (`submit_analysis`) | [7df4bb28…](https://stellar.expert/explorer/testnet/tx/7df4bb283c3b48272419b9759eef62e42f02c1711694adf7c2bb2cc3bacbf181) |
| Publicado a 320 XLM (`list_batch`) | [3f4300ba…](https://stellar.expert/explorer/testnet/tx/3f4300ba4ba56c45a5071234250a31481a5ad4473e15d166aaa56308b177a01e) |
| Comprado: 320 XLM al contrato (`buy`) | [93d8f913…](https://stellar.expert/explorer/testnet/tx/93d8f9131a55078cc2394e39d127519a00aebe44013b0dc0c2ce6a6cb51b7835) |
| Contra-análisis de LAB-002: 91,10 % (`counter_analysis`) | [4a87eb6e…](https://stellar.expert/explorer/testnet/tx/4a87eb6ef7876851d5d220c86b620dcf6385290fff5c2d74d2c9f0835275f5c7) |
| Confirmado: 320 XLM al vendedor (`confirm`) | [a7301eac…](https://stellar.expert/explorer/testnet/tx/a7301eac86836e4d858f7c50fe59d533518abb0c3be3e832fcf6354e624f4420) |

**Cómo leer una transacción:** en la página de `submit_analysis` busca los argumentos de la llamada al
contrato; el valor `hash` es el mismo que la app muestra como **"Hash anclado en la blockchain"**. En `buy` y
`confirm` verás la transferencia de XLM entre las cuentas y el contrato.

**Comprobarlo sin confiar en MinerTrace:** en la verificación, descarga el **registro canónico**, calcula su
SHA-256 (`sha256sum archivo.json` o `certutil -hashfile archivo.json SHA256` en Windows) y compáralo con el
`hash` de la transacción en stellar.expert.

---

## 10. Datos de la demo (19 lotes)

El lote de ejemplo de la semilla más 18 creados con `npm run demo:poblar`. Dueño de todos: **vendedor**. Todos los análisis firmados dan **íntegro**.

| Lote | Mineral | Origen | Pureza | Estado |
|---|---|---|---|---|
| LT-2026-0457 | Concentrado de estaño | Cooperativa Minera X, Potosí | 75,00 % Sn | **En venta** · 120 XLM |
| LT-2026-0501 | Concentrado de estaño | Huanuni, Oruro | 68,40 % Sn | **En venta** · 85 XLM |
| LT-2026-0502 | Concentrado de plata | Cerro Rico, Potosí | 45,20 % Ag | **Vendido** |
| LT-2026-0503 | Concentrado de zinc | San Cristóbal, Potosí | 52,30 % Zn | **En garantía** |
| LT-2026-0504 | Concentrado de plomo | Porco, Potosí | 61,75 % Pb (contra: 58,10) | **En disputa** |
| LT-2026-0505 | Concentrado de estaño | Colquiri, La Paz | 71,20 → **71,85 %** | Certificado con corrección |
| LT-2026-0506 | Concentrado de wolframio | Chojlla, La Paz (LAB-002) | 51,50 % W | **En venta** · 150 XLM |
| LT-2026-0507 | Concentrado de antimonio | Caracota, Potosí | 58,00 % Sb | **Falta la firma** |
| LT-2026-0508 | Doré de oro | Tipuani, La Paz | 88,40 % Au | **En venta** · 300 XLM |
| LT-2026-0509 | Doré de oro | Guanay, La Paz | 91,25 % Au | **Vendido** |
| LT-2026-0510 | Doré de oro | Mapiri, La Paz | 84,60 % Au | **En garantía** |
| LT-2026-0511 | Doré de oro | San Simón, Beni | 79,30 % Au (contra: 76,90) | **En disputa** |
| LT-2026-0512 | Concentrado de plata | Pulacayo, Potosí | 38,60 % Ag | **En venta** · 110 XLM |
| LT-2026-0513 | Doré de plata | San Bartolomé, Potosí | 97,20 % Ag | **Vendido** |
| LT-2026-0514 | Concentrado de plata | Colquechaquita, Potosí | 41,30 → **41,75 %** | Certificado con corrección |
| LT-2026-0515 | Concentrado de estaño | Siglo XX, Llallagua | 64,80 % Sn | **En venta** · 75 XLM |
| LT-2026-0516 | Concentrado de estaño | Caracoles, La Paz | 70,10 % Sn | **En garantía** |
| LT-2026-0517 | Concentrado de estaño | Huanuni, Oruro (LAB-002) | 66,35 % Sn | **En venta** · 80 XLM |
| LT-2026-0518 | Doré de oro | Tipuani, La Paz | 86,10 % Au | **Falta la firma** |


### PDF de ejemplo para subir

En `ejemplos/pdf/` hay informes listos para adjuntar (se regeneran con `npm run demo:pdfs`). Cualquier otro
PDF también sirve. **El formulario no lee el PDF:** escribe a mano los mismos valores que trae el informe.

**Contra-análisis** (Laboratorio → **Contra-análisis**, con `analista@lab002.test` y Freighter en **Lab B**):

| Archivo | Lote | Método | Pureza | Composición | Resultado esperado |
|---|---|---|---|---|---|
| `contra-analisis-LT-2026-0510-oro-disputa.pdf` | LT-2026-0510 (oro, certificado 84,60) | Ensayo al fuego | 80.00 | Au 80.00 · Ag 17.30 · Cu 2.10 · otros 0.60 | **En disputa** |
| `contra-analisis-LT-2026-0510-oro-dentro-tolerancia.pdf` | LT-2026-0510 | Ensayo al fuego | 84.20 | Au 84.20 · Ag 13.40 · Cu 1.80 · otros 0.60 | Sigue en garantía |
| `contra-analisis-LT-2026-0516-estano-disputa.pdf` | LT-2026-0516 (estaño, certificado 70,10) | FRX | 66.00 | Sn 66.00 · Fe 5.80 · W 1.60 · otros 26.60 | **En disputa** |
| `contra-analisis-LT-2026-0516-estano-dentro-tolerancia.pdf` | LT-2026-0516 | FRX | 69.50 | Sn 69.50 · Fe 5.00 · W 1.80 · otros 23.70 | Sigue en garantía |
| `contra-analisis-LT-2026-0503-zinc.pdf` | LT-2026-0503 (zinc, certificado 52,30) | ICP-OES | 51.90 | Zn 51.90 · Fe 7.90 · S 30.00 · otros 10.20 | Sigue en garantía |

Cada lote admite **un solo** contra-análisis por venta: para el mismo lote elige el de disputa **o** el de tolerancia.

**Análisis nuevos** (Laboratorio → **Registrar análisis**, con `analista@lab001.test` y luego Freighter en **Lab A**
para firmar). En "Dirección Stellar del dueño" pon la del vendedor para poder venderlo después:

| Archivo | Tipo de mineral | Método | Pureza | Composición |
|---|---|---|---|---|
| `informe-dore-oro-tipuani.pdf` | Doré de oro | Ensayo al fuego | 89.70 | Au 89.70 · Ag 8.90 · Cu 1.00 · otros 0.40 |
| `informe-concentrado-plata-potosi.pdf` | Concentrado de plata | Absorción atómica (AAS) | 43.10 | Ag 43.10 · Pb 19.20 · Zn 10.10 · otros 27.60 |
| `informe-concentrado-estano-huanuni.pdf` | Concentrado de estaño | FRX | 67.20 | Sn 67.20 · Fe 6.40 · S 3.00 · otros 23.40 |

---

## 11. Guiones para la demo

Antes de empezar: `npm run dev`, Freighter en **Testnet** con las 4 cuentas importadas, y el navegador en
http://localhost:5173.

### Guion A — "Nadie puede alterar un análisis" (3 min, sin wallet)
1. **Verificar** → `LT-2026-0509` → mostrar **Registro íntegro**, pureza 91,25 %, las tres comprobaciones.
2. Pulsar **Ver en el explorador ↗**: la transacción real en Stellar con el mismo hash.
3. Mostrar la **línea de tiempo**: certificado → publicado → comprado → contra-análisis → vendido.
4. (Al final) Portal como `analista@lab001.test` → análisis de **LT-2026-0505** → **Simular fraude** (95,00)
   → volver a `/verificar/LT-2026-0505`: **Registro alterado**, datos ✕ y PDF ✕.

### Guion B — "El laboratorio certifica con su firma" (3 min)
1. Portal como `analista@lab001.test` → **Panel** → análisis de `LT-2026-0518` (Falta la firma).
2. En Freighter, cuenta **Lab A** → **Conectar wallet** → **Firmar y anclar con Freighter** → aprobar.
3. ✅ *Transacción confirmada*; estado **Anclado**; mostrar el **QR** para imprimir.
4. Opcional: registrar un lote nuevo (Registrar análisis) poniendo como dueño la dirección del vendedor.

### Guion C — "Comprar con garantía" (4 min)
1. **Mercado** → elegir el oro `LT-2026-0508` (88,40 %, 300 XLM).
2. Freighter en **Comprador** → **Comprar por 300 XLM** → aprobar → *En garantía*.
3. Mostrar en stellar.expert que los 300 XLM están **en el contrato**, no en el vendedor.
4. **Mis lotes** (comprador) → **Confirmar recepción y liberar el pago** → *Vendido*: el vendedor cobra.

### Guion D — "El contra-análisis protege al comprador" (4 min)
1. Lote ya preparado en disputa: `LT-2026-0511` (oro 79,30 % certificado, contra-análisis 76,90 %).
2. `/verificar/LT-2026-0511`: estado **En disputa**, contra-análisis con su verificación y su línea de tiempo.
3. Freighter en **Comprador** → **Mis lotes** → **Pedir reembolso (250 XLM)** → el dinero vuelve.
4. Freighter en **Vendedor** → **Mis lotes**: el lote está **bloqueado** hasta que el laboratorio lo reanalice.

   *En vivo desde cero:* con `LT-2026-0510` (oro en garantía), entra como `analista@lab002.test` →
   **Contra-análisis** → elegir 0510 → pureza 80.00 (Au 80.00, Ag 17.30, Cu 2.10, otros 0.60) → adjuntar
   `ejemplos/pdf/contra-analisis-LT-2026-0510-oro-disputa.pdf` → Freighter en **Lab B** → firmar → *pasó a disputa*.

### Guion E — "Correcciones transparentes" (2 min)
`/verificar/LT-2026-0514` → **Historial de versiones**: v1 41,30 % y v2 41,75 % con el motivo, ambas íntegras.
La original nunca se borra.

---

## 12. Arquitectura y tecnologías

```
Navegador (React)                        Servidor (Node + Express)                 Stellar testnet
─────────────────                        ─────────────────────────                 ───────────────
Verificador público  ─── /api/publico ──► recalcula el hash ────────── lee ───────► Contrato MinerTrace
Portal laboratorio   ─── /api/...    ──► registra (PostgreSQL/PGlite)              (Soroban, Rust)
Mercado / Mis lotes  ─── /api/mercado ─► arma la transacción sin firmar            · análisis versionados
Freighter (firma) ◄──────── XDR ─────────┘  envía la firmada y comprueba ── envía ─► · escrow en XLM
                                          indexador de eventos ◄──────── lee ───── · eventos
```

| Parte | Tecnología |
|---|---|
| Web | React 19, Vite, Tailwind 4, React Router, PWA instalable, lector QR, `@stellar/freighter-api` 6 |
| Servidor | Node 22, Express 5, TypeScript, `@stellar/stellar-sdk` 17 |
| Base de datos | PGlite (PostgreSQL embebido, en `server/datos/`) o PostgreSQL/Supabase con `DATABASE_URL` |
| Integridad | JSON canónico RFC 8785 + SHA-256 + salt; tablas de solo inserción con triggers |
| Contrato | Rust, `soroban-sdk` 28, Stellar testnet |
| Pruebas | 29 del servidor (`npm test`), 15 del contrato (`npm run contrato:test`), 4 de integración real en testnet (`npm run test:testnet`) |

**Principios de seguridad:**
- La verificación **nunca confía en el hash guardado en la base de datos**: lo recalcula y lo compara con el contrato.
- Los registros son de **solo inserción**: una corrección es una versión nueva, nunca una edición.
- El servidor **no guarda claves de las wallets**: arma la transacción, la wallet la firma y el servidor solo
  la envía tras comprobar que es exactamente la operación pedida.
- El servidor marca un análisis como anclado **solo después de leerlo en el contrato**.

---

## 13. Limitaciones y pendientes

| Tema | Estado |
|---|---|
| Retirar una publicación sin comprador | No existe (`unlist_batch`) |
| Alta de usuarios y laboratorios | Sin pantallas: usuarios de la semilla; laboratorios por consola (`add_lab`) |
| PDF en producción | Se guardan en el disco del servidor; para desplegar hay que usar disco persistente o Supabase Storage |
| Passkeys para técnicos | Evaluado (Smart Account Kit), no implementado; estimado en 3-5 días |
| Cobro por vencimiento | Implementado y probado; con 7 días no se puede mostrar en vivo (se puede desplegar un contrato con plazo corto) |
| Red | Testnet. Mainnet requiere desplegar el contrato allí y usar dinero real |
| Reinicio de testnet | Stellar reinicia testnet cada pocos meses: hay que volver a desplegar y poblar |

---

## 14. Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| "404" en otra web | Se escribió una dirección de internet | Usa **http://localhost:5173** |
| No carga localhost:5173 | El servidor no está corriendo | `npm run dev` |
| No aparece "Mercado" con lotes | Servidor en modo simulado | `ANCLAJE=stellar` en `server/.env` |
| "Red incorrecta" en el botón de la wallet | Freighter no está en Testnet | Cambia la red de Freighter a Testnet |
| "Conecte en Freighter la cuenta del laboratorio (G…)" | Wallet equivocada | Selecciona en Freighter la cuenta Lab A (o Lab B) |
| "Firma rechazada en Freighter" | Se canceló en la extensión | Repite y aprueba |
| "Fondos insuficientes" | La cuenta no tiene XLM | Fondéala con friendbot |
| Un lote no aparece en Contra-análisis | No está en garantía o lo certificó tu propio laboratorio | Entra con el otro laboratorio; el lote debe estar comprado |
| Los enlaces del explorador fallan | Testnet se reinició | `npm run contrato:desplegar`, nuevo `STELLAR_CONTRATO_ID`, borrar `server/datos/`, `npm run demo:poblar` |

**Comandos útiles:**

```bash
npm run dev                 # arrancar
npm run demo:poblar         # (re)llenar los datos de la demo
npm run demo:pdfs           # regenerar los PDF de ejemplo (ejemplos/pdf/)
npm test                    # pruebas del servidor
npm run contrato:test       # pruebas del contrato
npm run test:testnet        # pruebas reales contra testnet (necesita las variables STELLAR_*)
npm run contrato:desplegar  # desplegar un contrato nuevo
```
