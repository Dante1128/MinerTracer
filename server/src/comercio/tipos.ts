import type { EstadoComercial, InfoToken } from '../mercado/mercado.ts';

/** Los importes humanos y las unidades mínimas se transportan como texto. */
export type TipoParticipante = 'productor' | 'cooperativa' | 'comprador';
export type TipoAnuncio = 'compra' | 'venta';
export interface PerfilPublico {
  cuenta: string;
  nombre: string;
  organizacion: string;
  tipo: TipoParticipante;
  zona: string;
  /** Es una declaración del participante, no una acreditación institucional. */
  verificado: false;
}
export interface PerfilComercial extends PerfilPublico {
  contacto: string;
  documento_ref: string;
  actualizado_en: string;
}
export interface EntradaAnuncio {
  tipo: TipoAnuncio;
  mineral: string;
  zona: string;
  cantidad: string;
  precio: string;
  lote_id?: string | null;
  vence: string;
  condiciones?: string;
  punto_entrega?: string;
  gastos_ensayo?: string;
  gastos_traslado?: string;
  oferta_externa_neta?: string | null;
  plazo_pago?: string;
}
export interface AnuncioComercial extends Omit<EntradaAnuncio, 'lote_id' | 'condiciones' | 'punto_entrega' | 'gastos_ensayo' | 'gastos_traslado' | 'oferta_externa_neta' | 'plazo_pago'> {
  id: string;
  cuenta: string;
  lote_id: string | null;
  condiciones: string;
  punto_entrega: string;
  gastos_ensayo: string;
  gastos_traslado: string;
  oferta_externa_neta: string | null;
  plazo_pago: string;
  estado: 'abierto' | 'cerrado' | 'aceptado';
  vigente: boolean;
  creado_en: string;
  perfil: PerfilPublico | null;
  token: InfoToken;
}
export interface EntradaOferta {
  precio: string;
  lote_id?: string | null;
  condiciones?: string;
  gastos_ensayo?: string;
  gastos_traslado?: string;
  punto_entrega?: string;
  plazo_pago?: string;
  vence?: string;
}
export interface OfertaComercial extends Omit<EntradaOferta, 'lote_id' | 'condiciones' | 'gastos_ensayo' | 'gastos_traslado' | 'punto_entrega' | 'plazo_pago' | 'vence'> {
  id: string;
  anuncio_id: string;
  cuenta: string;
  proponente: string;
  destinatario: string;
  oferta_anterior_id: string | null;
  lote_id: string | null;
  condiciones: string;
  gastos_ensayo: string;
  gastos_traslado: string;
  punto_entrega: string;
  plazo_pago: string;
  vence: string;
  estado: 'pendiente' | 'aceptada' | 'rechazada';
  vigente: boolean;
  creado_en: string;
  perfil: PerfilPublico | null;
}
export interface PoliticaComercial {
  disponible: boolean;
  origen: 'contrato' | 'orientativa';
  version: number;
  comision_bps: number;
  comision_minima: string;
  reintegro_bps: number;
  reintegro_maximo: string;
  token: InfoToken | null;
  destinatario_plataforma: string | null;
  /** Segundos fijados por el contrato; null cuando la política es orientativa. */
  plazo_entrega_seg: string | null;
  plazo_garantia_seg: string | null;
  mensaje: string;
}
export interface CotizacionComercial {
  orientativa: true;
  precio: string;
  comision: string;
  total_comprador: string;
  gastos_ensayo: string;
  gastos_traslado: string;
  neto_vendedor_sin_reintegro: string;
  reintegro_maximo_estimado: string;
  /** Sin acreditación institucional no se promete un reintegro. */
  reintegro_acreditado: string;
  diferencia_oferta_externa: string | null;
  unidades: { precio: string; comision: string; total_comprador: string; reintegro_maximo_estimado: string };
}
export interface OrdenComercial {
  id: string;
  orden_id: string;
  anuncio_id: string;
  oferta_id: string;
  lote_id: string;
  vendedor: string;
  comprador: string;
  precio: string;
  precio_unidades: string;
  comision_unidades: string;
  condiciones_hash: string;
  condiciones: { condiciones: string; punto_entrega: string; plazo_pago: string; gastos_ensayo: string; gastos_traslado: string };
  token: InfoToken;
  politica: PoliticaComercial;
  /** Estado del acuerdo de negociación; el pago y el escrow se consultan al contrato. */
  estado: 'pendiente_firma';
  creado_en: string;
  vence: string;
  cotizacion: CotizacionComercial;
}
export interface EvidenciaComercial {
  id: string;
  operacion_id: string;
  cuenta: string;
  tipo: 'origen' | 'entrega' | 'devolucion' | 'ensayo' | 'decision';
  referencia: string;
  descripcion: string;
  hash: string;
  creado_en: string;
  /** La huella protege lo declarado; no acredita por sí misma un hecho físico. */
  alcance: 'declarada';
}
export interface DetalleOperacion {
  cancelada_en_cadena?: boolean;
  operacion: OrdenComercial;
  cadena: EstadoComercial | null;
  venta_comercial: unknown | null;
  liquidacion: unknown | null;
  evidencias: EvidenciaComercial[];
}
export interface SesionComercial {
  cuenta: string | null;
  perfil: PerfilComercial | null;
}
