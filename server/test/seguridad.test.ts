import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { limitarAcceso } from '../src/seguridad.ts';

test('limita intentos aunque el cliente cambie X-Forwarded-For', async () => {
  const app = express();
  app.post('/login', limitarAcceso(), (_req, res) => { res.sendStatus(401); });
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
  }
});
