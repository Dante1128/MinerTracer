export type EstadoVerificacion = 'integro' | 'alterado' | 'pendiente' | 'error';

export interface Usuario {
  id: number;
  email: string;
  nombre: string;
  rol: 'analista' | 'supervisor';
  laboratorio_id: string;
}

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

const CLAVE_TOKEN = 'minertrace.token';

export const token = {
  leer: () => {
    try {
      return localStorage.getItem(CLAVE_TOKEN);
    } catch {
      return null;
    }
  },
  guardar: (valor: string | null) => {
    try {
      if (valor) localStorage.setItem(CLAVE_TOKEN, valor);
      else localStorage.removeItem(CLAVE_TOKEN);
    } catch {
      // Sin almacenamiento: la sesión dura lo que la pestaña.
    }
  },
};

let alExpirarSesion: () => void = () => {};
export const onSesionExpirada = (fn: () => void) => {
  alExpirarSesion = fn;
};

export async function api<T>(ruta: string, opciones: { metodo?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token.leer();
  if (t) headers.authorization = `Bearer ${t}`;
  if (opciones.json !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${ruta}`, {
      method: opciones.metodo ?? (opciones.json || opciones.form ? 'POST' : 'GET'),
      headers,
      body: opciones.form ?? (opciones.json !== undefined ? JSON.stringify(opciones.json) : undefined),
    });
  } catch {
    throw new ErrorApi(0, 'No hay conexión con el servidor');
  }

  const cuerpo = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && t) alExpirarSesion();
    throw new ErrorApi(res.status, cuerpo?.error ?? `Error ${res.status}`, cuerpo?.errores);
  }
  return cuerpo as T;
}
