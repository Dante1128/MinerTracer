import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalizar, construirRegistro, hashRegistro, sha256Hex, type DatosAnalisis } from '../src/integridad/canonico.ts';
import { ErrorValidacion, validarAnalisis, validarLote } from '../src/validacion.ts';

const lote = { tipo_mineral: 'Concentrado de estaño', peso_kg: '12500.000', origen: 'Potosí', coordenadas: null };
const analisis: DatosAnalisis = {
  version_esquema: '1',
  analisis_id: 'AN-2026-1023',
  version: 1,
  hash_anterior: null,
  motivo_correccion: null,
  laboratorio_id: 'LAB-001',
  lote_id: 'LT-2026-0457',
  fecha_analisis: '2026-09-15T14:30:00Z',
  metodo: 'FRX',
  pureza: '75.00',
  composicion: { Sn: '75.00', Pb: '4.10', Ag: '0.80', otros: '20.10' },
  observaciones: '',
  pdf_sha256: 'a'.repeat(64),
  salt: '00112233445566778899aabbccddeeff',
};

test('la canonicalización ordena claves y no depende del orden de entrada', () => {
  const desordenado = { ...analisis, composicion: { otros: '20.10', Ag: '0.80', Sn: '75.00', Pb: '4.10' } };
  const a = canonicalizar(construirRegistro(analisis, lote));
  const b = canonicalizar(construirRegistro(desordenado, lote));
  assert.equal(a, b);
  assert.ok(a.startsWith('{"analisis_id":"AN-2026-1023","composicion":{"Ag":"0.80","Pb":"4.10","Sn":"75.00"'));
  assert.ok(!/\s(?=")/.test(a), 'sin espacios entre tokens');
});

test('cambiar 75.00 por 95.00 produce un hash completamente distinto', () => {
  const original = hashRegistro(construirRegistro(analisis, lote));
  const alterado = hashRegistro(construirRegistro({ ...analisis, pureza: '95.00' }, lote));
  assert.match(original, /^[0-9a-f]{64}$/);
  assert.notEqual(original, alterado);
});

test('el hash es reproducible con herramientas externas (SHA-256 del texto canónico)', () => {
  const texto = canonicalizar(construirRegistro(analisis, lote));
  assert.equal(hashRegistro(construirRegistro(analisis, lote)), sha256Hex(Buffer.from(texto, 'utf8')));
});

test('los datos del lote también quedan sellados', () => {
  const a = hashRegistro(construirRegistro(analisis, lote));
  const b = hashRegistro(construirRegistro(analisis, { ...lote, peso_kg: '13500.000' }));
  assert.notEqual(a, b);
});

test('la validación normaliza decimales a precisión fija', () => {
  const v = validarAnalisis({
    fecha_analisis: '2026-09-15T10:30:00-04:00',
    metodo: 'FRX',
    pureza: '75',
    composicion: JSON.stringify({ Sn: '75', Pb: '4,1' }),
  });
  assert.equal(v.pureza, '75.00');
  assert.deepEqual(v.composicion, { Sn: '75.00', Pb: '4.10' });
  assert.equal(v.fecha_analisis, '2026-09-15T14:30:00Z');
  assert.equal(validarLote({ tipo_mineral: 'Sn', peso_kg: '1', origen: 'X' }).peso_kg, '1.000');
});

test('la validación rechaza pureza > 100, composición > 100% y símbolos inválidos', () => {
  const base = { fecha_analisis: '2026-09-15T14:30:00Z', metodo: 'FRX' };
  const errores = (entrada: Record<string, unknown>) => {
    try {
      validarAnalisis({ ...base, ...entrada });
      return {};
    } catch (e) {
      assert.ok(e instanceof ErrorValidacion);
      return e.errores;
    }
  };
  assert.ok(errores({ pureza: '100.01', composicion: { Sn: '1' } }).pureza);
  assert.ok(errores({ pureza: '75.123', composicion: { Sn: '1' } }).pureza);
  assert.ok(errores({ pureza: '75', composicion: { Sn: '80', Pb: '30' } }).composicion);
  assert.ok(errores({ pureza: '75', composicion: { estaño: '75' } }).composicion);
  assert.ok(errores({ pureza: '75', composicion: { Sn: '75' }, fecha_analisis: '2999-01-01' }).fecha_analisis);
});
