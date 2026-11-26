import type { Consultas } from '../db/index.ts';

/** Modelo: acceso a datos de la tabla `contra_analisis` (ver ../db/esquema.ts). */

export interface DatosContraAnalisis {
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
  hash: string;
  pdf_nombre: string;
  tx_id: string;
  fecha_anclaje: string;
}

/** Contra-análisis de un lote, con el nombre del laboratorio y del analista, del más antiguo al más reciente. */
export function listarPorLote(db: Consultas, loteId: string) {
  return db.query(
    `SELECT c.*, l.nombre AS laboratorio_nombre, l.cuenta_publica, u.nombre AS analista_nombre
     FROM contra_analisis c JOIN laboratorios l ON l.id = c.laboratorio_id JOIN usuarios u ON u.id = c.analista_id
     WHERE c.lote_id = $1 ORDER BY c.id`,
    [loteId],
  );
}

export async function buscarPorId(db: Consultas, id: number) {
  const [fila] = await db.query('SELECT * FROM contra_analisis WHERE id = $1', [id]);
  return fila ?? null;
}

export async function crear(db: Consultas, datos: DatosContraAnalisis) {
  const [fila] = await db.query(
    `INSERT INTO contra_analisis (lote_id, laboratorio_id, analista_id, fecha_analisis, metodo, pureza, composicion,
       observaciones, pdf_sha256, salt, version_esquema, hash, pdf_nombre, tx_id, fecha_anclaje)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
    [
      datos.lote_id, datos.laboratorio_id, datos.analista_id, datos.fecha_analisis, datos.metodo, datos.pureza,
      JSON.stringify(datos.composicion), datos.observaciones, datos.pdf_sha256, datos.salt,
      datos.version_esquema, datos.hash, datos.pdf_nombre, datos.tx_id, datos.fecha_anclaje,
    ],
  );
  return fila;
}
