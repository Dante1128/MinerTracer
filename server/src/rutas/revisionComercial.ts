import { Router } from 'express';
import { cuentaComercialDe, requiereSesionComercial } from '../comercio/sesion.ts';
import { agregarEvidenciaRevision, operacionesRevision } from '../comercio/servicio.ts';
import { ErrorHttp, type Contexto } from '../contexto.ts';
import { limitarAcceso } from '../seguridad.ts';

/** La revisión prepara evidencia; la decisión económica requiere además la firma en el contrato. */
export function rutasRevisionComercial(ctx: Contexto) {
  const r = Router();
  r.use(requiereSesionComercial(ctx.db));
  r.get('/', async (req, res) => {
    if (req.query.solo_disputas !== undefined && !['true','false'].includes(String(req.query.solo_disputas))) {
      throw new ErrorHttp(400, 'Use solo_disputas=true o false');
    }
    res.json({ autorizado: true, operaciones: await operacionesRevision(ctx, cuentaComercialDe(req), req.query.solo_disputas === 'true') });
  });
  r.post('/:ordenId/evidencias', limitarAcceso(ctx.db, 'comercio-evidencia-revision', 100), async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new ErrorHttp(400, 'Envíe un objeto JSON');
    res.status(201).json(await agregarEvidenciaRevision(ctx, String(req.params.ordenId), cuentaComercialDe(req), req.body));
  });
  return r;
}
