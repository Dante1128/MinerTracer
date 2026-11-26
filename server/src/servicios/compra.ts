import { ErrorHttp, type Contexto } from '../contexto.ts';
import { verificarLote } from './verificacion.ts';

/** Verifica el análisis exacto que la venta utiliza; conserva la recalculación desde los datos actuales. */
export async function comprobarAnalisisParaCompra(ctx: Contexto, loteId: string) {
  if (!ctx.mercado) throw new ErrorHttp(503, 'El mercado no está disponible');
  const estado = await ctx.mercado.estadoLote(loteId);
  if (!estado?.venta) throw new ErrorHttp(409, 'El lote ya no tiene una venta disponible');
  const resultado = await verificarLote(ctx, loteId);
  const analisis = resultado?.analisis.find((grupo) => grupo.analisis_id === estado.venta!.analisis_id)
    ?.versiones.find((version) => version.version === estado.venta!.version);
  if (!analisis || analisis.verificacion.estado !== 'integro') {
    throw new ErrorHttp(409, 'El análisis de esta venta no pudo verificarse íntegro; revise el informe antes de comprar');
  }
}
