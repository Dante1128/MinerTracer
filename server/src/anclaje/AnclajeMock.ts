import crypto from 'node:crypto';
import type { Db } from '../db/index.ts';
import {
  AnclajeNoEncontrado,
  type AnclajeConsultado,
  type ResultadoAnclaje,
  type ServicioAnclaje,
} from './ServicioAnclaje.ts';

// TODO WEB3: reemplazar por AnclajeStellar (ver MinerTrace.md, sección 17)
/**
 * Simula Stellar guardando los hashes en la tabla `anclajes_mock` (de solo
 * inserción) y devolviendo un ID con el formato de un hash de transacción
 * Stellar. Emula la latencia de red y, opcionalmente, fallos para probar
 * los reintentos.
 */
export class AnclajeMock implements ServicioAnclaje {
  readonly nombre = 'mock';
  private db: Db;
  private retrasoMs: number;
  private tasaFallo: number;

  constructor(db: Db, opciones: { retrasoMs?: number; tasaFallo?: number } = {}) {
    this.db = db;
    this.retrasoMs = opciones.retrasoMs ?? 0;
    this.tasaFallo = opciones.tasaFallo ?? 0;
  }

  async anclar(hash: string, laboratorioId: string): Promise<ResultadoAnclaje> {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('El hash debe ser SHA-256 en hexadecimal');
    if (this.retrasoMs > 0) await new Promise((r) => setTimeout(r, this.retrasoMs));
    if (Math.random() < this.tasaFallo) throw new Error('Red simulada no disponible');

    const [lab] = await this.db.query<{ cuenta_publica: string }>(
      'SELECT cuenta_publica FROM laboratorios WHERE id = $1',
      [laboratorioId],
    );
    if (!lab) throw new Error(`Laboratorio desconocido: ${laboratorioId}`);

    const txId = crypto.randomBytes(32).toString('hex');
    const fecha = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    await this.db.query(
      `INSERT INTO anclajes_mock (tx_id, hash, cuenta, fecha, ledger)
       VALUES ($1, $2, $3, $4, nextval('seq_ledger_mock'))`,
      [txId, hash, lab.cuenta_publica, fecha],
    );
    return { txId, fecha };
  }

  async consultarAnclaje(txId: string): Promise<AnclajeConsultado> {
    const [fila] = await this.db.query<AnclajeConsultado>(
      'SELECT hash, cuenta, fecha FROM anclajes_mock WHERE tx_id = $1',
      [txId],
    );
    if (!fila) throw new AnclajeNoEncontrado(txId);
    return fila;
  }

  urlExplorador(): string | null {
    // En Fase 2: `https://stellar.expert/explorer/testnet/tx/${txId}`
    return null;
  }
}
