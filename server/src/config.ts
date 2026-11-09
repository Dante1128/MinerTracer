import path from 'node:path';

try {
  process.loadEnvFile();
} catch {
  // Sin .env: se usan los valores por defecto de desarrollo.
}

const entero = (valor: string | undefined, porDefecto: number) =>
  valor === undefined || valor === '' ? porDefecto : Number.parseInt(valor, 10);

const produccion = process.env.NODE_ENV === 'production';

/** Variables por laboratorio: STELLAR_SECRETO_LAB_001=S... → { 'LAB-001': 'S...' } */
const porLaboratorio = (prefijo: string) =>
  Object.fromEntries(
    Object.entries(process.env)
      .filter(([clave, valor]) => clave.startsWith(prefijo) && valor)
      .map(([clave, valor]) => [clave.slice(prefijo.length).replace(/_/g, '-'), valor as string]),
  );

export const config = {
  produccion,
  puerto: entero(process.env.PORT, 3000),
  // Si no hay DATABASE_URL se usa PGlite (PostgreSQL embebido) en DATOS_DIR/pglite.
  databaseUrl: process.env.DATABASE_URL || null,
  datosDir: path.resolve(process.env.DATOS_DIR || './datos'),
  jwtSecret: process.env.JWT_SECRET || 'solo-para-desarrollo-cambiar',
  origenPublico: process.env.ORIGEN_PUBLICO || 'http://localhost:5173',
  proxiesConfiables: (process.env.PROXIES_CONFIABLES || '').split(',').map((valor) => valor.trim()).filter(Boolean),
  correo: {
    host: process.env.SMTP_HOST || '',
    puerto: entero(process.env.SMTP_PORT, 587),
    seguro: process.env.SMTP_SECURE === 'true',
    usuario: process.env.SMTP_USUARIO || '',
    clave: process.env.SMTP_CLAVE || '',
    remitente: process.env.SMTP_REMITENTE || '',
  },
  anclaje: {
    proveedor: process.env.ANCLAJE || 'mock',
    mockRetrasoMs: entero(process.env.MOCK_RETRASO_MS, 2500),
    mockTasaFallo: Number(process.env.MOCK_TASA_FALLO || 0),
  },
  // Solo testnet. Ver server/.env.example.
  stellar: {
    rpcUrl: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    contratoId: process.env.STELLAR_CONTRATO_ID || '',
    // Claves de laboratorio: solo para la semilla y las pruebas (o FIRMA_LABORATORIO=servidor).
    secretos: porLaboratorio('STELLAR_SECRETO_'),
    // Cuentas públicas de los laboratorios semilla cuando no se da su clave (firman con su wallet).
    cuentas: porLaboratorio('STELLAR_CUENTA_'),
    // Dueño del lote de ejemplo de la semilla (opcional).
    duenoDemo: process.env.STELLAR_DUENO_DEMO || null,
    // "wallet": el laboratorio firma sus análisis con Freighter. "servidor": firma el servidor (desarrollo).
    firmaLaboratorio: process.env.FIRMA_LABORATORIO === 'servidor' ? ('servidor' as const) : ('wallet' as const),
  },
  // Habilita el endpoint que simula a un intermediario alterando la base de datos.
  demoAlterar: process.env.DEMO_ALTERAR === 'true' && !produccion,
  maxPdfBytes: 20 * 1024 * 1024,
};

if (produccion && config.jwtSecret === 'solo-para-desarrollo-cambiar') {
  throw new Error('JWT_SECRET es obligatorio en producción');
}

if (produccion && (config.jwtSecret.length < 32 || config.jwtSecret.startsWith('cambie-esto'))) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres aleatorios en producción');
}
if (produccion && config.stellar.firmaLaboratorio === 'servidor') {
  throw new Error('En producción los laboratorios deben firmar con su wallet');
}

const origen = new URL(config.origenPublico);
if (!['http:', 'https:'].includes(origen.protocol) || origen.origin !== config.origenPublico || (produccion && origen.protocol !== 'https:')) {
  throw new Error('ORIGEN_PUBLICO debe ser un origen sin ruta; en producción requiere HTTPS');
}
if (!Number.isInteger(config.correo.puerto) || config.correo.puerto < 1 || config.correo.puerto > 65535) {
  throw new Error('SMTP_PORT debe ser un puerto válido');
}
if (produccion && (!process.env.ORIGEN_PUBLICO || !config.correo.host || !config.correo.remitente)) {
  throw new Error('Configure ORIGEN_PUBLICO, SMTP_HOST y SMTP_REMITENTE para producción');
}
