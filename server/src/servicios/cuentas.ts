import bcrypt from 'bcryptjs';
import { hashSecreto, secretoAleatorio } from '../auth.ts';
import { ErrorHttp, type Usuario } from '../contexto.ts';
import { encolarAcceso } from '../correo.ts';
import type { Consultas, Db } from '../db/index.ts';
import * as laboratorios from '../modelos/laboratorios.ts';
import * as usuarios from '../modelos/usuarios.ts';
import { ErrorValidacion } from '../validacion.ts';

export const emailNormalizado = (valor: unknown) => typeof valor === 'string' ? valor.trim().toLowerCase() : '';

export function validarClave(valor: unknown): string {
  if (typeof valor !== 'string' || valor.length < 12 || Buffer.byteLength(valor, 'utf8') > 72) {
    throw new ErrorValidacion({ password: 'Use al menos 12 caracteres y como máximo 72 bytes' });
  }
  return valor;
}

export function validarUsuario(entrada: Record<string, unknown>) {
  const email = emailNormalizado(entrada.email);
  const nombre = typeof entrada.nombre === 'string' ? entrada.nombre.trim().normalize('NFC') : '';
  const rol = entrada.rol;
  const errores: Record<string, string> = {};
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errores.email = 'Ingrese un correo válido';
  if (!nombre || nombre.length > 120) errores.nombre = 'Ingrese un nombre de hasta 120 caracteres';
  if (rol !== 'analista' && rol !== 'supervisor') errores.rol = 'Seleccione analista o supervisor';
  if (Object.keys(errores).length) throw new ErrorValidacion(errores);
  return { email, nombre, rol: rol as Usuario['rol'] };
}

export async function revocarAcceso(db: Consultas, id: number) {
  await db.query('UPDATE usuarios SET revision_acceso = revision_acceso + 1 WHERE id = $1', [id]);
  await db.query('DELETE FROM sesiones WHERE usuario_id = $1', [id]);
  await db.query('DELETE FROM recuperaciones WHERE usuario_id = $1', [id]);
  await db.query('DELETE FROM correos_pendientes WHERE usuario_id = $1', [id]);
}

export async function emitirRecuperacion(db: Consultas, usuario: { id: number; email: string; revision_acceso: number }) {
  const secreto = secretoAleatorio();
  await db.query('DELETE FROM recuperaciones WHERE usuario_id = $1 OR vence <= now()', [usuario.id]);
  await db.query("INSERT INTO recuperaciones (hash, usuario_id, revision_acceso, vence) VALUES ($1, $2, $3, now() + interval '30 minutes')",
    [hashSecreto(secreto), usuario.id, usuario.revision_acceso]);
  await encolarAcceso(db, usuario.id, usuario.email, secreto);
}

/** Serializa la administración de un laboratorio y vuelve a comprobar permisos. */
export async function conSupervisor<T>(db: Db, actor: Usuario, operacion: (conexion: Consultas) => Promise<T>) {
  return db.transaccion(async (conexion) => {
    await laboratorios.bloquearPorId(conexion, actor.laboratorio_id);
    const actual = await usuarios.bloquearSupervisorActivo(conexion, actor.id, actor.laboratorio_id);
    if (!actual) throw new ErrorHttp(403, 'Solo los supervisores pueden administrar usuarios');
    return operacion(conexion);
  });
}
