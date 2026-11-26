import type { Contexto } from '../contexto.ts';
import type { InfoToken } from '../mercado/mercado.ts';
import { comisionDe, decimal, menor, unidades } from './dinero.ts';
import type { CotizacionComercial, PoliticaComercial } from './tipos.ts';

interface ConfiguracionCadena {
  version?: number;
  destinatario_plataforma: string;
  comision_bps: number;
  comision_minima: string;
  reintegro_bps: number;
  reintegro_maximo: string;
  plazo_entrega_seg: string;
}
interface LecturasComerciales {
  infoComercial?: () => Promise<{ configuracion: ConfiguracionCadena | null; token: InfoToken; plazo_garantia_seg?: string | number }>;
  ventaComercial?: (loteId: string) => Promise<unknown | null>;
  liquidacion?: (loteId: string) => Promise<unknown | null>;
  historialLiquidaciones?: (loteId: string) => Promise<unknown[]>;
}
export const lecturasComerciales = (ctx: Contexto) => ctx.mercado as unknown as LecturasComerciales | null | undefined;

/** La vista orientativa no habilita una compra ni representa dinero cobrado. */
export async function leerPolitica(ctx: Contexto): Promise<PoliticaComercial> {
  const mercado = ctx.mercado;
  const comercial = lecturasComerciales(ctx);
  if (comercial?.infoComercial) {
    const info = await comercial.infoComercial();
    const politica = info.configuracion;
    if (politica) return {
      disponible: true, origen: 'contrato', version: politica.version ?? 2,
      comision_bps: Number(politica.comision_bps),
      comision_minima: decimal(BigInt(politica.comision_minima), info.token.decimales),
      reintegro_bps: Number(politica.reintegro_bps),
      reintegro_maximo: decimal(BigInt(politica.reintegro_maximo), info.token.decimales),
      token: info.token, destinatario_plataforma: politica.destinatario_plataforma,
      plazo_entrega_seg: String(politica.plazo_entrega_seg),
      plazo_garantia_seg: info.plazo_garantia_seg == null ? null : String(info.plazo_garantia_seg),
      mensaje: 'Importes en el token del contrato. La comisión se liquida al cerrar la compra; el reintegro requiere ensayo acreditado.',
    };
    return orientativa(info.token);
  }
  return orientativa(mercado ? (await mercado.info()).token : null);
}

function orientativa(token: InfoToken | null): PoliticaComercial {
  return {
    disponible: false, origen: 'orientativa', version: 2, comision_bps: 100, comision_minima: '20',
    reintegro_bps: 25, reintegro_maximo: '100', token, destinatario_plataforma: null,
    plazo_entrega_seg: null, plazo_garantia_seg: null,
    mensaje: 'Vista orientativa: 1% con mínimo de 20 unidades del token; reintegro hasta 0,25% y 100 unidades, sujeto a acreditación y liquidación. El contrato comercial no está configurado.',
  };
}

export function cotizar(politica: PoliticaComercial, entrada: { precio: unknown; gastos_ensayo?: unknown; gastos_traslado?: unknown; oferta_externa_neta?: unknown }): CotizacionComercial {
  const decimales = politica.token?.decimales ?? 7;
  const precio = unidades(entrada.precio, decimales, false);
  const ensayo = unidades(entrada.gastos_ensayo ?? '0', decimales);
  const traslado = unidades(entrada.gastos_traslado ?? '0', decimales);
  const comision = comisionDe(precio, politica.comision_bps, unidades(politica.comision_minima, decimales));
  const reintegro = menor(precio * BigInt(politica.reintegro_bps) / 10_000n, ensayo, unidades(politica.reintegro_maximo, decimales), comision);
  const neto = precio - ensayo - traslado;
  const externa = entrada.oferta_externa_neta == null || entrada.oferta_externa_neta === '' ? null : unidades(entrada.oferta_externa_neta, decimales);
  return {
    orientativa: true, precio: decimal(precio, decimales), comision: decimal(comision, decimales),
    total_comprador: decimal(precio + comision, decimales), gastos_ensayo: decimal(ensayo, decimales), gastos_traslado: decimal(traslado, decimales),
    neto_vendedor_sin_reintegro: decimal(neto, decimales), reintegro_maximo_estimado: decimal(reintegro, decimales), reintegro_acreditado: '0',
    diferencia_oferta_externa: externa === null ? null : decimal(neto - externa, decimales),
    unidades: { precio: precio.toString(), comision: comision.toString(), total_comprador: (precio + comision).toString(), reintegro_maximo_estimado: reintegro.toString() },
  };
}
