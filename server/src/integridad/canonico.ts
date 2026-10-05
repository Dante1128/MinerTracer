import crypto from 'node:crypto';
import canonicalize from 'canonicalize';

/** Versión del formato del registro canónico. Cambiarla exige mantener el constructor anterior. */
export const VERSION_ESQUEMA = '1';

export interface RegistroCanonico {
  version_esquema: string;
  analisis_id: string;
  version: number;
  hash_anterior: string | null;
  motivo_correccion: string | null;
  laboratorio_id: string;
  lote_id: string;
  lote: {
    tipo_mineral: string;
    peso_kg: string;
    origen: string;
    coordenadas: string | null;
  };
  fecha_analisis: string;
  metodo: string;
  pureza: string;
  composicion: Record<string, string>;
  observaciones: string;
  pdf_sha256: string;
  salt: string;
}

/** Filas de la base de datos (o datos validados) necesarias para reconstruir el registro. */
export interface DatosAnalisis {
  version_esquema: string;
  analisis_id: string;
  version: number;
  hash_anterior: string | null;
  motivo_correccion: string | null;
  laboratorio_id: string;
  lote_id: string;
  fecha_analisis: string;
  metodo: string;
  pureza: string;
  composicion: Record<string, string>;
  observaciones: string;
  pdf_sha256: string;
  salt: string;
}

export interface DatosLote {
  tipo_mineral: string;
  peso_kg: string;
  origen: string;
  coordenadas: string | null;
}

export function construirRegistro(a: DatosAnalisis, lote: DatosLote): RegistroCanonico {
  if (a.version_esquema !== VERSION_ESQUEMA) {
    throw new Error(`Versión de esquema no soportada: ${a.version_esquema}`);
  }
  return {
    version_esquema: a.version_esquema,
    analisis_id: a.analisis_id,
    version: a.version,
    hash_anterior: a.hash_anterior ?? null,
    motivo_correccion: a.motivo_correccion ?? null,
    laboratorio_id: a.laboratorio_id,
    lote_id: a.lote_id,
    lote: {
      tipo_mineral: lote.tipo_mineral,
      peso_kg: lote.peso_kg,
      origen: lote.origen,
      coordenadas: lote.coordenadas ?? null,
    },
    fecha_analisis: a.fecha_analisis,
    metodo: a.metodo,
    pureza: a.pureza,
    composicion: a.composicion,
    observaciones: a.observaciones,
    pdf_sha256: a.pdf_sha256,
    salt: a.salt,
  };
}

/**
 * Registro canónico de un contra-análisis (marketplace). Es un tipo aparte,
 * distinguido por `tipo`, que no altera el formato del registro de análisis.
 */
export interface RegistroContraAnalisis {
  tipo: 'contra_analisis';
  version_esquema: string;
  lote_id: string;
  laboratorio_id: string;
  fecha_analisis: string;
  metodo: string;
  pureza: string;
  composicion: Record<string, string>;
  observaciones: string;
  pdf_sha256: string;
  salt: string;
}

export function construirRegistroContraAnalisis(c: Omit<RegistroContraAnalisis, 'tipo'>): RegistroContraAnalisis {
  if (c.version_esquema !== VERSION_ESQUEMA) {
    throw new Error(`Versión de esquema no soportada: ${c.version_esquema}`);
  }
  return {
    tipo: 'contra_analisis',
    version_esquema: c.version_esquema,
    lote_id: c.lote_id,
    laboratorio_id: c.laboratorio_id,
    fecha_analisis: c.fecha_analisis,
    metodo: c.metodo,
    pureza: c.pureza,
    composicion: c.composicion,
    observaciones: c.observaciones,
    pdf_sha256: c.pdf_sha256,
    salt: c.salt,
  };
}

/** Serialización JCS (RFC 8785): claves ordenadas, sin espacios, números normalizados. */
export function canonicalizar(registro: RegistroCanonico | RegistroContraAnalisis): string {
  const texto = canonicalize(registro);
  if (texto === undefined) throw new Error('Registro no serializable');
  return texto;
}

export function sha256Hex(contenido: string | Uint8Array): string {
  return crypto.createHash('sha256').update(contenido).digest('hex');
}

export function hashRegistro(registro: RegistroCanonico | RegistroContraAnalisis): string {
  return sha256Hex(canonicalizar(registro));
}

export function nuevoSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}
