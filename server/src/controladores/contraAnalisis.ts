import type { Request, Response } from 'express';
import { usuarioDe } from '../auth.ts';
import { ErrorHttp, type Contexto } from '../contexto.ts';
import { validarCuenta } from '../mercado/mercado.ts';
import {
  enviarContraAnalisis,
  lotesParaContraAnalisis,
  prepararContraAnalisis,
  registrarContraAnalisis,
} from '../servicios/contraAnalisis.ts';
import { validarAnalisis } from '../validacion.ts';

/** Controlador: contra-análisis de lotes en garantía, ver ../rutas/contraAnalisis.ts. */

export const pdfDe = (req: Request) =>
  req.file ? { buffer: req.file.buffer, nombre: Buffer.from(req.file.originalname, 'latin1').toString('utf8') } : null;
export const loteDe = (req: Request) => String(req.body?.lote_id ?? '').trim().toUpperCase();

export async function pendientes(ctx: Contexto, req: Request, res: Response) {
  res.json(await lotesParaContraAnalisis(ctx, usuarioDe(req)));
}

/** Firma con wallet, paso 1: registro sellado + transacción sin firmar. */
export async function preparar(ctx: Contexto, req: Request, res: Response) {
  const datos = validarAnalisis(req.body ?? {});
  const cuenta = validarCuenta(req.body?.cuenta);
  res.json(await prepararContraAnalisis(ctx, usuarioDe(req), loteDe(req), datos, pdfDe(req), cuenta));
}

/** Firma con wallet, paso 2: envía la transacción firmada y guarda si el contrato la registró. */
export async function enviar(ctx: Contexto, req: Request, res: Response) {
  const xdr = String(req.body?.xdr ?? '');
  if (!xdr) throw new ErrorHttp(400, 'Falta la transacción firmada');
  const fila = await enviarContraAnalisis(ctx, usuarioDe(req), req.body ?? {}, xdr);
  res.status(201).json({ id: fila.id, lote_id: fila.lote_id, hash: fila.hash, tx_id: fila.tx_id, fecha_anclaje: fila.fecha_anclaje });
}

/** Firma en el servidor: solo con FIRMA_LABORATORIO=servidor. */
export async function registrar(ctx: Contexto, req: Request, res: Response) {
  if (ctx.anclaje.firmaConWallet) throw new ErrorHttp(409, 'Firme el contra-análisis con la wallet del laboratorio');
  const datos = validarAnalisis(req.body ?? {});
  const fila = await registrarContraAnalisis(ctx, usuarioDe(req), loteDe(req), datos, pdfDe(req));
  res.status(201).json({ id: fila.id, lote_id: fila.lote_id, hash: fila.hash, tx_id: fila.tx_id, fecha_anclaje: fila.fecha_anclaje });
}
