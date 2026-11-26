import type { EstadoComercial, InfoToken, VentaComercial, LiquidacionComercial } from './mercado.ts';

export type TipoParticipante = 'productor' | 'cooperativa' | 'comprador';
export interface PerfilPublico { cuenta: string; nombre: string; organizacion: string; tipo: TipoParticipante; zona: string; verificado: false }
export interface PerfilComercial extends PerfilPublico { contacto: string; documento_ref: string; actualizado_en: string }
export interface EntradaAnuncio {
  tipo: 'compra' | 'venta'; mineral: string; zona: string; cantidad: string; precio: string; lote_id?: string | null;
  vence: string; condiciones?: string; punto_entrega?: string; gastos_ensayo?: string; gastos_traslado?: string;
  oferta_externa_neta?: string | null; plazo_pago?: string;
}
export interface AnuncioComercial extends EntradaAnuncio {
  id: string; cuenta: string; lote_id: string | null; estado: 'abierto' | 'cerrado' | 'aceptado'; vigente: boolean;
  creado_en: string; perfil: PerfilPublico | null; token: InfoToken;
}
export interface EntradaOferta {
  precio: string; lote_id?: string | null; condiciones?: string; gastos_ensayo?: string; gastos_traslado?: string;
  punto_entrega?: string; plazo_pago?: string; vence?: string;
}
export interface OfertaComercial extends EntradaOferta {
  id: string; anuncio_id: string; cuenta: string; lote_id: string | null; estado: 'pendiente' | 'aceptada' | 'rechazada';
  vigente: boolean; creado_en: string; perfil: PerfilPublico | null; proponente: string; destinatario: string; oferta_anterior_id: string | null;
}
export interface PoliticaComercial {
  disponible: boolean; origen: 'contrato' | 'orientativa'; version: number; comision_bps: number; comision_minima: string;
  reintegro_bps: number; reintegro_maximo: string; token: InfoToken | null; destinatario_plataforma: string | null; mensaje: string;
  plazo_entrega_seg: string | null; plazo_garantia_seg: string | null;
}
export interface CotizacionComercial {
  orientativa: true; precio: string; comision: string; total_comprador: string; gastos_ensayo: string; gastos_traslado: string;
  neto_vendedor_sin_reintegro: string; reintegro_maximo_estimado: string; reintegro_acreditado: string;
  diferencia_oferta_externa: string | null;
  unidades: { precio: string; comision: string; total_comprador: string; reintegro_maximo_estimado: string };
}
export interface OrdenComercial {
  id: string; orden_id: string; anuncio_id: string; oferta_id: string; lote_id: string; vendedor: string; comprador: string;
  precio: string; precio_unidades: string; comision_unidades: string; condiciones_hash: string;
  condiciones: { condiciones: string; punto_entrega: string; plazo_pago: string; gastos_ensayo: string; gastos_traslado: string };
  token: InfoToken; politica: PoliticaComercial; estado: 'pendiente_firma'; creado_en: string; vence: string; cotizacion: CotizacionComercial;
}
export interface EvidenciaComercial {
  id: string; operacion_id: string; cuenta: string; tipo: 'origen' | 'entrega' | 'devolucion' | 'ensayo' | 'decision'; referencia: string;
  descripcion: string; hash: string; creado_en: string; alcance: 'declarada';
}
export interface DetalleOperacionComercial {
  cancelada_en_cadena?: boolean;
  operacion: OrdenComercial; cadena: EstadoComercial | null;
  venta_comercial: VentaComercial | null; liquidacion: LiquidacionComercial | null; evidencias: EvidenciaComercial[];
}

export type EstadoVerificacion = 'integro' | 'alterado' | 'pendiente' | 'error';

export interface Usuario {
  id: number;
  email: string;
  nombre: string;
  rol: 'analista' | 'supervisor';
  laboratorio_id: string;
}

export interface UsuarioGestionado extends Usuario { activo: boolean; }
export interface RespuestaSesion { usuario: Usuario; csrf: string; }
export interface RespuestaCuenta { mensaje: string; csrf?: string; }

export interface Lote {
  id: string;
  tipo_mineral: string;
  peso_kg: string;
  origen: string;
  coordenadas: string | null;
  /** Cuenta Stellar del dueño indicada al registrar el lote (null: a nombre del laboratorio). */
  dueno?: string | null;
  creado_en: string;
  total_analisis?: number;
}

export interface Analisis {
  analisis_id: string;
  version: number;
  lote_id: string;
  laboratorio_id: string;
  analista_nombre: string;
  fecha_analisis: string;
  metodo: string;
  pureza: string;
  composicion: Record<string, string>;
  observaciones: string;
  pdf_nombre: string;
  pdf_sha256: string;
  hash: string;
  hash_anterior: string | null;
  motivo_correccion: string | null;
  estado_anclaje: 'pendiente' | 'anclado';
  /** La firma el servidor (semilla); si no, la firma el laboratorio con su wallet. */
  firma_servidor?: boolean;
  tx_id: string | null;
  fecha_anclaje: string | null;
  creado_en: string;
  intentos_anclaje?: number;
  ultimo_error?: string | null;
  tipo_mineral?: string;
  origen?: string;
}

export interface Verificacion {
  estado: EstadoVerificacion;
  motivos: string[];
  hash_recalculado: string;
  hash_anclado: string | null;
  comprobaciones: { datos: boolean | null; firma: boolean | null; pdf: boolean };
  anclaje: {
    tx_id: string;
    fecha: string;
    cuenta: string;
    cuenta_laboratorio: string;
    url_explorador: string | null;
    red: string;
  } | null;
  registro_canonico: string;
}

export type AnalisisVerificado = Analisis & { verificacion: Verificacion };

export interface ResultadoLote {
  lote: Lote;
  laboratorio: { id: string; nombre: string; cuenta_publica: string; acreditaciones: string[] };
  analisis: { analisis_id: string; vigente: AnalisisVerificado; versiones: AnalisisVerificado[] }[];
}

export interface InfoServidor {
  anclaje: string;
  /** "simulada" (ANCLAJE=mock) o "testnet". */
  red: string;
  contrato_id: string | null;
  /** "wallet": el laboratorio firma sus análisis con Freighter. */
  firma_laboratorio: 'wallet' | 'servidor';
  motor_db: string;
  demo_alterar: boolean;
}

export class ErrorApi extends Error {
  estado: number;
  errores: Record<string, string>;
  constructor(estado: number, mensaje: string, errores: Record<string, string> = {}) {
    super(mensaje);
    this.estado = estado;
    this.errores = errores;
  }
}

let alExpirarSesion: () => void = () => {};
export const onSesionExpirada = (fn: () => void) => {
  alExpirarSesion = fn;
};

export async function api<T>(ruta: string, opciones: { metodo?: string; json?: unknown; form?: FormData; notificarSesion?: boolean } = {}, reintentarCsrf = true): Promise<T> {
  const headers: Record<string, string> = {};
  const metodo = opciones.metodo ?? (opciones.json !== undefined || opciones.form ? 'POST' : 'GET');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(metodo)) headers['X-CSRF-Token'] = await obtenerCsrf();
  if (opciones.json !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${ruta}`, {
      method: metodo,
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      body: opciones.form ?? (opciones.json !== undefined ? JSON.stringify(opciones.json) : undefined),
    });
  } catch {
    throw new ErrorApi(0, 'No hay conexión con el servidor');
  }

  const cuerpo = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (typeof cuerpo?.csrf === 'string') consultaCsrf = Promise.resolve(cuerpo.csrf);
  if (!res.ok) {
    // Otra pestaña puede haber rotado la sesión. Solo repetimos un rechazo anterior a la operación.
    if (res.status === 403 && cuerpo?.codigo === 'CSRF_INVALIDO' && reintentarCsrf) {
      consultaCsrf = null;
      return api<T>(ruta, opciones, false);
    }
    if (res.status === 401 && ruta !== '/auth/login' && opciones.notificarSesion !== false) alExpirarSesion();
    throw new ErrorApi(res.status, cuerpo?.error ?? `Error ${res.status}`, cuerpo?.errores);
  }
  return cuerpo as T;
}

let consultaCsrf: Promise<string> | null = null;
async function obtenerCsrf(): Promise<string> {
  consultaCsrf ??= fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    .then(async (respuesta) => {
      if (!respuesta.ok) throw new ErrorApi(respuesta.status, 'No se pudo preparar la solicitud');
      const cuerpo = await respuesta.json();
      return cuerpo.csrf as string;
    }).catch(() => { consultaCsrf = null; throw new ErrorApi(0, 'No se pudo conectar con el servidor'); });
  return consultaCsrf;
}
