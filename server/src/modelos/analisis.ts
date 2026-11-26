import type { Consultas } from '../db/index.ts';

/** Modelo: acceso a datos de la tabla `analisis` (ver ../db/esquema.ts). */

export interface DatosAnalisisFila {
  analisis_id: string;
  version: number;
  lote_id: string;
  laboratorio_id: string;
  analista_id: number;
  fecha_analisis: string;
  metodo: string;
  pureza: string;
  composicion: unknown;
  observaciones: string;
  pdf_sha256: string;
  salt: string;
  version_esquema: string;
  hash_anterior: string | null;
  motivo_correccion: string | null;
  hash: string;
  pdf_nombre: string;
  firma_servidor: boolean;
}

/** Solo la versión vigente (la más alta) de cada análisis del laboratorio. */
export function listarVigentesPorLaboratorio(db: Consultas, laboratorioId: string) {
  return db.query(
    `SELECT DISTINCT ON (a.analisis_id) a.*, l.tipo_mineral, l.origen, u.nombre AS analista_nombre
     FROM analisis a JOIN lotes l ON l.id = a.lote_id JOIN usuarios u ON u.id = a.analista_id
     WHERE a.laboratorio_id = $1
     ORDER BY a.analisis_id DESC, a.version DESC`,
    [laboratorioId],
  );
}

/** Todas las versiones de un análisis del laboratorio, de la más antigua a la más reciente. */
export function listarVersiones(db: Consultas, analisisId: string, laboratorioId: string) {
  return db.query(
    `SELECT a.*, u.nombre AS analista_nombre FROM analisis a JOIN usuarios u ON u.id = a.analista_id
     WHERE a.analisis_id = $1 AND a.laboratorio_id = $2 ORDER BY a.version`,
    [analisisId, laboratorioId],
  );
}

/** Todas las versiones de los análisis de un lote (cualquier laboratorio), para el verificador público. */
export function listarPorLote(db: Consultas, loteId: string) {
  return db.query(
    `SELECT a.*, u.nombre AS analista_nombre FROM analisis a JOIN usuarios u ON u.id = a.analista_id
     WHERE a.lote_id = $1 ORDER BY a.analisis_id, a.version`,
    [loteId],
  );
}

export async function buscarVersion(db: Consultas, analisisId: string, version: number) {
  const [fila] = await db.query('SELECT * FROM analisis WHERE analisis_id = $1 AND version = $2', [analisisId, version]);
  return fila ?? null;
}

export async function buscarVersionDeLaboratorio(db: Consultas, analisisId: string, version: number, laboratorioId: string) {
  const [fila] = await db.query(
    'SELECT * FROM analisis WHERE analisis_id = $1 AND version = $2 AND laboratorio_id = $3',
    [analisisId, version, laboratorioId],
  );
  return fila ?? null;
}

export async function buscarUltimaVersion(db: Consultas, analisisId: string) {
  const [fila] = await db.query('SELECT * FROM analisis WHERE analisis_id = $1 ORDER BY version DESC LIMIT 1', [analisisId]);
  return fila ?? null;
}

export async function buscarUltimaVersionDeLaboratorio(db: Consultas, analisisId: string, laboratorioId: string) {
  const [fila] = await db.query(
    'SELECT * FROM analisis WHERE analisis_id = $1 AND laboratorio_id = $2 ORDER BY version DESC LIMIT 1',
    [analisisId, laboratorioId],
  );
  return fila ?? null;
}

export async function siguienteCodigo(db: Consultas, anio: number) {
  const [{ n }] = await db.query<{ n: number }>("SELECT nextval('seq_analisis') AS n");
  return `AN-${anio}-${String(n).padStart(4, '0')}`;
}

export async function insertar(db: Consultas, datos: DatosAnalisisFila) {
  const [fila] = await db.query(
    `INSERT INTO analisis (analisis_id, version, lote_id, laboratorio_id, analista_id, fecha_analisis,
       metodo, pureza, composicion, observaciones, pdf_sha256, salt, version_esquema, hash_anterior,
       motivo_correccion, hash, pdf_nombre, firma_servidor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING *`,
    [
      datos.analisis_id, datos.version, datos.lote_id, datos.laboratorio_id, datos.analista_id,
      datos.fecha_analisis, datos.metodo, datos.pureza, JSON.stringify(datos.composicion),
      datos.observaciones, datos.pdf_sha256, datos.salt, datos.version_esquema,
      datos.hash_anterior, datos.motivo_correccion, datos.hash, datos.pdf_nombre, datos.firma_servidor,
    ],
  );
  return fila;
}
