import { useEffect, useState } from 'react';
import { api, ErrorApi } from './api.ts';
import { ErrorWallet, useWallet } from './wallet.tsx';

export type EstadoLote = 'Certificado' | 'EnVenta' | 'EnGarantia' | 'EnDisputa' | 'Vendido';
export type AccionMercado = 'list_batch' | 'buy' | 'confirm' | 'refund' | 'claim';

export interface InfoToken {
  contrato: string;
  simbolo: string;
  decimales: number;
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
  const [resultado, setResultado] = useState<ResultadoTransaccion | null>(null);

  const ejecutar = async <P extends { xdr?: string }>(
    preparar: (cuenta: string) => Promise<P>,
    enviar: (xdrFirmado: string, cuenta: string, preparado: P) => Promise<ResultadoTransaccion>,
  ): Promise<ResultadoTransaccion | null> => {
    setError(null);
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
      setError(e instanceof ErrorApi || e instanceof ErrorWallet ? e.message : 'Error inesperado al procesar la transacción');
      setPaso('error');
      return null;
    }
  };

  const reiniciar = () => {
    setPaso('inactivo');
    setError(null);
    setResultado(null);
  };

  return { paso, error, resultado, ejecutar, reiniciar, ocupado: paso === 'preparando' || paso === 'firmando' || paso === 'enviando' };
}

/** Acción del marketplace firmada por la wallet del vendedor o del comprador. */
export function useTransaccion() {
  const firma = useFirmaConWallet();
  const ejecutar = (accion: AccionMercado, loteId: string, precio?: string) =>
    firma.ejecutar(
      (cuenta) => api<{ xdr: string }>('/mercado/transacciones', { json: { accion, cuenta, lote_id: loteId, precio } }),
      (xdr, cuenta) => api<ResultadoTransaccion>('/mercado/transacciones/enviar', { json: { accion, cuenta, xdr } }),
    );
  return { ...firma, ejecutar };
}
