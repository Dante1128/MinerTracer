import type { NextFunction, Request, Response } from 'express';
import type { Contexto } from '../contexto.ts';

export type Controlador = (ctx: Contexto, req: Request, res: Response) => Promise<void> | void;

/** Ata un controlador (../controladores/*.ts) al contexto y reenvía sus errores al middleware de errores. */
export function enlazar(ctx: Contexto, controlador: Controlador) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(controlador(ctx, req, res)).catch(next);
  };
}
