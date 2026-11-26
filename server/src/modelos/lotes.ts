import type { Consultas } from '../db/index.ts';

/** Modelo: acceso a datos de la tabla `lotes` (ver ../db/esquema.ts). */

export interface DatosLote {
  id: string;
  laboratorio_id: string;
  tipo_mineral: string;
  peso_kg: string;
  origen: string;
  coordenadas: string | null;
  creado_por: number;
  dueno: string | null;
}

export async function buscarPorId(db: Consultas, id: string) {
  const [fila] = await db.query('SELECT * FROM lotes WHERE id = $1', [id]);
  return fila ?? null;
}

export async function existe(db: Consultas, id: string) {
  const [fila] = await db.query('SELECT 1 FROM lotes WHERE id = $1', [id]);
  return fila != null;
}

export async function buscarResumenComercial(db: Consultas, id: string) {
  const [fila] = await db.query(
    'SELECT id, tipo_mineral, origen, peso_kg FROM lotes WHERE id = $1',
    [id],
  );
  return fila ?? null;
}

export function listarPorIds(db: Consultas, ids: string[]) {
  return db.query<{ id: string; tipo_mineral: string; origen: string; peso_kg: string }>(
    'SELECT id, tipo_mineral, origen, peso_kg FROM lotes WHERE id = ANY($1)',
    [ids],
  );
}

export function listarIds(db: Consultas) {
  return db.query<{ id: string }>('SELECT id FROM lotes ORDER BY creado_en DESC');
}

export function listarPorLaboratorioConTotales(db: Consultas, laboratorioId: string) {
  return db.query(
    `SELECT l.*, COUNT(DISTINCT a.analisis_id)::int AS total_analisis
     FROM lotes l LEFT JOIN analisis a ON a.lote_id = l.id
     WHERE l.laboratorio_id = $1 GROUP BY l.id ORDER BY l.creado_en DESC`,
    [laboratorioId],
  );
}

export async function siguienteCodigo(db: Consultas, anio: number) {
  const [{ n }] = await db.query<{ n: number }>("SELECT nextval('seq_lote') AS n");
  return `LT-${anio}-${String(n).padStart(4, '0')}`;
}

export async function crear(db: Consultas, datos: DatosLote) {
  const [lote] = await db.query(
    `INSERT INTO lotes (id, laboratorio_id, tipo_mineral, peso_kg, origen, coordenadas, creado_por, dueno)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [datos.id, datos.laboratorio_id, datos.tipo_mineral, datos.peso_kg, datos.origen, datos.coordenadas, datos.creado_por, datos.dueno],
  );
  return lote;
}
