import { Router } from 'express';
import { leerPdf } from '../almacenamiento.ts';
import { config } from '../config.ts';
import { ErrorHttp, type Contexto } from '../contexto.ts';
import { canonicalizar, construirRegistro } from '../integridad/canonico.ts';
import { verificarLote } from '../servicios/verificacion.ts';

/** Verificador público: no requiere sesión. */
export function rutasPublicas(ctx: Contexto) {
  const r = Router();

  r.get('/info', (_req, res) => {
    res.json({ anclaje: ctx.anclaje.nombre, motor_db: ctx.db.motor, demo_alterar: config.demoAlterar });
  });

  r.get('/lotes/:loteId', async (req, res) => {
    const resultado = await verificarLote(ctx, String(req.params.loteId).toUpperCase());
    if (!resultado) throw new ErrorHttp(404, 'No existe un lote con ese código');
    res.json(resultado);
  });

  async function buscarVersion(analisisId: string, version: string) {
    const [fila] = await ctx.db.query('SELECT * FROM analisis WHERE analisis_id = $1 AND version = $2', [
      analisisId,
      Number.parseInt(version, 10) || 0,
    ]);
    if (!fila) throw new ErrorHttp(404, 'Análisis no encontrado');
    return fila;
  }

  // Registro canónico exacto que se hashea: permite verificar sin confiar en MinerTrace.
  r.get('/analisis/:analisisId/v/:version/canonico.json', async (req, res) => {
    const fila = await buscarVersion(req.params.analisisId, req.params.version);
    const [lote] = await ctx.db.query('SELECT * FROM lotes WHERE id = $1', [fila.lote_id]);
    res
      .type('application/json; charset=utf-8')
      .attachment(`${fila.analisis_id}-v${fila.version}.canonico.json`)
      .send(canonicalizar(construirRegistro(fila, lote)));
  });

  r.get('/analisis/:analisisId/v/:version/informe.pdf', async (req, res) => {
    const fila = await buscarVersion(req.params.analisisId, req.params.version);
    const pdf = await leerPdf(fila.pdf_sha256);
    if (!pdf) throw new ErrorHttp(404, 'Informe no disponible');
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${fila.analisis_id}-v${fila.version}.pdf"`);
    res.send(pdf);
  });

  return r;
}
