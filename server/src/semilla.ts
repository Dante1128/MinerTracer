import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Contexto, Usuario } from './contexto.ts';
import { pdfSimple } from './pdfSimple.ts';
import { registrarAnalisis, registrarLote } from './servicios/registro.ts';

export const PASSWORD_DEMO = 'minertrace123';

/** Clave pública con formato Stellar (G + 55 caracteres base32). En Fase 2 será una cuenta real de Testnet. */
export function cuentaSimulada(semilla: string): string {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = crypto.createHash('sha512').update(`minertrace-mock:${semilla}`).digest();
  return 'G' + Array.from(bytes.subarray(0, 55), (b) => alfabeto[b % 32]).join('');
}

/** Crea el laboratorio, los usuarios y un lote de ejemplo si la base está vacía. */
export async function sembrar(ctx: Contexto, opciones: { lotesDemo?: boolean } = {}) {
  const [existe] = await ctx.db.query('SELECT 1 FROM laboratorios LIMIT 1');
  if (existe) return false;

  await ctx.db.query(
    `INSERT INTO laboratorios (id, nombre, cuenta_publica, acreditaciones) VALUES ($1, $2, $3, $4)`,
    ['LAB-001', 'Laboratorio Minero Andino (demo)', cuentaSimulada('LAB-001'), JSON.stringify(['ISO/IEC 17025'])],
  );
  const hash = await bcrypt.hash(PASSWORD_DEMO, 10);
  const usuarios = await ctx.db.query<Usuario>(
    `INSERT INTO usuarios (email, nombre, password_hash, rol, laboratorio_id) VALUES
       ('analista@lab001.test', 'Ana Quispe', $1, 'analista', 'LAB-001'),
       ('supervisor@lab001.test', 'Carlos Mamani', $1, 'supervisor', 'LAB-001')
     RETURNING id, email, nombre, rol, laboratorio_id`,
    [hash],
  );

  if (opciones.lotesDemo !== false) {
    // El ejemplo de MinerTrace.md, sección 13.
    const analista = usuarios.find((u) => u.rol === 'analista')!;
    await registrarLote(ctx, analista, {
      codigo: 'LT-2026-0457',
      tipo_mineral: 'Concentrado de estaño',
      peso_kg: '12500.000',
      origen: 'Cooperativa Minera X, Potosí, Bolivia',
      coordenadas: '-19.583600,-65.753100',
    });
    const composicion = { Sn: '75.00', Pb: '4.10', Ag: '0.80', otros: '20.10' };
    await registrarAnalisis(
      ctx,
      analista,
      'LT-2026-0457',
      { fecha_analisis: '2026-09-15T14:30:00Z', metodo: 'FRX', pureza: '75.00', composicion, observaciones: 'Muestra compuesta de 5 submuestras.' },
      {
        nombre: 'informe-LT-2026-0457.pdf',
        buffer: pdfSimple('Informe de analisis - Laboratorio Minero Andino', [
          'Lote: LT-2026-0457   Fecha: 2026-09-15 14:30 UTC   Metodo: FRX',
          'Origen: Cooperativa Minera X, Potosi, Bolivia',
          'Pureza (Sn): 75.00 %',
          'Pb 4.10 %  Ag 0.80 %  Otros 20.10 %',
          'Analista: Ana Quispe',
        ]),
      },
    );
  }
  return true;
}
