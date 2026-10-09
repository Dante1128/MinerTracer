# MinerTrace

**Sistema de trazabilidad e integridad de análisis minerales con Stellar Blockchain**

---

## Índice

1. Problema que resuelve
2. Objetivo del sistema
3. Flujo de funcionamiento
4. Arquitectura general
5. Rol de la base de datos
6. Rol de Stellar Blockchain
7. Generación y utilización del hash
8. Proceso de registro de un análisis
9. Proceso de verificación de un análisis
10. Cómo se evita depender de la blockchain para grandes volúmenes de información
11. Ventajas de utilizar una blockchain pública para la trazabilidad
12. Posibles casos de uso
13. Ejemplo práctico: lote con 75% de pureza
14. Tecnologías que podrían utilizarse
15. Posibles mejoras futuras
16. Estructura de la aplicación web
17. Plan de desarrollo por fases (incluye pendientes Web3)
18. Conclusión

---

## 1. Problema que resuelve

En la cadena de comercialización de minerales, el informe de laboratorio es el documento que determina el valor de un lote. Pureza, composición y procedencia influyen directamente en el precio, en los impuestos y en la reputación de quienes participan.

El problema es que estos informes suelen existir como PDFs, hojas de cálculo o registros en bases de datos que cualquier persona con acceso puede modificar sin dejar rastro. Esto permite situaciones como:

- Un lote analizado con **75% de pureza** que luego se comercializa como si tuviera **95%**.
- Informes modificados después de emitidos, sin que el comprador pueda detectarlo.
- Disputas entre laboratorio, productor y comprador sin una evidencia neutral que resuelva cuál era el resultado original.
- Dificultad para reconstruir el historial de un lote en auditorías o controles regulatorios.

En resumen, falta un mecanismo **confiable, independiente y verificable** que demuestre que un resultado no fue alterado después de registrado.

---

## 2. Objetivo del sistema

MinerTrace busca **generar confianza, trazabilidad y evidencia verificable** durante el ciclo de vida de un lote de mineral, desde su análisis en laboratorio hasta su consulta o comercialización.

Concretamente, permite:

- Registrar análisis de laboratorio de forma estructurada.
- Sellar cada registro con una huella criptográfica anclada en una blockchain pública (Stellar).
- Permitir que cualquier interesado verifique que los datos que está viendo son idénticos a los registrados originalmente.

> **Alcance del sistema:** MinerTrace garantiza la **integridad del registro digital**, no la veracidad del análisis físico. Si un laboratorio mide mal o registra un dato falso desde el inicio, la blockchain sellará ese dato erróneo con la misma fidelidad. La validez del resultado depende del laboratorio, de sus procedimientos, de su calibración y de sus acreditaciones (por ejemplo, ISO/IEC 17025). Lo que MinerTrace sí asegura es que, **una vez registrado, el resultado no puede modificarse sin que se detecte**.

---

## 3. Flujo de funcionamiento

1. **Registro:** el laboratorio ingresa los datos del análisis.
2. **Almacenamiento:** los datos completos se guardan en la base de datos.
3. **Huella:** el sistema genera un hash SHA-256 del registro en un formato canónico.
4. **Anclaje:** el hash se envía a Stellar dentro de una transacción firmada por la cuenta del laboratorio.
5. **Vinculación:** el identificador de la transacción Stellar se guarda junto al registro.
6. **Consulta:** un comprador, auditor o cooperativa accede al análisis (por ejemplo, escaneando un código QR del lote).
7. **Verificación:** el sistema recalcula el hash de los datos actuales y lo compara con el anclado en Stellar.
8. **Resultado:** si coinciden, el registro está íntegro. Si no coinciden, fue alterado.

---

## 4. Arquitectura general

```
┌──────────────────┐        ┌───────────────────────────┐
│  Portal del      │        │   Portal público de       │
│  laboratorio     │        │   verificación (QR / ID)  │
└────────┬─────────┘        └─────────────┬─────────────┘
         │                                │
         ▼                                ▼
┌─────────────────────────────────────────────────────────┐
│                  Backend / API MinerTrace                │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Gestión de │  │ Servicio de  │  │ Servicio de      │ │
│  │ análisis   │  │ hashing      │  │ anclaje Stellar  │ │
│  └────────────┘  └──────────────┘  └──────────────────┘ │
└──────┬───────────────────┬──────────────────┬───────────┘
       ▼                   ▼                  ▼
┌─────────────┐   ┌─────────────────┐   ┌────────────────┐
│ Base de     │   │ Almacenamiento  │   │ Red Stellar    │
│ datos       │   │ de archivos     │   │ (Horizon /RPC) │
│ (PostgreSQL)│   │ (PDFs, anexos)  │   │                │
└─────────────┘   └─────────────────┘   └────────────────┘
```

Hay tres capas:

- **Presentación:** el portal del laboratorio para registrar análisis y el portal público para verificarlos.
- **Lógica:** una API que valida datos, genera hashes y gestiona las transacciones con Stellar.
- **Persistencia:** la base de datos y el almacenamiento de archivos guardan la información completa; Stellar guarda solo la evidencia de integridad.

---

## 5. Rol de la base de datos

La base de datos es la **fuente de la información completa**. Almacena:

- **Datos del lote:** código, peso, tipo de mineral, origen (cooperativa, mina, coordenadas).
- **Datos del análisis:** fecha, método (por ejemplo, fluorescencia de rayos X o ensayo al fuego), pureza, composición química por elemento, observaciones.
- **Datos del laboratorio:** identificador, analista responsable, acreditaciones.
- **Archivos adjuntos:** informe PDF firmado, certificados, fotografías.
- **Metadatos de integridad:** hash calculado, versión del formato canónico, ID de la transacción Stellar, fecha de anclaje, estado.

Es rápida, consultable, permite búsquedas y reportes, y puede almacenar gran volumen de información a bajo costo.

**Su límite:** por sí sola no ofrece garantías de inmutabilidad. Un administrador con acceso podría cambiar un 75 por un 95. Por eso se complementa con Stellar.

**Buena práctica:** tratar los registros como **solo inserción**. Una corrección no sobrescribe el análisis original, sino que crea una nueva versión vinculada a la anterior, con su propio hash y anclaje. Así el historial completo queda visible.

---

## 6. Rol de Stellar Blockchain

Stellar actúa como un **notario digital público**. Su función no es guardar el informe, sino dejar constancia inmutable de que **cierto contenido existía en un momento determinado y fue registrado por una cuenta determinada**.

Stellar aporta:

- **Inmutabilidad:** una vez confirmada, una transacción no puede modificarse ni borrarse.
- **Marca temporal:** cada transacción queda incluida en un ledger con fecha y hora de cierre.
- **Autoría:** la transacción la firma la cuenta del laboratorio (su clave pública), lo que permite atribuirle el registro.
- **Verificación independiente:** cualquiera puede consultar la transacción en exploradores públicos o mediante la API Horizon, sin depender de MinerTrace.
- **Bajo costo y rapidez:** las comisiones son de fracciones de centavo y los ledgers se cierran en pocos segundos, lo que hace viable anclar cada análisis.

### Formas de anclar el hash

| Método | Descripción | Recomendado para |
|---|---|---|
| `MEMO_HASH` | Memo de 32 bytes en la transacción, exactamente el tamaño de un SHA-256 | Prototipo y primera versión |
| `manageData` | Par clave/valor en la cuenta del laboratorio (clave = ID del lote, valor = hash) | Consultas por lote |
| Contrato Soroban | Contrato inteligente con reglas: laboratorios autorizados, versiones, revocaciones | Versión avanzada |

---

## 7. Generación y utilización del hash

Un **hash** es una huella digital de longitud fija (256 bits con SHA-256) calculada a partir de un contenido. Sus propiedades clave son:

- **Determinista:** el mismo contenido siempre produce el mismo hash.
- **Sensible:** cambiar un solo carácter (75 → 95) produce un hash completamente distinto.
- **Unidireccional:** a partir del hash no se pueden reconstruir los datos.
- **Resistente a colisiones:** en la práctica, no es factible encontrar dos contenidos distintos con el mismo hash.

### Canonicalización (detalle crítico)

Antes de calcular el hash, los datos deben serializarse siempre de la misma manera. Si un día el JSON sale con los campos en otro orden, o `75.0` en lugar de `75`, el hash cambia aunque los datos sean iguales. Para evitarlo:

- Usar un esquema fijo y versionado de campos.
- Serializar con un estándar como **JSON Canonicalization Scheme (RFC 8785)**: claves ordenadas, sin espacios, números normalizados.
- Representar cantidades con precisión fija (por ejemplo, la pureza como texto `"75.00"`).
- Usar fechas en ISO 8601 y UTC.
- Incluir el hash SHA-256 de los archivos adjuntos (como el PDF) dentro del registro, de modo que también queden protegidos.

### Privacidad

Si se teme que alguien intente adivinar los datos probando combinaciones, se puede añadir un valor aleatorio (*salt*) guardado en la base de datos. El hash sigue siendo verificable para quien tiene el registro, pero no revela nada a quien solo ve la blockchain.

---

## 8. Proceso de registro de un análisis

1. El analista inicia sesión en el portal del laboratorio.
2. Ingresa los datos del lote y del análisis, y adjunta el informe PDF.
3. El backend valida los datos: campos obligatorios, rangos (una pureza no puede superar 100%) y formatos.
4. Se calcula el SHA-256 del PDF adjunto.
5. Se construye el registro canónico con todos los campos, incluido el hash del PDF.
6. Se calcula el SHA-256 del registro canónico: esa es la **huella del análisis**.
7. Se guarda todo en la base de datos con estado *pendiente de anclaje*.
8. El servicio de anclaje crea una transacción Stellar con el hash en el memo, firmada con la clave del laboratorio.
9. Cuando la red confirma la transacción, se guarda su ID y fecha, y el estado cambia a *anclado*.
10. Se genera un código QR o enlace de verificación para el lote.

Si la red no está disponible, el registro queda pendiente y se reintenta. El análisis nunca se pierde porque ya está en la base de datos.

---

## 9. Proceso de verificación de un análisis

1. El verificador (comprador, auditor, entidad reguladora) escanea el QR o ingresa el ID del lote.
2. El sistema recupera el registro de la base de datos.
3. Reconstruye el registro canónico con el mismo esquema y versión usados al registrar.
4. Recalcula el hash.
5. Consulta la transacción en Stellar mediante su ID y obtiene el hash anclado.
6. Comprueba además que la transacción fue firmada por la cuenta pública conocida del laboratorio.
7. Compara ambos hashes:
   - ✅ **Coinciden:** el registro está íntegro desde la fecha del anclaje.
   - ❌ **No coinciden:** los datos fueron modificados después del registro.

**Verificación sin confiar en MinerTrace:** el sistema puede entregar el registro canónico y el ID de la transacción para que cualquiera calcule el hash con sus propias herramientas y lo compare en un explorador público de Stellar. La verificación no depende de creer en la plataforma.

---

## 10. Cómo se evita depender de la blockchain para grandes volúmenes de información

MinerTrace sigue un modelo de **anclaje fuera de cadena** (*off-chain storage, on-chain proof*):

| Dónde | Qué se guarda | Tamaño aproximado |
|---|---|---|
| Base de datos | Todos los datos del análisis | Kilobytes por registro |
| Almacenamiento de archivos | PDFs, fotografías, anexos | Megabytes |
| Stellar | Solo el hash | 32 bytes |

Beneficios:

- **Costo mínimo:** se paga por una transacción pequeña, no por almacenar documentos.
- **Privacidad:** los datos comerciales sensibles no quedan expuestos públicamente; en la cadena solo hay una huella ilegible.
- **Flexibilidad:** la base de datos puede cambiar de tecnología o escalar sin afectar la evidencia.
- **Escalabilidad:** para laboratorios con muchos análisis diarios, los hashes pueden agruparse en un **árbol de Merkle** y anclar solo la raíz (por ejemplo, cada hora). Cada análisis sigue siendo verificable individualmente con su prueba de Merkle, con una sola transacción por grupo de registros.

---

## 11. Ventajas de utilizar una blockchain pública para la trazabilidad

- **Neutralidad:** ningún actor de la cadena (laboratorio, cooperativa, comprador) controla el registro, así que ninguno puede alterarlo a su favor.
- **Verificación independiente:** cualquier persona puede comprobar la evidencia sin permisos especiales ni acuerdos previos.
- **Permanencia:** la evidencia sobrevive aunque MinerTrace deje de operar.
- **Transparencia auditable:** reguladores y auditores pueden revisar el historial de anclajes de un laboratorio.
- **Atribución criptográfica:** cada registro está firmado por la cuenta del laboratorio, lo que dificulta el repudio.
- **Costo y velocidad adecuados:** Stellar está orientada a transacciones rápidas y baratas, lo que hace viable anclar cada análisis.

Una blockchain privada podría hacer algo similar, pero la confianza volvería a depender de quienes la operan, que es justamente el problema que se quiere resolver.

---

## 12. Posibles casos de uso

### Laboratorios de análisis
- Proteger su reputación demostrando que sus informes no se modifican después de emitidos.
- Diferenciarse comercialmente con informes verificables.
- Responder a disputas con evidencia objetiva de lo que realmente emitieron.
- Detectar falsificaciones de informes que usan su nombre.

### Cooperativas mineras
- Demostrar la calidad real de su producción ante compradores y obtener precios justos.
- Documentar la procedencia de sus lotes, útil para mercados que exigen origen responsable.
- Protegerse de intermediarios que alteren resultados en su perjuicio.
- Mantener un historial verificable de su producción para obtener financiamiento o certificaciones.

### Empresas comercializadoras y exportadoras
- Verificar los análisis antes de comprar un lote.
- Presentar a clientes internacionales evidencia verificable de calidad y origen.
- Facilitar auditorías de cumplimiento y debida diligencia en la cadena de suministro.
- Reducir disputas contractuales basadas en la ley del mineral.

### Entidades reguladoras y fiscales
- Contrastar la pureza declarada en la exportación con el análisis original anclado.
- Detectar discrepancias que puedan indicar subdeclaración o fraude.

---

## 13. Ejemplo práctico: lote con 75% de pureza

### Registro (15 de septiembre de 2026)

El laboratorio `LAB-001` analiza el lote `LT-2026-0457` de una cooperativa de Potosí. El registro canónico, simplificado, sería:

```json
{"analisis_id":"AN-2026-1023","composicion":{"Ag":"0.80","Pb":"4.10","Sn":"75.00","otros":"20.10"},"fecha_analisis":"2026-09-15T14:30:00Z","laboratorio_id":"LAB-001","lote_id":"LT-2026-0457","metodo":"FRX","origen":"Cooperativa Minera X, Potosí, Bolivia","pdf_sha256":"9f2c...e41a","pureza":"75.00","version_esquema":"1"}
```

El sistema calcula su SHA-256 (valor ilustrativo, abreviado):

```
Hash original: a3f5c8...7b21
```

Ese hash se ancla en Stellar en una transacción firmada por la cuenta del laboratorio `GLAB...X7Q`. La transacción queda confirmada con su fecha y hora, y su ID se guarda en la base de datos.

### Intento de fraude (meses después)

Un intermediario con acceso a la base de datos cambia `"pureza":"75.00"` por `"pureza":"95.00"` y genera un nuevo PDF para vender el lote a mejor precio.

### Verificación por el comprador

1. El comprador escanea el QR del lote.
2. El sistema reconstruye el registro canónico con los datos actuales, que ahora dicen `95.00`.
3. Recalcula el hash: `e81d02...c94f`.
4. Consulta Stellar y obtiene el hash anclado: `a3f5c8...7b21`.
5. **No coinciden.** El sistema muestra:

> ❌ *Registro alterado: los datos actuales no corresponden al análisis registrado el 15/09/2026 por LAB-001.*

Además, el hash del nuevo PDF no coincide con el `pdf_sha256` original, por lo que también se detecta el documento falsificado.

### Lo que este ejemplo demuestra y lo que no

MinerTrace detectó que el registro fue modificado después del 15 de septiembre. **No puede demostrar por sí mismo que el 75% sea la medición correcta**; eso depende de que el laboratorio haya hecho bien el análisis. Pero sí demuestra que **75% fue lo que el laboratorio registró**, y que el 95% es posterior y no proviene de ese análisis.

---

## 14. Tecnologías que podrían utilizarse

| Componente | Opciones |
|---|---|
| Frontend | React o Next.js, con Tailwind CSS; lector QR para el verificador |
| Backend | Node.js (NestJS o Express) o Python (FastAPI) |
| Base de datos | PostgreSQL, con columnas JSONB para composición química y tablas de auditoría |
| Almacenamiento de archivos | Amazon S3, MinIO o similar; opcionalmente IPFS para anexos |
| Hashing | SHA-256 (módulo `crypto` de Node.js o `hashlib` de Python) y una librería de canonicalización RFC 8785 |
| Integración Stellar | Stellar SDK (JavaScript o Python), API Horizon o Stellar RPC; Testnet para desarrollo |
| Contratos inteligentes (opcional) | Soroban, escrito en Rust |
| Gestión de claves | Variables de entorno cifradas en el prototipo; HashiCorp Vault o un servicio KMS en producción |
| Autenticación | JWT u OAuth 2.0, con roles (analista, supervisor, verificador) |
| Colas y reintentos | Redis con BullMQ, o Celery en Python, para anclajes pendientes |
| PWA | Service Worker y Web App Manifest (por ejemplo, con `next-pwa` o Vite PWA) |
| Despliegue | Docker y Docker Compose; luego un servicio en la nube |

**Stack mínimo para una demostración:** React + Node.js + PostgreSQL + Stellar SDK en Testnet, anclando el hash en el memo de la transacción.

---

## 15. Posibles mejoras futuras

- **Trazabilidad del ciclo de vida completo:** registrar eventos del lote más allá del análisis (extracción, transporte, pesaje, almacenamiento, venta, exportación), formando una cadena de custodia verificable.
- **Contratos inteligentes en Soroban:** registro de laboratorios autorizados, control de versiones de análisis y revocación de informes.
- **Firma digital del analista:** además de la cuenta del laboratorio, firmas individuales del analista y del supervisor.
- **Integración directa con equipos de laboratorio:** capturar los resultados desde el instrumento para reducir errores o manipulaciones en la transcripción manual.
- **Análisis contradictorios:** permitir que un segundo laboratorio registre un contraanálisis del mismo lote y comparar resultados.
- **Tokenización de lotes:** representar lotes como activos en Stellar vinculados a su análisis, facilitando transferencias trazables.
- **Anclaje por lotes con árboles de Merkle:** reducir costos a gran escala.
- **Modo sin conexión:** verificación diferida en zonas mineras con poca señal.
- **Integración con organismos reguladores:** consultas directas para controles de exportación y fiscalización.
- **Credenciales verificables:** emitir los informes como credenciales digitales (estándar W3C) verificables con cualquier herramienta compatible.
- **Paneles de indicadores:** estadísticas de calidad por cooperativa, región o tipo de mineral.
- **App nativa (solo si hace falta):** si más adelante se necesita trabajar largos periodos sin internet o integrarse con hardware específico.

---

## 16. Estructura de la aplicación web

MinerTrace no necesita tres productos separados (una web informativa, un sistema y una app móvil). La mejor opción es **una sola aplicación web responsive, instalable como PWA, con tres zonas** según el tipo de usuario.

### Las tres zonas

| Zona | Ruta de ejemplo | Acceso | Usuarios | Función |
|---|---|---|---|---|
| Página del proyecto | `minertrace.com` | Pública | Compradores, inversionistas, jurados, público general | Explicar qué es MinerTrace, cómo funciona y por qué es confiable |
| Portal del laboratorio | `minertrace.com/laboratorio` | Con inicio de sesión | Analistas, supervisores | Registrar lotes y análisis, adjuntar informes, ver estado del anclaje en Stellar, generar QR |
| Verificador público | `minertrace.com/verificar/LT-2026-0457` | Pública | Compradores, auditores, reguladores, cooperativas | Escanear QR o ingresar código y ver si el análisis está íntegro o fue alterado |

Las tres zonas comparten el mismo dominio, el mismo backend y la misma base de datos.

### Por qué una aplicación web y no una app nativa

- **Un solo desarrollo:** un código base, un despliegue, un mantenimiento.
- **Sin tiendas de aplicaciones:** no hay que publicar ni esperar aprobaciones en Play Store o App Store.
- **Acceso inmediato:** el verificador funciona abriendo un enlace o escaneando un QR, sin instalar nada.
- **Funciona en celular:** con diseño responsive se adapta a cualquier pantalla.
- **Se instala como app (PWA):** puede añadirse a la pantalla de inicio, usar la cámara para escanear QR y funcionar parcialmente sin conexión.
- **Menor costo y tiempo:** ideal para un prototipo y para presentar el proyecto.

### Experiencia del usuario del laboratorio

El analista no necesita entender de blockchain. Solo llena un formulario; el sistema calcula el hash, lo ancla en Stellar y le muestra el resultado con un estado simple (*pendiente* → *anclado*) y el QR del lote listo para imprimir.

### Experiencia del verificador

El comprador escanea el QR y ve una respuesta clara:

- ✅ **Registro íntegro:** los datos coinciden con el análisis registrado por el laboratorio en la fecha indicada.
- ❌ **Registro alterado:** los datos actuales no coinciden con los registrados originalmente.

Además, puede ver el enlace a la transacción en un explorador público de Stellar para comprobarlo por su cuenta.

---

## 17. Plan de desarrollo por fases

### Fase 1 (actual): frontend + backend

El desarrollo inicial se enfoca en la aplicación web y el backend, dejando todo preparado para conectar Stellar después sin rehacer nada.

- Las tres zonas de la aplicación web: página del proyecto, portal del laboratorio con login y verificador público.
- Registro de lotes y análisis, carga de PDFs y generación de QR.
- Base de datos PostgreSQL con registros de solo inserción y versiones.
- **Hashing implementado desde ya:** canonicalización del registro (RFC 8785), SHA-256 del PDF y del análisis, y verificación comparando hashes. Esto no depende de la blockchain.
- **Servicio de anclaje simulado (mock):** en lugar de enviar el hash a Stellar, lo guarda en una tabla aparte y devuelve un ID de transacción simulado. El resto del sistema funciona como si Stellar existiera, con estados *pendiente* → *anclado*.

**Diseño clave:** el servicio de anclaje tiene una interfaz fija:

```ts
interface ServicioAnclaje {
  anclar(hash: string): Promise<{ txId: string; fecha: string }>;
  consultarAnclaje(txId: string): Promise<{ hash: string; cuenta: string; fecha: string }>;
}
```

En la Fase 1 existe `AnclajeMock implements ServicioAnclaje`. En la Fase 2 se crea `AnclajeStellar implements ServicioAnclaje` y se cambia la configuración. El frontend, la API y la base de datos quedan igual.

### Fase 2: integración Web3 con Stellar — ⚠️ PENDIENTE

> **Recordatorio:** esta fase queda pendiente. En el código, el servicio de anclaje simulado debe llevar un comentario `// TODO WEB3: reemplazar por AnclajeStellar (ver MinerTrace.md, sección 17)`.

Checklist:

- [ ] Crear cuentas del laboratorio en **Stellar Testnet** y fondearlas (Friendbot).
- [ ] Instalar el **Stellar SDK** (JavaScript o Python) y conectar con Horizon / Stellar RPC.
- [ ] Implementar `AnclajeStellar`: enviar el hash en el memo de la transacción (`MEMO_HASH`).
- [ ] Guardar el **ID real de la transacción** y la fecha del ledger en la base de datos.
- [ ] En el verificador, mostrar el **enlace a un explorador público** de Stellar.
- [ ] Validar que la transacción esté **firmada por la cuenta pública del laboratorio**.
- [ ] **Gestión segura de claves privadas** (variables cifradas en pruebas; Vault o KMS en producción).
- [ ] **Cola de reintentos** si la red no responde (Redis + BullMQ o Celery).
- [ ] Migrar los anclajes simulados de la Fase 1 (re-anclarlos en Testnet o marcarlos como datos de prueba).

### Fase 3: mejoras Web3 avanzadas

- [ ] Anclaje por lotes con **árboles de Merkle**.
- [ ] **Contrato inteligente en Soroban** (laboratorios autorizados, versiones, revocaciones).
- [ ] Paso de Testnet a **Mainnet**.
- [ ] Credenciales verificables y tokenización de lotes (ver sección 15).

---

## 18. Conclusión

MinerTrace combina lo mejor de dos tecnologías: la base de datos aporta capacidad, velocidad y detalle, y Stellar aporta una evidencia pública, inmutable y verificable de forma independiente. El resultado es un sistema donde **nadie puede modificar un análisis registrado sin que se detecte**.

MinerTrace no reemplaza la competencia técnica ni la acreditación del laboratorio; las complementa. La calidad del análisis sigue dependiendo de las personas y los procedimientos. Lo que cambia es que, una vez emitido un resultado, queda protegido por una evidencia que cualquier actor de la cadena puede comprobar.

Así, MinerTrace genera **confianza, trazabilidad y evidencia verificable** a lo largo de toda la vida del lote, desde el laboratorio hasta su comercialización, a través de una única aplicación web accesible desde cualquier dispositivo.
