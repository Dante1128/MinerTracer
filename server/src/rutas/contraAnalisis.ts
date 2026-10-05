import { Router } from 'express';
import multer from 'multer';
import { requiereSesion, usuarioDe } from '../auth.ts';
import { config } from '../config.ts';
import type { Contexto } from '../contexto.ts';
import { lotesParaContraAnalisis, registrarContraAnalisis } from '../servicios/contraAnalisis.ts';
import { validarAnalisis } from '../validacion.ts';

const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxPdfBytes, files: 1 } });

/** Portal del laboratorio: contra-análisis de lotes en garantía (requiere sesión). */
export function rutasContraAnalisis(ctx: Contexto) {
  const r = Router();
  r.use(requiereSesion);

  r.get('/pendientes', async (req, res) => {
    res.json(await lotesParaContraAnalisis(ctx, usuarioDe(req)));
  });

  r.post('/', subida.single('pdf'), async (req, res) => {
    const datos = validarAnalisis(req.body ?? {});
    const loteId = String(req.body?.lote_id ?? '').trim().toUpperCase();
    const pdf = req.file ? { buffer: req.file.buffer, nombre: Buffer.from(req.file.originalname, 'latin1').toString('utf8') } : null;
    const fila = await registrarContraAnalisis(ctx, usuarioDe(req), loteId, datos, pdf);
    res.status(201).json({ id: fila.id, lote_id: fila.lote_id, hash: fila.hash, tx_id: fila.tx_id, fecha_anclaje: fila.fecha_anclaje });
  });

  return r;
}
