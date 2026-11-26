import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Account, Contract, Keypair, nativeToScVal, TransactionBuilder } from '@stellar/stellar-sdk';

process.env.ANCLAJE = 'mock';
delete process.env.DATABASE_URL;
const { conectar } = await import('../src/db/index.ts');
const { crearApp } = await import('../src/app.ts');
const { AnclajeMock } = await import('../src/anclaje/AnclajeMock.ts');
const { ProcesadorAnclajes } = await import('../src/anclaje/procesador.ts');
const { hashSecreto } = await import('../src/auth.ts');
const { huellaInvocacion, PASSPHRASE } = await import('../src/stellar/contrato.ts');
const { aUnidadesMinimas, Mercado: MercadoReal } = await import('../src/mercado/mercado.ts');
type Mercado = import('../src/mercado/mercado.ts').Mercado;

const CONTRATO = 'CBPILW6WNKGUOYEFIR5MZPGYG2GMWMMMTYO27KY43VNR7JJ6TQ5GYK5W';
const vendedor = Keypair.random();
const intruso = Keypair.random();
const db = await conectar({ memoria: true });
const anclaje = new AnclajeMock(db);
const procesador = new ProcesadorAnclajes(db, anclaje);
let servidor: Server;
let base = '';
let cookie = '';
let csrf = '';
let envios = 0;

function transaccion(funcion: string, argumentos: Record<string, unknown>, cuenta = vendedor.publicKey(), tarifa = '1000') {
  const valores = Object.values(argumentos).map((valor) => nativeToScVal(valor));
  return new TransactionBuilder(new Account(cuenta, '1'), { fee: tarifa, networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(CONTRATO).call(funcion, ...valores)).setTimeout(180).build();
}
const mercado = {
  infoComercial: async () => ({
    configuracion: { version: 2, comision_bps: 100, comision_minima: '200000000', reintegro_bps: 25,
      reintegro_maximo: '1000000000', destinatario_plataforma: intruso.publicKey(), plazo_entrega_seg: '86400' },
    token: { contrato: CONTRATO, simbolo: 'XLM', decimales: 7 },
  }),
  contrato: {
    prepararTransaccion: async (funcion: string, argumentos: Record<string, unknown>, cuenta: string) => transaccion(funcion, argumentos, cuenta).toXDR(),
    enviarFirmada: async () => {
      envios++;
      await new Promise((resolver) => setTimeout(resolver, 25));
      return { txId: 'a'.repeat(64), ledger: 1234, fecha: '2026-11-26T12:00:00Z' };
    },
  },
  indexador: { sincronizar: async () => {} },
} as unknown as Mercado;

before(async () => {
  servidor = crearApp({ db, anclaje, procesador, mercado }).listen(0);
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const secreto = randomBytes(32).toString('hex');
  await db.query('INSERT INTO comercio_sesiones(hash,cuenta,vence) VALUES ($1,$2,$3)',
    [hashSecreto(secreto), vendedor.publicKey(), new Date(Date.now() + 60_000)]);
  const respuesta = await fetch(`${base}/api/auth/csrf`);
  csrf = (await respuesta.json()).csrf;
  cookie = `${respuesta.headers.getSetCookie()[0]!.split(';')[0]}; minertrace.comercio=${secreto}`;
});
after(async () => { await new Promise<void>((resolver) => servidor.close(() => resolver())); await db.cerrar(); });

async function enviar(ruta: string, datos: Record<string, unknown>, conSesion = true) {
  const respuesta = await fetch(`${base}/api/mercado/comercial/${ruta}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: conSesion ? cookie : cookie.split('; minertrace.comercio=')[0]!, 'X-CSRF-Token': csrf },
    body: JSON.stringify(datos),
  });
  return { estado: respuesta.status, datos: await respuesta.json() };
}
const solicitud = () => ({ accion: 'claim', cuenta: vendedor.publicKey(), lote_id: 'LT-PRU-001' });

test('la huella permite añadir firmas pero detecta otro lote, precio y fuente', () => {
  const original = transaccion('list_batch', { vendedor: vendedor.publicKey(), lote_id: 'LT-PRU-001', precio: 100n });
  const huella = huellaInvocacion(original.toXDR());
  original.sign(vendedor);
  assert.equal(huellaInvocacion(original.toXDR()), huella);
  assert.notEqual(huellaInvocacion(transaccion('list_batch', { vendedor: vendedor.publicKey(), lote_id: 'LT-PRU-002', precio: 100n }).toXDR()), huella);
  assert.notEqual(huellaInvocacion(transaccion('list_batch', { vendedor: vendedor.publicKey(), lote_id: 'LT-PRU-001', precio: 101n }).toXDR()), huella);
  assert.notEqual(huellaInvocacion(transaccion('list_batch', { vendedor: vendedor.publicKey(), lote_id: 'LT-PRU-001', precio: 100n }, intruso.publicKey()).toXDR()), huella);
  assert.notEqual(huellaInvocacion(transaccion('list_batch', { vendedor: vendedor.publicKey(), lote_id: 'LT-PRU-001', precio: 100n }, vendedor.publicKey(), '9000').toXDR()), huella);
  assert.throws(() => huellaInvocacion('no-es-xdr'), /sola operación/);
});

test('las acciones comerciales requieren una sesión cuya cuenta coincida', async () => {
  assert.equal((await enviar('preparar', solicitud(), false)).estado, 401);
  assert.equal((await enviar('preparar', { ...solicitud(), cuenta: intruso.publicKey() })).estado, 403);
});

test('el servidor rechaza una invocación alterada aunque conserve la acción y cuenta', async () => {
  const preparada = await enviar('preparar', solicitud());
  assert.equal(preparada.estado, 200, JSON.stringify(preparada.datos));
  const antes = envios;
  const alterada = transaccion('claim', { vendedor: vendedor.publicKey(), lote_id: 'LT-OTRO-001' });
  alterada.sign(vendedor);
  const resultado = await enviar('enviar', { ...solicitud(), preparacion_id: preparada.datos.preparacion_id, xdr: alterada.toXDR() });
  assert.equal(resultado.estado, 403);
  assert.equal(envios, antes);
});

test('una preparación vencida no se envía; repetir una ya confirmada devuelve el mismo cierre', async () => {
  const vencida = await enviar('preparar', solicitud());
  await db.query("UPDATE comercio_transacciones SET vence=now()-interval '1 minute' WHERE id=$1", [vencida.datos.preparacion_id]);
  assert.equal((await enviar('enviar', { ...solicitud(), preparacion_id: vencida.datos.preparacion_id, xdr: vencida.datos.xdr })).estado, 409);

  const preparada = await enviar('preparar', solicitud());
  const firmada = TransactionBuilder.fromXDR(preparada.datos.xdr, PASSPHRASE);
  firmada.sign(vendedor);
  const datos = { ...solicitud(), preparacion_id: preparada.datos.preparacion_id, xdr: firmada.toXDR() };
  const antes = envios;
  assert.equal((await enviar('enviar', datos)).estado, 200);
  const repetida = await enviar('enviar', datos);
  assert.equal(repetida.estado, 200);
  assert.equal(repetida.datos.tx_id, 'a'.repeat(64));
  assert.equal(envios, antes + 1);
});

test('dos envíos simultáneos no difunden dos veces la misma preparación', async () => {
  const preparada = await enviar('preparar', solicitud());
  const datos = { ...solicitud(), preparacion_id: preparada.datos.preparacion_id, xdr: preparada.datos.xdr };
  const antes = envios;
  const resultados = await Promise.all([enviar('enviar', datos), enviar('enviar', datos)]);
  assert.ok(resultados.some((resultado) => resultado.estado === 200));
  assert.ok(resultados.every((resultado) => [200, 409].includes(resultado.estado)));
  assert.equal(envios, antes + 1);
});

test('los precios admiten token entero y rechazan magnitudes que exceden i128', () => {
  assert.equal(aUnidadesMinimas('100', 0), 100n);
  assert.throws(() => aUnidadesMinimas('1.5', 0), /Precio inválido/);
  assert.throws(() => aUnidadesMinimas((1n << 127n).toString(), 0), /rango/);
});

test('una compra no adopta una nueva reserva aunque coincidan su precio y análisis', async () => {
  const estado = { venta: { analisis_id: 'AN-1', version: 1 }, venta_comercial: { orden_id: 'orden-nueva', total: '101000000000' } };
  let invocada: Record<string, unknown> | null = null;
  const prueba = {
    comprobarSaldo: async () => {}, estadoLote: async () => estado,
    contrato: { prepararTransaccion: async (_funcion: string, argumentos: Record<string, unknown>) => { invocada = argumentos; return 'xdr'; } },
  } as unknown as Mercado;
  const esperado = { total: estado.venta_comercial.total, analisis_id: 'AN-1', version: 1 };
  const preparar = (orden_id?: string) => MercadoReal.prototype.prepararTransaccion.call(prueba, 'buy', vendedor.publicKey(), 'LT-PRU-001', undefined, { ...esperado, orden_id });
  await assert.rejects(() => preparar(), /otro acuerdo/);
  await assert.rejects(() => preparar('orden-anterior'), /otro acuerdo/);
  assert.equal(invocada, null);
  assert.equal(await preparar('orden-nueva'), 'xdr');
  assert.equal((invocada as Record<string, unknown> | null)?.orden_id, 'orden-nueva');
});
