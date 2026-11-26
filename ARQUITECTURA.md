# Arquitectura: Modelo-Vista-Controlador

MinerTrace es una API en Express (`server/`) más una SPA en React (`web/`), no una aplicación
de renderizado en servidor. El mapeo a MVC es, por eso, el habitual en este tipo de proyectos:
la Vista vive en el navegador y habla con el Modelo y el Controlador por HTTP/JSON, nunca
directamente con la base de datos.

```
┌─────────────────────┐        HTTP / JSON        ┌───────────────────────────────────────────────┐
│   VISTA (web/src)    │ ─────────────────────────▶│   CONTROLADOR (server/src/rutas+controladores) │
│   React + Vite       │ ◀───────────────────────── │   recibe la petición, valida, responde         │
└─────────────────────┘                             └───────────────────┬─────────────────────────┘
                                                                          │ llama
                                                      ┌───────────────────▼─────────────────────────┐
                                                      │   SERVICIOS (server/src/servicios)           │
                                                      │   reglas de negocio: hashing, anclaje,        │
                                                      │   marketplace, verificación                   │
                                                      └───────────────────┬─────────────────────────┘
                                                                          │ llama
                                                      ┌───────────────────▼─────────────────────────┐
                                                      │   MODELO (server/src/modelos + db/)          │
                                                      │   esquema de las tablas y acceso a datos      │
                                                      └───────────────────────────────────────────────┘
```

## Vista — `web/src/`

La SPA en React. No conoce SQL ni reglas de negocio: solo pide datos a la API (`web/src/api.ts`)
y los muestra. `paginas/` son las pantallas (Inicio, Verificar, Panel, DetalleAnalisis, Mercado…);
`componentes/` son las piezas reutilizables (formulario de análisis, escáner QR, insignias de
verificación); `wallet.tsx` conecta con Freighter para firmar transacciones Stellar, pero la
transacción en sí la arma siempre el servidor.

## Modelo — `server/src/modelos/` + `server/src/db/`

`db/esquema.ts` define las tablas y los triggers de solo inserción (el Modelo también es
responsable de las invariantes de los datos, no solo de leerlos). `modelos/` tiene un archivo
por entidad del dominio, cada uno con funciones puntuales que envuelven su SQL:

- `modelos/laboratorios.ts`, `modelos/usuarios.ts`: cuentas y laboratorios.
- `modelos/lotes.ts`, `modelos/analisis.ts`: lotes y sus análisis versionados.
- `modelos/contraAnalisis.ts`: contra-análisis del marketplace.

El módulo base del laboratorio concentra estas consultas en `modelos/`: los controladores y sus
servicios de negocio llaman a estas funciones. La extensión comercial v2 mantiene sus consultas y
transacciones de negociación en `comercio/servicio.ts`, con las mismas reglas de integridad.
(Las tablas de infraestructura — sesiones, recuperaciones, correos pendientes, límites de acceso,
eventos del contrato — se manejan donde ya vivían, en `auth.ts`, `correo.ts`, `seguridad.ts` y
`mercado/indexador.ts`, porque son detalle de esos subsistemas y no entidades del dominio.)

## Controlador — `server/src/rutas/` + `server/src/controladores/` + `server/src/servicios/`

Se reparte en tres capas finas, cada una con una responsabilidad:

- **`rutas/*.ts`**: solo registra las URLs (`Router`), aplica middlewares (sesión, límites de
  acceso, Multer para el PDF) y ata cada endpoint a su función en `controladores/`. No contiene
  lógica.
- **`controladores/*.ts`**: una función por endpoint. Lee `req`, valida con `validacion.ts`,
  llama al Modelo o a un servicio, y escribe la respuesta (`res.json(...)`). Es la capa
  "Controlador" clásica: traduce HTTP ↔ dominio.
- **`servicios/*.ts`**: las reglas de negocio que no son de un único endpoint — sellar un
  registro con su hash, encadenar versiones, verificar un anclaje contra la blockchain, orquestar
  el marketplace. Un controlador puede llamar a varios pasos de un servicio; un servicio nunca
  conoce `req`/`res`.

`server/src/anclaje/` y `server/src/mercado/` son subsistemas propios (el anclaje en Stellar/mock
y el marketplace sobre el contrato Soroban): actúan como Modelo+Servicio de su propio dominio
(leen y escriben su estado) y se consultan desde los controladores igual que cualquier otro
servicio.

## Extensión comercial v2

`server/src/comercio/` concentra perfiles declarados, anuncios, ofertas, acuerdos inmutables, evidencias,
sesiones comerciales y cálculos monetarios con enteros. Las rutas `/api/comercio` exponen la negociación;
`/api/mercado/comercial` prepara y envía las transacciones firmadas por las wallets. El directorio público
combina los perfiles declarados con sus anuncios y los lotes leídos del contrato, sin exponer contacto ni
referencias privadas de documentos. La identidad de un vendedor no se certifica por el laboratorio del lote.

El estado de pagos, recepción, incidencias y liquidaciones procede siempre del contrato. Las firmas del
laboratorio se mantienen en el navegador, y los controladores conservan la comprobación de preparaciones,
transacciones e importes esperados. Los eventos indexados alimentan la línea de tiempo.

## Por qué no hay "vistas" en el servidor

Un backend de API no renderiza HTML: lo que en un MVC clásico sería la Vista del servidor
(una plantilla) aquí es el JSON que devuelve el controlador, consumido por la Vista real, que es
la SPA. Por eso `web/` es la Vista del sistema completo, y el servidor es Modelo + Controlador.

## Dónde tocar qué

| Quiero… | Toco… |
|---|---|
| Cambiar una consulta SQL o el esquema de una tabla | `server/src/modelos/*.ts` o `server/src/db/esquema.ts` |
| Agregar un endpoint nuevo | `server/src/controladores/*.ts` (lógica) + `server/src/rutas/*.ts` (URL) |
| Cambiar una regla de negocio (hashing, verificación, marketplace) | `server/src/servicios/*.ts` |
| Cambiar cómo se ve o se navega algo | `web/src/paginas/` o `web/src/componentes/` |
