import { Router } from 'express';
import { sobrescribirPdf } from '../almacenamiento.ts';
import { requiereSesion, usuarioDe } from '../auth.ts';
import { ErrorHttp, type Contexto } from '../contexto.ts';
import { construirRegistro, hashRegistro } from '../integridad/canonico.ts';
import { pdfSimple } from '../pdfSimple.ts';
import { validarPureza } from '../validacion.ts';

/**
 * SOLO DEMOSTRACIÓN (DEMO_ALTERAR=true, nunca en producción).
 *
 * Simula al intermediario de la sección 13 de MinerTrace.md: alguien con acceso
 * directo a la base de datos que desactiva la protección de solo inserción,
 * cambia la pureza, recalcula el hash guardado en la fila para cubrir sus
 * huellas y sustituye el PDF. Aun así el verificador lo detecta, porque el
 * hash anclado no se puede cambiar.
 */
export function rutasDemo(ctx: Contexto) {
  const r = Router();
  r.use(requiereSesion);

  r.post('/alterar', async (req, res) => {
    const usuario = usuarioDe(req);
    const analisisId = String(req.body?.analisis_id ?? '');
    const pureza = validarPureza(req.body?.pureza);

    const [fila] = await ctx.db.query(
      'SELECT * FROM analisis WHERE analisis_id = $1 AND laboratorio_id = $2 ORDER BY version DESC LIMIT 1',
      [analisisId, usuario.laboratorio_id],
    );
    if (!fila) throw new ErrorHttp(404, 'Análisis no encontrado');
    const [lote] = await ctx.db.query('SELECT * FROM lotes WHERE id = $1', [fila.lote_id]);

    const hashFalso = hashRegistro(construirRegistro({ ...fila, pureza }, lote));
    await ctx.db.exec('ALTER TABLE analisis DISABLE TRIGGER mt_analisis_protegido');
    try {
      await ctx.db.query('UPDATE analisis SET pureza = $2, hash = $3 WHERE id = $1', [fila.id, pureza, hashFalso]);
    } finally {
      await ctx.db.exec('ALTER TABLE analisis ENABLE TRIGGER mt_analisis_protegido');
    }

    if (req.body?.falsificar_pdf) {
      await sobrescribirPdf(
        fila.pdf_sha256,
        pdfSimple(`Informe de analisis ${fila.analisis_id}`, [`Lote: ${fila.lote_id}`, `Pureza: ${pureza} %`]),
      );
    }

    console.warn(`[demo] ${usuario.email} alteró ${analisisId} v${fila.version}: pureza ${fila.pureza} -> ${pureza}`);
    res.json({ analisis_id: analisisId, version: fila.version, pureza_original: fila.pureza, pureza_nueva: pureza });
  });

  return r;
}
