/**
 * Contrato del servicio de anclaje (MinerTrace.md, sección 17).
 *
 * Fase 1: AnclajeMock. Fase 2: AnclajeStellar. El resto del sistema solo
 * depende de esta interfaz.
 *
 * Diferencia con el documento: `anclar` recibe también el laboratorio, porque
 * la transacción debe firmarse con la cuenta de ese laboratorio y el servicio
 * necesita saber qué clave usar.
 */
export interface ServicioAnclaje {
  readonly nombre: string;
  anclar(hash: string, laboratorioId: string): Promise<ResultadoAnclaje>;
  consultarAnclaje(txId: string): Promise<AnclajeConsultado>;
  /** URL pública para comprobar la transacción por cuenta propia (null si no existe). */
  urlExplorador(txId: string): string | null;
}

export interface ResultadoAnclaje {
  txId: string;
  /** Fecha de cierre del ledger, ISO 8601 UTC. */
  fecha: string;
}

export interface AnclajeConsultado {
  /** SHA-256 en hexadecimal (64 caracteres). */
  hash: string;
  /** Cuenta pública que firmó la transacción. */
  cuenta: string;
  fecha: string;
}

export class AnclajeNoEncontrado extends Error {
  constructor(txId: string) {
    super(`Transacción no encontrada: ${txId}`);
    this.name = 'AnclajeNoEncontrado';
  }
}
