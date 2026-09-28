import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.ts';
import { ErrorHttp, type Usuario } from './contexto.ts';

declare module 'express-serve-static-core' {
  interface Request {
    usuario?: Usuario;
  }
}

export function firmarToken(usuario: Usuario): string {
  return jwt.sign(usuario, config.jwtSecret, { expiresIn: '12h', subject: String(usuario.id) });
}

export function requiereSesion(req: Request, _res: Response, next: NextFunction) {
  const [tipo, token] = (req.headers.authorization ?? '').split(' ');
  if (tipo !== 'Bearer' || !token) throw new ErrorHttp(401, 'Inicie sesión');
  try {
    const datos = jwt.verify(token, config.jwtSecret) as Usuario & jwt.JwtPayload;
    req.usuario = {
      id: datos.id,
      email: datos.email,
      nombre: datos.nombre,
      rol: datos.rol,
      laboratorio_id: datos.laboratorio_id,
    };
  } catch {
    throw new ErrorHttp(401, 'Sesión vencida; inicie sesión de nuevo');
  }
  next();
}

export const usuarioDe = (req: Request): Usuario => {
  if (!req.usuario) throw new ErrorHttp(401, 'Inicie sesión');
  return req.usuario;
};
