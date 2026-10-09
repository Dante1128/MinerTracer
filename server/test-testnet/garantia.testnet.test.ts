/**
 * Vencimiento de la garantía contra testnet: si el comprador no confirma ni
 * hay disputa, el vendedor cobra al vencer el plazo. Necesita un contrato
 * desplegado con un plazo corto (PLAZO_GARANTIA_SEG=20 npm run contrato:desplegar);
 * con el plazo normal (días) se omite. Mismas variables que anclaje.testnet.test.ts.
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
process.env.FIRMA_LABORATORIO = 'servidor';
delete process.env.DATABASE_URL;

const PLAZO_MAXIMO_SEG = 120;
const { config } = await import('../src/config.ts');
const { Mercado } = await import('../src/mercado/mercado.ts');
const faltan = ['STELLAR_CONTRATO_ID', 'STELLAR_SECRETO_LAB_001', 'STELLAR_SECRETO_LAB_002'].filter((v) => !process.env[v]);
let omitir: string | false = faltan.length > 0 ? `faltan variables: ${faltan.join(', ')}` : false;
let plazo = 0;
if (!omitir) {
  const { conectar } = await import('../src/db/index.ts');
  const db = await conectar({ memoria: true });
  plazo = (await new Mercado(db, config.stellar.rpcUrl, config.stellar.contratoId).info()).plazo_garantia_seg;
  await db.cerrar();
  if (plazo > PLAZO_MAXIMO_SEG) omitir = `el contrato tiene un plazo de ${plazo} s; despliegue uno con PLAZO_GARANTIA_SEG=20`;
}

after(() => fs.rmSync(dirTemporal, { recursive: true, force: true }));

test('el vendedor cobra cuando vence la garantía sin confirmación ni disputa', { skip: omitir, timeout: 300_000 }, async () => {
  const { conectar } = await import('../src/db/index.ts');
  const { crearServicioAnclaje } = await import('../src/anclaje/index.ts');
  const { ProcesadorAnclajes } = await import('../src/anclaje/procesador.ts');
  const { PASSPHRASE } = await import('../src/stellar/contrato.ts');
  const { ErrorContrato } = await import('../src/anclaje/erroresContrato.ts');
  const { sembrar } = await import('../src/semilla.ts');
  const { registrarAnalisis, registrarLote } = await import('../src/servicios/registro.ts');
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
    const [analista] = await db.query<Usuario>(
      "SELECT id, email, nombre, rol, laboratorio_id FROM usuarios WHERE email = 'analista@lab001.test'",
    );
    const marca = Date.now();
    await db.query("SELECT setval('seq_analisis', $1)", [(marca % 1_000_000_000) + 3]);
    const loteId = `LT-G${marca}`;
    await registrarLote(ctx, analista, {
      codigo: loteId,
      tipo_mineral: 'Concentrado de estaño',
      peso_kg: '10.000',
      origen: 'Prueba del plazo de garantía',
      coordenadas: null,
      dueno: vendedor.publicKey(),
    });
    await registrarAnalisis(
      ctx,
      analista,
      loteId,
      { fecha_analisis: '2026-09-15T14:30:00Z', metodo: 'FRX', pureza: '75.00', composicion: { Sn: '75.00' }, observaciones: '' },
      { buffer: pdfSimple('Informe', [loteId]), nombre: 'informe.pdf' },
      { firmaServidor: true },
    );
    await procesador.procesar();

    const firmarYEnviar = async (accion: Accion, par: Keypair, precio?: string) => {
      const tx = TransactionBuilder.fromXDR(await mercado.prepararTransaccion(accion, par.publicKey(), loteId, precio), PASSPHRASE);
      tx.sign(par);
      return mercado.enviarTransaccion(accion, par.publicKey(), tx.toXDR());
    };
    await firmarYEnviar('list_batch', vendedor, '3');
    await firmarYEnviar('buy', comprador);
    const venta = (await mercado.estadoLote(loteId))?.venta;
    assert.ok(venta?.vence_garantia, 'la compra fija el vencimiento');

    // Antes del vencimiento, el vendedor no puede cobrar.
    await assert.rejects(firmarYEnviar('claim', vendedor), (e) => e instanceof ErrorContrato && e.codigo === 25);
    await assert.rejects(firmarYEnviar('claim', comprador), (e) => e instanceof ErrorContrato && e.codigo === 26);

    // Se espera a que la hora de los ledgers supere el vencimiento.
    const vence = Number(venta.vence_garantia);
    for (;;) {
      const ultimo = await servidor.getLatestLedger();
      const ahora = Number((ultimo as unknown as { closeTime?: string }).closeTime ?? Math.floor(Date.now() / 1000));
      if (ahora > vence + 2) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    await firmarYEnviar('claim', vendedor);
    const estado = await mercado.estadoLote(loteId);
    assert.equal(estado?.estado, 'Vendido');
    assert.equal(estado?.dueno, comprador.publicKey());
    assert.equal(estado?.venta, null);
    const tipos = (await mercado.cronologia(loteId)).map((e) => e.tipo);
    assert.equal(tipos.at(-1), 'pago_reclamado');
    console.log(`  plazo ${plazo} s · lote ${loteId}`);
  } finally {
    await db.cerrar();
  }
});
