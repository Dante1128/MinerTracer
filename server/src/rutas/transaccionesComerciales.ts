import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { cuentaComercialDe, requiereSesionComercial } from '../comercio/sesion.ts';
import { requiereSesion, usuarioDe } from '../auth.ts';
import { ErrorHttp, type Contexto } from '../contexto.ts';
import { aUnidadesMinimas, validarCuenta } from '../mercado/mercado.ts';
import { requiereMercado } from '../servicios/contraAnalisis.ts';
import { comprobarAnalisisParaCompra } from '../servicios/compra.ts';
import { huellaInvocacion, PASSPHRASE } from '../stellar/contrato.ts';
import { CODIGO_LOTE } from '../validacion.ts';
import { unidades } from '../comercio/dinero.ts';

const ACCIONES = ['reservar_venta', 'buy', 'registrar_recepcion', 'atestiguar_entrega', 'abrir_incidencia',
  'cancelar_compra', 'confirm', 'claim', 'refund', 'cancelar_venta', 'registrar_gasto_ensayo',
  'registrar_devolucion', 'resolver_incidencia'] as const;
type AccionComercial = typeof ACCIONES[number];
interface Preparacion { id: string; cuenta: string; accion: string; lote_id: string; orden_id: string | null;
  invocacion_hash: string; vence: string; tx_id: string | null; fecha: string | null; enviando: boolean; }

const texto = (valor: unknown, maximo = 200) => typeof valor === 'string' ? valor.trim().slice(0, maximo) : '';
function accionDe(req: Request): AccionComercial {
  const accion = req.body?.accion;
  if (!ACCIONES.includes(accion)) throw new ErrorHttp(400, 'La acción comercial no existe');
  return accion;
}
function loteDe(req: Request) {
  const id = texto(req.body?.lote_id).toUpperCase();
  if (!CODIGO_LOTE.test(id)) throw new ErrorHttp(400, 'Seleccione un lote válido');
  return id;
}
async function huellaEvidencia(ctx: Contexto, req: Request, cuenta: string, loteId: string): Promise<Buffer> {
  let hash = texto(req.body?.evidencia_hash ?? req.body?.comprobante_hash, 64).toLowerCase();
  if (req.body?.evidencia_id) {
    const [evidencia] = await ctx.db.query<{ hash: string; cuenta: string; lote_id: string }>(
      `SELECT e.hash,e.cuenta,o.lote_id FROM comercio_evidencias e
       JOIN comercio_operaciones o ON o.id=e.operacion_id WHERE e.id=$1`, [texto(req.body.evidencia_id)],
    );
    if (!evidencia || evidencia.cuenta !== cuenta || evidencia.lote_id !== loteId) {
      throw new ErrorHttp(403, 'La evidencia debe pertenecer a esta cuenta y a este lote');
    }
    hash = evidencia.hash;
  }
  if (!/^[a-f0-9]{64}$/.test(hash) || /^0+$/.test(hash)) {
    throw new ErrorHttp(400, 'Adjunte la evidencia o referencia del comprobante antes de firmar');
  }
  return Buffer.from(hash, 'hex');
}

export function rutasTransaccionesComerciales(ctx: Contexto) {
  const r = Router();
  r.use(async (req, res, next) => {
    if (['registrar_gasto_ensayo', 'atestiguar_entrega', 'registrar_devolucion'].includes(req.body?.accion)) {
      // El equipo ya inició sesión en el portal. La firma sigue siendo de la wallet institucional.
      await requiereSesion(ctx.db)(req, res, () => {});
      const usuario = usuarioDe(req);
      const [laboratorio] = await ctx.db.query<{ cuenta_publica: string }>('SELECT cuenta_publica FROM laboratorios WHERE id=$1', [usuario.laboratorio_id]);
      if (!laboratorio) throw new ErrorHttp(403, 'El laboratorio no tiene una cuenta firmante registrada');
      req.cuentaComercial = laboratorio.cuenta_publica;
    } else {
      await requiereSesionComercial(ctx.db)(req, res, () => {});
    }
    next();
  });

  r.post('/preparar', async (req, res) => {
    const cuenta = cuentaComercialDe(req);
    if (validarCuenta(req.body?.cuenta) !== cuenta) throw new ErrorHttp(403, 'La wallet conectada cambió; vuelva a iniciar sesión comercial');
    const accion = accionDe(req);
    const loteId = loteDe(req);
    const mercado = requiereMercado(ctx);
    if (accion === 'buy') await comprobarAnalisisParaCompra(ctx, loteId);
    const { configuracion, token, plazo_garantia_seg: plazoGarantia } = await mercado.infoComercial();
    if (!configuracion || configuracion.version < 2) {
      throw new ErrorHttp(409, 'El contrato necesita la versión comercial: despliegue el contrato actualizado y configure las tarifas');
    }
    let argumentos: Record<string, unknown>;
    let funcion: string = accion;
    let ordenId: string | null = null;
    if (accion === 'buy') {
      const estado = await mercado.estadoLote(loteId);
      const comercial = estado?.venta_comercial ?? await mercado.ventaComercial(loteId);
      if (!estado?.venta || !comercial) throw new ErrorHttp(409, 'La venta ya no está disponible');
      if (req.body?.total_esperado !== comercial.total || req.body?.analisis_id_esperado !== estado.venta.analisis_id || req.body?.version_esperada !== estado.venta.version) {
        throw new ErrorHttp(409, 'Los importes o el análisis cambiaron; actualice el desglose antes de pagar');
      }
      const esperada = texto(req.body?.orden_id);
      if (esperada !== (comercial.orden_id ?? '')) throw new ErrorHttp(409, 'El lote ahora pertenece a otro acuerdo; actualice la operación');
      if (comercial.orden_id) {
        const [orden] = await ctx.db.query<{ comprador: string; vendedor: string; precio_unidades: string; comision_unidades: string; condiciones_hash: string;
          politica: { comision_bps: number; destinatario_plataforma: string; plazo_entrega_seg: string; plazo_garantia_seg: string } }>(
          'SELECT comprador,vendedor,precio_unidades,comision_unidades,condiciones_hash,politica FROM comercio_operaciones WHERE id=$1 AND lote_id=$2', [comercial.orden_id,loteId]);
        if (!orden || orden.comprador !== cuenta || orden.vendedor !== estado.venta.vendedor || orden.precio_unidades !== estado.venta.precio || orden.condiciones_hash !== comercial.condiciones_hash ||
            orden.comision_unidades !== comercial.comision || orden.politica.comision_bps !== comercial.comision_bps ||
            orden.politica.destinatario_plataforma !== comercial.destinatario_plataforma ||
            String(orden.politica.plazo_entrega_seg) !== String(comercial.plazo_entrega_seg) ||
            String(orden.politica.plazo_garantia_seg) !== String(comercial.plazo_garantia_seg)) {
          throw new ErrorHttp(409, 'La reserva no coincide con la oferta aceptada; revise el acuerdo antes de pagar');
        }
      }
      funcion = 'financiar_orden';
      argumentos = { comprador: cuenta, lote_id: loteId, orden_id: esperada, total_esperado: BigInt(comercial.total),
        analisis_id_esperado: estado.venta.analisis_id, version_esperada: estado.venta.version };
    } else if (accion === 'reservar_venta') {
      ordenId = texto(req.body?.orden_id);
      const [orden] = await ctx.db.query<{
        id: string; vendedor: string; comprador: string; lote_id: string; precio_unidades: string;
        comision_unidades: string; condiciones_hash: string; vence: string; token: { contrato: string };
        politica: { version: number; comision_bps: number; comision_minima: string; reintegro_bps: number;
          reintegro_maximo: string; destinatario_plataforma: string; plazo_entrega_seg?: string; plazo_garantia_seg?: number };
      }>('SELECT * FROM comercio_operaciones WHERE id=$1', [ordenId]);
      if (!orden || orden.lote_id !== loteId) throw new ErrorHttp(404, 'La orden no existe para este lote');
      if (orden.vendedor !== cuenta) throw new ErrorHttp(403, 'Solo el vendedor puede firmar esta orden');
      if (new Date(orden.vence).getTime() <= Date.now()) throw new ErrorHttp(409, 'La oferta venció; acuerde una nueva');
      const precio = BigInt(orden.precio_unidades);
      const comisionCalculada = (precio * BigInt(configuracion.comision_bps) + 9999n) / 10000n;
      const comision = comisionCalculada > BigInt(configuracion.comision_minima) ? comisionCalculada : BigInt(configuracion.comision_minima);
      const politica = orden.politica;
      if (comision.toString() !== orden.comision_unidades || orden.token.contrato !== token.contrato ||
          politica.version !== configuracion.version || politica.comision_bps !== configuracion.comision_bps ||
          unidades(politica.comision_minima, token.decimales).toString() !== configuracion.comision_minima ||
          politica.reintegro_bps !== configuracion.reintegro_bps ||
          unidades(politica.reintegro_maximo, token.decimales).toString() !== configuracion.reintegro_maximo ||
          politica.destinatario_plataforma !== configuracion.destinatario_plataforma ||
          String(politica.plazo_entrega_seg ?? '') !== String(configuracion.plazo_entrega_seg) ||
          Number(politica.plazo_garantia_seg) !== plazoGarantia) {
        throw new ErrorHttp(409, 'La tarifa o la moneda cambió; vuelva a acordar la operación con los importes actuales');
      }
      argumentos = { vendedor: cuenta, lote_id: loteId, comprador: orden.comprador, precio, orden_id: orden.id,
        vence_publicacion: BigInt(Math.floor(new Date(orden.vence).getTime() / 1000)),
        condiciones_hash: Buffer.from(orden.condiciones_hash, 'hex') };
    } else if (accion === 'registrar_gasto_ensayo') {
      argumentos = { lab: cuenta, lote_id: loteId, costo: aUnidadesMinimas(texto(req.body?.costo), token.decimales),
        comprobante_hash: await huellaEvidencia(ctx, req, cuenta, loteId) };
    } else if (['registrar_recepcion', 'atestiguar_entrega', 'registrar_devolucion'].includes(accion)) {
      argumentos = { [accion === 'registrar_recepcion' ? 'comprador' : 'lab']: cuenta, lote_id: loteId,
        evidencia_hash: await huellaEvidencia(ctx, req, cuenta, loteId) };
    } else if (accion === 'abrir_incidencia') {
      const motivo = texto(req.body?.motivo, 1000);
      if (motivo.length < 10) throw new ErrorHttp(400, 'Explique lo ocurrido con al menos 10 caracteres');
      argumentos = { comprador: cuenta, lote_id: loteId, motivo };
    } else if (accion === 'resolver_incidencia') {
      if (typeof req.body?.reembolsar !== 'boolean') throw new ErrorHttp(400, 'Indique la resolución de la incidencia');
      let devolucion: Buffer = Buffer.alloc(32);
      if (req.body.reembolsar) {
        const estado = await mercado.estadoLote(loteId);
        const comercial = estado?.venta_comercial ?? await mercado.ventaComercial(loteId);
        const exigeDevolucion = !!comercial?.recepcion || !!estado?.contra_analisis;
        if (exigeDevolucion || req.body?.evidencia_hash || req.body?.evidencia_id) devolucion = await huellaEvidencia(ctx, req, cuenta, loteId);
      }
      argumentos = { admin: cuenta, lote_id: loteId, reembolsar: req.body.reembolsar,
        devolucion_hash: devolucion };
    } else {
      argumentos = { [accion === 'claim' || accion === 'cancelar_venta' ? 'vendedor' : 'comprador']: cuenta, lote_id: loteId };
    }
    if (accion === 'buy' || accion === 'confirm' || accion === 'registrar_recepcion') {
      const comercial = await mercado.ventaComercial(loteId);
      if (!comercial) throw new ErrorHttp(409, 'Esta venta ya no está disponible');
      ordenId = comercial.orden_id;
    }
    const xdr = await mercado.contrato.prepararTransaccion(funcion, argumentos, cuenta);
    const id = randomUUID();
    await ctx.db.query('DELETE FROM comercio_transacciones WHERE vence<=now() AND tx_id IS NULL AND NOT enviando');
    await ctx.db.query(
      `INSERT INTO comercio_transacciones (id,cuenta,accion,lote_id,orden_id,invocacion_hash,vence)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id,cuenta,accion,loteId,ordenId,huellaInvocacion(xdr),new Date(Date.now()+5*60_000)],
    );
    res.json({ xdr, preparacion_id: id, passphrase: PASSPHRASE });
  });

  r.post('/enviar', async (req, res) => {
    const cuenta = cuentaComercialDe(req);
    if (validarCuenta(req.body?.cuenta) !== cuenta) throw new ErrorHttp(403, 'Use la cuenta de su sesión comercial');
    const accion = accionDe(req);
    const loteId = loteDe(req);
    const id = texto(req.body?.preparacion_id);
    const [preparacion] = await ctx.db.query<Preparacion>('SELECT * FROM comercio_transacciones WHERE id=$1 AND cuenta=$2', [id,cuenta]);
    if (!preparacion || preparacion.accion !== accion || preparacion.lote_id !== loteId) {
      throw new ErrorHttp(403, 'Prepare nuevamente la operación que desea firmar');
    }
    if (preparacion.tx_id) {
      res.json({ tx_id: preparacion.tx_id, fecha: preparacion.fecha,
        url_explorador: `https://stellar.expert/explorer/testnet/tx/${preparacion.tx_id}` });
      return;
    }
    if (new Date(preparacion.vence).getTime() <= Date.now()) throw new ErrorHttp(409, 'La preparación venció; vuelva a firmar la operación');
    const xdr = texto(req.body?.xdr, 200_000);
    if (huellaInvocacion(xdr) !== preparacion.invocacion_hash) {
      throw new ErrorHttp(403, 'La transacción modificó el lote, los importes o las condiciones acordadas');
    }
    const [reservada] = await ctx.db.query(
      'UPDATE comercio_transacciones SET enviando=true WHERE id=$1 AND NOT enviando AND tx_id IS NULL RETURNING id', [id],
    );
    if (!reservada) throw new ErrorHttp(409, 'Esta transacción ya se está enviando; actualice el estado de la operación');
    try {
      const mercado = requiereMercado(ctx);
      const resultado = await mercado.contrato.enviarFirmada(xdr, { funcion: accion === 'buy' ? 'financiar_orden' : accion, cuenta });
      await ctx.db.query('UPDATE comercio_transacciones SET tx_id=$2,fecha=$3,enviando=false WHERE id=$1', [id,resultado.txId,resultado.fecha]);
      await mercado.indexador.sincronizar().catch(() => {});
      res.json({ tx_id: resultado.txId, fecha: resultado.fecha,
        url_explorador: `https://stellar.expert/explorer/testnet/tx/${resultado.txId}` });
    } catch (error) {
      await ctx.db.query('UPDATE comercio_transacciones SET enviando=false WHERE id=$1 AND tx_id IS NULL', [id]);
      throw error;
    }
  });
  return r;
}
