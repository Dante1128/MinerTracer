/**
 * Prueba de integración del marketplace contra el contrato en testnet:
 * publicar → comprar → contra-análisis fuera de tolerancia → reembolso.
 * Las wallets del vendedor y del comprador son cuentas nuevas fondeadas con
 * friendbot; firman aquí lo que en el navegador firmaría Freighter.
 * Requiere las mismas variables que anclaje.testnet.test.ts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { Keypair, rpc, TransactionBuilder } from '@stellar/stellar-sdk';

const dirTemporal = fs.mkdtempSync(path.join(os.tmpdir(), 'minertrace-testnet-'));
process.env.DATOS_DIR = dirTemporal;
process.env.ANCLAJE = 'stellar';
// Estas pruebas firman en el servidor; la firma con wallet se prueba en firma-wallet.testnet.test.ts.
process.env.FIRMA_LABORATORIO = 'servidor';
delete process.env.DATABASE_URL;

const { config } = await import('../src/config.ts');
const faltan = ['STELLAR_CONTRATO_ID', 'STELLAR_SECRETO_LAB_001', 'STELLAR_SECRETO_LAB_002'].filter((v) => !process.env[v]);
const omitir = faltan.length > 0 ? `faltan variables: ${faltan.join(', ')}` : false;

after(() => fs.rmSync(dirTemporal, { recursive: true, force: true }));

test('publicar, comprar, contra-análisis en disputa y reembolso en testnet', { skip: omitir, timeout: 300_000 }, async () => {
  const { conectar } = await import('../src/db/index.ts');
  const { crearServicioAnclaje } = await import('../src/anclaje/index.ts');
  const { ProcesadorAnclajes } = await import('../src/anclaje/procesador.ts');
  const { Mercado } = await import('../src/mercado/mercado.ts');
  const { PASSPHRASE } = await import('../src/stellar/contrato.ts');
  const { ErrorContrato } = await import('../src/anclaje/erroresContrato.ts');
  const { sembrar } = await import('../src/semilla.ts');
  const { registrarAnalisis, registrarLote } = await import('../src/servicios/registro.ts');
  const { registrarContraAnalisis } = await import('../src/servicios/contraAnalisis.ts');
  const { pdfSimple } = await import('../src/pdfSimple.ts');
  type Usuario = import('../src/contexto.ts').Usuario;
  type Accion = import('../src/mercado/mercado.ts').Accion;

  const servidor = new rpc.Server(config.stellar.rpcUrl);
  const vendedor = Keypair.random();
  const comprador = Keypair.random();
  await Promise.all([servidor.requestAirdrop(vendedor.publicKey()), servidor.requestAirdrop(comprador.publicKey())]);

  const db = await conectar({ memoria: true });
  try {
    const anclaje = crearServicioAnclaje(db);
    const procesador = new ProcesadorAnclajes(db, anclaje);
    const mercado = new Mercado(db, config.stellar.rpcUrl, config.stellar.contratoId);
    const ctx = { db, anclaje, procesador: { procesar: async () => {} } as unknown as typeof procesador, mercado };
    await sembrar(ctx, { lotesDemo: false });
    const usuario = async (email: string) =>
      (await db.query<Usuario>('SELECT id, email, nombre, rol, laboratorio_id FROM usuarios WHERE email = $1', [email]))[0];

    // El contrato es persistente: códigos nuevos en cada ejecución.
    const marca = Date.now();
    await db.query("SELECT setval('seq_analisis', $1)", [(marca % 1_000_000_000) + 1]);
    const loteId = `LT-M${marca}`;
    await registrarLote(ctx, await usuario('analista@lab001.test'), {
      codigo: loteId,
      tipo_mineral: 'Concentrado de estaño',
      peso_kg: '500.000',
      origen: 'Prueba de integración del mercado',
      coordenadas: null,
      dueno: vendedor.publicKey(),
    });
    await registrarAnalisis(
      ctx,
      await usuario('analista@lab001.test'),
      loteId,
      { fecha_analisis: '2026-09-15T14:30:00Z', metodo: 'FRX', pureza: '75.00', composicion: { Sn: '75.00' }, observaciones: '' },
      { buffer: pdfSimple('Informe', [loteId]), nombre: 'informe.pdf' },
    );
    await procesador.procesar();
    const [anclado] = await db.query('SELECT estado_anclaje, ultimo_error FROM analisis WHERE lote_id = $1', [loteId]);
    assert.equal(anclado.estado_anclaje, 'anclado', anclado.ultimo_error ?? '');
    assert.equal((await mercado.estadoLote(loteId))?.estado, 'Certificado');

    // Lo que hace el navegador: pedir la transacción, firmarla con la wallet y enviarla.
    const firmarYEnviar = async (accion: Accion, par: Keypair, precio?: string) => {
      const xdr = await mercado.prepararTransaccion(accion, par.publicKey(), loteId, precio);
      const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASE);
      tx.sign(par);
      return mercado.enviarTransaccion(accion, par.publicKey(), tx.toXDR());
    };

    await firmarYEnviar('list_batch', vendedor, '10');
    assert.equal((await mercado.estadoLote(loteId))?.estado, 'EnVenta');
    assert.ok((await mercado.lotesEnVenta()).some((l) => l.lote_id === loteId));

    await assert.rejects(firmarYEnviar('buy', vendedor), (e) => e instanceof ErrorContrato && e.codigo === 17);
    await firmarYEnviar('buy', comprador);
    let estado = await mercado.estadoLote(loteId);
    assert.equal(estado?.estado, 'EnGarantia');
    assert.equal(estado?.venta?.comprador, comprador.publicKey());

    // Contra-análisis del laboratorio B: 72.00 % frente a 75.00 % (tolerancia 2.00 %).
    await registrarContraAnalisis(
      ctx,
      await usuario('analista@lab002.test'),
      loteId,
      { fecha_analisis: '2026-10-01T10:00:00Z', metodo: 'ICP-OES', pureza: '72.00', composicion: { Sn: '72.00' }, observaciones: '' },
      { buffer: pdfSimple('Contra-análisis', [loteId]), nombre: 'contra.pdf' },
    );
    estado = await mercado.estadoLote(loteId);
    assert.equal(estado?.estado, 'EnDisputa');
    assert.equal(estado?.contra_analisis?.diferencia_bps, 300);

    await assert.rejects(firmarYEnviar('confirm', comprador), (e) => e instanceof ErrorContrato && e.codigo === 21);
    await firmarYEnviar('refund', comprador);
    estado = await mercado.estadoLote(loteId);
    assert.equal(estado?.estado, 'EnDisputa');
    assert.equal(estado?.venta, null);
    assert.equal(estado?.dueno, vendedor.publicKey());

    const tipos = (await mercado.cronologia(loteId)).map((e) => e.tipo);
    assert.deepEqual(tipos, [
      'analisis_registrado',
      'lote_publicado',
      'lote_comprado',
      'contra_analisis_registrado',
      'reembolsado',
    ]);
  } finally {
    await db.cerrar();
  }
});
