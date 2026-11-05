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
