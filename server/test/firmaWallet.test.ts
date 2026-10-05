import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// Base de datos en memoria y archivos en un directorio temporal.
const dirTemporal = fs.mkdtempSync(path.join(os.tmpdir(), 'minertrace-test-'));
process.env.DATOS_DIR = dirTemporal;
process.env.ANCLAJE = 'mock';
delete process.env.DATABASE_URL;

const { conectar } = await import('../src/db/index.ts');
const { AnclajeMock } = await import('../src/anclaje/AnclajeMock.ts');
const { ProcesadorAnclajes } = await import('../src/anclaje/procesador.ts');
const { ErrorContrato } = await import('../src/anclaje/erroresContrato.ts');
const { crearApp } = await import('../src/app.ts');
const { sembrar, cuentaLaboratorio, PASSWORD_DEMO } = await import('../src/semilla.ts');
const { registrarAnalisis, registrarLote } = await import('../src/servicios/registro.ts');
const { pdfSimple } = await import('../src/pdfSimple.ts');
type Usuario = import('../src/contexto.ts').Usuario;
type ServicioAnclaje = import('../src/anclaje/ServicioAnclaje.ts').ServicioAnclaje;
type SolicitudAnclaje = import('../src/anclaje/ServicioAnclaje.ts').SolicitudAnclaje;
type ResultadoAnclaje = import('../src/anclaje/ServicioAnclaje.ts').ResultadoAnclaje;
type EstadoComercial = import('../src/mercado/mercado.ts').EstadoComercial;
type Mercado = import('../src/mercado/mercado.ts').Mercado;

const db = await conectar({ memoria: true });
const mock = new AnclajeMock(db);
const CUENTA_LAB1 = cuentaLaboratorio('LAB-001');
const CUENTA_LAB2 = cuentaLaboratorio('LAB-002');
const TX = 'cd'.repeat(32);

/** Anclaje con firma por wallet: registra lo que se le pide y simula la red. */
const red = {
  firmadas: [] as SolicitudAnclaje[],
  preparadas: [] as SolicitudAnclaje[],
  enLaRed: new Map<string, ResultadoAnclaje>(),
  prepararFalla: null as Error | null,
};
const anclaje: ServicioAnclaje = {
  nombre: 'stellar',
  red: 'testnet',
  contratoId: 'C-PRUEBA',
  firmaConWallet: true,
  anclar: async (s) => {
    red.firmadas.push(s);
    return { txId: 'ab'.repeat(32), fecha: '2026-10-05T12:00:00Z' };
  },
  buscarAnclaje: async (s) => red.enLaRed.get(s.hash) ?? null,
  prepararAnclaje: async (s) => {
    red.preparadas.push(s);
    if (red.prepararFalla) throw red.prepararFalla;
    return `XDR:${s.hash}`;
  },
  enviarAnclaje: async (s, xdr) => {
    assert.equal(xdr, `XDR:${s.hash}:firmado`);
    return { txId: TX, fecha: '2026-10-05T12:00:00Z' };
  },
  consultarAnclaje: mock.consultarAnclaje.bind(mock),
  urlExplorador: (tx) => `https://stellar.expert/explorer/testnet/tx/${tx}`,
};

/** Estado del contrato que ve el marketplace falso. */
let estadoLote: EstadoComercial | null = null;
const enviadasContra: string[] = [];
const mercado = {
  estadoLote: async () => estadoLote,
  indexador: { sincronizar: async () => {} },
  contrato: {
    prepararTransaccion: async (metodo: string, args: { hash: Buffer }) => `XDR:${metodo}:${args.hash.toString('hex')}`,
    enviarFirmada: async (xdr: string, esperado: { funcion: string; cuenta: string }) => {
      assert.equal(esperado.funcion, 'counter_analysis');
      assert.equal(esperado.cuenta, CUENTA_LAB2);
      enviadasContra.push(xdr);
      // El contrato registra el hash que venía en la transacción.
      const hash = xdr.split(':')[2];
      estadoLote = { ...estadoLote!, contra_analisis: { lab: CUENTA_LAB2, lab_certificador: CUENTA_LAB1, hash, pureza_bps: 7200, diferencia_bps: 300, fecha: 'f' } };
      return { txId: TX, ledger: 1, fecha: '2026-10-05T12:00:00Z' };
    },
  },
} as unknown as Mercado;

const procesador = new ProcesadorAnclajes(db, anclaje);
const ctx = { db, anclaje, procesador: { procesar: async () => {} } as unknown as typeof procesador, mercado };
let servidor: Server;
let base = '';
let analista: Usuario;
const tokens: Record<string, string> = {};

const datos = (pureza: string) => ({
  fecha_analisis: '2026-09-15T14:30:00Z',
  metodo: 'FRX',
  pureza,
  composicion: { Sn: pureza },
  observaciones: '',
});
const pdf = (t: string) => ({ buffer: pdfSimple('Informe', [t]), nombre: 'informe.pdf' });

async function api(ruta: string, opciones: { token?: string; json?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = {};
  if (opciones.token) headers.authorization = `Bearer ${opciones.token}`;
  if (opciones.json !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + ruta, {
    method: opciones.json !== undefined || opciones.form ? 'POST' : 'GET',
    headers,
    body: opciones.form ?? (opciones.json !== undefined ? JSON.stringify(opciones.json) : undefined),
  });
  return { estado: res.status, cuerpo: await res.json() };
}

before(async () => {
  await sembrar(ctx, { lotesDemo: false });
  [analista] = await db.query<Usuario>("SELECT id, email, nombre, rol, laboratorio_id FROM usuarios WHERE email = 'analista@lab001.test'");
  await registrarLote(ctx, analista, { codigo: 'LT-WAL-0001', tipo_mineral: 'Estaño', peso_kg: '1.000', origen: 'Oruro', coordenadas: null, dueno: null });
  servidor = crearApp(ctx).listen(0);
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  for (const email of ['analista@lab001.test', 'analista@lab002.test']) {
    tokens[email] = (await api('/api/auth/login', { json: { email, password: PASSWORD_DEMO } })).cuerpo.token;
  }
});

beforeEach(() => {
  red.firmadas.length = 0;
  red.preparadas.length = 0;
  red.enLaRed.clear();
  red.prepararFalla = null;
});

after(async () => {
  servidor.close();
  await db.cerrar();
  fs.rmSync(dirTemporal, { recursive: true, force: true });
});

const estadoDe = async (id: number) => (await db.query('SELECT estado_anclaje, tx_id FROM analisis WHERE id = $1', [id]))[0];

test('con firma por wallet el procesador no firma los análisis del portal: solo los reconcilia', async () => {
  const portal = await registrarAnalisis(ctx, analista, 'LT-WAL-0001', datos('75.00'), pdf('portal'));
  const semilla = await registrarAnalisis(ctx, analista, 'LT-WAL-0001', datos('60.00'), pdf('semilla'), { firmaServidor: true });
  await procesador.procesar();

  assert.deepEqual(red.firmadas.map((s) => s.analisisId), [semilla.analisis_id], 'solo firma el de la semilla');
  assert.equal((await estadoDe(portal.id)).estado_anclaje, 'pendiente');
  assert.equal((await estadoDe(semilla.id)).estado_anclaje, 'anclado');

  // El laboratorio firmó desde otro navegador y la transacción ya está en la red.
  red.enLaRed.set(portal.hash, { txId: TX, fecha: '2026-10-05T12:00:00Z' });
  red.firmadas.length = 0;
  await db.query('UPDATE analisis SET proximo_intento = NULL WHERE id = $1', [portal.id]);
  await procesador.procesar();
  assert.deepEqual(await estadoDe(portal.id), { estado_anclaje: 'anclado', tx_id: TX });
  assert.equal(red.firmadas.length, 0, 'reconciliar no firma nada');
});

test('el laboratorio firma su análisis con la wallet y el servidor lo marca anclado', async () => {
  const fila = await registrarAnalisis(ctx, analista, 'LT-WAL-0001', datos('70.00'), pdf('wallet'));
  const ruta = `/api/analisis/${fila.analisis_id}/v/1/firma`;
  const lab1 = tokens['analista@lab001.test'];

  assert.equal((await api(ruta, { json: { cuenta: CUENTA_LAB1 } })).estado, 401);
  const otraCuenta = await api(ruta, { token: lab1, json: { cuenta: CUENTA_LAB2 } });
  assert.equal(otraCuenta.estado, 403);
  assert.match(otraCuenta.cuerpo.error, new RegExp(CUENTA_LAB1));
  assert.equal((await api(ruta, { token: tokens['analista@lab002.test'], json: { cuenta: CUENTA_LAB2 } })).estado, 404);

  const preparada = await api(ruta, { token: lab1, json: { cuenta: CUENTA_LAB1 } });
  assert.equal(preparada.estado, 200);
  assert.equal(preparada.cuerpo.xdr, `XDR:${fila.hash}`);
  assert.equal(red.preparadas[0].cuentaLaboratorio, CUENTA_LAB1);
  assert.equal((await estadoDe(fila.id)).estado_anclaje, 'pendiente', 'preparar no ancla');

  const enviada = await api(`${ruta}/enviar`, { token: lab1, json: { cuenta: CUENTA_LAB1, xdr: `${preparada.cuerpo.xdr}:firmado` } });
  assert.equal(enviada.estado, 200, JSON.stringify(enviada.cuerpo));
  assert.equal(enviada.cuerpo.tx_id, TX);
  assert.deepEqual(await estadoDe(fila.id), { estado_anclaje: 'anclado', tx_id: TX });

  const otraVez = await api(ruta, { token: lab1, json: { cuenta: CUENTA_LAB1 } });
  assert.equal(otraVez.estado, 409);
});

test('si la versión ya estaba en el contrato, preparar la reconcilia en vez de fallar', async () => {
  const fila = await registrarAnalisis(ctx, analista, 'LT-WAL-0001', datos('71.00'), pdf('repetido'));
  red.prepararFalla = new ErrorContrato(6);
  red.enLaRed.set(fila.hash, { txId: TX, fecha: '2026-10-05T12:00:00Z' });
  const r = await api(`/api/analisis/${fila.analisis_id}/v/1/firma`, { token: tokens['analista@lab001.test'], json: { cuenta: CUENTA_LAB1 } });
  assert.deepEqual(r.cuerpo, { ya_anclado: true, tx_id: TX });
  assert.equal((await estadoDe(fila.id)).estado_anclaje, 'anclado');
});

test('el contra-análisis con wallet solo se guarda si el contrato registró el mismo hash', async () => {
  estadoLote = {
    lote_id: 'LT-WAL-0001',
    estado: 'EnGarantia',
    dueno: 'G',
    analisis_id: 'AN-1',
    version: 1,
    lab: CUENTA_LAB1,
    pureza_bps: 7500,
    venta: { vendedor: 'G', precio: '1', comprador: 'G2', analisis_id: 'AN-1', version: 1, lab: CUENTA_LAB1, pureza_bps: 7500 },
    contra_analisis: null,
  };
  const lab2 = tokens['analista@lab002.test'];
  const formulario = (cuenta: string) => {
    const f = new FormData();
    f.set('lote_id', 'LT-WAL-0001');
    f.set('cuenta', cuenta);
    f.set('fecha_analisis', '2026-10-01T10:00:00Z');
    f.set('metodo', 'ICP-OES');
    f.set('pureza', '72');
    f.set('composicion', JSON.stringify({ Sn: '72' }));
    f.set('pdf', new Blob([new Uint8Array(pdfSimple('Contra', ['72 %']))]), 'contra.pdf');
    return f;
  };
  const contar = async () => (await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM contra_analisis'))[0].n;

  assert.equal((await api('/api/contra-analisis/preparar', { token: lab2, form: formulario(CUENTA_LAB1) })).estado, 403);
  const preparado = await api('/api/contra-analisis/preparar', { token: lab2, form: formulario(CUENTA_LAB2) });
  assert.equal(preparado.estado, 200, JSON.stringify(preparado.cuerpo));
  const { xdr, registro, pdf_nombre } = preparado.cuerpo;
  assert.equal(registro.tipo, 'contra_analisis');
  assert.equal(registro.pureza, '72.00');
  assert.equal(await contar(), 0, 'preparar no guarda nada');

  // Un registro manipulado no coincide con el hash que quedó en el contrato.
  const manipulado = await api('/api/contra-analisis/enviar', {
    token: lab2,
    json: { registro: { ...registro, pureza: '75.00', composicion: { Sn: '75.00' } }, pdf_nombre, xdr: `${xdr}:firmado` },
  });
  assert.equal(manipulado.estado, 409);
  assert.equal(await contar(), 0);

  estadoLote = { ...estadoLote, contra_analisis: null };
  const enviado = await api('/api/contra-analisis/enviar', { token: lab2, json: { registro, pdf_nombre, xdr: `${xdr}:firmado` } });
  assert.equal(enviado.estado, 201, JSON.stringify(enviado.cuerpo));
  assert.equal(enviado.cuerpo.tx_id, TX);
  assert.equal(await contar(), 1);

  // En modo wallet, el servidor no firma contra-análisis.
  assert.equal((await api('/api/contra-analisis', { token: lab2, form: formulario(CUENTA_LAB2) })).estado, 409);
});

test('el servidor informa el modo de firma', async () => {
  const info = await api('/api/publico/info');
  assert.equal(info.cuerpo.firma_laboratorio, 'wallet');
});
