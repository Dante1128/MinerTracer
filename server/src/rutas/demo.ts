import { Router } from 'express';
import { requiereSesion } from '../auth.ts';
import * as demo from '../controladores/demo.ts';
import type { Contexto } from '../contexto.ts';
import { enlazar } from './enlazar.ts';

/** Rutas: SOLO DEMOSTRACIÓN (lógica en ../controladores/demo.ts). */
export function rutasDemo(ctx: Contexto) {
  const r = Router();
  r.use(requiereSesion(ctx.db));

  r.post('/alterar', enlazar(ctx, demo.alterar));

  return r;
}
