import { Router, type Request, type Response } from 'express';
import { ErrorHttp, type Contexto } from '../contexto.ts';
import { ACCIONES, validarCuenta, type Accion } from '../mercado/mercado.ts';
import { requiereMercado, verificarContraAnalisis } from '../servicios/contraAnalisis.ts';
import { CODIGO_LOTE } from '../validacion.ts';

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

/** Marketplace con garantía: público, sin sesión. Las cuentas se identifican con su wallet. */
export function rutasMercado(ctx: Contexto) {
  const r = Router();

  r.get('/info', async (_req, res) => {
    if (!ctx.mercado) {
      res.json({ habilitado: false });
      return;
    }
    res.json({ habilitado: true, ...(await ctx.mercado.info()) });
  });

  r.get('/lotes', async (_req, res) => {
    res.json(await requiereMercado(ctx).lotesEnVenta());
  });

  /** Estado comercial, línea de tiempo y contra-análisis de un lote. */
  r.get('/lotes/:loteId', async (req: Request, res: Response) => {
    const mercado = requiereMercado(ctx);
    const loteId = loteDe(req);
    const [lote] = await ctx.db.query('SELECT id, tipo_mineral, origen, peso_kg FROM lotes WHERE id = $1', [loteId]);
    const estado = await mercado.estadoLote(loteId);
    if (!estado && !lote) throw new ErrorHttp(404, 'No existe un lote con ese código');

    const [conDatos] = estado ? await mercado.lotesFiltrados((e) => e.lote_id === loteId) : [null];
    const filas = await ctx.db.query(
      `SELECT c.*, l.nombre AS laboratorio_nombre, l.cuenta_publica, u.nombre AS analista_nombre
       FROM contra_analisis c JOIN laboratorios l ON l.id = c.laboratorio_id JOIN usuarios u ON u.id = c.analista_id
       WHERE c.lote_id = $1 ORDER BY c.id`,
      [loteId],
    );
    const contraAnalisis = await Promise.all(
      filas.map(async (f, i) => ({
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
  });

  r.get('/cuentas/:cuenta/lotes', async (req, res) => {
    res.json(await requiereMercado(ctx).lotesDeCuenta(validarCuenta(req.params.cuenta)));
  });

  /** Arma la transacción sin firmar; la firma la wallet de la cuenta. */
  r.post('/transacciones', async (req, res) => {
    const mercado = requiereMercado(ctx);
    const accion = accionDe(req.body?.accion);
    const cuenta = validarCuenta(req.body?.cuenta);
    const xdr = await mercado.prepararTransaccion(accion, cuenta, loteDe(req), req.body?.precio);
    res.json({ xdr, passphrase: (await mercado.info()).passphrase });
  });

  /** Envía la transacción firmada por la wallet y espera la confirmación. */
  r.post('/transacciones/enviar', async (req, res) => {
    const mercado = requiereMercado(ctx);
    const accion = accionDe(req.body?.accion);
    const cuenta = validarCuenta(req.body?.cuenta);
    const xdr = String(req.body?.xdr ?? '');
    if (!xdr) throw new ErrorHttp(400, 'Falta la transacción firmada');
    const resultado = await mercado.enviarTransaccion(accion, cuenta, xdr);
    res.json({ tx_id: resultado.txId, ledger: resultado.ledger, fecha: resultado.fecha, url_explorador: URL_EXPLORADOR + resultado.txId });
  });

  return r;
}
