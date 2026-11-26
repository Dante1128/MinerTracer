import type { Request, Response } from 'express';
import { ErrorContrato, VERSION_DUPLICADA } from '../anclaje/erroresContrato.ts';
import { marcarAnclado, solicitudDeAnalisis } from '../anclaje/procesador.ts';
import { usuarioDe } from '../auth.ts';
import { ErrorHttp, type Contexto } from '../contexto.ts';
import { validarCuenta } from '../mercado/mercado.ts';
import * as analisis from '../modelos/analisis.ts';
import * as laboratorios from '../modelos/laboratorios.ts';
import * as lotes from '../modelos/lotes.ts';
import { registrarAnalisis, registrarCorreccion, registrarLote, type PdfSubido } from '../servicios/registro.ts';
import { publico, verificarAnalisis } from '../servicios/verificacion.ts';
import { validarAnalisis, validarLote, validarMotivo } from '../validacion.ts';

/** Controlador: portal del laboratorio (lotes y análisis propios), ver ../rutas/laboratorio.ts. */

export const pdfDe = (archivo: Express.Multer.File | undefined): PdfSubido | null =>
  archivo ? { buffer: archivo.buffer, nombre: Buffer.from(archivo.originalname, 'latin1').toString('utf8') } : null;

export async function quienSoy(ctx: Contexto, req: Request, res: Response) {
  const usuario = usuarioDe(req);
  const laboratorio = await laboratorios.buscarPorId(ctx.db, usuario.laboratorio_id);
  res.json({ usuario, laboratorio });
}

export async function listarLotes(ctx: Contexto, req: Request, res: Response) {
  res.json(await lotes.listarPorLaboratorioConTotales(ctx.db, usuarioDe(req).laboratorio_id));
}

export async function crearLote(ctx: Contexto, req: Request, res: Response) {
  const lote = await registrarLote(ctx, usuarioDe(req), validarLote(req.body ?? {}));
  res.status(201).json(lote);
}

export async function listarAnalisis(ctx: Contexto, req: Request, res: Response) {
  // Solo la versión vigente de cada análisis.
  const filas = await analisis.listarVigentesPorLaboratorio(ctx.db, usuarioDe(req).laboratorio_id);
  res.json(
    filas.map((f: any) => ({
      ...publico(f),
      tipo_mineral: f.tipo_mineral,
      origen: f.origen,
      intentos_anclaje: f.intentos_anclaje,
      ultimo_error: f.ultimo_error,
    })),
  );
}

export async function verAnalisis(ctx: Contexto, req: Request, res: Response) {
  const usuario = usuarioDe(req);
  const versiones = await analisis.listarVersiones(ctx.db, String(req.params.analisisId), usuario.laboratorio_id);
  if (versiones.length === 0) throw new ErrorHttp(404, 'Análisis no encontrado');
  const lote = await lotes.buscarPorId(ctx.db, versiones[0].lote_id);
  const laboratorio = await laboratorios.buscarPorId(ctx.db, usuario.laboratorio_id);
  res.json({
    lote,
    versiones: await Promise.all(
      versiones.map(async (v: any) => ({
        ...publico(v),
        intentos_anclaje: v.intentos_anclaje,
        ultimo_error: v.ultimo_error,
        verificacion: await verificarAnalisis(ctx, v, lote, laboratorio),
      })),
    ),
  });
}

export async function crearAnalisis(ctx: Contexto, req: Request, res: Response) {
  const datos = validarAnalisis(req.body ?? {});
  const loteId = String(req.body?.lote_id ?? '');
  const fila = await registrarAnalisis(ctx, usuarioDe(req), loteId, datos, pdfDe(req.file));
  res.status(201).json(publico(fila));
}

/**
 * Análisis pendiente que debe firmar la wallet del laboratorio conectada:
 * debe ser del laboratorio del usuario, estar pendiente y no ser de firma en el servidor.
 */
async function paraFirmar(ctx: Contexto, req: Request, cuenta: string) {
  if (!ctx.anclaje.firmaConWallet) throw new ErrorHttp(409, 'Este servidor firma los análisis por su cuenta (FIRMA_LABORATORIO=servidor)');
  const usuario = usuarioDe(req);
  const fila = await analisis.buscarVersionDeLaboratorio(
    ctx.db,
    String(req.params.analisisId),
    Number.parseInt(String(req.params.version), 10) || 0,
    usuario.laboratorio_id,
  );
  if (!fila) throw new ErrorHttp(404, 'Análisis no encontrado');
  if (fila.estado_anclaje !== 'pendiente') throw new ErrorHttp(409, 'El análisis ya está anclado');
  if (fila.firma_servidor) throw new ErrorHttp(409, 'Este análisis lo ancla el servidor');
  const solicitud = await solicitudDeAnalisis(ctx.db, fila);
  if (cuenta !== solicitud.cuentaLaboratorio) {
    throw new ErrorHttp(403, `Conecte en Freighter la cuenta del laboratorio (${solicitud.cuentaLaboratorio})`);
  }
  return { fila, solicitud };
}

/** Transacción sin firmar para que el laboratorio la firme con su wallet. */
export async function prepararFirma(ctx: Contexto, req: Request, res: Response) {
  const { fila, solicitud } = await paraFirmar(ctx, req, validarCuenta(req.body?.cuenta));
  try {
    res.json({ xdr: await ctx.anclaje.prepararAnclaje(solicitud) });
  } catch (error) {
    // Ya estaba en el contrato (firmado antes, desde otro navegador): se reconcilia.
    if (!(error instanceof ErrorContrato && error.codigo === VERSION_DUPLICADA)) throw error;
    const encontrado = await ctx.anclaje.buscarAnclaje(solicitud);
    if (!encontrado) throw error;
    await marcarAnclado(ctx.db, fila.id, encontrado);
    res.json({ ya_anclado: true, tx_id: encontrado.txId });
  }
}

/** Envía la transacción firmada; marca el análisis como anclado solo si el contrato lo tiene. */
export async function enviarFirma(ctx: Contexto, req: Request, res: Response) {
  const { fila, solicitud } = await paraFirmar(ctx, req, validarCuenta(req.body?.cuenta));
  const xdr = String(req.body?.xdr ?? '');
  if (!xdr) throw new ErrorHttp(400, 'Falta la transacción firmada');
  const resultado = await ctx.anclaje.enviarAnclaje(solicitud, xdr);
  await marcarAnclado(ctx.db, fila.id, resultado);
  res.json({ tx_id: resultado.txId, fecha: resultado.fecha, url_explorador: ctx.anclaje.urlExplorador(resultado.txId) });
}

export async function crearVersion(ctx: Contexto, req: Request, res: Response) {
  const datos = validarAnalisis(req.body ?? {});
  const motivo = validarMotivo(req.body ?? {});
  const fila = await registrarCorreccion(ctx, usuarioDe(req), String(req.params.analisisId), datos, motivo, pdfDe(req.file));
  res.status(201).json(publico(fila));
}
