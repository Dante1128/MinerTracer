import { StrKey } from '@stellar/stellar-sdk';
import { ErrorContrato } from '../anclaje/erroresContrato.ts';
import { ErrorHttp } from '../contexto.ts';
import type { Db } from '../db/index.ts';
import * as laboratorios from '../modelos/laboratorios.ts';
import * as lotes from '../modelos/lotes.ts';
import { ContratoSoroban, FondosInsuficientes, funcionInvocada, PASSPHRASE } from '../stellar/contrato.ts';
import { aJson, IndexadorEventos } from './indexador.ts';

/** Acciones del marketplace que firma la wallet del vendedor o del comprador. */
export const ACCIONES = ['list_batch', 'buy', 'confirm', 'refund', 'claim'] as const;
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
  /** Segundos Unix (texto) desde los que el vendedor puede cobrar sin confirmación; null si aún no se compró. */
  vence_garantia: string | null;
}

/** Importes en unidades mínimas del token del contrato, nunca en bolivianos implícitos. */
export interface ConfigComercial {
  version: number;
  destinatario_plataforma: string;
  comision_bps: number;
  comision_minima: string;
  reintegro_bps: number;
  reintegro_maximo: string;
  plazo_entrega_seg: string;
}

export interface VentaComercial {
  comision_bps?: number;
  plazo_entrega_seg?: string;
  plazo_garantia_seg?: string;
  orden_id: string | null;
  comprador_reservado: string | null;
  vence_publicacion: string | null;
  condiciones_hash: string | null;
  comision: string;
  reintegro: string;
  total: string;
  destinatario_plataforma: string | null;
  vence_entrega: string | null;
  recepcion: { fecha: string; evidencia_hash: string; acreditador: string } | null;
  incidencia: { motivo: string; fecha: string } | null;
  devolucion_hash: string | null;
}

export interface LiquidacionComercial {
  orden_id: string | null;
  vendedor: string;
  comprador: string;
  precio: string;
  comision: string;
  reintegro: string;
  total: string;
  fecha: string;
  reembolsada?: boolean;
  recibido_vendedor?: string;
  recibido_plataforma?: string;
  devuelto_comprador?: string;
  comercial?: VentaComercial;
  [campo: string]: unknown;
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
  venta_comercial?: VentaComercial | null;
  liquidacion?: LiquidacionComercial | null;
}

/** "100.5" con 7 decimales → 1005000000n. */
export function aUnidadesMinimas(monto: string, decimales: number): bigint {
  const texto = String(monto ?? '').trim().replace(',', '.');
  if (!Number.isInteger(decimales) || decimales < 0 || decimales > 18) throw new ErrorHttp(503, 'La precisión del token no está admitida');
  const expresion = decimales === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${decimales}})?$`);
  if (texto.length > 80 || !expresion.test(texto)) {
    throw new ErrorHttp(400, `Precio inválido: use un número con hasta ${decimales} decimales`);
  }
  const [entero, fraccion = ''] = texto.split('.');
  const valor = BigInt(entero) * 10n ** BigInt(decimales) + BigInt(fraccion.padEnd(decimales, '0') || '0');
  if (valor <= 0n) throw new ErrorHttp(400, 'El precio debe ser mayor que cero');
  if (valor > (1n << 127n) - 1n) throw new ErrorHttp(400, 'El precio supera el rango permitido');
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
  private configuracion: Promise<{ tolerancia_bps: number; plazo_garantia_seg: number }> | null = null;

  constructor(db: Db, rpcUrl: string, contratoId: string) {
    this.db = db;
    this.contrato = new ContratoSoroban(rpcUrl, contratoId);
    this.indexador = new IndexadorEventos(db, this.contrato);
  }

  async info() {
    const [token, { tolerancia_bps, plazo_garantia_seg }] = await Promise.all([this.infoToken(), this.leerConfiguracion()]);
    const comercio = await this.configuracionComercial();
    return { contrato_id: this.contrato.contratoId, red: 'testnet', passphrase: PASSPHRASE, token, tolerancia_bps, plazo_garantia_seg, comercio };
  }

  async configuracionComercial(): Promise<ConfigComercial | null> {
    const valor = await this.leerComercialOpcional('get_comercio');
    return valor ? aJson(valor) as ConfigComercial : null;
  }

  async infoComercial() {
    const [configuracion, token, general] = await Promise.all([this.configuracionComercial(), this.infoToken(), this.leerConfiguracion()]);
    return { configuracion, token, plazo_garantia_seg: general.plazo_garantia_seg };
  }

  async ventaComercial(loteId: string): Promise<VentaComercial | null> {
    const valor = await this.leerComercialOpcional('get_venta_comercial', { lote_id: loteId });
    return valor ? aJson(valor) as VentaComercial : null;
  }

  async liquidacion(loteId: string): Promise<LiquidacionComercial | null> {
    const valor = await this.leerComercialOpcional('get_liquidacion', { lote_id: loteId });
    return valor ? this.normalizarLiquidacion(valor) : null;
  }

  async historialLiquidaciones(loteId: string): Promise<LiquidacionComercial[]> {
    const valor = await this.leerComercialOpcional('get_historial_liquidaciones', { lote_id: loteId });
    return Array.isArray(valor) ? valor.map((fila) => this.normalizarLiquidacion(fila)) : [];
  }

  async ordenCancelada(ordenId: string): Promise<boolean> {
    return (await this.leerComercialOpcional('get_orden_cancelada', { orden_id: ordenId })) === true;
  }

  private normalizarLiquidacion(valor: unknown): LiquidacionComercial {
    const plano = aJson(valor) as LiquidacionComercial & { resultado?: { tag: string } | string };
    return { ...plano, orden_id: plano.comercial?.orden_id ?? plano.orden_id ?? null,
      reembolsada: (typeof plano.resultado === 'string' ? plano.resultado : plano.resultado?.tag) === 'Reembolsada' };
  }

  private async leerComercialOpcional(metodo: string, argumentos: Record<string, unknown> = {}): Promise<unknown | null> {
    try {
      return await this.contrato.leer(metodo, argumentos);
    } catch (error) {
      // Un contrato de la versión anterior sigue verificando sus análisis; no fingimos que cobra comisiones.
      if (error instanceof Error && error.message === `El contrato no tiene el método ${metodo}`) return null;
      if ([SIN_VENTA, LOTE_INEXISTENTE, 34, 43].includes(codigoDe(error) ?? -1)) return null;
      throw error;
    }
  }

  async estadoLote(loteId: string): Promise<EstadoComercial | null> {
    let lote: Record<string, unknown>;
    try {
      lote = await this.contrato.leer('get_batch', { lote_id: loteId });
    } catch (error) {
      if (codigoDe(error) === LOTE_INEXISTENTE) return null;
      throw error;
    }
    const [venta, contra, comercial, liquidacion] = await Promise.all([
      this.leerOpcional('get_sale', loteId, SIN_VENTA),
      this.leerOpcional('get_counter_analysis', loteId, SIN_CONTRA_ANALISIS),
      this.ventaComercial(loteId),
      this.liquidacion(loteId),
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
      venta_comercial: comercial,
      liquidacion,
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
    const ids = await lotes.listarIds(this.db);
    const estados: EstadoComercial[] = [];
    for (let i = 0; i < ids.length; i += 10) {
      const tanda = await Promise.all(ids.slice(i, i + 10).map((l) => this.estadoLote(l.id)));
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
  async prepararTransaccion(accion: Accion, cuenta: string, loteId: string, precio?: string,
    esperado?: { total: string; analisis_id: string; version: number; orden_id?: string }): Promise<string> {
    switch (accion) {
      case 'list_batch': {
        const { decimales } = await this.infoToken();
        const monto = aUnidadesMinimas(precio ?? '', decimales);
        return this.contrato.prepararTransaccion('list_batch', { dueno: cuenta, lote_id: loteId, precio: monto }, cuenta);
      }
      case 'buy': {
        await this.comprobarSaldo(cuenta, loteId);
        const estado = await this.estadoLote(loteId);
        if (estado?.venta && estado.venta_comercial) {
          if (!esperado || esperado.total !== estado.venta_comercial.total || esperado.analisis_id !== estado.venta.analisis_id || esperado.version !== estado.venta.version) {
            throw new ErrorHttp(409, 'El precio o el análisis cambió; actualice el detalle antes de comprar');
          }
          if ((esperado.orden_id ?? '') !== (estado.venta_comercial.orden_id ?? '')) {
            throw new ErrorHttp(409, 'El lote ahora pertenece a otro acuerdo; actualice el detalle antes de comprar');
          }
          return this.contrato.prepararTransaccion('financiar_orden', { comprador: cuenta, lote_id: loteId,
            orden_id: estado.venta_comercial.orden_id ?? '', total_esperado: BigInt(estado.venta_comercial.total),
            analisis_id_esperado: estado.venta.analisis_id, version_esperada: estado.venta.version }, cuenta);
        }
        return this.contrato.prepararTransaccion('buy', { comprador: cuenta, lote_id: loteId }, cuenta);
      }
      case 'confirm':
        return this.contrato.prepararTransaccion('confirm', { comprador: cuenta, lote_id: loteId }, cuenta);
      case 'refund':
        return this.contrato.prepararTransaccion('refund', { comprador: cuenta, lote_id: loteId }, cuenta);
      case 'claim':
        return this.contrato.prepararTransaccion('claim', { vendedor: cuenta, lote_id: loteId }, cuenta);
    }
  }

  async enviarTransaccion(accion: Accion, cuenta: string, xdrFirmado: string) {
    const funcion = accion === 'buy' && funcionInvocada(xdrFirmado) === 'financiar_orden' ? 'financiar_orden' : accion;
    const resultado = await this.contrato.enviarFirmada(xdrFirmado, { funcion, cuenta });
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
    const comercial = await this.ventaComercial(loteId);
    const total = comercial ? BigInt(comercial.total) : venta.precio;
    if (saldo < total) {
      const error = new FondosInsuficientes();
      error.message = `Fondos insuficientes: el total con comisión es ${formatoMonto(total, token)} y la cuenta tiene ${formatoMonto(saldo, token)}`;
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
      // Un activo clásico devuelve "CODIGO:EMISOR"; el contrato sigue identificando la moneda completa.
      return { contrato: config.token, simbolo: simbolo === 'native' ? 'XLM' : simbolo.split(':')[0], decimales: Number(decimales) };
    })().catch((error) => {
      this.token = null;
      throw error;
    });
    return this.token;
  }

  private leerConfiguracion() {
    this.configuracion ??= this.contrato
      .leer<{ tolerancia_bps: number; plazo_garantia_seg: bigint }>('get_config')
      .then((c) => ({ tolerancia_bps: Number(c.tolerancia_bps), plazo_garantia_seg: Number(c.plazo_garantia_seg) }))
      .catch((error) => {
        this.configuracion = null;
        throw error;
      });
    return this.configuracion;
  }

  /** Agrega el tipo de mineral, el origen y el laboratorio (nombre) desde la base de datos. */
  private async conDatosDelLote(estados: EstadoComercial[]) {
    if (estados.length === 0) return [];
    const ids = estados.map((e) => e.lote_id);
    const lotesEncontrados = await lotes.listarPorIds(this.db, ids);
    const labs = await laboratorios.listarTodos(this.db);
    return estados.map((e) => {
      const lote = lotesEncontrados.find((l) => l.id === e.lote_id);
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
