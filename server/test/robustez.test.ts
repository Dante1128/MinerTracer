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
const { sembrar } = await import('../src/semilla.ts');
const { registrarAnalisis, registrarLote } = await import('../src/servicios/registro.ts');
const { pdfSimple } = await import('../src/pdfSimple.ts');
const { ErrorHttp } = await import('../src/contexto.ts');
type Usuario = import('../src/contexto.ts').Usuario;

const db = await conectar({ memoria: true });
const anclaje = new AnclajeMock(db);
const procesador = new ProcesadorAnclajes(db, anclaje);
const ctx = { db, anclaje, procesador };

const datos = {
  fecha_analisis: '2026-09-15T14:30:00Z',
  metodo: 'FRX',
  pureza: '75.00',
  composicion: { Sn: '75.00' },
  observaciones: '',
};
let analista: Usuario;
let analistaOtroLab: Usuario;

before(async () => {
  await sembrar(ctx, { lotesDemo: false });
  const usuario = async (email: string) =>
    (await db.query<Usuario>('SELECT id, email, nombre, rol, laboratorio_id FROM usuarios WHERE email = $1', [email]))[0];
  analista = await usuario('analista@lab001.test');
  analistaOtroLab = await usuario('analista@lab002.test');
  await registrarLote(ctx, analista, {
    codigo: 'LT-ROB-0001',
    tipo_mineral: 'Concentrado de estaño',
    peso_kg: '100.000',
    origen: 'Potosí',
    coordenadas: null,
    dueno: null,
  });
});

after(async () => {
  procesador.detener();
  await db.cerrar();
  fs.rmSync(dirTemporal, { recursive: true, force: true });
});

test('un lote de otro laboratorio se rechaza antes de guardar el PDF y de consumir la secuencia', async () => {
  const pdf = pdfSimple('Informe ajeno', ['Pureza 75 %']);
  await assert.rejects(
    registrarAnalisis(ctx, analistaOtroLab, 'LT-ROB-0001', datos, { buffer: pdf, nombre: 'ajeno.pdf' }),
    (error) => error instanceof ErrorHttp && error.estado === 403,
  );
  const pdfs = path.join(dirTemporal, 'pdfs');
  assert.deepEqual(fs.existsSync(pdfs) ? fs.readdirSync(pdfs) : [], [], 'no debe quedar un PDF huérfano');

  const propio = await registrarAnalisis(ctx, analista, 'LT-ROB-0001', datos, {
    buffer: pdfSimple('Informe', ['Pureza 75 %']),
    nombre: 'informe.pdf',
  });
  assert.match(propio.analisis_id, /^AN-\d{4}-0001$/, 'la secuencia no debe saltar números');
});

test('dos procesadores concurrentes anclan cada análisis una sola vez', async () => {
  // El procesador de `ctx` no corre: el análisis queda pendiente para los dos procesadores de la prueba.
  const sinAnclar = { ...ctx, procesador: { procesar: async () => {} } as unknown as typeof procesador };
  const fila = await registrarAnalisis(sinAnclar, analista, 'LT-ROB-0001', { ...datos, pureza: '74.00' }, {
    buffer: pdfSimple('Informe', ['Pureza 74 %']),
    nombre: 'informe.pdf',
  });
  assert.equal(fila.estado_anclaje, 'pendiente');

  const lento = new AnclajeMock(db, { retrasoMs: 50 });
  const a = new ProcesadorAnclajes(db, lento);
  const b = new ProcesadorAnclajes(db, lento);
  await Promise.all([a.procesar(), b.procesar()]);

  const [{ total }] = await db.query<{ total: number }>('SELECT COUNT(*)::int AS total FROM anclajes_mock WHERE hash = $1', [
    fila.hash,
  ]);
  assert.equal(total, 1, 'el hash debe anclarse una sola vez');
  const [actual] = await db.query('SELECT estado_anclaje, ultimo_error FROM analisis WHERE id = $1', [fila.id]);
  assert.equal(actual.estado_anclaje, 'anclado');
  assert.equal(actual.ultimo_error, null);
});
