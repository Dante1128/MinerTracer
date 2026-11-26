import { ErrorHttp } from '../contexto.ts';

const MAXIMO_I128 = (1n << 127n) - 1n;

export function unidades(valor: unknown, decimales: number, permiteCero = true): bigint {
  if (!Number.isInteger(decimales) || decimales < 0 || decimales > 18) throw new ErrorHttp(503, 'El token tiene una precisión no admitida');
  const texto = typeof valor === 'string' ? valor.trim().replace(',', '.') : '';
  const expresion = decimales === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${decimales}})?$`);
  if (texto.length > 80 || !expresion.test(texto)) throw new ErrorHttp(400, `Importe inválido: use texto decimal con hasta ${decimales} decimales`);
  const [entero, fraccion = ''] = texto.split('.');
  const monto = BigInt(entero!) * 10n ** BigInt(decimales) + BigInt(fraccion.padEnd(decimales, '0') || '0');
  if (monto > MAXIMO_I128 || (!permiteCero && monto === 0n)) throw new ErrorHttp(400, 'El importe está fuera del rango permitido');
  return monto;
}

export function decimal(monto: bigint, decimales: number): string {
  const signo = monto < 0n ? '-' : '';
  const absoluto = monto < 0n ? -monto : monto;
  if (decimales === 0) return signo + absoluto.toString();
  const escala = 10n ** BigInt(decimales);
  const fraccion = (absoluto % escala).toString().padStart(decimales, '0').replace(/0+$/, '');
  return `${signo}${absoluto / escala}${fraccion ? '.' + fraccion : ''}`;
}

export function normalizarImporte(valor: unknown, decimales: number, permiteCero = true) {
  return decimal(unidades(valor, decimales, permiteCero), decimales);
}

export function comisionDe(precio: bigint, bps: number, minimo: bigint): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new ErrorHttp(503, 'La política de comisión no es válida');
  const porcentaje = (precio * BigInt(bps) + 9_999n) / 10_000n;
  const comision = porcentaje > minimo ? porcentaje : minimo;
  if (precio + comision > MAXIMO_I128) throw new ErrorHttp(400, 'El total supera el rango permitido');
  return comision;
}

export const menor = (...valores: bigint[]) => valores.reduce((a, b) => a < b ? a : b);
