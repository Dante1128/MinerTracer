/**
 * Contrato del servicio de anclaje (MinerTrace.md, sección 17).
 *
 * Proveedores: AnclajeMock (simulado) y AnclajeStellar (contrato Soroban en
 * testnet). El resto del sistema solo depende de esta interfaz.
 *
 * Diferencias con el documento:
 * - `anclar` recibe el análisis completo y no solo el hash: el contrato
 *   registra también el laboratorio, el lote, la versión, el hash anterior y
 *   la pureza, y la transacción se firma con la cuenta del laboratorio.
 * - `consultarAnclaje` recibe también el análisis y la versión: el contrato
 *   guarda el registro por (analisis_id, version) y el RPC de Stellar solo
 *   conserva las transacciones unos días, así que no se puede leer por txId.
 */
export interface ServicioAnclaje {
  readonly nombre: string;
  /** Red en la que se ancla ("simulada" o "testnet"). */
  readonly red: string;
  /** Contrato Soroban donde se registran los análisis (null si es simulado). */
  readonly contratoId: string | null;
  /**
   * Los laboratorios firman con su propia wallet (Freighter). El procesador
   * entonces no firma: solo reconcilia lo que ya está en la red, salvo los
   * análisis marcados con `firma_servidor` (semilla y pruebas).
   */
  readonly firmaConWallet: boolean;
  /** Firma en el servidor y ancla (mock, semilla, pruebas o FIRMA_LABORATORIO=servidor). */
  anclar(solicitud: SolicitudAnclaje): Promise<ResultadoAnclaje>;
  /** Busca en la red un anclaje ya hecho de esta solicitud; null si aún no existe. */
  buscarAnclaje(solicitud: SolicitudAnclaje): Promise<ResultadoAnclaje | null>;
  /** Transacción sin firmar para la wallet del laboratorio. */
  prepararAnclaje(solicitud: SolicitudAnclaje): Promise<string>;
  /** Envía la transacción firmada por la wallet; solo devuelve el anclaje si el contrato tiene exactamente este registro. */
  enviarAnclaje(solicitud: SolicitudAnclaje, xdrFirmado: string): Promise<ResultadoAnclaje>;
  consultarAnclaje(referencia: ReferenciaAnclaje): Promise<AnclajeConsultado>;
  /** URL pública para comprobar la transacción por cuenta propia (null si no existe). */
  urlExplorador(txId: string): string | null;
}

export interface SolicitudAnclaje {
  /** SHA-256 del registro canónico, en hexadecimal. */
  hash: string;
  laboratorioId: string;
  /** Cuenta pública del laboratorio, que firma el registro. */
  cuentaLaboratorio: string;
  analisisId: string;
  version: number;
  loteId: string;
  hashAnterior: string | null;
  /** Pureza normalizada con dos decimales ("75.00"). */
  pureza: string;
  /** Cuenta Stellar del dueño del lote (solo cuenta al crear el lote en el contrato). */
  dueno: string;
}

export interface ReferenciaAnclaje {
  txId: string;
  analisisId: string;
  version: number;
}

export interface ResultadoAnclaje {
  txId: string;
  /** Fecha de cierre del ledger, ISO 8601 UTC. */
  fecha: string;
}

export interface AnclajeConsultado {
  /** SHA-256 en hexadecimal (64 caracteres). */
  hash: string;
  /** Cuenta pública que registró el análisis. */
  cuenta: string;
  fecha: string;
  /** La cuenta sigue autorizada como laboratorio (en el contrato, si existe). */
  cuentaAutorizada: boolean;
}

export class AnclajeNoEncontrado extends Error {
  constructor(txId: string) {
    super(`Transacción no encontrada: ${txId}`);
    this.name = 'AnclajeNoEncontrado';
  }
}
