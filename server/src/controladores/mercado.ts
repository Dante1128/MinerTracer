import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ErrorHttp, type Contexto } from '../contexto.ts';
import { ACCIONES, validarCuenta, type Accion } from '../mercado/mercado.ts';
import * as contraAnalisisModelo from '../modelos/contraAnalisis.ts';
import * as lotesModelo from '../modelos/lotes.ts';
import { buscarPublicoPorCuenta } from '../modelos/perfilesComerciales.ts';
import { requiereMercado, verificarContraAnalisis } from '../servicios/contraAnalisis.ts';
import { comprobarAnalisisParaCompra } from '../servicios/compra.ts';
import { huellaInvocacion } from '../stellar/contrato.ts';
import { CODIGO_LOTE } from '../validacion.ts';

/** Controlador: marketplace con garantía, público (sin sesión), ver ../rutas/mercado.ts. */

const URL_EXPLORADOR = 'https://stellar.expert/explorer/testnet/tx/';

function loteDe(req: Request): string {
  const loteId = String(req.params.loteId ?? req.body?.lote_id ?? '').trim().toUpperCase();
  if (!CODIGO_LOTE.test(loteId)) throw new ErrorHttp(400, 'Código de lote inválido');
  return loteId;
}

function accionDe(valor: unknown): Accion {
  if (!ACCIONES.includes(valor as Accion)) throw new ErrorHttp(400, 'Acción desconocida');
  return valor as Accion;
}

export async function info(ctx: Contexto, _req: Request, res: Response) {
  if (!ctx.mercado) {
    res.json({ habilitado: false });
    return;
  }
  res.json({ habilitado: true, ...(await ctx.mercado.info()) });
}

export async function listarLotes(ctx: Contexto, _req: Request, res: Response) {
  res.json(await requiereMercado(ctx).lotesEnVenta());
}

/** Estado comercial, línea de tiempo y contra-análisis de un lote. */
export async function verLote(ctx: Contexto, req: Request, res: Response) {
  const mercado = requiereMercado(ctx);
  const loteId = loteDe(req);
  const lote = await lotesModelo.buscarResumenComercial(ctx.db, loteId);
  const estado = await mercado.estadoLote(loteId);
  if (!estado && !lote) throw new ErrorHttp(404, 'No existe un lote con ese código');

  const [conDatos] = estado ? await mercado.lotesFiltrados((e) => e.lote_id === loteId) : [null];
  const filas = await contraAnalisisModelo.listarPorLote(ctx.db, loteId);
  const contraAnalisis = await Promise.all(
    filas.map(async (f: any, i: number) => ({
      id: f.id,
      laboratorio_id: f.laboratorio_id,
      laboratorio_nombre: f.laboratorio_nombre,
      analista_nombre: f.analista_nombre,
      fecha_analisis: f.fecha_analisis,
      metodo: f.metodo,
      pureza: f.pureza,
      composicion: f.composicion,
      observaciones: f.observaciones,
      pdf_nombre: f.pdf_nombre,
      pdf_sha256: f.pdf_sha256,
      hash: f.hash,
      tx_id: f.tx_id,
      fecha_anclaje: f.fecha_anclaje,
      url_explorador: URL_EXPLORADOR + f.tx_id,
      // Solo el último puede seguir en el contrato.
      verificacion: await verificarContraAnalisis(f, i === filas.length - 1 ? estado : null, f.cuenta_publica),
    })),
  );
  res.json({
    lote_id: loteId,
    estado: conDatos ?? estado,
    cronologia: (await mercado.cronologia(loteId)).map((e) => ({ ...e, url_explorador: URL_EXPLORADOR + e.tx_hash })),
    contra_analisis: contraAnalisis,
  });
}

export async function lotesDeCuenta(ctx: Contexto, req: Request, res: Response) {
  res.json(await requiereMercado(ctx).lotesDeCuenta(validarCuenta(req.params.cuenta)));
}

/** Perfil declarado de la cuenta vendedora, sin información de contacto ni documentos privados. */
export async function perfilDeCuenta(ctx: Contexto, req: Request, res: Response) {
  const perfil = await buscarPublicoPorCuenta(ctx.db, validarCuenta(req.params.cuenta));
  if (!perfil) throw new ErrorHttp(404, 'La cuenta todavía no tiene un perfil comercial público');
  res.json(perfil);
}

/** Arma la transacción sin firmar; la firma la wallet de la cuenta. */
export async function prepararTransaccion(ctx: Contexto, req: Request, res: Response) {
  const mercado = requiereMercado(ctx);
  const accion = accionDe(req.body?.accion);
  const cuenta = validarCuenta(req.body?.cuenta);
  if (accion === 'buy') await comprobarAnalisisParaCompra(ctx, loteDe(req));
  const loteId = loteDe(req);
  const esperado = accion === 'buy' ? { total: String(req.body?.total_esperado ?? ''), analisis_id: String(req.body?.analisis_id_esperado ?? ''), version: req.body?.version_esperada, orden_id: typeof req.body?.orden_id === 'string' ? req.body.orden_id : undefined } : undefined;
  const xdr = await mercado.prepararTransaccion(accion, cuenta, loteId, req.body?.precio, esperado);
  const id = randomUUID();
  await ctx.db.query(`INSERT INTO comercio_transacciones (id,cuenta,accion,lote_id,invocacion_hash,vence)
    VALUES ($1,$2,$3,$4,$5,$6)`, [id,cuenta,accion,loteId,huellaInvocacion(xdr),new Date(Date.now()+5*60_000)]);
  res.json({ xdr, preparacion_id: id, passphrase: (await mercado.info()).passphrase });
}

/** Envía la transacción firmada por la wallet y espera la confirmación. */
export async function enviarTransaccion(ctx: Contexto, req: Request, res: Response) {
  const mercado = requiereMercado(ctx);
  const accion = accionDe(req.body?.accion);
  const cuenta = validarCuenta(req.body?.cuenta);
  const xdr = String(req.body?.xdr ?? '');
  if (!xdr) throw new ErrorHttp(400, 'Falta la transacción firmada');
  const id = typeof req.body?.preparacion_id === 'string' ? req.body.preparacion_id : '';
  const [preparacion] = await ctx.db.query<{ invocacion_hash: string; tx_id: string | null; fecha: string | null; vence: string }>(
    'SELECT invocacion_hash,tx_id,fecha,vence FROM comercio_transacciones WHERE id=$1 AND cuenta=$2 AND accion=$3', [id,cuenta,accion]);
  if (!preparacion || preparacion.invocacion_hash !== huellaInvocacion(xdr)) throw new ErrorHttp(403, 'Prepare y firme las condiciones exactas de esta operación');
  if (preparacion.tx_id) { res.json({ tx_id: preparacion.tx_id, fecha: preparacion.fecha, url_explorador: URL_EXPLORADOR + preparacion.tx_id }); return; }
  if (new Date(preparacion.vence).getTime() <= Date.now()) throw new ErrorHttp(409, 'La transacción preparada venció; vuelva a intentarlo');
  const [reservada] = await ctx.db.query('UPDATE comercio_transacciones SET enviando=true WHERE id=$1 AND NOT enviando AND tx_id IS NULL RETURNING id', [id]);
  if (!reservada) throw new ErrorHttp(409, 'Esta transacción ya se está enviando; actualice su estado');
  try {
    const resultado = await mercado.enviarTransaccion(accion, cuenta, xdr);
    await ctx.db.query('UPDATE comercio_transacciones SET tx_id=$2,fecha=$3,enviando=false WHERE id=$1', [id,resultado.txId,resultado.fecha]);
    res.json({ tx_id: resultado.txId, ledger: resultado.ledger, fecha: resultado.fecha, url_explorador: URL_EXPLORADOR + resultado.txId });
  } catch (error) {
    await ctx.db.query('UPDATE comercio_transacciones SET enviando=false WHERE id=$1 AND tx_id IS NULL', [id]);
    throw error;
  }
}
