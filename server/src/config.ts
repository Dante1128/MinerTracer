import path from 'node:path';

try {
  process.loadEnvFile();
} catch {
  // Sin .env: se usan los valores por defecto de desarrollo.
}

const entero = (valor: string | undefined, porDefecto: number) =>
  valor === undefined || valor === '' ? porDefecto : Number.parseInt(valor, 10);

const produccion = process.env.NODE_ENV === 'production';

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
  // Habilita el endpoint que simula a un intermediario alterando la base de datos.
  demoAlterar: process.env.DEMO_ALTERAR === 'true' && !produccion,
  maxPdfBytes: 20 * 1024 * 1024,
};

if (produccion && config.jwtSecret === 'solo-para-desarrollo-cambiar') {
  throw new Error('JWT_SECRET es obligatorio en producción');
}
