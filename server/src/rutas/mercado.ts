import { Router } from 'express';
import * as mercado from '../controladores/mercado.ts';
import type { Contexto } from '../contexto.ts';
import { enlazar, type Controlador } from './enlazar.ts';

/** Rutas: marketplace con garantía, público, sin sesión (lógica en ../controladores/mercado.ts). */
export function rutasMercado(ctx: Contexto) {
  const r = Router();
  const con = (controlador: Controlador) => enlazar(ctx, controlador);

  r.get('/info', con(mercado.info));
  r.get('/lotes', con(mercado.listarLotes));
  r.get('/lotes/:loteId', con(mercado.verLote));
  r.get('/cuentas/:cuenta/lotes', con(mercado.lotesDeCuenta));
  r.post('/transacciones', con(mercado.prepararTransaccion));
  r.post('/transacciones/enviar', con(mercado.enviarTransaccion));

  return r;
}
