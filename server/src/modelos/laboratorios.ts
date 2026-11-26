import type { Consultas } from '../db/index.ts';

/** Modelo: acceso a datos de la tabla `laboratorios` (ver ../db/esquema.ts). */

export async function buscarPorId(db: Consultas, id: string) {
  const [fila] = await db.query('SELECT * FROM laboratorios WHERE id = $1', [id]);
  return fila ?? null;
}

export async function buscarResumen(db: Consultas, id: string) {
  const [fila] = await db.query(
    'SELECT id, nombre, cuenta_publica, acreditaciones FROM laboratorios WHERE id = $1',
    [id],
  );
  return fila ?? null;
}

export async function buscarCuentaPublica(db: Consultas, id: string) {
  const [fila] = await db.query<{ id: string; cuenta_publica: string }>(
    'SELECT id, cuenta_publica FROM laboratorios WHERE id = $1',
    [id],
  );
  return fila ?? null;
}

export function listarTodos(db: Consultas) {
  return db.query<{ id: string; nombre: string; cuenta_publica: string }>('SELECT id, nombre, cuenta_publica FROM laboratorios');
}

/** Bloquea la fila dentro de una transacción (sin leerla) para serializar su administración. */
export function bloquearPorId(conexion: Consultas, id: string) {
  return conexion.query('SELECT id FROM laboratorios WHERE id = $1 FOR UPDATE', [id]);
}
