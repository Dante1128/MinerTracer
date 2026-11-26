import { Router } from 'express';
import * as publico from '../controladores/publico.ts';
import type { Contexto } from '../contexto.ts';
import { enlazar, type Controlador } from './enlazar.ts';

/** Rutas: verificador público, sin sesión (lógica en ../controladores/publico.ts). */
export function rutasPublicas(ctx: Contexto) {
  const r = Router();
  const con = (controlador: Controlador) => enlazar(ctx, controlador);

  r.get('/info', con(publico.info));
  r.get('/lotes/:loteId', con(publico.verLote));
  r.get('/analisis/:analisisId/v/:version/canonico.json', con(publico.analisisCanonico));
  r.get('/analisis/:analisisId/v/:version/informe.pdf', con(publico.analisisInforme));
  r.get('/contra-analisis/:id/canonico.json', con(publico.contraAnalisisCanonico));
  r.get('/contra-analisis/:id/informe.pdf', con(publico.contraAnalisisInforme));

  return r;
}
