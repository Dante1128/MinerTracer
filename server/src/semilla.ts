import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Keypair } from '@stellar/stellar-sdk';
import { variableSecreto } from './anclaje/AnclajeStellar.ts';
import { config } from './config.ts';
import type { Contexto, Usuario } from './contexto.ts';
import { pdfSimple } from './pdfSimple.ts';
import { registrarAnalisis, registrarLote } from './servicios/registro.ts';

export const PASSWORD_DEMO = 'minertrace123';

const LABORATORIOS = [
  {
    id: 'LAB-001',
    nombre: 'Laboratorio Minero Andino (demo)',
    usuarios: [
      ['analista@lab001.test', 'Ana Quispe', 'analista'],
      ['supervisor@lab001.test', 'Carlos Mamani', 'supervisor'],
    ],
  },
  {
    id: 'LAB-002',
    nombre: 'Laboratorio de Contraste del Sur (demo)',
    usuarios: [
      ['analista@lab002.test', 'Rosa Condori', 'analista'],
      ['supervisor@lab002.test', 'Jorge Choque', 'supervisor'],
    ],
  },
] as const;

/**
 * Cuenta Stellar de un laboratorio: la de su clave en STELLAR_SECRETO_<ID>.
 * Sin clave (solo en modo mock) se deriva del ID una dirección válida que no
 * existe en la red.
 */
export function cuentaLaboratorio(laboratorioId: string): string {
  const secreto = config.stellar.secretos[laboratorioId];
  if (secreto) return Keypair.fromSecret(secreto).publicKey();
  if (config.anclaje.proveedor === 'stellar') {
    throw new Error(`Falta ${variableSecreto(laboratorioId)} para crear el laboratorio ${laboratorioId}`);
  }
  const semilla = crypto.createHash('sha256').update(`minertrace-mock:${laboratorioId}`).digest();
  return Keypair.fromRawEd25519Seed(semilla).publicKey();
}

/** Crea los laboratorios, sus usuarios y un lote de ejemplo si la base está vacía. */
export async function sembrar(ctx: Contexto, opciones: { lotesDemo?: boolean } = {}) {
  const [existe] = await ctx.db.query('SELECT 1 FROM laboratorios LIMIT 1');
  if (existe) return false;

  const hash = await bcrypt.hash(PASSWORD_DEMO, 10);
  const usuarios: Usuario[] = [];
  for (const lab of LABORATORIOS) {
    await ctx.db.query(
      `INSERT INTO laboratorios (id, nombre, cuenta_publica, acreditaciones) VALUES ($1, $2, $3, $4)`,
      [lab.id, lab.nombre, cuentaLaboratorio(lab.id), JSON.stringify(['ISO/IEC 17025'])],
    );
    for (const [email, nombre, rol] of lab.usuarios) {
      const [usuario] = await ctx.db.query<Usuario>(
        `INSERT INTO usuarios (email, nombre, password_hash, rol, laboratorio_id) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, nombre, rol, laboratorio_id`,
        [email, nombre, hash, rol, lab.id],
      );
      usuarios.push(usuario);
    }
  }

  if (opciones.lotesDemo !== false) {
    // El ejemplo de MinerTrace.md, sección 13.
    const analista = usuarios.find((u) => u.email === 'analista@lab001.test')!;
    await registrarLote(ctx, analista, {
      codigo: 'LT-2026-0457',
      tipo_mineral: 'Concentrado de estaño',
      peso_kg: '12500.000',
      origen: 'Cooperativa Minera X, Potosí, Bolivia',
      coordenadas: '-19.583600,-65.753100',
      dueno: config.stellar.duenoDemo,
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
