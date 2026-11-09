import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { limitarAcceso } from '../src/seguridad.ts';
import { conectar } from '../src/db/index.ts';

test('limita intentos aunque el cliente cambie X-Forwarded-For', async () => {
  const app = express();
  const db = await conectar({ memoria: true });
  app.post('/login', limitarAcceso(db, 'prueba'), (_req, res) => { res.sendStatus(401); });
  const servidor = app.listen(0);
  try {
    const direccion = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/login`;
    for (let i = 0; i < 20; i++) {
      assert.equal((await fetch(direccion, { method: 'POST', headers: { 'X-Forwarded-For': `192.0.2.${i}` } })).status, 401);
    }
    const bloqueada = await fetch(direccion, { method: 'POST' });
    assert.equal(bloqueada.status, 429);
    assert.ok(Number(bloqueada.headers.get('retry-after')) > 0);
  } finally {
    servidor.close();
    await db.cerrar();
  }
});

test('con proxy confiable distingue clientes y limita también la cuenta entre IP e instancias', async () => {
  const db = await conectar({ memoria: true });
  const servidores = [0, 1].map(() => {
    const app = express();
    app.set('trust proxy', ['loopback']);
    app.use(express.json());
    app.post('/login', limitarAcceso(db, 'proxy', 3), (_req, res) => { res.sendStatus(401); });
    return app.listen(0);
  });
  const enviar = (indice: number, ip: string, email: string) => fetch(`http://127.0.0.1:${(servidores[indice].address() as AddressInfo).port}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ email }),
  });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await enviar(i % 2, `192.0.2.${i}`, i % 2 ? ' CUENTA@REAL.TEST ' : 'cuenta@real.test')).status, 401);
    assert.equal((await enviar(1, '192.0.2.44', 'cuenta@real.test')).status, 429);
    assert.equal((await enviar(0, '192.0.2.45', 'otra@real.test')).status, 401, 'otro cliente y cuenta conservan su cupo');
  } finally {
    for (const servidor of servidores) servidor.close();
    await db.cerrar();
  }
});
