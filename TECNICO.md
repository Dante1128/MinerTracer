# MinerTrace — Documento técnico (Web3 / blockchain)

Explicación técnica de la capa blockchain de MinerTrace: la red Stellar, el contrato inteligente Soroban,
el algoritmo de huella (hashing), las firmas, el ciclo de una transacción y el modelo de seguridad.
La guía de uso está en [GUIA.md](GUIA.md) y el diseño original en [MinerTrace.md](MinerTrace.md).

## Índice

1. [Resumen técnico](#1-resumen-técnico)
2. [Arquitectura](#2-arquitectura)
3. [La red: Stellar y Soroban](#3-la-red-stellar-y-soroban)
4. [El contrato inteligente](#4-el-contrato-inteligente)
5. [Algoritmo de huella (hashing)](#5-algoritmo-de-huella-hashing)
6. [Algoritmo de verificación](#6-algoritmo-de-verificación)
7. [Identidad, firmas y autorización](#7-identidad-firmas-y-autorización)
8. [Ciclo de vida de una transacción](#8-ciclo-de-vida-de-una-transacción)
9. [Garantía de pago (escrow)](#9-garantía-de-pago-escrow)
10. [Eventos e indexación](#10-eventos-e-indexación)
11. [Costos](#11-costos)
12. [Modelo de seguridad y amenazas](#12-modelo-de-seguridad-y-amenazas)
13. [Limitaciones y decisiones de diseño](#13-limitaciones-y-decisiones-de-diseño)
14. [Estándares y versiones](#14-estándares-y-versiones)
15. [Pruebas](#15-pruebas)

---

## 1. Resumen técnico

| Aspecto | Elección |
|---|---|
| Blockchain | **Stellar** (capa 1, pública), red **testnet**, protocolo 29 |
| Contratos inteligentes | **Soroban**, la plataforma de contratos de Stellar (WebAssembly) |
| Lenguaje del contrato | **Rust** con `soroban-sdk` 28.0.0, compilado a **WebAssembly** (`wasm32v1-none`, ~21 KB) |
| Tipo de contrato | Contrato con estado propio que combina un **registro notarial versionado** (attestation registry con cadena de hashes) y un **escrow** (custodia condicional de pagos) sobre la interfaz estándar de tokens |
| Huella | **SHA-256** sobre JSON canónico **RFC 8785 (JCS)**, con salt de 128 bits y el SHA-256 del PDF incluido |
| Firmas | **Ed25519** (cuentas Stellar `G…`); autorización con el marco de Soroban (`require_auth`) |
| Pago | **XLM nativo** mediante su Stellar Asset Contract (interfaz de tokens SEP-41); cambiable a USDC por configuración |
| Wallet | **Freighter** (extensión del navegador), `@stellar/freighter-api` 6.0.1 |
| Cliente blockchain | `@stellar/stellar-sdk` 17.2.1 contra **Stellar RPC** (`soroban-testnet.stellar.org`) |
| Patrón de datos | **Off-chain storage, on-chain proof**: los datos y PDF en la base de datos; en la cadena solo la huella y las reglas |
| Aplicación | Servidor Node.js 22 + Express 5 + TypeScript; web React 19; base PostgreSQL (PGlite embebido o Supabase) |

---

## 2. Arquitectura

```
┌──────────────────────────── Navegador ────────────────────────────┐
│ React 19 (Vite)                         Freighter (extensión)     │
│ · Verificador público · Mercado         · guarda la clave Ed25519 │
│ · Portal del laboratorio · Mis lotes    · firma el sobre XDR      │
└──────────────┬───────────────────────────────────▲────────────────┘
               │ HTTPS / JSON                       │ XDR sin firmar → firmado
┌──────────────▼────────────────────────────────────┴───────────────┐
│ Servidor Node.js (Express, TypeScript)                            │
│ · integridad/canonico.ts   registro canónico RFC 8785 + SHA-256    │
│ · anclaje/AnclajeStellar   submit_analysis / get_analysis          │
│ · stellar/contrato.ts      simula, arma XDR, valida y envía        │
│ · mercado/                 estado comercial + indexador de eventos │
│ · procesador               reconcilia anclajes pendientes          │
│ · PostgreSQL (PGlite/Supabase): datos completos, PDF, solo inserción│
└──────────────┬─────────────────────────────────────────────────────┘
               │ JSON-RPC (simulateTransaction, sendTransaction,
               │           getTransaction, getEvents, getHealth)
┌──────────────▼─────────────────────────────────────────────────────┐
│ Stellar testnet · Soroban                                           │
│ Contrato MinerTrace  CAHKMOKFXWD3OTMT45SBLSWHCN7Y2PPQVZJIL6VBQYIMW3ZH22XVQFYK │
│ · registro de laboratorios · análisis versionados (hash chain)      │
│ · lotes, ventas, contra-análisis · escrow en XLM (SAC)              │
│ Token XLM nativo (SAC) CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC │
└─────────────────────────────────────────────────────────────────────┘
```

**Qué vive en cada lugar:**

| Dónde | Qué | Por qué |
|---|---|---|
| Base de datos | Datos completos del análisis, del lote, PDF, usuarios, copia de eventos | Volumen, privacidad comercial, consultas rápidas |
| Blockchain | Huella SHA-256 (32 bytes), laboratorio, versión, pureza en puntos básicos, estados de venta, dinero en garantía | Inmutabilidad, marca de tiempo, autoría verificable, reglas que nadie puede saltarse |
| Navegador (Freighter) | Claves privadas de laboratorios, vendedores y compradores | El servidor nunca las tiene |

---

## 3. La red: Stellar y Soroban

**Stellar** es una blockchain pública de capa 1 orientada a pagos:

- **Consenso:** Stellar Consensus Protocol (SCP), un acuerdo bizantino federado (FBA). Los validadores eligen en
  quién confiar ("quorum slices"); no hay minería ni prueba de trabajo.
- **Finalidad:** cada *ledger* (bloque) se cierra cada ~5 segundos y la finalidad es inmediata, sin reorganizaciones.
- **Cuentas:** pares de claves **Ed25519**. Direcciones con codificación StrKey: `G…` (cuenta), `S…` (clave
  secreta), `C…` (contrato).
- **Moneda:** XLM, con 7 decimales (1 XLM = 10 000 000 *stroops*). Paga las comisiones y, aquí, el precio de los lotes.
- **Redes:** *mainnet* (dinero real) y *testnet* (dinero de prueba, se reinicia periódicamente). Cada red tiene una
  *passphrase* que entra en lo que se firma, así que una firma de testnet no sirve en mainnet. Testnet:
  `Test SDF Network ; September 2015`.

**Soroban** es la plataforma de contratos inteligentes de Stellar:

- Los contratos se escriben en **Rust** y se compilan a **WebAssembly**; la red ejecuta el WASM en un "host"
  determinista que expone almacenamiento, criptografía, eventos y llamadas entre contratos.
- **Modelo de almacenamiento con alquiler (state archival):** cada entrada tiene un TTL (tiempo de vida en
  ledgers); hay que extenderlo pagando "renta" o la entrada se archiva (se puede restaurar). Tipos: *instance*
  (ligado al contrato), *persistent* (datos duraderos) y *temporary*.
- **Simulación previa:** antes de enviar, el RPC simula la transacción para calcular las lecturas y escrituras
  (*footprint*), los recursos y la comisión; luego se firma y se envía.
- **Stellar RPC:** la API JSON-RPC para hablar con Soroban (`simulateTransaction`, `sendTransaction`,
  `getTransaction`, `getEvents`, `getLedgerEntries`). Conserva el historial reciente (~7 días, 120 960 ledgers).

**Por qué Stellar:** comisiones de fracciones de centavo, cierre en ~5 s, contratos en Rust/WASM, tokens
estándar (incluido USDC nativo) y exploradores públicos para verificación independiente.

---

## 4. El contrato inteligente

| Dato | Valor |
|---|---|
| Dirección (testnet) | `CAHKMOKFXWD3OTMT45SBLSWHCN7Y2PPQVZJIL6VBQYIMW3ZH22XVQFYK` |
| Código | `contracts/minertrace/src/lib.rs` (Rust, `#![no_std]`) |
| Compilación | `stellar contract build` → `minertrace.wasm`, ~21 KB, perfil `release` (opt-level z, LTO, panic=abort) |
| Despliegue | `scripts/desplegar-testnet.mjs` con el Stellar CLI 28 |
| Actualizable | **No**: no tiene función de *upgrade*. Su lógica es inmutable; un cambio exige desplegar otro contrato |

### 4.1 Qué tipo de contrato es

Es un **contrato de aplicación con estado propio**, no un token. Combina dos patrones:

1. **Registro notarial versionado (attestation registry).** Por cada `(analisis_id, version)` guarda la huella
   SHA-256 y quién la registró. Las versiones forman una **cadena de hashes**: la versión N+1 debe declarar como
   `hash_anterior` el hash de la versión N, igual que los bloques de una blockchain. Solo escriben los
   laboratorios autorizados por un administrador (**control de acceso por lista blanca**).
2. **Escrow (custodia condicional).** Mantiene una máquina de estados por lote y **custodia el pago** entre la
   compra y la liberación. El dinero solo puede salir hacia el vendedor (confirmación o vencimiento) o hacia el
   comprador (reembolso por disputa). Usa la **interfaz estándar de tokens** (SEP-41), así que funciona con XLM o
   USDC sin cambiar código.

### 4.2 Configuración (constructor)

Se configura en el mismo despliegue con un **constructor** (`__constructor`, CAP-58), así nadie puede
"inicializarlo" antes que el dueño:

| Parámetro | Valor desplegado | Uso |
|---|---|---|
| `admin` | `GD5C42D6F23JAKEULOZMDSDBHPPPFSCVVNODMTGMGCJDYD7UE64ZBVOM` | Autoriza y revoca laboratorios |
| `token` | `CDLZFC3S…` (XLM nativo) | Moneda de pago |
| `tolerancia_bps` | `200` (2,00 %) | Diferencia máxima aceptada en un contra-análisis |
| `plazo_garantia_seg` | `604800` (7 días) | Tras la compra, plazo para que el vendedor pueda cobrar sin confirmación |

### 4.3 Datos que guarda

| Clave de almacenamiento | Tipo | Contenido |
|---|---|---|
| `Config` | instance | admin, token, tolerancia, plazo |
| `Laboratorio(Address)` | persistent | nombre, activo |
| `Analisis(String, u32)` | persistent | lab, lote_id, **hash** `BytesN<32>`, hash_anterior, pureza_bps, ledger, fecha |
| `Lote(String)` | persistent | dueño, **estado**, análisis vigente (id, versión, lab, pureza) |
| `Venta(String)` | persistent | vendedor, precio `i128`, comprador, análisis vendido, pureza vendida, vence_garantia |
| `ContraAnalisis(String)` | persistent | lab, lab certificador, hash, pureza, diferencia, fecha |
| `LotesEnVenta` | persistent | índice de lotes publicados (el contrato no puede recorrer sus claves) |

La **pureza** se guarda como entero en **puntos básicos** (`u32`): 75,00 % = `7500`. Así se evita la coma
flotante, que no es determinista.

**TTL:** en cada escritura se extiende la entrada y la instancia hasta 120 días si les quedan menos de 30.

### 4.4 Funciones públicas

| Función | Autorización | Reglas principales |
|---|---|---|
| `__constructor(admin, token, tolerancia_bps, plazo_garantia_seg)` | (despliegue) | tolerancia ≤ 10000, plazo > 0 |
| `add_lab(lab, nombre)` | `admin.require_auth()` | Alta o reactivación |
| `revoke_lab(lab)` | `admin.require_auth()` | El laboratorio deja de poder registrar y sus certificados no sirven para vender |
| `submit_analysis(lab, lote_id, dueno, analisis_id, version, hash, hash_anterior, pureza_bps)` | `lab.require_auth()` | Lab activo; versión ≥ 1; nunca sobrescribir; v1 sin `hash_anterior`; vN exige `hash_anterior` = hash de vN-1, el mismo laboratorio y el mismo lote |
| `list_batch(dueno, lote_id, precio)` | `dueno.require_auth()` | Dueño del lote; estado Certificado o Vendido; precio > 0; certificador activo; **copia la pureza certificada** en la venta |
| `buy(comprador, lote_id)` | `comprador.require_auth()` | En venta; no el propio vendedor; transfiere el precio al contrato; fija `vence_garantia` |
| `counter_analysis(lab, lote_id, hash, pureza_bps)` | `lab.require_auth()` | Lab activo y distinto del certificador; lote en garantía; uno por venta; `|Δ| > tolerancia` → disputa |
| `confirm(comprador, lote_id)` | `comprador.require_auth()` | Solo el comprador, en garantía y sin disputa; paga al vendedor; cambia el dueño |
| `refund(comprador, lote_id)` | `comprador.require_auth()` | Solo en disputa; devuelve el dinero; el lote queda bloqueado |
| `claim(vendedor, lote_id)` | `vendedor.require_auth()` | En garantía, sin disputa, `timestamp ≥ vence_garantia` |
| `get_*`, `listed_batches`, `is_lab` | ninguna (lectura) | Consultas |

### 4.5 Máquina de estados del lote

```
Certificado ─list_batch→ EnVenta ─buy→ EnGarantia ─confirm|claim→ Vendido ─list_batch→ EnVenta …
                                            │
                                  counter_analysis (|Δ| > tolerancia)
                                            ▼
Certificado ←─ submit_analysis del certificador ── EnDisputa ←── refund (devuelve el pago)
```

### 4.6 Errores tipados

Enum `#[contracterror]` con 26 códigos `u32` (`Error(Contract, #n)` en la red). Ejemplos: `1` laboratorio no
autorizado, `6` versión duplicada, `8` hash anterior incorrecto, `14` el estado no permite la operación,
`21` lote en disputa, `25` el plazo de garantía no venció. El servidor los traduce a español
(`server/src/anclaje/erroresContrato.ts`). No hay `panic!` genéricos: todo error es un código conocido.

---

## 5. Algoritmo de huella (hashing)

### 5.1 Pasos

```
datos del análisis + datos del lote + SHA-256(PDF) + salt aleatorio
        │
        ▼  1. normalización (decimales fijos, fechas ISO 8601 UTC, texto Unicode NFC)
        ▼  2. registro canónico con esquema versionado
        ▼  3. serialización JCS — RFC 8785
        ▼  4. SHA-256 (FIPS 180-4) → 32 bytes (64 hex)
        ▼  5. se ancla en el contrato como BytesN<32>
```

1. **Normalización** (`server/src/validacion.ts`): la pureza y la composición como texto con 2 decimales
   (`"86.10"`), el peso con 3, las coordenadas con 6; fechas en ISO 8601 UTC sin milisegundos; textos en Unicode NFC.
   Así el mismo dato siempre produce los mismos bytes, sin depender de la coma flotante ni del huso horario.
2. **Registro canónico** (`server/src/integridad/canonico.ts`): un objeto con esquema fijo y versionado
   (`version_esquema: "1"`).
3. **JCS – JSON Canonicalization Scheme (RFC 8785):** claves ordenadas, sin espacios, números y cadenas con
   una única representación. Librería `canonicalize` 5.1.
4. **SHA-256:** función hash criptográfica de 256 bits (familia SHA-2), resistente a preimagen y colisiones.
5. **Anclaje:** los 32 bytes se envían a `submit_analysis` firmados por el laboratorio.

### 5.2 Qué entra en la huella

| Campo | Por qué |
|---|---|
| `version_esquema` | Permite cambiar el formato en el futuro sin invalidar lo anterior |
| `analisis_id`, `version` | Identidad del registro |
| `hash_anterior` | **Encadena** cada corrección con la versión previa |
| `motivo_correccion` | El motivo queda sellado |
| `laboratorio_id`, `lote_id` | Quién y sobre qué |
| `lote` (tipo de mineral, peso, origen, coordenadas) | El lote también queda sellado: no se puede cambiar su origen ni su peso |
| `fecha_analisis`, `metodo`, `pureza`, `composicion`, `observaciones` | El resultado del análisis |
| `pdf_sha256` | **SHA-256 del PDF:** la huella cubre el documento sin subirlo a la cadena |
| `salt` (16 bytes aleatorios, 128 bits) | Impide adivinar los datos por fuerza bruta a partir del hash publicado (la pureza tiene pocas opciones posibles) |

### 5.3 Ejemplo real (análisis `AN-2026-0038`, anclado en testnet)

Registro canónico exacto (es lo que descarga "Verificar por su cuenta"):

```json
{"analisis_id":"AN-2026-0038","composicion":{"Ag":"12.20","Au":"86.10","Cu":"1.20","otros":"0.50"},"fecha_analisis":"2026-09-28T11:00:00Z","hash_anterior":null,"laboratorio_id":"LAB-001","lote":{"coordenadas":"-15.546900,-68.016700","origen":"Cooperativa Aurífera Tipuani, Larecaja, La Paz, Bolivia","peso_kg":"10.050","tipo_mineral":"Doré de oro"},"lote_id":"LT-2026-0518","metodo":"Ensayo al fuego","motivo_correccion":null,"observaciones":"Pendiente de firma: barra N.º TP-0931.","pdf_sha256":"e7cc33dad1f073402a13d90e947c65a60eb905cb6855ec67bba859fa8bab2f2b","pureza":"86.10","salt":"9c8328dc093c14194c738a3c517a49d4","version":1,"version_esquema":"1"}
```

```
SHA-256 = c26835a108b59b2ecc2fa359a1e88d812d5b40b3de57e74edac63f54ef37632f
```

Es exactamente el hash registrado en el contrato por la transacción
[`a06a54d4…944ae`](https://stellar.expert/explorer/testnet/tx/a06a54d48854678cda04a1f73d91733fa8a61039f561cdcdd7b7e6ed45a944ae)
(ledger 5 110 393, firmada por `GCPC…HQWF`). Cambiar un solo carácter, por ejemplo `86.10` por `96.10`, da
un hash completamente distinto (efecto avalancha).

### 5.4 Contra-análisis

Usa un registro canónico **de otro tipo** (`"tipo": "contra_analisis"`), con el lote, el laboratorio, el
resultado, el SHA-256 de su PDF y su propio salt. Se ancla con `counter_analysis`. Es un formato aparte, así que
no altera las huellas de los análisis ya anclados.

---

## 6. Algoritmo de verificación

`server/src/servicios/verificacion.ts`, por cada versión de un análisis:

```
1. registro = reconstruir el registro canónico con los datos ACTUALES de la base de datos
2. h = SHA-256(JCS(registro))                      ← nunca se usa el hash guardado en la fila
3. a = contrato.get_analysis(analisis_id, version) ← lectura en la cadena (simulación vía RPC)
4. datos ✓   si a.hash == h
5. firma ✓   si a.lab == cuenta del laboratorio  Y  contrato.is_lab(a.lab)
6. PDF ✓     si SHA-256(PDF guardado) == pdf_sha256 del registro
7. enlace ✓  si hash_anterior == hash ANCLADO de la versión anterior
             (si la anterior aún no está anclada → "pendiente", nunca "íntegro")
8. veredicto: íntegro (todo ✓) · alterado (algún ✕) · pendiente (sin anclar) · error (sin red)
```

**Verificación independiente (sin confiar en MinerTrace):** cualquiera puede descargar el registro canónico,
calcular `sha256sum` y compararlo con el argumento `hash` de la transacción en stellar.expert, o leer el contrato
con `stellar contract invoke … -- get_analysis --analisis_id AN-2026-0038 --version 1`.

---

## 7. Identidad, firmas y autorización

### 7.1 Firmas

- Cada cuenta es un par **Ed25519**. Se firma el **hash del sobre de la transacción**, que incluye la
  *passphrase* de la red (no se puede reutilizar una firma en otra red).
- La clave privada vive en **Freighter** (laboratorios, vendedores, compradores). El servidor no la conoce. Solo la
  semilla y las pruebas usan claves en el servidor (`STELLAR_SECRETO_*`).

### 7.2 Autorización de Soroban (`require_auth`)

Cada función exige la firma de la dirección que actúa (`lab.require_auth()`, `comprador.require_auth()`…). El host
de Soroban verifica que esa dirección autorizó **esa invocación con esos argumentos**. Como la cuenta que actúa es
también la que origina la transacción, su firma del sobre cubre la autorización (*source account credentials*).

En `buy`, el árbol de autorización incluye **la subinvocación** `transfer(comprador → contrato, precio)` al token:
el comprador autoriza a la vez la compra y el pago. Una prueba del contrato verifica ese árbol exacto.

### 7.3 Quién controla qué

| Dirección | Controla |
|---|---|
| Administrador | La lista de laboratorios (alta y revocación). No puede tocar análisis ni dinero |
| Laboratorio | Sus análisis (solo agregar versiones) y sus contra-análisis |
| Dueño | Publicar su lote; cobrar al confirmar o al vencer la garantía |
| Comprador | Pagar, confirmar o pedir reembolso de su compra |
| Contrato | Custodia el dinero; nadie más puede moverlo |

---

## 8. Ciclo de vida de una transacción

Así funciona, por ejemplo, la firma de un análisis o una compra con Freighter:

```
Navegador              Servidor                          Stellar RPC / red
   │  1. POST …/firma       │                                     │
   ├───────────────────────►│ 2. arma InvokeHostFunction          │
   │                        │    (contrato, función, argumentos)  │
   │                        ├── 3. simulateTransaction ──────────►│ footprint, recursos,
   │                        │◄────────────────────────────────────┤ comisión, errores
   │  4. XDR sin firmar      │                                     │
   │◄───────────────────────┤                                     │
   │ 5. Freighter muestra y │                                     │
   │    firma (Ed25519)     │                                     │
   │  6. XDR firmado         │                                     │
   ├───────────────────────►│ 7. valida: una sola operación,      │
   │                        │    este contrato, esta función,     │
   │                        │    esta cuenta de origen            │
   │                        ├── 8. sendTransaction ──────────────►│
   │                        ├── 9. getTransaction (sondeo) ──────►│ SUCCESS en ~5 s
   │                        │ 10. vuelve a leer el contrato y     │
   │                        │     recién entonces marca "anclado" │
   │  11. tx_id + enlace     │                                     │
   │◄───────────────────────┤                                     │
```

- La **simulación** detecta antes de firmar los errores del contrato (por ejemplo, "El lote está en disputa") y
  calcula la comisión exacta.
- El servidor **no firma**: solo arma, valida y envía. Si la wallet intentara enviar otra operación, la rechaza.
- **Reconciliación:** si el navegador se cierra después de enviar, el procesador asíncrono encuentra el registro
  en el contrato y recupera el ID de la transacción desde los eventos (`getEvents`).
- **Concurrencia:** cada cuenta tiene un número de secuencia; dos transacciones simultáneas de la misma cuenta
  chocan (`txBadSeq`) y se reintentan.

---

## 9. Garantía de pago (escrow)

```
            buy (precio)                    confirm  /  claim (vencido)
Comprador ───────────────► CONTRATO ─────────────────────────────────► Vendedor
    ▲                         │
    └──────── refund ─────────┘  (solo en disputa por contra-análisis)
```

- Los montos son `i128` en la unidad mínima del token (XLM: 7 decimales).
- El contrato llama a `token.transfer(desde, hacia, monto)` de la interfaz estándar. Con XLM se usa el
  **Stellar Asset Contract** del XLM nativo; con USDC bastaría desplegar con su contrato.
- **La venta copia la pureza certificada al publicar:** si el laboratorio corrige el análisis durante la garantía,
  el contra-análisis se compara con lo que se vendió.
- **Plazo:** `vence_garantia = timestamp del ledger de compra + plazo`. Se usa la hora del ledger, no la del servidor.
- No existe ninguna función que permita al administrador ni a MinerTrace retirar los fondos custodiados.

---

## 10. Eventos e indexación

Cada acción emite un evento (`#[contractevent]`) con el lote como *topic* para poder filtrar:
`analisis_registrado`, `lote_publicado`, `lote_comprado`, `contra_analisis_registrado`, `venta_confirmada`,
`reembolsado`, `pago_reclamado`, `laboratorio_agregado`, `laboratorio_revocado`, `configurado`.

El RPC solo conserva los eventos ~7 días. Un **indexador** (`server/src/mercado/indexador.ts`) los lee con
`getEvents` (paginando por cursor, en ventanas de 10 000 ledgers) y los copia en la tabla `eventos_contrato`, que
es de solo inserción, para mostrar la **línea de tiempo** de cada lote. El estado comercial y la verificación
**siempre se leen del contrato**: los eventos copiados solo son informativos.

---

## 11. Costos

Medidos en testnet; en mainnet las comisiones en XLM son del mismo orden:

| Operación | Comisión real |
|---|---|
| Anclar un análisis (`submit_analysis`) | ~0,79 XLM. Crea entradas nuevas de almacenamiento persistente y paga su renta por 120 días |
| Comprar (`buy`) | ~0,06 XLM |
| Lecturas (`get_analysis`, verificación) | **Gratis**: son simulaciones, no transacciones |

La comisión de Soroban se compone de una tarifa base, los recursos de CPU y memoria, el tamaño de la transacción,
las escrituras y la **renta** del almacenamiento.

---

## 12. Modelo de seguridad y amenazas

| Amenaza | Defensa | Resultado |
|---|---|---|
| Alguien con acceso a la base de datos cambia la pureza | La verificación recalcula la huella y la compara con la del contrato | **Alterado** |
| …y además recalcula y guarda el hash en la base de datos | La verificación nunca usa el hash guardado | **Alterado** igual |
| Se reemplaza el PDF | Su SHA-256 está dentro de la huella | "PDF reemplazado" |
| Se borra o edita un análisis en la base de datos | Triggers de solo inserción en PostgreSQL + la huella anclada | Rechazado o detectado |
| El laboratorio quiere reescribir un resultado anclado | El contrato no sobrescribe versiones | Solo puede añadir una corrección visible |
| Una corrección sin relación con la anterior | El contrato exige `hash_anterior` = hash de la versión previa, el mismo laboratorio y el mismo lote | Rechazada |
| Un laboratorio falso o revocado | Lista blanca del administrador + `is_lab` en la verificación | Rechazado / "firma ✕" |
| Adivinar los datos a partir del hash público | Salt aleatorio de 128 bits | Inviable |
| Firmar en nombre de otro | `require_auth` + firmas Ed25519 | Rechazado por la red |
| El servidor envía una operación distinta de la pedida | El servidor valida contrato, función y cuenta; Freighter muestra la transacción antes de firmar | Rechazado |
| El laboratorio miente desde el origen | Contra-análisis de un segundo laboratorio | Disputa y reembolso |
| El vendedor no entrega | El dinero está en el contrato | El comprador no confirma (y puede pedir contra-análisis) |
| El comprador nunca confirma | Plazo de garantía | El vendedor cobra con `claim` |

---

## 13. Limitaciones y decisiones de diseño

- **Problema del oráculo:** la blockchain garantiza que el dato **no cambió después**, no que la medición física
  fuera correcta. Por eso existe el contra-análisis y los laboratorios están autorizados (acreditación).
- **Administrador centralizado:** una cuenta decide qué laboratorios están autorizados. En producción podría ser
  una multifirma o una entidad reguladora.
- **Contrato no actualizable:** da garantías fuertes (nadie cambia las reglas) pero obliga a desplegar uno nuevo
  para cualquier mejora (por ejemplo, para agregar `unlist_batch`).
- **Confianza en el RPC:** la app lee la cadena a través de un nodo RPC. Para máxima independencia, un verificador
  puede usar su propio nodo o comprobar en el explorador.
- **Off-chain:** si se pierden los datos de la base de datos, la huella sigue probando qué se registró, pero no
  permite reconstruir el contenido. Los PDF necesitan almacenamiento persistente en producción.
- **Testnet:** se reinicia periódicamente. Mainnet requiere desplegar el contrato allí y usar dinero real.
- **Passkeys:** evaluado (Smart Account Kit, verificación secp256r1 en la cadena, CAP-51), no implementado.

---

## 14. Estándares y versiones

| Estándar / pieza | Uso |
|---|---|
| Stellar Consensus Protocol (FBA) | Consenso de la red |
| Soroban (CAP-46 y siguientes) | Contratos inteligentes en WebAssembly |
| CAP-58 | Constructores de contratos (`__constructor`) |
| SEP-41 | Interfaz estándar de tokens (`transfer`, `balance`) |
| SEP-23 (StrKey) | Codificación de direcciones `G…`, `C…`, `S…` |
| Ed25519 (RFC 8032) | Firmas de las cuentas |
| SHA-256 (FIPS 180-4) | Huella de registros y PDF |
| JCS (RFC 8785) | Serialización canónica de JSON |
| ISO 8601 | Fechas en UTC |
| `soroban-sdk` 28.0.0 · Stellar CLI 28 · Rust 1.98 · target `wasm32v1-none` | Contrato |
| `@stellar/stellar-sdk` 17.2.1 · `@stellar/freighter-api` 6.0.1 | Cliente y wallet |
| Node.js 22 · Express 5 · TypeScript · React 19 · Vite · PostgreSQL (PGlite) | Aplicación |

---

## 15. Pruebas

| Conjunto | Qué cubre | Comando |
|---|---|---|
| Contrato (15, Rust) | Lab no autorizado o revocado, versión duplicada, `hash_anterior` incorrecto, compra y confirmación, contra-análisis dentro y fuera de tolerancia, reembolso, firmas incorrectas, árbol de autorización de `buy`, un evento por acción, plazo de garantía y `claim` | `npm run contrato:test` |
| Servidor (29) | Hashing y canonicalización, validación, flujo completo con fraude, correcciones, concurrencia del procesador, firma con wallet y reconciliación, marketplace, contra-análisis | `npm test` |
| Integración real en testnet (4) | Anclaje y verificación, firma con wallet y reconciliación, marketplace completo con disputa y reembolso, cobro por vencimiento | `npm run test:testnet` |
