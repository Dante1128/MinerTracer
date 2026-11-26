import { Keypair } from '@stellar/stellar-sdk';
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { cookieDe, entregarCsrf, hashSecreto, secretoAleatorio } from '../auth.ts';
import { config } from '../config.ts';
import { ErrorHttp } from '../contexto.ts';
import type { Db } from '../db/index.ts';
import { validarCuenta } from '../mercado/mercado.ts';

declare module 'express-serve-static-core' {
  interface Request { cuentaComercial?: string; }
}

const COOKIE_SESION = config.produccion ? '__Host-minertrace.comercio' : 'minertrace.comercio';
const COOKIE_RETO = config.produccion ? '__Host-minertrace.reto-comercio' : 'minertrace.reto-comercio';
const DURACION_RETO = 5 * 60_000;
const DURACION_SESION = 12 * 60 * 60_000;
const opciones: CookieOptions = { httpOnly: true, secure: config.produccion, sameSite: 'strict', path: '/' };

export async function crearDesafio(db: Db, cuentaCruda: unknown, req: Request, res: Response) {
  const cuenta = validarCuenta(cuentaCruda);
  const id = secretoAleatorio();
  const vinculo = secretoAleatorio();
  const emitido = new Date();
  const vence = new Date(emitido.getTime() + DURACION_RETO);
  const mensaje = [
    'MinerTrace: iniciar sesión comercial',
    `Origen: ${config.origenPublico}`,
    'Red: Stellar testnet',
    `Cuenta: ${cuenta}`,
    `Desafío: ${id}`,
    `Emitido: ${emitido.toISOString()}`,
    `Vence: ${vence.toISOString()}`,
    'Esta firma identifica la wallet. No autoriza compras, pagos ni transferencias.',
  ].join('\n');
  await db.query('DELETE FROM comercio_desafios WHERE vence <= now()');
  await db.query(
    'INSERT INTO comercio_desafios (id, cuenta, mensaje, vinculo_hash, vence) VALUES ($1,$2,$3,$4,$5)',
    [id, cuenta, mensaje, hashSecreto(vinculo), vence],
  );
  res.cookie(COOKIE_RETO, vinculo, { ...opciones, maxAge: DURACION_RETO });
  return { id, mensaje, vence: vence.toISOString() };
}

export async function verificarDesafio(db: Db, entrada: Record<string, unknown>, req: Request, res: Response) {
  const id = typeof entrada.id === 'string' ? entrada.id : '';
  const firma = typeof entrada.firma === 'string' ? entrada.firma : '';
  const vinculo = cookieDe(req, COOKIE_RETO);
  if (!/^[a-f0-9]{64}$/.test(id) || !/^[A-Za-z0-9+/]{86}==$/.test(firma) || !vinculo) {
    throw new ErrorHttp(400, 'El desafío o la firma no son válidos');
  }
  const firmaBytes = Buffer.from(firma, 'base64');
  if (firmaBytes.length !== 64 || firmaBytes.toString('base64') !== firma) throw new ErrorHttp(400, 'Firma inválida');
  const secreto = secretoAleatorio();
  const cuenta = await db.transaccion(async (conexion) => {
    const [desafio] = await conexion.query<{ cuenta: string; mensaje: string }>(
      'SELECT cuenta,mensaje FROM comercio_desafios WHERE id=$1 AND vinculo_hash=$2 AND vence>now() AND NOT consumido FOR UPDATE',
      [id, hashSecreto(vinculo)],
    );
    if (!desafio) throw new ErrorHttp(401, 'El desafío venció o ya fue utilizado; solicite otro');
    if (!Keypair.fromPublicKey(desafio.cuenta).verifyMessage(desafio.mensaje, firmaBytes)) {
      throw new ErrorHttp(401, 'La firma no corresponde a la cuenta del desafío');
    }
    const [consumido] = await conexion.query(
      'UPDATE comercio_desafios SET consumido=true WHERE id=$1 AND NOT consumido AND vence>now() RETURNING id', [id],
    );
    if (!consumido) throw new ErrorHttp(401, 'El desafío ya fue utilizado');
    await conexion.query('DELETE FROM comercio_sesiones WHERE hash=$1 OR vence<=now()', [hashSecreto(cookieDe(req, COOKIE_SESION))]);
    await conexion.query('INSERT INTO comercio_sesiones (hash,cuenta,vence) VALUES ($1,$2,$3)',
      [hashSecreto(secreto), desafio.cuenta, new Date(Date.now() + DURACION_SESION)]);
    return desafio.cuenta;
  });
  res.cookie(COOKIE_SESION, secreto, { ...opciones, maxAge: DURACION_SESION });
  res.clearCookie(COOKIE_RETO, opciones);
  return { cuenta, csrf: entregarCsrf(req, res) };
}

export async function leerSesionComercial(db: Db, req: Request): Promise<string | null> {
  const secreto = cookieDe(req, COOKIE_SESION);
  if (!secreto) return null;
  const [sesion] = await db.query<{ cuenta: string }>('SELECT cuenta FROM comercio_sesiones WHERE hash=$1 AND vence>now()', [hashSecreto(secreto)]);
  return sesion?.cuenta ?? null;
}

export function requiereSesionComercial(db: Db): RequestHandler {
  return async (req, _res, next) => {
    const cuenta = await leerSesionComercial(db, req);
    if (!cuenta) throw new ErrorHttp(401, 'Conecte y firme con su wallet para iniciar sesión comercial');
    req.cuentaComercial = cuenta;
    next();
  };
}

export function cuentaComercialDe(req: Request): string {
  if (!req.cuentaComercial) throw new ErrorHttp(401, 'Inicie sesión comercial con su wallet');
  return req.cuentaComercial;
}

export async function cerrarSesionComercial(db: Db, req: Request, res: Response) {
  await db.query('DELETE FROM comercio_sesiones WHERE hash=$1', [hashSecreto(cookieDe(req, COOKIE_SESION))]);
  res.clearCookie(COOKIE_SESION, opciones);
  return { cuenta: null, perfil: null, csrf: entregarCsrf(req, res) };
}
