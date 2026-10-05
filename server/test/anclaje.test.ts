import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// Base de datos en memoria y archivos en un directorio temporal.
const dirTemporal = fs.mkdtempSync(path.join(os.tmpdir(), 'minertrace-test-'));
process.env.DATOS_DIR = dirTemporal;
process.env.ANCLAJE = 'mock';
delete process.env.DATABASE_URL;

const { conectar } = await import('../src/db/index.ts');
const { AnclajeMock } = await import('../src/anclaje/AnclajeMock.ts');
const { ProcesadorAnclajes } = await import('../src/anclaje/procesador.ts');
const { aPuntosBasicos } = await import('../src/anclaje/AnclajeStellar.ts');
const { codigoErrorContrato, ErrorContrato } = await import('../src/anclaje/erroresContrato.ts');
const { sembrar, cuentaLaboratorio } = await import('../src/semilla.ts');
const { registrarAnalisis, registrarCorreccion, registrarLote } = await import('../src/servicios/registro.ts');
const { verificarLote } = await import('../src/servicios/verificacion.ts');
const { validarLote } = await import('../src/validacion.ts');
const { ErrorValidacion } = await import('../src/validacion.ts');
const { pdfSimple } = await import('../src/pdfSimple.ts');
type Usuario = import('../src/contexto.ts').Usuario;
type SolicitudAnclaje = import('../src/anclaje/ServicioAnclaje.ts').SolicitudAnclaje;
type ServicioAnclaje = import('../src/anclaje/ServicioAnclaje.ts').ServicioAnclaje;

const db = await conectar({ memoria: true });
const mock = new AnclajeMock(db);
const sinProcesar = { procesar: async () => {} } as unknown as InstanceType<typeof ProcesadorAnclajes>;
const ctxBase = { db, anclaje: mock as ServicioAnclaje, procesador: sinProcesar };

const DUENO = 'GBJZFZ52JRTIPAHXCXQPQ4OJKMVKOIGJDGOOYDPRQYEUZKBO3FQJPSSL';
const datos = (pureza: string) => ({
  fecha_analisis: '2026-09-15T14:30:00Z',
  metodo: 'FRX',
  pureza,
  composicion: { Sn: pureza },
  observaciones: '',
});
const pdf = (texto: string) => ({ buffer: pdfSimple('Informe', [texto]), nombre: 'informe.pdf' });
let analista: Usuario;
let supervisor: Usuario;

/** Anclaje que delega en el mock pero permite fallar o alterar respuestas. */
function anclajeDePrueba(cambios: Partial<ServicioAnclaje> & { enviadas?: SolicitudAnclaje[] }): ServicioAnclaje {
  return {
    nombre: mock.nombre,
    red: mock.red,
    contratoId: mock.contratoId,
    anclar: async (s) => {
      cambios.enviadas?.push(s);
      return (cambios.anclar ?? mock.anclar.bind(mock))(s);
    },
    consultarAnclaje: cambios.consultarAnclaje ?? mock.consultarAnclaje.bind(mock),
    urlExplorador: () => null,
  };
}

async function nuevoLote(codigo: string, dueno: string | null) {
  await registrarLote(ctxBase, analista, {
    codigo,
    tipo_mineral: 'Concentrado de estaño',
    peso_kg: '100.000',
    origen: 'Potosí',
    coordenadas: null,
    dueno,
  });
}

before(async () => {
  await sembrar(ctxBase, { lotesDemo: false });
  const usuario = async (email: string) =>
    (await db.query<Usuario>('SELECT id, email, nombre, rol, laboratorio_id FROM usuarios WHERE email = $1', [email]))[0];
  analista = await usuario('analista@lab001.test');
  supervisor = await usuario('supervisor@lab001.test');
});

after(async () => {
  await db.cerrar();
  fs.rmSync(dirTemporal, { recursive: true, force: true });
});

test('el procesador envía al contrato la versión, el hash anterior, la pureza y el dueño', async () => {
  const enviadas: SolicitudAnclaje[] = [];
  const procesador = new ProcesadorAnclajes(db, anclajeDePrueba({ enviadas }));
  await nuevoLote('LT-ANC-0001', DUENO);
  await nuevoLote('LT-ANC-0002', null);

  const v1 = await registrarAnalisis(ctxBase, analista, 'LT-ANC-0001', datos('75.00'), pdf('v1'));
  await registrarAnalisis(ctxBase, analista, 'LT-ANC-0002', datos('60.00'), pdf('otro'));
  await procesador.procesar();
  const v2 = await registrarCorreccion(ctxBase, supervisor, v1.analisis_id, datos('74.50'), 'Recalibración', null);
  await procesador.procesar();

  const cuentaLab = cuentaLaboratorio('LAB-001');
  assert.equal(enviadas.length, 3);
  assert.deepEqual(enviadas[0], {
    hash: v1.hash,
    laboratorioId: 'LAB-001',
    cuentaLaboratorio: cuentaLab,
    analisisId: v1.analisis_id,
    version: 1,
    loteId: 'LT-ANC-0001',
    hashAnterior: null,
    pureza: '75.00',
    dueno: DUENO,
  });
  // Sin dueño indicado, el lote queda a nombre del laboratorio.
  assert.equal(enviadas[1].dueno, cuentaLab);
  // La corrección se ancla con el hash de la versión anterior.
  assert.equal(enviadas[2].version, 2);
  assert.equal(enviadas[2].hashAnterior, v1.hash);
  assert.equal(enviadas[2].hash, v2.hash);
});

test('si la versión anterior no está anclada, la nueva queda pendiente y no íntegra', async () => {
  // La versión 1 no consigue anclarse; la 2 sí.
  const anclaje = anclajeDePrueba({
    anclar: async (s) => {
      if (s.version === 1) throw new Error('red no disponible');
      return mock.anclar(s);
    },
  });
  const ctx = { ...ctxBase, anclaje };
  await nuevoLote('LT-ANC-0003', null);
  const v1 = await registrarAnalisis(ctx, analista, 'LT-ANC-0003', datos('70.00'), pdf('v1'));
  await registrarCorreccion(ctx, supervisor, v1.analisis_id, datos('71.00'), 'Error de transcripción', null);
  await new ProcesadorAnclajes(db, anclaje).procesar();

  const resultado = await verificarLote(ctx, 'LT-ANC-0003');
  const [v1Ver, v2Ver] = resultado!.analisis[0].versiones;
  assert.equal(v1Ver.estado_anclaje, 'pendiente');
  assert.equal(v2Ver.estado_anclaje, 'anclado');
  assert.equal(v2Ver.verificacion.comprobaciones.datos, true);
  assert.equal(v2Ver.verificacion.estado, 'pendiente');
  assert.ok(v2Ver.verificacion.motivos.includes('La versión anterior aún no está anclada'));
});

test('una cuenta que ya no está autorizada no cuenta como firma válida', async () => {
  await nuevoLote('LT-ANC-0004', null);
  await registrarAnalisis(ctxBase, analista, 'LT-ANC-0004', datos('80.00'), pdf('v1'));
  await new ProcesadorAnclajes(db, mock).procesar();

  const revocada = anclajeDePrueba({
    consultarAnclaje: async (ref) => ({ ...(await mock.consultarAnclaje(ref)), cuentaAutorizada: false }),
  });
  const resultado = await verificarLote({ ...ctxBase, anclaje: revocada }, 'LT-ANC-0004');
  const { verificacion } = resultado!.analisis[0].vigente;
  assert.deepEqual(verificacion.comprobaciones, { datos: true, firma: false, pdf: true });
  assert.equal(verificacion.estado, 'alterado');
  assert.ok(verificacion.motivos.includes('La cuenta que lo registró ya no está autorizada como laboratorio'));

  // Con la cuenta autorizada, el mismo análisis es íntegro.
  const normal = await verificarLote(ctxBase, 'LT-ANC-0004');
  assert.equal(normal!.analisis[0].vigente.verificacion.estado, 'integro');
});

test('el dueño del lote debe ser una dirección Stellar válida', () => {
  const base = { tipo_mineral: 'Estaño', peso_kg: '10', origen: 'Oruro' };
  assert.equal(validarLote({ ...base, dueno: DUENO.toLowerCase() }).dueno, DUENO);
  assert.equal(validarLote(base).dueno, null);
  assert.throws(
    () => validarLote({ ...base, dueno: 'GNOVALIDA' }),
    (e) => e instanceof ErrorValidacion && 'dueno' in e.errores,
  );
});

test('las semillas usan direcciones Stellar válidas y distintas por laboratorio', () => {
  const a = cuentaLaboratorio('LAB-001');
  const b = cuentaLaboratorio('LAB-002');
  assert.match(a, /^G[A-Z2-7]{55}$/);
  assert.notEqual(a, b);
  assert.equal(validarLote({ tipo_mineral: 'x', peso_kg: '1', origen: 'y', dueno: a }).dueno, a);
});

test('pureza en puntos básicos y errores del contrato', () => {
  assert.equal(aPuntosBasicos('92.50'), 9250);
  assert.equal(aPuntosBasicos('100.00'), 10000);
  assert.equal(aPuntosBasicos('0.80'), 80);
  assert.throws(() => aPuntosBasicos('92.5'));

  assert.equal(codigoErrorContrato('HostError: Error(Contract, #6)\nEvent log...'), 6);
  assert.equal(codigoErrorContrato('otro error'), null);
  assert.equal(new ErrorContrato(1).message, 'El laboratorio no está autorizado en el contrato');
});
