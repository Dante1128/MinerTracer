import { contract, Keypair, nativeToScVal, Networks, rpc, scValToNative } from '@stellar/stellar-sdk';
import { ContratoSoroban } from '../stellar/contrato.ts';
import {
  ANALISIS_INEXISTENTE,
  codigoErrorContrato,
  ErrorContrato,
  VERSION_DUPLICADA,
} from './erroresContrato.ts';
import {
  AnclajeNoEncontrado,
  type AnclajeConsultado,
  type ReferenciaAnclaje,
  type ResultadoAnclaje,
  type ServicioAnclaje,
  type SolicitudAnclaje,
} from './ServicioAnclaje.ts';

/** Solo testnet: MinerTrace todavía no opera en mainnet. */
const PASSPHRASE = Networks.TESTNET;

/** Registro de un análisis tal como lo devuelve `get_analysis`. */
interface AnalisisEnCadena {
  lab: string;
  lote_id: string;
  hash: Uint8Array;
  hash_anterior?: Uint8Array | null;
  pureza_bps: number;
  ledger: number;
  /** Hora de cierre del ledger, en segundos Unix. */
  fecha: bigint | number;
}

interface ResultadoContrato<T> {
  isErr(): boolean;
  unwrap(): T;
}

type Llamada<T> = Promise<contract.AssembledTransaction<T>>;

/** Métodos del contrato que usa el servidor (`contract.Client` los genera en tiempo de ejecución). */
interface MetodosContrato {
  submit_analysis(args: {
    lab: string;
    lote_id: string;
    dueno: string;
    analisis_id: string;
    version: number;
    hash: Buffer;
    hash_anterior: Buffer | undefined;
    pureza_bps: number;
  }): Llamada<ResultadoContrato<void>>;
  get_analysis(args: { analisis_id: string; version: number }): Llamada<ResultadoContrato<AnalisisEnCadena>>;
  is_lab(args: { lab: string }): Llamada<boolean>;
}

export interface OpcionesStellar {
  rpcUrl: string;
  contratoId: string;
  /** Clave secreta de cada laboratorio, por ID (LAB-001 → S...): semilla, pruebas o firma en el servidor. */
  secretos: Record<string, string>;
  /** Los laboratorios firman sus análisis con su wallet (FIRMA_LABORATORIO=wallet). */
  firmaConWallet: boolean;
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const isoDesdeSegundos = (segundos: bigint | number) =>
  new Date(Number(segundos) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** "75.00" → 7500. La validación garantiza siempre dos decimales. */
export function aPuntosBasicos(pureza: string): number {
  if (!/^\d{1,3}\.\d{2}$/.test(pureza)) throw new Error(`Pureza con formato inesperado: ${pureza}`);
  return Number.parseInt(pureza.replace('.', ''), 10);
}

/** Nombre de la variable de entorno con la clave de un laboratorio: LAB-001 → STELLAR_SECRETO_LAB_001. */
export const variableSecreto = (laboratorioId: string) => `STELLAR_SECRETO_${laboratorioId.replace(/-/g, '_')}`;

/** Argumentos de `submit_analysis` para una solicitud. */
function argumentos(s: SolicitudAnclaje) {
  return {
    lab: s.cuentaLaboratorio,
    lote_id: s.loteId,
    dueno: s.dueno,
    analisis_id: s.analisisId,
    version: s.version,
    hash: Buffer.from(s.hash, 'hex'),
    hash_anterior: s.hashAnterior ? Buffer.from(s.hashAnterior, 'hex') : undefined,
    pureza_bps: aPuntosBasicos(s.pureza),
  };
}

/**
 * Ancla los análisis en el contrato MinerTrace de Soroban (testnet) y los
 * verifica leyendo el estado del contrato, nunca la base de datos.
 *
 * Normalmente el laboratorio firma `submit_analysis` con su propia wallet:
 * `prepararAnclaje` arma la transacción sin firmar y `enviarAnclaje` la envía y
 * comprueba el registro en el contrato. La firma en el servidor (`anclar`, con
 * STELLAR_SECRETO_<ID>) queda para la semilla, las pruebas y FIRMA_LABORATORIO=servidor.
 */
export class AnclajeStellar implements ServicioAnclaje {
  readonly nombre = 'stellar';
  readonly red = 'testnet';
  readonly contratoId: string;
  readonly firmaConWallet: boolean;
  private opciones: OpcionesStellar;
  private servidor: rpc.Server;
  private contrato: ContratoSoroban;
  private spec: Promise<contract.Spec> | null = null;
  private clientes = new Map<string, MetodosContrato>();

  constructor(opciones: OpcionesStellar) {
    this.opciones = opciones;
    this.contratoId = opciones.contratoId;
    this.firmaConWallet = opciones.firmaConWallet;
    this.servidor = new rpc.Server(opciones.rpcUrl);
    this.contrato = new ContratoSoroban(opciones.rpcUrl, opciones.contratoId);
  }

  async anclar(s: SolicitudAnclaje): Promise<ResultadoAnclaje> {
    const firmante = this.parDe(s.laboratorioId);
    if (firmante.publicKey() !== s.cuentaLaboratorio) {
      throw new Error(`La clave de ${variableSecreto(s.laboratorioId)} no corresponde a la cuenta registrada del laboratorio`);
    }
    const cliente = await this.cliente(s.laboratorioId);
    const tx = await cliente.submit_analysis(argumentos(s));

    const codigo = this.codigoDeSimulacion(tx);
    if (codigo === VERSION_DUPLICADA) return this.recuperarAnclaje(s);
    if (codigo !== null) throw new ErrorContrato(codigo);

    let enviada: contract.SentTransaction<ResultadoContrato<void>>;
    try {
      enviada = await tx.signAndSend();
    } catch (error) {
      const codigoEnvio = codigoErrorContrato((error as Error).message);
      throw codigoEnvio !== null ? new ErrorContrato(codigoEnvio) : error;
    }
    const respuesta = enviada.getTransactionResponse;
    const txId = enviada.sendTransactionResponse?.hash;
    if (!txId || respuesta?.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`La transacción no se confirmó en la red (${respuesta?.status ?? 'sin respuesta'})`);
    }
    return { txId, fecha: isoDesdeSegundos(respuesta.createdAt) };
  }

  prepararAnclaje(s: SolicitudAnclaje): Promise<string> {
    return this.contrato.prepararTransaccion('submit_analysis', argumentos(s), s.cuentaLaboratorio);
  }

  async enviarAnclaje(s: SolicitudAnclaje, xdrFirmado: string): Promise<ResultadoAnclaje> {
    const enviada = await this.contrato.enviarFirmada(xdrFirmado, { funcion: 'submit_analysis', cuenta: s.cuentaLaboratorio });
    // Se marca anclado solo si el contrato guarda exactamente este registro.
    const anclado = await this.leerAnalisis(s.analisisId, s.version);
    if (!anclado || hex(anclado.hash) !== s.hash || anclado.lab !== s.cuentaLaboratorio) {
      throw new Error('La transacción se confirmó, pero el contrato no tiene este análisis con el mismo hash');
    }
    return { txId: enviada.txId, fecha: enviada.fecha };
  }

  async consultarAnclaje(ref: ReferenciaAnclaje): Promise<AnclajeConsultado> {
    const anclado = await this.leerAnalisis(ref.analisisId, ref.version);
    if (!anclado) throw new AnclajeNoEncontrado(ref.txId);
    const lector = await this.cliente();
    const autorizada = (await lector.is_lab({ lab: anclado.lab })).result;
    return {
      hash: hex(anclado.hash),
      cuenta: anclado.lab,
      fecha: isoDesdeSegundos(anclado.fecha),
      cuentaAutorizada: autorizada === true,
    };
  }

  urlExplorador(txId: string): string {
    return `https://stellar.expert/explorer/testnet/tx/${txId}`;
  }

  /** Lee el registro del contrato; null si esa versión no existe. */
  private async leerAnalisis(analisisId: string, version: number): Promise<AnalisisEnCadena | null> {
    const lector = await this.cliente();
    const tx = await lector.get_analysis({ analisis_id: analisisId, version });
    if (!tx.result.isErr()) return tx.result.unwrap();
    const codigo = this.codigoDeSimulacion(tx);
    if (codigo === ANALISIS_INEXISTENTE) return null;
    throw codigo !== null ? new ErrorContrato(codigo) : new Error('No se pudo leer el análisis del contrato');
  }

  /** La versión ya estaba en el contrato (p. ej., el proceso se cayó tras enviarla): se recupera su transacción. */
  private async recuperarAnclaje(s: SolicitudAnclaje): Promise<ResultadoAnclaje> {
    const encontrado = await this.buscarAnclaje(s);
    if (!encontrado) throw new Error('El contrato indicó que la versión ya existe, pero no se pudo leer');
    return encontrado;
  }

  /**
   * Si el contrato ya tiene esta versión, comprueba que sea exactamente la
   * nuestra y busca el ID de la transacción en los eventos del contrato.
   * Sirve para reconciliar análisis firmados con la wallet del laboratorio.
   */
  async buscarAnclaje(s: SolicitudAnclaje): Promise<ResultadoAnclaje | null> {
    const anclado = await this.leerAnalisis(s.analisisId, s.version);
    if (!anclado) return null;
    if (hex(anclado.hash) !== s.hash || anclado.lab !== s.cuentaLaboratorio) {
      throw new Error(
        `El contrato ya tiene otra versión ${s.analisisId} v${s.version}. ` +
          'Si se reinició la base de datos, despliegue un contrato nuevo (npm run contrato:desplegar).',
      );
    }
    const salud = await this.servidor.getHealth();
    if (anclado.ledger < salud.oldestLedger) {
      throw new Error('El análisis ya está en el contrato, pero su transacción salió de la ventana de retención del RPC');
    }
    const tema = (valor: string, tipo: 'symbol' | 'string') => nativeToScVal(valor, { type: tipo }).toXDR('base64');
    const { events } = await this.servidor.getEvents({
      startLedger: anclado.ledger,
      filters: [
        {
          type: 'contract',
          contractIds: [this.contratoId],
          topics: [[tema('analisis_registrado', 'symbol'), tema(s.loteId, 'string'), tema(s.analisisId, 'string')]],
        },
      ],
      limit: 100,
    });
    const evento = events.find((e) => (scValToNative(e.value) as { version?: number }).version === s.version);
    if (!evento) throw new Error('El análisis ya está en el contrato, pero no se encontró su transacción');
    return { txId: evento.txHash, fecha: new Date(evento.ledgerClosedAt).toISOString().replace(/\.\d{3}Z$/, 'Z') };
  }

  private codigoDeSimulacion(tx: contract.AssembledTransaction<unknown>): number | null {
    const simulacion = tx.simulation;
    return simulacion && rpc.Api.isSimulationError(simulacion) ? codigoErrorContrato(simulacion.error) : null;
  }

  private parDe(laboratorioId: string): Keypair {
    const secreto = this.opciones.secretos[laboratorioId];
    if (!secreto) throw new Error(`Falta la clave del laboratorio ${laboratorioId} (${variableSecreto(laboratorioId)})`);
    return Keypair.fromSecret(secreto);
  }

  /** Cliente del contrato: de lectura, o firmado por un laboratorio. La interfaz se descarga una vez. */
  private async cliente(laboratorioId?: string): Promise<MetodosContrato> {
    const clave = laboratorioId ?? '';
    const existente = this.clientes.get(clave);
    if (existente) return existente;

    const base = { contractId: this.contratoId, networkPassphrase: PASSPHRASE, rpcUrl: this.opciones.rpcUrl };
    this.spec ??= contract.Client.from(base)
      .then((c) => c.spec)
      .catch((error) => {
        this.spec = null;
        throw error;
      });
    let opciones: contract.ClientOptions = base;
    if (laboratorioId) {
      const par = this.parDe(laboratorioId);
      opciones = { ...base, publicKey: par.publicKey(), ...contract.basicNodeSigner(par, PASSPHRASE) };
    }
    const cliente = new contract.Client(await this.spec, opciones) as unknown as MetodosContrato;
    this.clientes.set(clave, cliente);
    return cliente;
  }
}
