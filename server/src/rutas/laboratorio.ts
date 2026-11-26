import { Router } from 'express';
import multer from 'multer';
import { requiereSesion } from '../auth.ts';
import { config } from '../config.ts';
import * as laboratorio from '../controladores/laboratorio.ts';
import type { Contexto } from '../contexto.ts';
import { enlazar, type Controlador } from './enlazar.ts';

const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxPdfBytes, files: 1 } });

/** Rutas: portal del laboratorio (lógica en ../controladores/laboratorio.ts). */
export function rutasLaboratorio(ctx: Contexto) {
  const r = Router();
  const con = (controlador: Controlador) => enlazar(ctx, controlador);

  r.use(['/auth/yo', '/lotes', '/analisis'], requiereSesion(ctx.db));

  r.get('/auth/yo', con(laboratorio.quienSoy));

  r.get('/lotes', con(laboratorio.listarLotes));
  r.post('/lotes', con(laboratorio.crearLote));

  r.get('/analisis', con(laboratorio.listarAnalisis));
  r.get('/analisis/:analisisId', con(laboratorio.verAnalisis));
  r.post('/analisis', subida.single('pdf'), con(laboratorio.crearAnalisis));
  r.post('/analisis/:analisisId/v/:version/firma', con(laboratorio.prepararFirma));
  r.post('/analisis/:analisisId/v/:version/firma/enviar', con(laboratorio.enviarFirma));
  r.post('/analisis/:analisisId/versiones', subida.single('pdf'), con(laboratorio.crearVersion));

  return r;
}
