import { crearServicioAnclaje } from './anclaje/index.ts';
import { ProcesadorAnclajes } from './anclaje/procesador.ts';
import { crearApp } from './app.ts';
import { config } from './config.ts';
import { conectar } from './db/index.ts';
import { PASSWORD_DEMO, sembrar } from './semilla.ts';

const db = await conectar();
const anclaje = crearServicioAnclaje(db);
const procesador = new ProcesadorAnclajes(db, anclaje);
const ctx = { db, anclaje, procesador };

if (await sembrar(ctx)) {
  console.log(`[semilla] Usuarios de prueba: analista@lab001.test / supervisor@lab001.test (contraseña: ${PASSWORD_DEMO})`);
}
procesador.iniciar();

const servidor = crearApp(ctx).listen(config.puerto, () => {
  console.log(`MinerTrace API en http://localhost:${config.puerto}`);
  console.log(`  base de datos: ${db.motor === 'pglite' ? `PGlite (${config.datosDir})` : 'PostgreSQL'}`);
  console.log(`  anclaje: ${anclaje.nombre}${config.demoAlterar ? ' | demo de alteración habilitada' : ''}`);
});

async function apagar() {
  procesador.detener();
  servidor.close();
  await db.cerrar();
  process.exit(0);
}
process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
