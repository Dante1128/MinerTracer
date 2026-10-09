/**
 * Etapa 4 contra testnet: el laboratorio firma con su wallet. Aquí se firma con
 * la clave del laboratorio, exactamente lo que haría Freighter con el XDR.
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
process.env.FIRMA_LABORATORIO = 'wallet';
delete process.env.DATABASE_URL;

const { config } = await import('../src/config.ts');
const faltan = ['STELLAR_CONTRATO_ID', 'STELLAR_SECRETO_LAB_001', 'STELLAR_SECRETO_LAB_002'].filter((v) => !process.env[v]);
const omitir = faltan.length > 0 ? `faltan variables: ${faltan.join(', ')}` : false;

after(() => fs.rmSync(dirTemporal, { recursive: true, force: true }));

test('análisis y contra-análisis firmados con la wallet del laboratorio, y reconciliación', { skip: omitir, timeout: 300_000 }, async () => {
  const { conectar } = await import('../src/db/index.ts');
  const { crearServicioAnclaje } = await import('../src/anclaje/index.ts');
  const { ProcesadorAnclajes, marcarAnclado, solicitudDeAnalisis } = await import('../src/anclaje/procesador.ts');
  const { Mercado } = await import('../src/mercado/mercado.ts');
  const { PASSPHRASE } = await import('../src/stellar/contrato.ts');
  const { sembrar } = await import('../src/semilla.ts');
  const { registrarAnalisis, registrarCorreccion, registrarLote } = await import('../src/servicios/registro.ts');
  const { prepararContraAnalisis, enviarContraAnalisis } = await import('../src/servicios/contraAnalisis.ts');
  const { verificarLote } = await import('../src/servicios/verificacion.ts');
  const { pdfSimple } = await import('../src/pdfSimple.ts');
  type Usuario = import('../src/contexto.ts').Usuario;

  const labA = Keypair.fromSecret(config.stellar.secretos['LAB-001']);
  const labB = Keypair.fromSecret(config.stellar.secretos['LAB-002']);
  const firmar = (xdr: string, par: Keypair) => {
    const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASE);
    tx.sign(par);
    return tx.toXDR();
  };

  const servidor = new rpc.Server(config.stellar.rpcUrl);
  const vendedor = Keypair.random();
  const comprador = Keypair.random();
  await Promise.all([servidor.requestAirdrop(vendedor.publicKey()), servidor.requestAirdrop(comprador.publicKey())]);

  const db = await conectar({ memoria: true });
  try {
    const anclaje = crearServicioAnclaje(db);
    assert.equal(anclaje.firmaConWallet, true);
    const procesador = new ProcesadorAnclajes(db, anclaje);
    const mercado = new Mercado(db, config.stellar.rpcUrl, config.stellar.contratoId);
    const ctx = { db, anclaje, procesador: { procesar: async () => {} } as unknown as typeof procesador, mercado };
    await sembrar(ctx, { lotesDemo: false });
    const usuario = async (email: string) =>
      (await db.query<Usuario>('SELECT id, email, nombre, rol, laboratorio_id FROM usuarios WHERE email = $1', [email]))[0];

    const marca = Date.now();
    await db.query("SELECT setval('seq_analisis', $1)", [(marca % 1_000_000_000) + 2]);
    const loteId = `LT-W${marca}`;
    await registrarLote(ctx, await usuario('analista@lab001.test'), {
      codigo: loteId,
      tipo_mineral: 'Concentrado de estaño',
      peso_kg: '100.000',
      origen: 'Prueba de firma con wallet',
      coordenadas: null,
      dueno: vendedor.publicKey(),
    });
    const datos = (pureza: string) => ({
      fecha_analisis: '2026-09-15T14:30:00Z',
      metodo: 'FRX',
      pureza,
      composicion: { Sn: pureza },
      observaciones: '',
    });

    // 1. El procesador no firma: el análisis espera la wallet del laboratorio.
    const v1 = await registrarAnalisis(ctx, await usuario('analista@lab001.test'), loteId, datos('75.00'), {
      buffer: pdfSimple('Informe', [loteId]),
      nombre: 'informe.pdf',
    });
    await procesador.procesar();
    const pendiente = (await db.query('SELECT estado_anclaje, ultimo_error FROM analisis WHERE id = $1', [v1.id]))[0];
    assert.deepEqual(pendiente, { estado_anclaje: 'pendiente', ultimo_error: null });

    // 2. El laboratorio firma (Freighter) y el servidor envía, comprueba el contrato y marca.
    const s1 = await solicitudDeAnalisis(db, v1);
    const r1 = await anclaje.enviarAnclaje(s1, firmar(await anclaje.prepararAnclaje(s1), labA));
    assert.equal(await marcarAnclado(db, v1.id, r1), true);
    let resultado = await verificarLote(ctx, loteId);
    assert.equal(resultado!.analisis[0].vigente.verificacion.estado, 'integro');

    // 3. Reconciliación: la corrección se firma y llega a la red sin avisar al servidor.
    const v2 = await registrarCorreccion(ctx, await usuario('supervisor@lab001.test'), v1.analisis_id, datos('74.50'), 'Recalibración', null);
    const s2 = await solicitudDeAnalisis(db, v2);
    const directa = await mercado.contrato.enviarFirmada(firmar(await anclaje.prepararAnclaje(s2), labA), {
      funcion: 'submit_analysis',
      cuenta: labA.publicKey(),
    });
    await procesador.procesar();
    const reconciliada = (await db.query('SELECT estado_anclaje, tx_id FROM analisis WHERE id = $1', [v2.id]))[0];
    assert.deepEqual(reconciliada, { estado_anclaje: 'anclado', tx_id: directa.txId });
    resultado = await verificarLote(ctx, loteId);
    assert.ok(resultado!.analisis[0].versiones.every((v) => v.verificacion.estado === 'integro'));

    // 4. Venta y contra-análisis del laboratorio B firmado con su wallet.
    for (const [accion, par] of [['list_batch', vendedor], ['buy', comprador]] as const) {
      const xdr = await mercado.prepararTransaccion(accion, par.publicKey(), loteId, accion === 'list_batch' ? '5' : undefined);
      await mercado.enviarTransaccion(accion, par.publicKey(), firmar(xdr, par));
    }
    const analistaB = await usuario('analista@lab002.test');
    const preparado = await prepararContraAnalisis(
      ctx,
      analistaB,
      loteId,
      { fecha_analisis: '2026-10-01T10:00:00Z', metodo: 'ICP-OES', pureza: '74.00', composicion: { Sn: '74.00' }, observaciones: '' },
      { buffer: pdfSimple('Contra-análisis', [loteId]), nombre: 'contra.pdf' },
      labB.publicKey(),
    );
    const fila = await enviarContraAnalisis(ctx, analistaB, { registro: preparado.registro, pdf_nombre: preparado.pdf_nombre }, firmar(preparado.xdr, labB));
    const estado = await mercado.estadoLote(loteId);
    assert.equal(estado?.contra_analisis?.hash, fila.hash);
    // 74.50 % vendido frente a 74.00 %: dentro de la tolerancia, sigue en garantía.
    assert.equal(estado?.estado, 'EnGarantia');
  } finally {
    await db.cerrar();
  }
});
