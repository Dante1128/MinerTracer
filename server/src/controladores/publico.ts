import type { Request, Response } from 'express';
import { leerPdf } from '../almacenamiento.ts';
import { config } from '../config.ts';
import { ErrorHttp, type Contexto } from '../contexto.ts';
import { canonicalizar, construirRegistro } from '../integridad/canonico.ts';
import * as analisis from '../modelos/analisis.ts';
import * as contraAnalisis from '../modelos/contraAnalisis.ts';
import * as lotes from '../modelos/lotes.ts';
import { registroDeContraAnalisis } from '../servicios/contraAnalisis.ts';
import { verificarLote } from '../servicios/verificacion.ts';

/** Controlador: verificador público, sin sesión, ver ../rutas/publico.ts. */

export function info(ctx: Contexto, _req: Request, res: Response) {
  res.json({
    anclaje: ctx.anclaje.nombre,
    red: ctx.anclaje.red,
    contrato_id: ctx.anclaje.contratoId,
    // "wallet": cada laboratorio firma sus análisis con Freighter.
    firma_laboratorio: ctx.anclaje.firmaConWallet ? 'wallet' : 'servidor',
    motor_db: ctx.db.motor,
    demo_alterar: config.demoAlterar,
  });
}

export async function verLote(ctx: Contexto, req: Request, res: Response) {
  const resultado = await verificarLote(ctx, String(req.params.loteId).toUpperCase());
  if (!resultado) throw new ErrorHttp(404, 'No existe un lote con ese código');
  res.json(resultado);
}

async function buscarVersion(ctx: Contexto, analisisId: string, version: string) {
  const fila = await analisis.buscarVersion(ctx.db, analisisId, Number.parseInt(version, 10) || 0);
  if (!fila) throw new ErrorHttp(404, 'Análisis no encontrado');
  return fila;
}

// Registro canónico exacto que se hashea: permite verificar sin confiar en MinerTrace.
export async function analisisCanonico(ctx: Contexto, req: Request, res: Response) {
  const fila = await buscarVersion(ctx, String(req.params.analisisId), String(req.params.version));
  const lote = await lotes.buscarPorId(ctx.db, fila.lote_id);
  res
    .type('application/json; charset=utf-8')
    .attachment(`${fila.analisis_id}-v${fila.version}.canonico.json`)
    .send(canonicalizar(construirRegistro(fila, lote)));
}

export async function analisisInforme(ctx: Contexto, req: Request, res: Response) {
  const fila = await buscarVersion(ctx, String(req.params.analisisId), String(req.params.version));
  const pdf = await leerPdf(fila.pdf_sha256);
  if (!pdf) throw new ErrorHttp(404, 'Informe no disponible');
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${fila.analisis_id}-v${fila.version}.pdf"`);
  res.send(pdf);
}

async function buscarContraAnalisis(ctx: Contexto, id: string) {
  const fila = await contraAnalisis.buscarPorId(ctx.db, Number.parseInt(id, 10) || 0);
  if (!fila) throw new ErrorHttp(404, 'Contra-análisis no encontrado');
  return fila;
}

export async function contraAnalisisCanonico(ctx: Contexto, req: Request, res: Response) {
  const fila = await buscarContraAnalisis(ctx, String(req.params.id));
  res
    .type('application/json; charset=utf-8')
    .attachment(`contra-analisis-${fila.id}.canonico.json`)
    .send(canonicalizar(registroDeContraAnalisis(fila)));
}

export async function contraAnalisisInforme(ctx: Contexto, req: Request, res: Response) {
  const fila = await buscarContraAnalisis(ctx, String(req.params.id));
  const pdf = await leerPdf(fila.pdf_sha256);
  if (!pdf) throw new ErrorHttp(404, 'Informe no disponible');
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="contra-analisis-${fila.id}.pdf"`);
  res.send(pdf);
}
