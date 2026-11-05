import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { config } from './config.ts';
import { ErrorHttp, type Usuario } from './contexto.ts';
import type { Db } from './db/index.ts';

declare module 'express-serve-static-core' {
  interface Request { usuario?: Usuario; }
}

const COOKIE_SESION = config.produccion ? '__Host-minertrace.sesion' : 'minertrace.sesion';
const COOKIE_CSRF = config.produccion ? '__Host-minertrace.csrf' : 'minertrace.csrf';
const DURACION_SESION = 12 * 60 * 60 * 1000;
const opcionesCookie: CookieOptions = { httpOnly: true, secure: config.produccion, sameSite: 'strict', path: '/' };
export const hashSecreto = (valor: string) => createHash('sha256').update(valor).digest('hex');
export const secretoAleatorio = () => randomBytes(32).toString('hex');

export function cookieDe(req: Request, nombre: string): string {
  const valores = (req.headers.cookie ?? '').split(';').map((parte) => parte.trim());
  const valor = valores.find((parte) => parte.startsWith(nombre + '='))?.slice(nombre.length + 1) ?? '';
  return /^[a-f0-9]{64}$/.test(valor) ? valor : '';
}

function tokenCsrf(semilla: string, sesion: string): string {
  return createHmac('sha256', config.jwtSecret).update('csrf:' + semilla + ':' + sesion).digest('hex');
}

export function entregarCsrf(req: Request, res: Response, sesion = cookieDe(req, COOKIE_SESION)): string {
  const semilla = cookieDe(req, COOKIE_CSRF) || secretoAleatorio();
  res.cookie(COOKIE_CSRF, semilla, { ...opcionesCookie, maxAge: DURACION_SESION });
  return tokenCsrf(semilla, sesion);
}

/** Protege también el inicio de sesión, antes de interpretar el cuerpo. */
export const protegerCsrf: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const recibido = req.get('X-CSRF-Token') ?? '';
  const semilla = cookieDe(req, COOKIE_CSRF);
  const esperado = tokenCsrf(semilla, cookieDe(req, COOKIE_SESION));
  if (req.get('Sec-Fetch-Site') === 'cross-site' || (req.get('Origin') && req.get('Origin') !== config.origenPublico) ||
      !semilla || !/^[a-f0-9]{64}$/.test(recibido) || !timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado))) {
    throw new ErrorHttp(403, 'Recargue la página para confirmar que la solicitud es segura', 'CSRF_INVALIDO');
  }
  next();
};

export async function crearSesion(db: Db, usuario: Usuario & { revision_acceso: number }, req: Request, res: Response) {
  const secreto = secretoAleatorio();
  await db.query('DELETE FROM sesiones WHERE vence <= now()');
  await db.query('DELETE FROM sesiones WHERE hash = $1', [hashSecreto(cookieDe(req, COOKIE_SESION))]);
  await db.query('INSERT INTO sesiones (hash, usuario_id, revision_acceso, vence) VALUES ($1, $2, $3, $4)',
    [hashSecreto(secreto), usuario.id, usuario.revision_acceso, new Date(Date.now() + DURACION_SESION)]);
  res.cookie(COOKIE_SESION, secreto, { ...opcionesCookie, maxAge: DURACION_SESION });
  return entregarCsrf(req, res, secreto);
}

export async function cerrarSesion(db: Db, req: Request, res: Response) {
  await db.query('DELETE FROM sesiones WHERE hash = $1', [hashSecreto(cookieDe(req, COOKIE_SESION))]);
  res.clearCookie(COOKIE_SESION, opcionesCookie);
  return entregarCsrf(req, res, '');
}

export function requiereSesion(db: Db): RequestHandler {
  return async (req, _res, next) => {
    const secreto = cookieDe(req, COOKIE_SESION);
    if (!secreto) throw new ErrorHttp(401, 'Inicie sesión');
    const [usuario] = await db.query<Usuario>(
      'SELECT u.id, u.email, u.nombre, u.rol, u.laboratorio_id FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id ' +
      'WHERE s.hash = $1 AND s.vence > now() AND u.activo AND s.revision_acceso = u.revision_acceso',
      [hashSecreto(secreto)],
    );
    if (!usuario) throw new ErrorHttp(401, 'Sesión vencida o revocada; inicie sesión de nuevo');
    req.usuario = usuario;
    next();
  };
}

export const usuarioDe = (req: Request): Usuario => {
  if (!req.usuario) throw new ErrorHttp(401, 'Inicie sesión');
  return req.usuario;
};
