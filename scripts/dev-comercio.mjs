// Arranque comercial aislado: conserva .env y todas las bases de datos anteriores.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archivoEnv = path.join(raiz, 'server', '.env');
if (existsSync(archivoEnv)) process.loadEnvFile(archivoEnv);

const archivoDespliegue = path.join(raiz, 'scripts', 'comercio-testnet.json');
let contratoReferencia = '';
if (!process.env.COMERCIO_CONTRATO_ID && existsSync(archivoDespliegue)) {
  const despliegue = JSON.parse(readFileSync(archivoDespliegue, 'utf8'));
  if (despliegue.red === 'testnet' && despliegue.version_comercial === 2) contratoReferencia = despliegue.contrato_id;
}
const contrato = (process.env.COMERCIO_CONTRATO_ID || contratoReferencia).trim();
if (!/^C[A-Z2-7]{55}$/.test(contrato)) {
  console.error('Indique COMERCIO_CONTRATO_ID con el identificador público del contrato comercial nuevo.');
  console.error('Para obtenerlo, despliegue explícitamente con: npm run contrato:desplegar');
  console.error('Después, en PowerShell: $env:COMERCIO_CONTRATO_ID="C..."; npm run dev:comercio');
  process.exit(1);
}

const carpeta = `datos-comercio-${contrato.slice(0, 12)}-${contrato.slice(-8)}`;
const datosDir = path.join(raiz, 'server', carpeta);
mkdirSync(datosDir, { recursive: true });
const entornoHijo = {
  ...process.env,
  NODE_ENV: 'development',
  ANCLAJE: 'stellar',
  STELLAR_CONTRATO_ID: contrato,
  DATOS_DIR: datosDir,
  // Una cadena vacía evita que config.ts recupere DATABASE_URL desde server/.env.
  DATABASE_URL: '',
};

console.log(`Contrato comercial (testnet): ${contrato}`);
console.log(`PGlite y PDF: server/${carpeta} (se reutiliza al volver a iniciar este contrato)`);
console.log('Abra http://localhost:5173/comercio. Ctrl+C detiene la API y la web.');
const proceso = spawn(process.execPath, [path.join(raiz, 'scripts', 'dev.mjs')], {
  cwd: raiz, env: entornoHijo, stdio: 'inherit',
});
proceso.on('error', () => {
  console.error('No se pudo iniciar el entorno comercial. Compruebe Node.js y las dependencias instaladas.');
  process.exitCode = 1;
});
proceso.on('exit', (codigo) => { process.exitCode = codigo ?? 0; });
for (const senal of ['SIGINT', 'SIGTERM']) process.on(senal, () => proceso.kill(senal));
