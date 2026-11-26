import type { Consultas } from '../db/index.ts';

/** Modelo: acceso a datos de la tabla `usuarios` (ver ../db/esquema.ts). */

export const CAMPOS_PUBLICOS = 'id, email, nombre, rol, laboratorio_id, activo';

export async function buscarPorEmail(db: Consultas, email: string) {
  const [fila] = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
  return fila ?? null;
}

export function listarPorLaboratorio(db: Consultas, laboratorioId: string) {
  return db.query(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE laboratorio_id = $1 ORDER BY nombre, id`, [laboratorioId]);
}

export interface DatosUsuario {
  email: string;
  nombre: string;
  rol: 'analista' | 'supervisor';
  laboratorio_id: string;
  password_hash: string;
}

/** `null` si ya existe una cuenta con ese correo. */
export async function crear(conexion: Consultas, datos: DatosUsuario) {
  const [fila] = await conexion.query(
    `INSERT INTO usuarios (email, nombre, rol, laboratorio_id, password_hash) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO NOTHING RETURNING ${CAMPOS_PUBLICOS}, revision_acceso`,
    [datos.email, datos.nombre, datos.rol, datos.laboratorio_id, datos.password_hash],
  );
  return fila ?? null;
}

/** Bloquea y devuelve la cuenta del laboratorio, dentro de una transacción, para administrarla. */
export async function bloquearPorIdYLaboratorio(conexion: Consultas, id: number, laboratorioId: string) {
  const [fila] = await conexion.query('SELECT * FROM usuarios WHERE id = $1 AND laboratorio_id = $2 FOR UPDATE', [id, laboratorioId]);
  return fila ?? null;
}

/** Bloquea y devuelve la cuenta activa, dentro de una transacción (cambio de contraseña propio). */
export async function bloquearActivoPorId(conexion: Consultas, id: number) {
  const [fila] = await conexion.query('SELECT * FROM usuarios WHERE id = $1 AND activo FOR UPDATE', [id]);
  return fila ?? null;
}

/** Comprueba que el actor siga siendo supervisor activo del laboratorio, bloqueando la fila. */
export async function bloquearSupervisorActivo(conexion: Consultas, id: number, laboratorioId: string) {
  const [fila] = await conexion.query(
    "SELECT id FROM usuarios WHERE id = $1 AND laboratorio_id = $2 AND activo AND rol = 'supervisor' FOR UPDATE",
    [id, laboratorioId],
  );
  return fila ?? null;
}

export function actualizarEstado(conexion: Consultas, id: number, activo: boolean) {
  return conexion.query('UPDATE usuarios SET activo = $2 WHERE id = $1', [id, activo]);
}

export function actualizarRol(conexion: Consultas, id: number, rol: 'analista' | 'supervisor') {
  return conexion.query('UPDATE usuarios SET rol = $2 WHERE id = $1', [id, rol]);
}

export function actualizarPassword(conexion: Consultas, id: number, hash: string) {
  return conexion.query('UPDATE usuarios SET password_hash = $2 WHERE id = $1', [id, hash]);
}
