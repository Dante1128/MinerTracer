import { Asset, contract, Keypair, Networks, rpc, StrKey, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';
import { codigoErrorContrato, ErrorContrato } from '../anclaje/erroresContrato.ts';

/** Solo testnet: MinerTrace todavía no opera en mainnet. */
export const PASSPHRASE = Networks.TESTNET;

type Metodo = (args?: Record<string, unknown>) => Promise<contract.AssembledTransaction<unknown>>;

interface ResultadoContrato {
  isErr(): boolean;
  unwrap(): unknown;
}
const esResultado = (valor: unknown): valor is ResultadoContrato =>
  typeof (valor as ResultadoContrato | null)?.isErr === 'function';

/** La simulación falló porque la cuenta no tiene saldo suficiente en el token. */
export class FondosInsuficientes extends Error {
  constructor() {
    super('Fondos insuficientes para pagar el lote');
    this.name = 'FondosInsuficientes';
  }
}

export class TransaccionRechazada extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'TransaccionRechazada';
  }
}

/** Convierte un fallo de simulación o envío en un error tipado del contrato, si lo es. */
export function errorDeContrato(texto: unknown): Error | null {
  const mensaje = String(texto ?? '');
  // El token estándar falla con su propio código (#10) cuando no alcanza el saldo.
  if (/balance is not sufficient|insufficient balance|underfunded/i.test(mensaje)) return new FondosInsuficientes();
  const codigo = codigoErrorContrato(mensaje);
  return codigo !== null ? new ErrorContrato(codigo) : null;
}

/**
 * Acceso genérico a un contrato Soroban de testnet: lecturas (simulación),
 * transacciones sin firmar para que las firme una wallet, firma en el
 * servidor (semilla, pruebas y FIRMA_LABORATORIO=servidor) y envío de transacciones firmadas.
 */
export class ContratoSoroban {
  readonly contratoId: string;
  readonly rpcUrl: string;
  readonly servidor: rpc.Server;
  private spec: Promise<contract.Spec> | null = null;

  constructor(rpcUrl: string, contratoId: string) {
    this.rpcUrl = rpcUrl;
    this.contratoId = contratoId;
    this.servidor = new rpc.Server(rpcUrl);
  }

  /** Contrato del XLM nativo en testnet (interfaz estándar de tokens). */
  static tokenNativo(): string {
    return Asset.native().contractId(PASSPHRASE);
  }

  /** Lee un valor del contrato. Los errores del contrato se lanzan como ErrorContrato. */
  async leer<T>(metodo: string, args: Record<string, unknown> = {}): Promise<T> {
    const tx = await this.llamar(metodo, args);
    const resultado: unknown = tx.result;
    if (esResultado(resultado)) {
      if (resultado.isErr()) throw this.errorDeSimulacion(tx) ?? new Error(`${metodo} falló en el contrato`);
      return resultado.unwrap() as T;
    }
    return resultado as T;
  }

  /** Simula la llamada como si la firmara `cuenta` y devuelve el XDR listo para firmar. */
  async prepararTransaccion(metodo: string, args: Record<string, unknown>, cuenta: string): Promise<string> {
    const tx = await this.llamar(metodo, args, { publicKey: cuenta });
    const error = this.errorDeSimulacion(tx);
    if (error) throw error;
    return tx.toXDR();
  }

  /** Firma en el servidor y envía: solo semilla, pruebas y FIRMA_LABORATORIO=servidor. */
  async firmarYEnviar(metodo: string, args: Record<string, unknown>, par: Keypair) {
    const tx = await this.llamar(metodo, args, {
      publicKey: par.publicKey(),
      ...contract.basicNodeSigner(par, PASSPHRASE),
    });
    const error = this.errorDeSimulacion(tx);
    if (error) throw error;
    try {
      const enviada = await tx.signAndSend();
      const respuesta = enviada.getTransactionResponse;
      const txId = enviada.sendTransactionResponse?.hash;
      if (!txId || respuesta?.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        throw new TransaccionRechazada(`La transacción no se confirmó en la red (${respuesta?.status ?? 'sin respuesta'})`);
      }
      return { txId, ledger: respuesta.ledger, fecha: isoDesdeSegundos(respuesta.createdAt) };
    } catch (e) {
      throw errorDeContrato((e as Error).message) ?? e;
    }
  }

  /**
   * Envía una transacción firmada por una wallet y espera su confirmación.
   * Solo acepta una invocación a este contrato, con la función y la cuenta esperadas.
   */
  async enviarFirmada(xdrFirmado: string, esperado: { funcion: string; cuenta: string }) {
    let tx: Transaction;
    try {
      tx = TransactionBuilder.fromXDR(xdrFirmado, PASSPHRASE) as Transaction;
    } catch {
      throw new TransaccionRechazada('La transacción firmada no es válida');
    }
    const destino = destinoDeInvocacion(tx);
    if (!destino || destino.contrato !== this.contratoId || destino.funcion !== esperado.funcion) {
      throw new TransaccionRechazada('La transacción no corresponde a la operación solicitada');
    }
    if (tx.source !== esperado.cuenta) {
      throw new TransaccionRechazada('La transacción está firmada por otra cuenta');
    }

    const envio = await this.servidor.sendTransaction(tx);
    if (envio.status === 'ERROR' || envio.status === 'TRY_AGAIN_LATER') {
      const codigo = envio.errorResult?.result.type ?? envio.status;
      throw new TransaccionRechazada(mensajeEnvio(codigo));
    }
    const final = await this.servidor.pollTransaction(envio.hash, { attempts: 30, sleepStrategy: () => 1000 });
    if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new TransaccionRechazada(
        final.status === rpc.Api.GetTransactionStatus.NOT_FOUND
          ? 'La red no confirmó la transacción a tiempo; revise el explorador antes de reintentar'
          : 'La transacción falló en la red',
      );
    }
    return { txId: envio.hash, ledger: final.ledger, fecha: isoDesdeSegundos(final.createdAt) };
  }

  private errorDeSimulacion(tx: contract.AssembledTransaction<unknown>): Error | null {
    const simulacion = tx.simulation;
    if (!simulacion || !rpc.Api.isSimulationError(simulacion)) return null;
    return errorDeContrato(simulacion.error) ?? new TransaccionRechazada(simulacion.error.split('\n')[0]);
  }

  private async llamar(metodo: string, args: Record<string, unknown>, opciones: Partial<contract.ClientOptions> = {}) {
    const base = { contractId: this.contratoId, networkPassphrase: PASSPHRASE, rpcUrl: this.rpcUrl };
    this.spec ??= contract.Client.from(base)
      .then((c) => c.spec)
      .catch((error) => {
        this.spec = null;
        throw error;
      });
    const cliente = new contract.Client(await this.spec, { ...base, ...opciones }) as unknown as Record<string, Metodo>;
    if (typeof cliente[metodo] !== 'function') throw new Error(`El contrato no tiene el método ${metodo}`);
    return cliente[metodo](args);
  }
}

export const isoDesdeSegundos = (segundos: bigint | number) =>
  new Date(Number(segundos) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Contrato y función que invoca una transacción (null si no es una única invocación a contrato). */
function destinoDeInvocacion(tx: Transaction): { contrato: string; funcion: string } | null {
  if (tx.operations.length !== 1) return null;
  const op = tx.operations[0] as { type: string; func?: unknown };
  const func = op.func as {
    type?: string;
    invokeContract?: { contractAddress?: { contractId?: { value?: Uint8Array } }; functionName?: { bytes?: Uint8Array } };
  };
  const id = func?.invokeContract?.contractAddress?.contractId?.value;
  const nombre = func?.invokeContract?.functionName?.bytes;
  if (op.type !== 'invokeHostFunction' || func?.type !== 'hostFunctionTypeInvokeContract' || !id || !nombre) return null;
  return { contrato: StrKey.encodeContract(Buffer.from(id)), funcion: Buffer.from(nombre).toString('utf8') };
}

function mensajeEnvio(codigo: string): string {
  if (/insufficientBalance|insufficientFee/i.test(codigo)) return 'La cuenta no tiene XLM suficiente para pagar la comisión';
  if (/badSeq/i.test(codigo)) return 'La transacción quedó desactualizada; inténtelo de nuevo';
  if (/tooLate/i.test(codigo)) return 'La transacción venció antes de enviarse; inténtelo de nuevo';
  if (/noAccount/i.test(codigo)) return 'La cuenta no existe en testnet; fondéela con friendbot';
  return `La red rechazó la transacción (${codigo})`;
}
