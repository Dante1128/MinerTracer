import { StrKey } from '@stellar/stellar-sdk';
import { ErrorContrato } from '../anclaje/erroresContrato.ts';
import { ErrorHttp } from '../contexto.ts';
import type { Db } from '../db/index.ts';
import { ContratoSoroban, FondosInsuficientes, PASSPHRASE } from '../stellar/contrato.ts';
import { aJson, IndexadorEventos } from './indexador.ts';

/** Acciones del marketplace que firma la wallet del vendedor o del comprador. */
export const ACCIONES = ['list_batch', 'buy', 'confirm', 'refund'] as const;
export type Accion = (typeof ACCIONES)[number];

const SIN_VENTA = 22;
const SIN_CONTRA_ANALISIS = 23;
const LOTE_INEXISTENTE = 12;

export interface InfoToken {
  contrato: string;
  simbolo: string;
  decimales: number;
}

export interface Venta {
  vendedor: string;
  precio: string;
  comprador: string | null;
  analisis_id: string;
  version: number;
  lab: string;
  pureza_bps: number;
}

export interface ContraAnalisisEnCadena {
  lab: string;
  lab_certificador: string;
  hash: string;
  pureza_bps: number;
  diferencia_bps: number;
  fecha: string;
}

/** Estado comercial de un lote, leído del contrato. */
export interface EstadoComercial {
  lote_id: string;
  estado: 'Certificado' | 'EnVenta' | 'EnGarantia' | 'EnDisputa' | 'Vendido';
  dueno: string;
  analisis_id: string;
  version: number;
  lab: string;
  pureza_bps: number;
  venta: Venta | null;
  contra_analisis: ContraAnalisisEnCadena | null;
}

/** "100.5" con 7 decimales → 1005000000n. */
export function aUnidadesMinimas(monto: string, decimales: number): bigint {
  const texto = String(monto ?? '').trim().replace(',', '.');
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimales}})?$`).test(texto)) {
    throw new ErrorHttp(400, `Precio inválido: use un número con hasta ${decimales} decimales`);
  }
  const [entero, fraccion = ''] = texto.split('.');
  const valor = BigInt(entero) * 10n ** BigInt(decimales) + BigInt(fraccion.padEnd(decimales, '0') || '0');
  if (valor <= 0n) throw new ErrorHttp(400, 'El precio debe ser mayor que cero');
  return valor;
}

export function validarCuenta(cuenta: unknown): string {
  const texto = String(cuenta ?? '').trim().toUpperCase();
  if (!StrKey.isValidEd25519PublicKey(texto)) throw new ErrorHttp(400, 'Dirección Stellar inválida');
  return texto;
}

const codigoDe = (error: unknown) => (error instanceof ErrorContrato ? error.codigo : null);

/**
 * Marketplace con garantía sobre el contrato MinerTrace (solo con ANCLAJE=stellar).
 * El estado comercial siempre se lee del contrato; los eventos copiados por el
 * indexador solo alimentan la línea de tiempo.
 */
export class Mercado {
  readonly contrato: ContratoSoroban;
  readonly indexador: IndexadorEventos;
  private db: Db;
  private token: Promise<InfoToken> | null = null;
  private tolerancia: Promise<number> | null = null;

  constructor(db: Db, rpcUrl: string, contratoId: string) {
    this.db = db;
    this.contrato = new ContratoSoroban(rpcUrl, contratoId);
    this.indexador = new IndexadorEventos(db, this.contrato);
  }

  async info() {
    const [token, tolerancia_bps] = await Promise.all([this.infoToken(), this.toleranciaBps()]);
    return { contrato_id: this.contrato.contratoId, red: 'testnet', passphrase: PASSPHRASE, token, tolerancia_bps };
  }

  async estadoLote(loteId: string): Promise<EstadoComercial | null> {
    let lote: Record<string, unknown>;
    try {
      lote = await this.contrato.leer('get_batch', { lote_id: loteId });
    } catch (error) {
      if (codigoDe(error) === LOTE_INEXISTENTE) return null;
      throw error;
    }
    const [venta, contra] = await Promise.all([
      this.leerOpcional('get_sale', loteId, SIN_VENTA),
      this.leerOpcional('get_counter_analysis', loteId, SIN_CONTRA_ANALISIS),
    ]);
    const plano = aJson(lote) as Omit<EstadoComercial, 'estado' | 'venta' | 'contra_analisis'> & { estado: { tag: string } };
    const contraJson = contra ? (aJson(contra) as ContraAnalisisEnCadena & { fecha: string }) : null;
    return {
      lote_id: loteId,
      estado: plano.estado.tag as EstadoComercial['estado'],
      dueno: plano.dueno,
      analisis_id: plano.analisis_id,
      version: plano.version,
      lab: plano.lab,
      pureza_bps: plano.pureza_bps,
      venta: venta ? (aJson(venta) as Venta) : null,
      contra_analisis: contraJson
        ? { ...contraJson, fecha: new Date(Number(contraJson.fecha) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') }
        : null,
    };
  }

  /** Lotes publicados sin comprador, con los datos del lote que tenga la base de datos. */
  async lotesEnVenta() {
    const ids = await this.contrato.leer<string[]>('listed_batches');
    const estados = await Promise.all(ids.map((id) => this.estadoLote(id)));
    return this.conDatosDelLote(estados.filter((e): e is EstadoComercial => e !== null));
  }

  /** Lotes en los que participa una cuenta: dueña, vendedora o compradora. */
  lotesDeCuenta(cuenta: string) {
    return this.lotesFiltrados((e) => e.dueno === cuenta || e.venta?.vendedor === cuenta || e.venta?.comprador === cuenta);
  }

  /**
   * El contrato no permite buscar lotes por estado ni por cuenta: se recorren
   * los lotes registrados en MinerTrace y se lee el estado de cada uno.
   */
  async lotesFiltrados(filtro: (estado: EstadoComercial) => boolean) {
    const lotes = await this.db.query<{ id: string }>('SELECT id FROM lotes ORDER BY creado_en DESC');
    const estados: EstadoComercial[] = [];
    for (let i = 0; i < lotes.length; i += 10) {
      const tanda = await Promise.all(lotes.slice(i, i + 10).map((l) => this.estadoLote(l.id)));
      for (const e of tanda) if (e && filtro(e)) estados.push(e);
    }
    return this.conDatosDelLote(estados);
  }

  /** Línea de tiempo del lote a partir de los eventos copiados del contrato. */
  async cronologia(loteId: string) {
    await this.indexador.sincronizar().catch(() => {});
    return this.db.query<{ tipo: string; datos: Record<string, unknown>; ledger: number; fecha: string; tx_hash: string }>(
      `SELECT tipo, datos, ledger, fecha, tx_hash FROM eventos_contrato
       WHERE contrato_id = $1 AND lote_id = $2 ORDER BY ledger, id`,
      [this.contrato.contratoId, loteId],
    );
  }

  /** Transacción sin firmar para que la firme la wallet de `cuenta`. */
  async prepararTransaccion(accion: Accion, cuenta: string, loteId: string, precio?: string): Promise<string> {
    switch (accion) {
      case 'list_batch': {
        const { decimales } = await this.infoToken();
        const monto = aUnidadesMinimas(precio ?? '', decimales);
        return this.contrato.prepararTransaccion('list_batch', { dueno: cuenta, lote_id: loteId, precio: monto }, cuenta);
      }
      case 'buy': {
        await this.comprobarSaldo(cuenta, loteId);
        return this.contrato.prepararTransaccion('buy', { comprador: cuenta, lote_id: loteId }, cuenta);
      }
      case 'confirm':
        return this.contrato.prepararTransaccion('confirm', { comprador: cuenta, lote_id: loteId }, cuenta);
      case 'refund':
        return this.contrato.prepararTransaccion('refund', { comprador: cuenta, lote_id: loteId }, cuenta);
    }
  }

  async enviarTransaccion(accion: Accion, cuenta: string, xdrFirmado: string) {
    const resultado = await this.contrato.enviarFirmada(xdrFirmado, { funcion: accion, cuenta });
    await this.indexador.sincronizar().catch(() => {});
    return resultado;
  }

  /** Antes de armar la compra, comprueba que el comprador tenga saldo para el precio. */
  private async comprobarSaldo(cuenta: string, loteId: string) {
    const venta = (await this.leerOpcional('get_sale', loteId, SIN_VENTA)) as { precio: bigint } | null;
    if (!venta) throw new ErrorContrato(14);
    const token = await this.infoToken();
    const tokenContrato = new ContratoSoroban(this.contrato.rpcUrl, token.contrato);
    const saldo = await tokenContrato.leer<bigint>('balance', { id: cuenta }).catch(() => 0n);
    if (saldo < venta.precio) {
      const error = new FondosInsuficientes();
      error.message = `Fondos insuficientes: el lote cuesta ${formatoMonto(venta.precio, token)} y la cuenta tiene ${formatoMonto(saldo, token)}`;
      throw error;
    }
  }

  private async leerOpcional(metodo: string, loteId: string, codigoAusente: number): Promise<unknown | null> {
    try {
      return await this.contrato.leer(metodo, { lote_id: loteId });
    } catch (error) {
      if (codigoDe(error) === codigoAusente) return null;
      throw error;
    }
  }

  private infoToken(): Promise<InfoToken> {
    this.token ??= (async () => {
      const config = await this.contrato.leer<{ token: string }>('get_config');
      const token = new ContratoSoroban(this.contrato.rpcUrl, config.token);
      const [simbolo, decimales] = await Promise.all([token.leer<string>('symbol'), token.leer<number>('decimals')]);
      return { contrato: config.token, simbolo: simbolo === 'native' ? 'XLM' : simbolo, decimales: Number(decimales) };
    })().catch((error) => {
      this.token = null;
      throw error;
    });
    return this.token;
  }

  private toleranciaBps(): Promise<number> {
    this.tolerancia ??= this.contrato
      .leer<{ tolerancia_bps: number }>('get_config')
      .then((c) => Number(c.tolerancia_bps))
      .catch((error) => {
        this.tolerancia = null;
        throw error;
      });
    return this.tolerancia;
  }

  /** Agrega el tipo de mineral, el origen y el laboratorio (nombre) desde la base de datos. */
  private async conDatosDelLote(estados: EstadoComercial[]) {
    if (estados.length === 0) return [];
    const ids = estados.map((e) => e.lote_id);
    const lotes = await this.db.query<{ id: string; tipo_mineral: string; origen: string; peso_kg: string }>(
      'SELECT id, tipo_mineral, origen, peso_kg FROM lotes WHERE id = ANY($1)',
      [ids],
    );
    const labs = await this.db.query<{ id: string; nombre: string; cuenta_publica: string }>(
      'SELECT id, nombre, cuenta_publica FROM laboratorios',
    );
    return estados.map((e) => {
      const lote = lotes.find((l) => l.id === e.lote_id);
      const lab = labs.find((l) => l.cuenta_publica === e.lab);
      return {
        ...e,
        tipo_mineral: lote?.tipo_mineral ?? null,
        origen: lote?.origen ?? null,
        peso_kg: lote?.peso_kg ?? null,
        laboratorio: lab ? { id: lab.id, nombre: lab.nombre } : null,
      };
    });
  }
}

function formatoMonto(valor: bigint, token: InfoToken): string {
  const base = 10n ** BigInt(token.decimales);
  const fraccion = (valor % base).toString().padStart(token.decimales, '0').replace(/0+$/, '');
  return `${valor / base}${fraccion ? `.${fraccion}` : ''} ${token.simbolo}`;
}
