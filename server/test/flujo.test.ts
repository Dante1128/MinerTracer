import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// Base de datos en memoria y archivos en un directorio temporal.
const dirTemporal = fs.mkdtempSync(path.join(os.tmpdir(), 'minertrace-test-'));
process.env.DATOS_DIR = dirTemporal;
process.env.DEMO_ALTERAR = 'true';
process.env.ANCLAJE = 'mock';
delete process.env.DATABASE_URL;

const { conectar } = await import('../src/db/index.ts');
const { AnclajeMock } = await import('../src/anclaje/AnclajeMock.ts');
const { ProcesadorAnclajes } = await import('../src/anclaje/procesador.ts');
const { crearApp } = await import('../src/app.ts');
const { sembrar, PASSWORD_DEMO } = await import('../src/semilla.ts');
const { pdfSimple } = await import('../src/pdfSimple.ts');

const db = await conectar({ memoria: true });
const anclaje = new AnclajeMock(db);
const procesador = new ProcesadorAnclajes(db, anclaje);
const ctx = { db, anclaje, procesador };
let servidor: Server;
let base = '';

async function api(ruta: string, opciones: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opciones.token) headers.authorization = `Bearer ${opciones.token}`;
  if (opciones.json !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + ruta, {
    ...opciones,
    headers,
    body: opciones.json !== undefined ? JSON.stringify(opciones.json) : opciones.body,
  });
  return { estado: res.status, cuerpo: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
}

async function login(email: string) {
  const { cuerpo } = await api('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD_DEMO } });
  return cuerpo.token as string;
}

before(async () => {
  await sembrar(ctx, { lotesDemo: false });
  servidor = crearApp(ctx).listen(0);
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(async () => {
  servidor.close();
  await db.cerrar();
  fs.rmSync(dirTemporal, { recursive: true, force: true });
});

test('flujo completo: registro → anclaje → verificación → fraude detectado', async () => {
  const token = await login('analista@lab001.test');
  assert.ok(token);

  // Registrar lote
  const lote = await api('/api/lotes', {
    method: 'POST',
    token,
    json: { codigo: 'lt-2026-0457', tipo_mineral: 'Concentrado de estaño', peso_kg: '12500', origen: 'Cooperativa Minera X' },
  });
  assert.equal(lote.estado, 201, JSON.stringify(lote.cuerpo));
  assert.equal(lote.cuerpo.id, 'LT-2026-0457');

  // Registrar análisis con PDF
  const form = new FormData();
  form.set('lote_id', 'LT-2026-0457');
  form.set('fecha_analisis', '2026-09-15T14:30:00Z');
  form.set('metodo', 'FRX');
  form.set('pureza', '75');
  form.set('composicion', JSON.stringify({ Sn: '75', Pb: '4.1', Ag: '0.8', otros: '20.1' }));
  form.set('pdf', new Blob([new Uint8Array(pdfSimple('Informe', ['Pureza 75 %']))], { type: 'application/pdf' }), 'informe.pdf');
  const registro = await api('/api/analisis', { method: 'POST', token, body: form });
  assert.equal(registro.estado, 201, JSON.stringify(registro.cuerpo));
  assert.equal(registro.cuerpo.pureza, '75.00');
  const analisisId = registro.cuerpo.analisis_id;

  // Anclaje (el procesador corre en segundo plano; aquí lo esperamos)
  await procesador.procesar();
  let publico = await api('/api/publico/lotes/LT-2026-0457');
  let vigente = publico.cuerpo.analisis[0].vigente;
  assert.equal(vigente.estado_anclaje, 'anclado');
  assert.equal(vigente.verificacion.estado, 'integro', vigente.verificacion.motivos.join('; '));
  assert.deepEqual(vigente.verificacion.comprobaciones, { datos: true, firma: true, pdf: true });

  // El registro canónico público reproduce el hash anclado
  const texto = await (await fetch(`${base}/api/publico/analisis/${analisisId}/v/1/canonico.json`)).text();
  const { createHash } = await import('node:crypto');
  assert.equal(createHash('sha256').update(texto).digest('hex'), vigente.verificacion.hash_anclado);

  // La base de datos rechaza modificaciones directas
  await assert.rejects(db.query("UPDATE analisis SET pureza = '95.00'"), /no se pueden modificar/);
  await assert.rejects(db.query('DELETE FROM analisis'), /no se pueden borrar/);

  // Un intermediario desactiva la protección y cambia 75 → 95 (y recalcula el hash local)
  const fraude = await api('/api/demo/alterar', { method: 'POST', token, json: { analisis_id: analisisId, pureza: '95' } });
  assert.equal(fraude.estado, 200, JSON.stringify(fraude.cuerpo));

  publico = await api('/api/publico/lotes/LT-2026-0457');
  vigente = publico.cuerpo.analisis[0].vigente;
  assert.equal(vigente.pureza, '95.00');
  assert.equal(vigente.verificacion.estado, 'alterado');
  assert.equal(vigente.verificacion.comprobaciones.datos, false);
});

test('las correcciones crean versiones enlazadas y solo las registra un supervisor', async () => {
  const analista = await login('analista@lab001.test');
  const supervisor = await login('supervisor@lab001.test');

  await api('/api/lotes', { method: 'POST', token: analista, json: { tipo_mineral: 'Plata', peso_kg: '500', origen: 'Oruro' } });
  const { cuerpo: lotes } = await api('/api/lotes', { token: analista });
  const loteId = lotes.find((l: any) => l.origen === 'Oruro').id;
  assert.match(loteId, /^LT-\d{4}-\d{4}$/);

  const datos = () => {
    const f = new FormData();
    f.set('lote_id', loteId);
    f.set('fecha_analisis', '2026-09-20T10:00:00Z');
    f.set('metodo', 'Ensayo al fuego');
    f.set('pureza', '60.5');
    f.set('composicion', JSON.stringify({ Ag: '60.5' }));
    return f;
  };
  const f1 = datos();
  f1.set('pdf', new Blob([new Uint8Array(pdfSimple('Informe', ['v1']))]), 'v1.pdf');
  const v1 = await api('/api/analisis', { method: 'POST', token: analista, body: f1 });
  assert.equal(v1.estado, 201);

  const f2 = datos();
  f2.set('pureza', '61.20');
  f2.set('composicion', JSON.stringify({ Ag: '61.2' }));
  f2.set('motivo_correccion', 'Error de transcripción');
  const rechazo = await api(`/api/analisis/${v1.cuerpo.analisis_id}/versiones`, { method: 'POST', token: analista, body: f2 });
  assert.equal(rechazo.estado, 403);

  const v2 = await api(`/api/analisis/${v1.cuerpo.analisis_id}/versiones`, { method: 'POST', token: supervisor, body: f2 });
  assert.equal(v2.estado, 201, JSON.stringify(v2.cuerpo));
  assert.equal(v2.cuerpo.version, 2);
  assert.equal(v2.cuerpo.hash_anterior, v1.cuerpo.hash);

  await procesador.procesar();
  const { cuerpo } = await api(`/api/publico/lotes/${loteId}`);
  const [grupo] = cuerpo.analisis;
  assert.equal(grupo.versiones.length, 2);
  assert.equal(grupo.vigente.pureza, '61.20');
  assert.ok(grupo.versiones.every((v: any) => v.verificacion.estado === 'integro'));
});

test('rechaza archivos que no son PDF y accesos sin sesión', async () => {
  const token = await login('analista@lab001.test');
  const f = new FormData();
  f.set('lote_id', 'LT-2026-0457');
  f.set('fecha_analisis', '2026-09-15T14:30:00Z');
  f.set('metodo', 'FRX');
  f.set('pureza', '70');
  f.set('composicion', JSON.stringify({ Sn: '70' }));
  f.set('pdf', new Blob(['no soy un pdf']), 'falso.pdf');
  assert.equal((await api('/api/analisis', { method: 'POST', token, body: f })).estado, 400);
  assert.equal((await api('/api/analisis')).estado, 401);
  assert.equal((await api('/api/publico/lotes/NO-EXISTE')).estado, 404);
});
