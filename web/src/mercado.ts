import { useEffect, useState } from 'react';
import { api, ErrorApi, type AnuncioComercial } from './api.ts';
import { acortar } from './formato.ts';
import { ErrorWallet, useWallet } from './wallet.tsx';

export type EstadoLote = 'Certificado' | 'EnVenta' | 'EnGarantia' | 'EnDisputa' | 'Vendido';
export type AccionMercado = 'list_batch' | 'buy' | 'confirm' | 'refund' | 'claim';

export interface InfoToken {
  contrato: string;
  simbolo: string;
  decimales: number;
}

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
  precio: string;
  comision: string;
  reintegro: string;
  total: string;
  vendedor: string;
  comprador: string;
  fecha: string;
  reembolsada?: boolean;
  [campo: string]: unknown;
}

export type InfoMercado =
  | { habilitado: false }
  | {
      habilitado: true;
      contrato_id: string;
      red: string;
      passphrase: string;
      token: InfoToken;
      tolerancia_bps: number;
      /** Tras la compra, si el comprador no confirma ni hay disputa en este plazo, el vendedor puede cobrar. */
      plazo_garantia_seg: number;
      comercio?: ConfigComercial | null;
    };

export interface Venta {
  vendedor: string;
  /** En unidades mínimas del token (texto: puede superar Number.MAX_SAFE_INTEGER). */
  precio: string;
  comprador: string | null;
  analisis_id: string;
  version: number;
  lab: string;
  pureza_bps: number;
  /** Segundos Unix (texto) desde los que el vendedor puede cobrar sin confirmación; null antes de la compra. */
  vence_garantia: string | null;
}

/** Fecha ISO del vencimiento de la garantía, o null. */
export const venceGarantia = (venta: Venta | null | undefined) =>
  venta?.vence_garantia ? new Date(Number(venta.vence_garantia) * 1000).toISOString() : null;

/** El vencimiento ya pasó (según el reloj local; el contrato usa la hora del ledger). */
export const garantiaVencida = (venta: Venta | null | undefined) => {
  const vence = venceGarantia(venta);
  return vence !== null && new Date(vence).getTime() <= Date.now();
};

/** "7 días", "1 día", "45 minutos"… */
export function formatoPlazo(segundos: number): string {
  if (segundos >= 86400 && segundos % 86400 === 0) return `${segundos / 86400} ${segundos === 86400 ? 'día' : 'días'}`;
  if (segundos >= 3600) return `${Math.round(segundos / 3600)} horas`;
  if (segundos >= 60) return `${Math.round(segundos / 60)} minutos`;
  return `${segundos} segundos`;
}

export interface ContraAnalisisEnCadena {
  lab: string;
  lab_certificador: string;
  hash: string;
  pureza_bps: number;
  diferencia_bps: number;
  fecha: string;
}

export interface EstadoComercial {
  lote_id: string;
  estado: EstadoLote;
  dueno: string;
  analisis_id: string;
  version: number;
  lab: string;
  pureza_bps: number;
  venta: Venta | null;
  contra_analisis: ContraAnalisisEnCadena | null;
  venta_comercial?: VentaComercial | null;
  liquidacion?: LiquidacionComercial | null;
  tipo_mineral?: string | null;
  origen?: string | null;
  peso_kg?: string | null;
  laboratorio?: { id: string; nombre: string } | null;
}

export interface EventoCronologia {
  tipo: string;
  datos: Record<string, unknown>;
  ledger: number;
  fecha: string;
  tx_hash: string;
  url_explorador: string;
}

export interface ContraAnalisisPublico {
  id: number;
  laboratorio_id: string;
  laboratorio_nombre: string;
  analista_nombre: string;
  fecha_analisis: string;
  metodo: string;
  pureza: string;
  composicion: Record<string, string>;
  observaciones: string;
  pdf_nombre: string;
  pdf_sha256: string;
  hash: string;
  tx_id: string;
  fecha_anclaje: string;
  url_explorador: string;
  verificacion: {
    estado: 'integro' | 'alterado' | 'no_verificable';
    motivos: string[];
    hash_recalculado: string;
    hash_anclado: string | null;
    comprobaciones: { datos: boolean | null; pdf: boolean };
  };
}

export interface DetalleComercial {
  lote_id: string;
  estado: EstadoComercial | null;
  cronologia: EventoCronologia[];
  contra_analisis: ContraAnalisisPublico[];
}

export const ETIQUETA_ESTADO: Record<EstadoLote, { texto: string; clases: string }> = {
  Certificado: { texto: 'Certificado', clases: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  EnVenta: { texto: 'En venta', clases: 'bg-sky-50 text-sky-700 ring-sky-600/20' },
  EnGarantia: { texto: 'En garantía', clases: 'bg-mineral-50 text-mineral-700 ring-mineral-600/20' },
  EnDisputa: { texto: 'En disputa', clases: 'bg-red-50 text-red-700 ring-red-600/20' },
  Vendido: { texto: 'Vendido', clases: 'bg-stone-100 text-stone-700 ring-stone-500/20' },
};

/** 7500 → "75.00" */
export const formatoPureza = (bps: number) => (bps / 100).toFixed(2);

/** "1005000000" con 7 decimales → "100.5 XLM" */
export function formatoPrecio(precio: string, token: InfoToken): string {
  const valor = BigInt(precio);
  const base = 10n ** BigInt(token.decimales);
  const fraccion = (valor % base).toString().padStart(token.decimales, '0').replace(/0+$/, '');
  const entero = (valor / base).toLocaleString('es');
  return `${entero}${fraccion ? `,${fraccion}` : ''} ${token.simbolo}`;
}

// Se consulta una sola vez por carga de la página.
let consultaInfo: Promise<InfoMercado | null> | null = null;

export function useInfoMercado(): InfoMercado | null {
  const [info, setInfo] = useState<InfoMercado | null>(null);
  useEffect(() => {
    let vigente = true;
    consultaInfo ??= api<InfoMercado>('/mercado/info').catch(() => {
      consultaInfo = null;
      return null;
    });
    void consultaInfo.then((i) => vigente && setInfo(i));
    return () => {
      vigente = false;
    };
  }, []);
  return info;
}

/** Nombres de ejemplos sintéticos del poblado histórico; no acreditan identidad comercial. */
const NOMBRE_VENDEDOR_DEMO: Record<string, string> = {
  GAVLAJBO5WY3HLN3RP625XYV6XPD4KTUB67YUUJINWZUT5I577UYBXI6: 'Cooperativa Minera Huanuni',
  GA35TV5YYQB3OK337EI4CZO3SSMSY46MCCGSJONGSJQEYQXYX66XC22Z: 'Consorcio de Cooperativas de Potosí',
  GCZ3ANLXJB7VCGQXXZCFBRTPYWBPVOIB2ZSFAXK6ZVJT4GPUDLVZQWIC: 'Cooperativas Auríferas del Norte de La Paz',
  GAXG6GXZSXPKTLBFS6TYUV4YWQMACTK5525GJZKZTBW76IXWJ4V7JUXI: 'Cooperativa Aurífera San Simón (Beni)',
  GB4NXHV3V5OY7EJXJQP5YWLSERN7VOUJJM2ZSOLFVJT4KP3SYRJ5KAKJ: 'Cooperativa Minera Colquiri',
  GCLOFJ2GSUVKBR6EHSKBG4OSTOWF72JFZ5DQ4BFB2NJXL4X3CYDGQ5LD: 'Minera Chojlla',
  GBJZFZ52JRTIPAHXCXQPQ4OJKMVKOIGJDGOOYDPRQYEUZKBO3FQJPSSL: 'Vendedor comercial',
};

/** Cuenta vendedora con los lotes que ofrece en el contrato; el laboratorio solo firma el análisis. */
export interface Vendedor {
  id: string;
  nombre: string;
  es_demo: boolean;
  publicaciones: number;
  lotes: EstadoComercial[];
  minerales: string[];
  laboratorios: string[];
}

export function agruparPorVendedor(lotes: EstadoComercial[], anuncios: AnuncioComercial[] = []): Vendedor[] {
  const porId = new Map<string, Vendedor>();
  const obtener = (id: string) => {
    const nombreDemo = NOMBRE_VENDEDOR_DEMO[id];
    return porId.get(id) ?? {
      id, nombre: nombreDemo ? `${nombreDemo} (demo)` : acortar(id, 6), es_demo: !!nombreDemo,
      publicaciones: 0, lotes: [], minerales: [], laboratorios: [],
    };
  };
  for (const lote of lotes) {
    const id = lote.venta?.vendedor ?? lote.dueno;
    const vendedor = obtener(id);
    vendedor.lotes.push(lote);
    if (lote.tipo_mineral && !vendedor.minerales.includes(lote.tipo_mineral)) vendedor.minerales.push(lote.tipo_mineral);
    const laboratorio = lote.laboratorio?.nombre;
    if (laboratorio && !vendedor.laboratorios.includes(laboratorio)) vendedor.laboratorios.push(laboratorio);
    porId.set(id, vendedor);
  }
  for (const anuncio of anuncios) {
    if (anuncio.tipo !== 'venta' || !anuncio.vigente) continue;
    const vendedor = obtener(anuncio.cuenta);
    vendedor.publicaciones++;
    if (anuncio.perfil) vendedor.nombre = anuncio.perfil.organizacion || anuncio.perfil.nombre;
    if (!vendedor.minerales.includes(anuncio.mineral)) vendedor.minerales.push(anuncio.mineral);
    porId.set(anuncio.cuenta, vendedor);
  }
  return [...porId.values()].sort((a, b) => (b.publicaciones + b.lotes.length) - (a.publicaciones + a.lotes.length));
}

/** Lectura del catálogo del contrato, con actualización manual y cancelación al cambiar de vista. */
export function useLotesMercado(habilitado: boolean | undefined, recarga = 0) {
  const [lotes, setLotes] = useState<EstadoComercial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!habilitado) return;
    let vigente = true;
    setError(null);
    setLotes(null);
    api<EstadoComercial[]>('/mercado/lotes')
      .then((datos) => { if (vigente) setLotes(datos); })
      .catch((e) => { if (vigente) setError(e instanceof ErrorApi ? e.message : 'No se pudo leer el contrato'); });
    return () => { vigente = false; };
  }, [habilitado, recarga]);
  return { lotes, error };
}

export type PasoTransaccion = 'inactivo' | 'preparando' | 'firmando' | 'enviando' | 'confirmada' | 'error';

export interface ResultadoTransaccion {
  tx_id: string;
  url_explorador: string;
  fecha: string;
}

/**
 * Ciclo de una transacción firmada por la wallet conectada: el servidor la
 * arma (`preparar`), Freighter la firma y el servidor la envía y espera la
 * confirmación (`enviar`). Expone el paso en curso y un error legible.
 */
export function useFirmaConWallet() {
  const wallet = useWallet();
  const [paso, setPaso] = useState<PasoTransaccion>('inactivo');
  const [error, setError] = useState<string | null>(null);
  const [estadoError, setEstadoError] = useState<number | null>(null);
  const [resultado, setResultado] = useState<ResultadoTransaccion | null>(null);

  const ejecutar = async <P extends { xdr?: string }>(
    preparar: (cuenta: string) => Promise<P>,
    enviar: (xdrFirmado: string, cuenta: string, preparado: P) => Promise<ResultadoTransaccion>,
  ): Promise<ResultadoTransaccion | null> => {
    setError(null);
    setEstadoError(null);
    setResultado(null);
    try {
      if (!wallet.direccion) throw new ErrorWallet('Conecte su wallet Freighter para continuar.');
      if (!wallet.redCorrecta) throw new ErrorWallet(`Freighter está en ${wallet.red ?? 'otra red'}. Cambie a Testnet en la extensión.`);
      const cuenta = wallet.direccion;
      setPaso('preparando');
      const preparado = await preparar(cuenta);
      let r: ResultadoTransaccion;
      if (preparado.xdr) {
        setPaso('firmando');
        const firmado = await wallet.firmar(preparado.xdr);
        setPaso('enviando');
        r = await enviar(firmado, cuenta, preparado);
      } else {
        // Ya estaba en la red (p. ej., firmado antes): no hace falta firmar.
        r = preparado as unknown as ResultadoTransaccion;
      }
      setResultado(r);
      setPaso('confirmada');
      return r;
    } catch (e) {
      setEstadoError(e instanceof ErrorApi ? e.estado : null);
      setError(e instanceof ErrorApi || e instanceof ErrorWallet ? e.message : 'Error inesperado al procesar la transacción');
      setPaso('error');
      return null;
    }
  };

  const reiniciar = () => {
    setPaso('inactivo');
    setError(null);
    setEstadoError(null);
    setResultado(null);
  };

  return { paso, error, estadoError, resultado, ejecutar, reiniciar, ocupado: paso === 'preparando' || paso === 'firmando' || paso === 'enviando' };
}

/** Acción del marketplace firmada por la wallet del vendedor o del comprador. */
export function useTransaccion() {
  const firma = useFirmaConWallet();
  const ejecutar = (accion: AccionMercado, loteId: string, precio?: string,
    esperado?: { total_esperado: string; analisis_id_esperado: string; version_esperada: number; orden_id?: string }) =>
    firma.ejecutar(
      (cuenta) => api<{ xdr: string; preparacion_id: string }>('/mercado/transacciones', { json: { accion, cuenta, lote_id: loteId, precio, ...esperado } }),
      (xdr, cuenta, preparada) => api<ResultadoTransaccion>('/mercado/transacciones/enviar', { json: { accion, cuenta, xdr, preparacion_id: preparada.preparacion_id } }),
    );
  return { ...firma, ejecutar };
}

export type AccionComercial = 'reservar_venta' | 'buy' | 'registrar_recepcion' | 'atestiguar_entrega' |
  'abrir_incidencia' | 'cancelar_compra' | 'confirm' | 'claim' | 'refund' | 'cancelar_venta' |
  'registrar_gasto_ensayo' | 'registrar_devolucion' | 'resolver_incidencia';

export interface DatosTransaccionComercial {
  accion: AccionComercial;
  lote_id: string;
  orden_id?: string;
  evidencia_hash?: string;
  evidencia_id?: string;
  motivo?: string;
  costo?: string;
  comprobante_hash?: string;
  reembolsar?: boolean;
  total_esperado?: string;
  analisis_id_esperado?: string;
  version_esperada?: number;
}

/** La orden se comprueba en el servidor; la wallet firma y la red decide el resultado. */
export function useTransaccionComercial() {
  const firma = useFirmaConWallet();
  const solicitar = async <T,>(ruta: string, json: unknown): Promise<T> => {
    try { return await api<T>(ruta, { json, notificarSesion: false }); }
    catch (error) {
      if (error instanceof ErrorApi && error.estado === 401) window.dispatchEvent(new Event('sesion-comercial-vencida'));
      throw error;
    }
  };
  const ejecutar = (datos: DatosTransaccionComercial) => firma.ejecutar(
    (cuenta) => solicitar<{ xdr: string; preparacion_id: string }>('/mercado/comercial/preparar', { ...datos, cuenta }),
    (xdr, cuenta, preparado) => solicitar<ResultadoTransaccion>('/mercado/comercial/enviar', { ...datos, cuenta, xdr, preparacion_id: preparado.preparacion_id }),
  );
  return { ...firma, ejecutar };
}
