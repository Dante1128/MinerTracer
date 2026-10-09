/**
 * Prueba de integración contra el contrato desplegado en Stellar testnet.
 * No forma parte de `npm test`: se ejecuta con `npm run test:testnet` y
 * necesita (en el entorno o en server/.env) STELLAR_CONTRATO_ID,
 * STELLAR_SECRETO_LAB_001 y STELLAR_SECRETO_LAB_002, con ambos laboratorios
 * autorizados en el contrato (npm run contrato:desplegar).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

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

test('registra un análisis en testnet, espera el anclaje y lo verifica contra el contrato', { skip: omitir, timeout: 240_000 }, async () => {
  const { conectar } = await import('../src/db/index.ts');
  const { crearServicioAnclaje } = await import('../src/anclaje/index.ts');
  const { ProcesadorAnclajes } = await import('../src/anclaje/procesador.ts');
  const { sembrar, cuentaLaboratorio } = await import('../src/semilla.ts');
  const { registrarAnalisis, registrarCorreccion, registrarLote } = await import('../src/servicios/registro.ts');
  const { verificarLote } = await import('../src/servicios/verificacion.ts');
  const { pdfSimple } = await import('../src/pdfSimple.ts');
  type Usuario = import('../src/contexto.ts').Usuario;

  const db = await conectar({ memoria: true });
  try {
    const anclaje = crearServicioAnclaje(db);
    const procesador = new ProcesadorAnclajes(db, anclaje);
    const ctx = { db, anclaje, procesador: { procesar: async () => {} } as unknown as typeof procesador };
    await sembrar(ctx, { lotesDemo: false });
    const usuario = async (email: string) =>
      (await db.query<Usuario>('SELECT id, email, nombre, rol, laboratorio_id FROM usuarios WHERE email = $1', [email]))[0];
    const analista = await usuario('analista@lab001.test');
    const supervisor = await usuario('supervisor@lab001.test');

    // El contrato es persistente: cada ejecución usa códigos nuevos.
    const marca = Date.now();
    await db.query("SELECT setval('seq_analisis', $1)", [marca % 1_000_000_000]);
    const loteId = `LT-T${marca}`;
    await registrarLote(ctx, analista, {
      codigo: loteId,
      tipo_mineral: 'Concentrado de estaño',
      peso_kg: '100.000',
      origen: 'Prueba de integración',
      coordenadas: null,
      dueno: cuentaLaboratorio('LAB-002'),
    });
    const datos = (pureza: string) => ({
      fecha_analisis: '2026-09-15T14:30:00Z',
      metodo: 'FRX',
      pureza,
      composicion: { Sn: pureza },
      observaciones: 'Prueba de integración en testnet',
    });

    // Versión 1: registro, anclaje y verificación.
    const v1 = await registrarAnalisis(ctx, analista, loteId, datos('75.00'), {
      buffer: pdfSimple('Informe', [`Lote ${loteId}`]),
      nombre: 'informe.pdf',
    });
    await procesador.procesar();
    const [fila1] = await db.query('SELECT estado_anclaje, tx_id, ultimo_error FROM analisis WHERE id = $1', [v1.id]);
    assert.equal(fila1.estado_anclaje, 'anclado', fila1.ultimo_error ?? '');
    assert.match(fila1.tx_id, /^[0-9a-f]{64}$/);

    let resultado = await verificarLote(ctx, loteId);
    let vigente = resultado!.analisis[0].vigente;
    assert.equal(vigente.verificacion.estado, 'integro', vigente.verificacion.motivos.join('; '));
    assert.deepEqual(vigente.verificacion.comprobaciones, { datos: true, firma: true, pdf: true });
    assert.equal(vigente.verificacion.hash_anclado, v1.hash);
    assert.equal(vigente.verificacion.anclaje?.url_explorador, `https://stellar.expert/explorer/testnet/tx/${fila1.tx_id}`);
    assert.equal(vigente.verificacion.anclaje?.cuenta, cuentaLaboratorio('LAB-001'));

    // Reintentar el mismo anclaje no duplica: recupera la transacción original.
    const repetido = await anclaje.anclar({
      hash: v1.hash,
      laboratorioId: 'LAB-001',
      cuentaLaboratorio: cuentaLaboratorio('LAB-001'),
      analisisId: v1.analisis_id,
      version: 1,
      loteId,
      hashAnterior: null,
      pureza: '75.00',
      dueno: cuentaLaboratorio('LAB-002'),
    });
    assert.equal(repetido.txId, fila1.tx_id);

    // Versión 2: la corrección se ancla enlazada a la versión 1.
    await registrarCorreccion(ctx, supervisor, v1.analisis_id, datos('74.50'), 'Recalibración del equipo', null);
    await procesador.procesar();
    resultado = await verificarLote(ctx, loteId);
    const versiones = resultado!.analisis[0].versiones;
    assert.equal(versiones.length, 2);
    for (const v of versiones) {
      assert.equal(v.verificacion.estado, 'integro', `v${v.version}: ${v.verificacion.motivos.join('; ')}`);
    }
    assert.equal(versiones[1].hash_anterior, v1.hash);

    // Un intermediario altera la base de datos: el contrato lo delata.
    await db.exec('ALTER TABLE analisis DISABLE TRIGGER mt_analisis_protegido');
    await db.query("UPDATE analisis SET pureza = '95.00' WHERE analisis_id = $1 AND version = 2", [v1.analisis_id]);
    await db.exec('ALTER TABLE analisis ENABLE TRIGGER mt_analisis_protegido');
    resultado = await verificarLote(ctx, loteId);
    vigente = resultado!.analisis[0].vigente;
    assert.equal(vigente.verificacion.estado, 'alterado');
    assert.equal(vigente.verificacion.comprobaciones.datos, false);

    console.log(`  lote ${loteId} · ${config.stellar.contratoId} · tx v1 ${fila1.tx_id}`);
  } finally {
    await db.cerrar();
  }
});
