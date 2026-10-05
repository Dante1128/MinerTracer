import { useEffect, useState } from 'react';
import { api, ErrorApi } from './api.ts';
import { ErrorWallet, useWallet } from './wallet.tsx';

export type EstadoLote = 'Certificado' | 'EnVenta' | 'EnGarantia' | 'EnDisputa' | 'Vendido';
export type AccionMercado = 'list_batch' | 'buy' | 'confirm' | 'refund';

export interface InfoToken {
  contrato: string;
  simbolo: string;
  decimales: number;
}

export type InfoMercado =
  | { habilitado: false }
  | { habilitado: true; contrato_id: string; red: string; passphrase: string; token: InfoToken; tolerancia_bps: number };

export interface Venta {
  vendedor: string;
  /** En unidades mínimas del token (texto: puede superar Number.MAX_SAFE_INTEGER). */
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
 * Ejecuta una acción del marketplace: el servidor arma la transacción, la
 * wallet conectada la firma y el servidor la envía y espera la confirmación.
 */
export function useTransaccion() {
  const wallet = useWallet();
  const [paso, setPaso] = useState<PasoTransaccion>('inactivo');
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoTransaccion | null>(null);

  const ejecutar = async (accion: AccionMercado, loteId: string, precio?: string): Promise<ResultadoTransaccion | null> => {
    setError(null);
    setResultado(null);
    try {
      if (!wallet.direccion) throw new ErrorWallet('Conecte su wallet Freighter para continuar.');
      if (!wallet.redCorrecta) throw new ErrorWallet(`Freighter está en ${wallet.red ?? 'otra red'}. Cambie a Testnet en la extensión.`);
      setPaso('preparando');
      const { xdr } = await api<{ xdr: string }>('/mercado/transacciones', {
        json: { accion, cuenta: wallet.direccion, lote_id: loteId, precio },
      });
      setPaso('firmando');
      const firmado = await wallet.firmar(xdr);
      setPaso('enviando');
      const r = await api<ResultadoTransaccion>('/mercado/transacciones/enviar', {
        json: { accion, cuenta: wallet.direccion, xdr: firmado },
      });
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
