import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Account, Contract, Keypair, nativeToScVal, TransactionBuilder, xdr } from '@stellar/stellar-sdk';

// Base de datos en memoria y archivos en un directorio temporal.
const dirTemporal = fs.mkdtempSync(path.join(os.tmpdir(), 'minertrace-test-'));
process.env.DATOS_DIR = dirTemporal;
process.env.ANCLAJE = 'mock';
delete process.env.DATABASE_URL;

const LAB_002 = Keypair.random();
process.env.STELLAR_SECRETO_LAB_002 = LAB_002.secret();

const { conectar } = await import('../src/db/index.ts');
const { AnclajeMock } = await import('../src/anclaje/AnclajeMock.ts');
const { ProcesadorAnclajes } = await import('../src/anclaje/procesador.ts');
const { crearApp } = await import('../src/app.ts');
const { sembrar, cuentaLaboratorio } = await import('../src/semilla.ts');
const { registrarLote } = await import('../src/servicios/registro.ts');
const { registrarContraAnalisis, verificarContraAnalisis, registroDeContraAnalisis } = await import(
  '../src/servicios/contraAnalisis.ts'
);
const { aUnidadesMinimas, validarCuenta } = await import('../src/mercado/mercado.ts');
const { aJson, filaDeEvento, ledgerDelCursor } = await import('../src/mercado/indexador.ts');
const { ContratoSoroban, PASSPHRASE, TransaccionRechazada, errorDeContrato, FondosInsuficientes } = await import(
  '../src/stellar/contrato.ts'
);
const { ErrorContrato } = await import('../src/anclaje/erroresContrato.ts');
const { canonicalizar, sha256Hex } = await import('../src/integridad/canonico.ts');
const { pdfSimple } = await import('../src/pdfSimple.ts');
type Usuario = import('../src/contexto.ts').Usuario;
type EstadoComercial = import('../src/mercado/mercado.ts').EstadoComercial;
type Mercado = import('../src/mercado/mercado.ts').Mercado;

const db = await conectar({ memoria: true });
const anclaje = new AnclajeMock(db);
const procesador = new ProcesadorAnclajes(db, anclaje);
const ctx = { db, anclaje, procesador };
const CONTRATO = 'CBPILW6WNKGUOYEFIR5MZPGYG2GMWMMMTYO27KY43VNR7JJ6TQ5GYK5W';
const COMPRADOR = 'GDRILNQTFSNQA3HXC2BWSGVCPIJ3URVOXHKKRNM6P6IK7EJPRQYXTD5R';
let servidor: Server;
let base = '';
let analistaLab2: Usuario;

before(async () => {
  await sembrar(ctx, { lotesDemo: false });
  [analistaLab2] = await db.query<Usuario>(
    "SELECT id, email, nombre, rol, laboratorio_id FROM usuarios WHERE email = 'analista@lab002.test'",
  );
  const [analista] = await db.query<Usuario>(
    "SELECT id, email, nombre, rol, laboratorio_id FROM usuarios WHERE email = 'analista@lab001.test'",
  );
  await registrarLote(ctx, analista, {
    codigo: 'LT-MER-0001',
    tipo_mineral: 'Concentrado de estaño',
    peso_kg: '100.000',
    origen: 'Potosí',
    coordenadas: null,
    dueno: null,
  });
  servidor = crearApp(ctx).listen(0);
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(async () => {
  servidor.close();
  await db.cerrar();
  fs.rmSync(dirTemporal, { recursive: true, force: true });
});

/** Estado del contrato para un lote en garantía certificado por LAB-001. */
function enGarantia(cambios: Partial<EstadoComercial> = {}): EstadoComercial {
  return {
    lote_id: 'LT-MER-0001',
    estado: 'EnGarantia',
    dueno: 'GBJZFZ52JRTIPAHXCXQPQ4OJKMVKOIGJDGOOYDPRQYEUZKBO3FQJPSSL',
    analisis_id: 'AN-2026-0001',
    version: 1,
    lab: cuentaLaboratorio('LAB-001'),
    pureza_bps: 7500,
    venta: {
      vendedor: 'GBJZFZ52JRTIPAHXCXQPQ4OJKMVKOIGJDGOOYDPRQYEUZKBO3FQJPSSL',
      precio: '100000000',
      comprador: COMPRADOR,
      analisis_id: 'AN-2026-0001',
      version: 1,
      lab: cuentaLaboratorio('LAB-001'),
      pureza_bps: 7500,
      vence_garantia: '0',
    },
    contra_analisis: null,
    ...cambios,
  };
}

/** Mercado falso: estado fijo y un contrato que registra (o rechaza) el contra-análisis. */
function mercadoFalso(estado: EstadoComercial | null, enviar: (args: Record<string, unknown>) => Promise<unknown>) {
  const enviados: Record<string, unknown>[] = [];
  const mercado = {
    estadoLote: async () => estado,
    indexador: { sincronizar: async () => {} },
    contrato: {
      firmarYEnviar: async (metodo: string, args: Record<string, unknown>) => {
        assert.equal(metodo, 'counter_analysis');
        enviados.push(args);
        return enviar(args);
      },
    },
  } as unknown as Mercado;
  return { mercado, enviados };
}

const datosContra = {
  fecha_analisis: '2026-10-01T10:00:00Z',
  metodo: 'ICP-OES',
  pureza: '72.00',
  composicion: { Sn: '72.00' },
  observaciones: 'Contra-análisis del comprador',
};
const pdfContra = () => ({ buffer: pdfSimple('Contra-análisis', ['Pureza 72 %']), nombre: 'contra.pdf' });

test('precios en unidades mínimas del token y direcciones Stellar', () => {
  assert.equal(aUnidadesMinimas('100', 7), 1_000_000_000n);
  assert.equal(aUnidadesMinimas('0.5', 7), 5_000_000n);
  assert.equal(aUnidadesMinimas('12,25', 7), 122_500_000n);
  assert.throws(() => aUnidadesMinimas('0', 7), /mayor que cero/);
  assert.throws(() => aUnidadesMinimas('1.12345678', 7), /hasta 7 decimales/);
  assert.throws(() => aUnidadesMinimas('-3', 7));
  assert.equal(validarCuenta(COMPRADOR.toLowerCase()), COMPRADOR);
  assert.throws(() => validarCuenta('GXXX'), /inválida/);
});

test('los eventos del contrato se convierten en filas de la línea de tiempo', () => {
  const sym = (s: string) => nativeToScVal(s, { type: 'symbol' });
  const str = (s: string) => nativeToScVal(s, { type: 'string' });
  const valor = nativeToScVal(
    { comprador: COMPRADOR, precio: 100_000_000n },
    { type: { comprador: ['symbol', 'address'], precio: ['symbol', 'i128'] } },
  );
  assert.deepEqual(filaDeEvento({ topic: [sym('lote_comprado'), str('LT-1')], value: valor }), {
    tipo: 'lote_comprado',
    loteId: 'LT-1',
    datos: { comprador: COMPRADOR, precio: '100000000' },
  });
  const registrado = filaDeEvento({
    topic: [sym('analisis_registrado'), str('LT-1'), str('AN-1')],
    value: nativeToScVal({ version: 2 }, { type: { version: ['symbol', 'u32'] } }),
  });
  assert.deepEqual(registrado.datos, { version: 2, analisis_id: 'AN-1' });
  const lab = filaDeEvento({
    topic: [sym('laboratorio_agregado'), nativeToScVal(COMPRADOR, { type: 'address' })],
    value: xdr.ScVal.scvMap([]),
  });
  assert.equal(lab.loteId, null);
  assert.equal(lab.datos.lab, COMPRADOR);

  assert.deepEqual(aJson({ a: 5n, b: new Uint8Array([171, 205]), c: [1n] }), { a: '5', b: 'abcd', c: ['1'] });
  // TOID: ledger en los 32 bits altos.
  assert.equal(ledgerDelCursor(`${(5_041_067n << 32n) + 7n}-4294967295`), 5_041_067);
});

test('errores de simulación: contrato, fondos insuficientes u otros', () => {
  assert.ok(errorDeContrato('HostError: Error(Contract, #14)') instanceof ErrorContrato);
  assert.ok(errorDeContrato('Error(Contract, #10) ... balance is not sufficient to spend') instanceof FondosInsuficientes);
  assert.equal(errorDeContrato('timeout'), null);
});

test('el servidor solo envía la invocación pedida, a este contrato y desde la cuenta indicada', async () => {
  const contrato = new ContratoSoroban('https://rpc.invalido.test', CONTRATO);
  const firmar = (contratoId: string, funcion: string, origen = COMPRADOR) =>
    new TransactionBuilder(new Account(origen, '1'), { fee: '100', networkPassphrase: PASSPHRASE })
      .addOperation(new Contract(contratoId).call(funcion, nativeToScVal(COMPRADOR, { type: 'address' })))
      .setTimeout(30)
      .build()
      .toXDR();
  const otroContrato = 'CB6Z7NJS2PHF4GVI5HADBHVRDKESQPSRGPM2ZUIYBEZTWA5IVSCJRSZ3';

  await assert.rejects(contrato.enviarFirmada('no-es-xdr', { funcion: 'buy', cuenta: COMPRADOR }), TransaccionRechazada);
  await assert.rejects(
    contrato.enviarFirmada(firmar(CONTRATO, 'refund'), { funcion: 'buy', cuenta: COMPRADOR }),
    /no corresponde a la operación/,
  );
  await assert.rejects(
    contrato.enviarFirmada(firmar(otroContrato, 'buy'), { funcion: 'buy', cuenta: COMPRADOR }),
    /no corresponde a la operación/,
  );
  await assert.rejects(
    contrato.enviarFirmada(firmar(CONTRATO, 'buy', 'GBJZFZ52JRTIPAHXCXQPQ4OJKMVKOIGJDGOOYDPRQYEUZKBO3FQJPSSL'), {
      funcion: 'buy',
      cuenta: COMPRADOR,
    }),
    /firmada por otra cuenta/,
  );
});

test('el contra-análisis exige garantía, otro laboratorio y que no exista ya uno', async () => {
  const intentar = (estado: EstadoComercial | null) =>
    registrarContraAnalisis(
      { ...ctx, mercado: mercadoFalso(estado, async () => ({ txId: 'x', fecha: 'x' })).mercado },
      analistaLab2,
      'LT-MER-0001',
      datosContra,
      pdfContra(),
    );
  await assert.rejects(intentar(null), /no está registrado en el contrato/);
  await assert.rejects(intentar(enGarantia({ estado: 'EnVenta' })), /mientras el lote está en garantía/);
  const yaHay = enGarantia({ contra_analisis: { lab: 'G', lab_certificador: 'G', hash: 'h', pureza_bps: 1, diferencia_bps: 1, fecha: 'f' } });
  await assert.rejects(intentar(yaHay), /ya tiene un contra-análisis/);
  const mismoLab = enGarantia();
  mismoLab.venta!.lab = cuentaLaboratorio('LAB-002');
  await assert.rejects(intentar(mismoLab), /laboratorio distinto/);
  await assert.rejects(
    registrarContraAnalisis({ ...ctx, mercado: null }, analistaLab2, 'LT-MER-0001', datosContra, pdfContra()),
    /requiere ANCLAJE=stellar/,
  );
  const [{ n }] = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM contra_analisis');
  assert.equal(n, 0, 'nada se guarda si el contrato no lo aceptaría');
});

test('si el contrato rechaza el contra-análisis no se guarda; si lo acepta, queda sellado y verificable', async () => {
  const rechazo = mercadoFalso(enGarantia(), async () => {
    throw new ErrorContrato(19);
  });
  await assert.rejects(
    registrarContraAnalisis({ ...ctx, mercado: rechazo.mercado }, analistaLab2, 'LT-MER-0001', datosContra, pdfContra()),
    ErrorContrato,
  );
  assert.equal((await db.query('SELECT 1 FROM contra_analisis')).length, 0);

  const ok = mercadoFalso(enGarantia(), async () => ({ txId: 'ab'.repeat(32), fecha: '2026-10-05T20:00:00Z' }));
  const fila = await registrarContraAnalisis({ ...ctx, mercado: ok.mercado }, analistaLab2, 'LT-MER-0001', datosContra, pdfContra());
  const [enviado] = ok.enviados;
  assert.equal(enviado.lab, cuentaLaboratorio('LAB-002'));
  assert.equal(enviado.pureza_bps, 7200);
  assert.equal((enviado.hash as Buffer).toString('hex'), fila.hash);
  assert.equal(sha256Hex(canonicalizar(registroDeContraAnalisis(fila))), fila.hash);
  assert.match(canonicalizar(registroDeContraAnalisis(fila)), /"tipo":"contra_analisis"/);

  // Verificación contra el estado del contrato.
  const cuenta = cuentaLaboratorio('LAB-002');
  const enCadena = (hash: string) =>
    enGarantia({ contra_analisis: { lab: cuenta, lab_certificador: 'G', hash, pureza_bps: 7200, diferencia_bps: 300, fecha: 'f' } });
  assert.equal((await verificarContraAnalisis(fila, enCadena(fila.hash), cuenta)).estado, 'integro');
  const alterado = await verificarContraAnalisis({ ...fila, pureza: '75.00' }, enCadena(fila.hash), cuenta);
  assert.equal(alterado.estado, 'alterado');
  assert.equal(alterado.comprobaciones.datos, false);
  assert.equal((await verificarContraAnalisis(fila, enGarantia(), cuenta)).estado, 'no_verificable');

  // Las filas son de solo inserción.
  await assert.rejects(db.query("UPDATE contra_analisis SET pureza = '75.00'"), /solo inserción/);
});

test('con ANCLAJE=mock el marketplace queda deshabilitado', async () => {
  const info = await (await fetch(`${base}/api/mercado/info`)).json();
  assert.deepEqual(info, { habilitado: false });
  const lotes = await fetch(`${base}/api/mercado/lotes`);
  assert.equal(lotes.status, 503);
  const tx = await fetch(`${base}/api/mercado/transacciones`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accion: 'buy', cuenta: COMPRADOR, lote_id: 'LT-MER-0001' }),
  });
  assert.equal(tx.status, 503);
  assert.equal((await fetch(`${base}/api/contra-analisis/pendientes`)).status, 401);
});
