import { Router } from 'express';
import multer from 'multer';
import { requiereSesion } from '../auth.ts';
import { config } from '../config.ts';
import * as contraAnalisis from '../controladores/contraAnalisis.ts';
import type { Contexto } from '../contexto.ts';
import { enlazar, type Controlador } from './enlazar.ts';

const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxPdfBytes, files: 1 } });

/** Rutas: portal del laboratorio, contra-análisis de lotes en garantía (lógica en ../controladores/contraAnalisis.ts). */
export function rutasContraAnalisis(ctx: Contexto) {
  const r = Router();
  r.use(requiereSesion(ctx.db));
  const con = (controlador: Controlador) => enlazar(ctx, controlador);

  r.get('/pendientes', con(contraAnalisis.pendientes));
  r.post('/preparar', subida.single('pdf'), con(contraAnalisis.preparar));
  r.post('/enviar', con(contraAnalisis.enviar));
  r.post('/', subida.single('pdf'), con(contraAnalisis.registrar));

  return r;
}
