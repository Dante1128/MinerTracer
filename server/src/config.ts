import path from 'node:path';

try {
  process.loadEnvFile();
} catch {
  // Sin .env: se usan los valores por defecto de desarrollo.
}

const entero = (valor: string | undefined, porDefecto: number) =>
  valor === undefined || valor === '' ? porDefecto : Number.parseInt(valor, 10);

const produccion = process.env.NODE_ENV === 'production';

/** STELLAR_SECRETO_LAB_001=S... → { 'LAB-001': 'S...' } */
const PREFIJO_SECRETO = 'STELLAR_SECRETO_';
const secretosLaboratorios = Object.fromEntries(
  Object.entries(process.env)
    .filter(([clave, valor]) => clave.startsWith(PREFIJO_SECRETO) && valor)
    .map(([clave, valor]) => [clave.slice(PREFIJO_SECRETO.length).replace(/_/g, '-'), valor as string]),
);

export const config = {
  produccion,
  puerto: entero(process.env.PORT, 3000),
  // Si no hay DATABASE_URL se usa PGlite (PostgreSQL embebido) en DATOS_DIR/pglite.
  databaseUrl: process.env.DATABASE_URL || null,
  datosDir: path.resolve(process.env.DATOS_DIR || './datos'),
  jwtSecret: process.env.JWT_SECRET || 'solo-para-desarrollo-cambiar',
  anclaje: {
    proveedor: process.env.ANCLAJE || 'mock',
    mockRetrasoMs: entero(process.env.MOCK_RETRASO_MS, 2500),
    mockTasaFallo: Number(process.env.MOCK_TASA_FALLO || 0),
  },
  // Solo testnet. Ver server/.env.example.
  stellar: {
    rpcUrl: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    contratoId: process.env.STELLAR_CONTRATO_ID || '',
    // Temporal (etapa 4): el servidor firma con la clave de cada laboratorio.
    secretos: secretosLaboratorios,
    // Dueño del lote de ejemplo de la semilla (opcional).
    duenoDemo: process.env.STELLAR_DUENO_DEMO || null,
  },
  // Habilita el endpoint que simula a un intermediario alterando la base de datos.
  demoAlterar: process.env.DEMO_ALTERAR === 'true' && !produccion,
  maxPdfBytes: 20 * 1024 * 1024,
};

if (produccion && config.jwtSecret === 'solo-para-desarrollo-cambiar') {
  throw new Error('JWT_SECRET es obligatorio en producción');
}
