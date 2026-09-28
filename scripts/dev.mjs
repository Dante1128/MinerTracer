// Arranca la API y el frontend juntos (Ctrl+C detiene ambos).
import { spawn } from 'node:child_process';

const procesos = [
  ['api', 'npm run dev --prefix server'],
  ['web', 'npm run dev --prefix web'],
].map(([nombre, comando]) => {
  const p = spawn(comando, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefijar = (datos) =>
    datos
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((linea) => console.log(`[${nombre}] ${linea}`));
  p.stdout.on('data', prefijar);
  p.stderr.on('data', prefijar);
  p.on('exit', (codigo) => {
    console.log(`[${nombre}] terminó (${codigo})`);
    procesos.forEach((otro) => otro.kill());
    process.exit(codigo ?? 0);
  });
  return p;
});

process.on('SIGINT', () => procesos.forEach((p) => p.kill()));
