import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { cerrarSesion, crearSesion, hashSecreto, secretoAleatorio, usuarioDe } from '../auth.ts';
import { ErrorHttp, type Contexto, type Usuario } from '../contexto.ts';
import * as usuarios from '../modelos/usuarios.ts';
import {
  conSupervisor,
  emailNormalizado,
  emitirRecuperacion,
  revocarAcceso,
  validarClave,
  validarUsuario,
} from '../servicios/cuentas.ts';

/** Controlador: autenticación y administración de cuentas (ver ../rutas/cuentas.ts). */

const hashInexistente = await bcrypt.hash(secretoAleatorio(), 12);
const publico = (fila: Usuario) => ({ id: fila.id, email: fila.email, nombre: fila.nombre, rol: fila.rol, laboratorio_id: fila.laboratorio_id });

export const idDe = (req: Request) => {
  const texto = String(req.params.id ?? '');
  const id = Number(texto);
  if (!/^[1-9]\d*$/.test(texto) || !Number.isSafeInteger(id)) throw new ErrorHttp(400, 'Usuario inválido');
  return id;
};

export async function login(ctx: Contexto, req: Request, res: Response) {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
    throw new ErrorHttp(401, 'Correo o contraseña incorrectos');
  }
  const fila = await usuarios.buscarPorEmail(ctx.db, emailNormalizado(email));
  const correcta = await bcrypt.compare(password, fila?.password_hash ?? hashInexistente);
  if (!fila?.activo || !correcta) throw new ErrorHttp(401, 'Correo o contraseña incorrectos');
  const csrf = await crearSesion(ctx.db, fila, req, res);
  res.json({ usuario: publico(fila), csrf });
}

export async function salir(ctx: Contexto, req: Request, res: Response) {
  res.json({ csrf: await cerrarSesion(ctx.db, req, res) });
}

export async function recuperar(ctx: Contexto, req: Request, res: Response) {
  const email = emailNormalizado(req.body?.email).slice(0, 254);
  await ctx.db.transaccion(async (conexion) => {
    const [usuario] = await conexion.query('SELECT * FROM usuarios WHERE email = $1 AND activo FOR UPDATE', [email]);
    if (usuario) await emitirRecuperacion(conexion, usuario);
  });
  res.status(202).json({ mensaje: 'Si la cuenta está habilitada, recibirá un enlace para establecer su contraseña.' });
}

export async function restablecer(ctx: Contexto, req: Request, res: Response) {
  const secreto = req.body?.secreto;
  if (typeof secreto !== 'string' || !/^[a-f0-9]{64}$/.test(secreto)) throw new ErrorHttp(400, 'El enlace no es válido o ya venció');
  const hash = await bcrypt.hash(validarClave(req.body?.password), 12);
  await ctx.db.transaccion(async (conexion) => {
    const [usuario] = await conexion.query(
      `SELECT u.* FROM usuarios u JOIN recuperaciones r ON r.usuario_id = u.id
       WHERE r.hash = $1 AND r.vence > now() AND u.activo FOR UPDATE OF u`, [hashSecreto(secreto)],
    );
    if (!usuario) throw new ErrorHttp(400, 'El enlace no es válido o ya venció');
    const [consumido] = await conexion.query(
      'DELETE FROM recuperaciones WHERE hash = $1 AND vence > now() AND revision_acceso = $2 RETURNING usuario_id',
      [hashSecreto(secreto), usuario.revision_acceso],
    );
    if (!consumido) throw new ErrorHttp(400, 'El enlace no es válido o ya venció');
    await usuarios.actualizarPassword(conexion, usuario.id, hash);
    await revocarAcceso(conexion, usuario.id);
  });
  res.json({ mensaje: 'Contraseña actualizada. Inicie sesión con su nueva contraseña.', csrf: await cerrarSesion(ctx.db, req, res) });
}

export async function cambiarClave(ctx: Contexto, req: Request, res: Response) {
  const usuario = usuarioDe(req);
  const nueva = validarClave(req.body?.password);
  const actual = req.body?.actual;
  if (typeof actual !== 'string' || Buffer.byteLength(actual, 'utf8') > 72) throw new ErrorHttp(400, 'Ingrese su contraseña actual');
  const hash = await bcrypt.hash(nueva, 12);
  await ctx.db.transaccion(async (conexion) => {
    const fila = await usuarios.bloquearActivoPorId(conexion, usuario.id);
    if (!fila || !await bcrypt.compare(actual, fila.password_hash)) throw new ErrorHttp(400, 'La contraseña actual no es correcta');
    await usuarios.actualizarPassword(conexion, usuario.id, hash);
    await revocarAcceso(conexion, usuario.id);
  });
  res.json({ mensaje: 'Contraseña actualizada. Inicie sesión de nuevo.', csrf: await cerrarSesion(ctx.db, req, res) });
}

export async function revocarSesiones(ctx: Contexto, req: Request, res: Response) {
  await ctx.db.transaccion(async (conexion) => { await revocarAcceso(conexion, usuarioDe(req).id); });
  res.json({ csrf: await cerrarSesion(ctx.db, req, res) });
}

export function exigirSupervisor(req: Request, _res: Response, next: () => void) {
  if (usuarioDe(req).rol !== 'supervisor') throw new ErrorHttp(403, 'Solo los supervisores pueden administrar usuarios');
  next();
}

export async function listarUsuarios(ctx: Contexto, req: Request, res: Response) {
  res.json(await usuarios.listarPorLaboratorio(ctx.db, usuarioDe(req).laboratorio_id));
}

export async function crearUsuario(ctx: Contexto, req: Request, res: Response) {
  const datos = validarUsuario(req.body ?? {});
  const actor = usuarioDe(req);
  // La contraseña inicial es aleatoria e inaccesible: el destinatario elige la suya por correo.
  const hash = await bcrypt.hash(secretoAleatorio(), 12);
  const usuario = await conSupervisor(ctx.db, actor, async (conexion) => {
    const fila = await usuarios.crear(conexion, { ...datos, laboratorio_id: actor.laboratorio_id, password_hash: hash });
    if (!fila) throw new ErrorHttp(409, 'No se puede crear una cuenta con ese correo');
    await emitirRecuperacion(conexion, fila);
    return fila;
  });
  res.status(201).json({ ...publico(usuario), activo: usuario.activo });
}

export async function administrarUsuario(ctx: Contexto, req: Request, res: Response) {
  const actor = usuarioDe(req);
  const id = idDe(req);
  const accion = req.params.accion;
  if (!['estado', 'rol', 'revocar', 'invitacion'].includes(String(accion))) throw new ErrorHttp(404, 'Acción no encontrada');
  if (id === actor.id) throw new ErrorHttp(400, 'Use Mi cuenta para gestionar su propio acceso');
  if (accion === 'estado' && typeof req.body?.activo !== 'boolean') throw new ErrorHttp(400, 'Indique si la cuenta está habilitada');
  if (accion === 'rol' && !['analista', 'supervisor'].includes(req.body?.rol)) throw new ErrorHttp(400, 'Seleccione un rol válido');
  await conSupervisor(ctx.db, actor, async (conexion) => {
    const usuario = await usuarios.bloquearPorIdYLaboratorio(conexion, id, actor.laboratorio_id);
    if (!usuario) throw new ErrorHttp(404, 'Usuario no encontrado');
    if (accion === 'invitacion') {
      if (!usuario.activo) throw new ErrorHttp(409, 'Habilite la cuenta antes de enviar un enlace');
      await emitirRecuperacion(conexion, usuario);
    } else {
      if (accion === 'estado') await usuarios.actualizarEstado(conexion, id, req.body.activo);
      if (accion === 'rol') await usuarios.actualizarRol(conexion, id, req.body.rol);
      await revocarAcceso(conexion, id);
    }
  });
  res.json({ mensaje: accion === 'invitacion' ? 'Enlace solicitado. Se enviará por correo.' : 'Acceso actualizado.' });
}
