import bcrypt from 'bcryptjs';
import { Router } from 'express';
import multer from 'multer';
import { firmarToken, requiereSesion, usuarioDe } from '../auth.ts';
import { config } from '../config.ts';
import { ErrorHttp, type Contexto, type Usuario } from '../contexto.ts';
import { registrarAnalisis, registrarCorreccion, registrarLote, type PdfSubido } from '../servicios/registro.ts';
import { publico, verificarAnalisis } from '../servicios/verificacion.ts';
import { validarAnalisis, validarLote, validarMotivo } from '../validacion.ts';

const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxPdfBytes, files: 1 } });

const pdfDe = (archivo: Express.Multer.File | undefined): PdfSubido | null =>
  archivo ? { buffer: archivo.buffer, nombre: Buffer.from(archivo.originalname, 'latin1').toString('utf8') } : null;

export function rutasLaboratorio(ctx: Contexto) {
  const r = Router();

  r.post('/auth/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    const [fila] = await ctx.db.query('SELECT * FROM usuarios WHERE email = $1', [String(email ?? '').trim().toLowerCase()]);
    if (!fila || !(await bcrypt.compare(String(password ?? ''), fila.password_hash))) {
      throw new ErrorHttp(401, 'Correo o contraseña incorrectos');
    }
    const usuario: Usuario = {
      id: fila.id,
      email: fila.email,
      nombre: fila.nombre,
      rol: fila.rol,
      laboratorio_id: fila.laboratorio_id,
    };
    res.json({ token: firmarToken(usuario), usuario });
  });

  r.use(['/auth/yo', '/lotes', '/analisis'], requiereSesion);

  r.get('/auth/yo', async (req, res) => {
    const usuario = usuarioDe(req);
    const [laboratorio] = await ctx.db.query('SELECT * FROM laboratorios WHERE id = $1', [usuario.laboratorio_id]);
    res.json({ usuario, laboratorio });
  });

  r.get('/lotes', async (req, res) => {
    const lotes = await ctx.db.query(
      `SELECT l.*, COUNT(DISTINCT a.analisis_id)::int AS total_analisis
       FROM lotes l LEFT JOIN analisis a ON a.lote_id = l.id
       WHERE l.laboratorio_id = $1 GROUP BY l.id ORDER BY l.creado_en DESC`,
      [usuarioDe(req).laboratorio_id],
    );
    res.json(lotes);
  });

  r.post('/lotes', async (req, res) => {
    const lote = await registrarLote(ctx, usuarioDe(req), validarLote(req.body ?? {}));
    res.status(201).json(lote);
  });

  r.get('/analisis', async (req, res) => {
    // Solo la versión vigente de cada análisis.
    const filas = await ctx.db.query(
      `SELECT DISTINCT ON (a.analisis_id) a.*, l.tipo_mineral, l.origen, u.nombre AS analista_nombre
       FROM analisis a JOIN lotes l ON l.id = a.lote_id JOIN usuarios u ON u.id = a.analista_id
       WHERE a.laboratorio_id = $1
       ORDER BY a.analisis_id DESC, a.version DESC`,
      [usuarioDe(req).laboratorio_id],
    );
    res.json(
      filas.map((f) => ({
        ...publico(f),
        tipo_mineral: f.tipo_mineral,
        origen: f.origen,
        intentos_anclaje: f.intentos_anclaje,
        ultimo_error: f.ultimo_error,
      })),
    );
  });

  r.get('/analisis/:analisisId', async (req, res) => {
    const usuario = usuarioDe(req);
    const versiones = await ctx.db.query(
      `SELECT a.*, u.nombre AS analista_nombre FROM analisis a JOIN usuarios u ON u.id = a.analista_id
       WHERE a.analisis_id = $1 AND a.laboratorio_id = $2 ORDER BY a.version`,
      [req.params.analisisId, usuario.laboratorio_id],
    );
    if (versiones.length === 0) throw new ErrorHttp(404, 'Análisis no encontrado');
    const [lote] = await ctx.db.query('SELECT * FROM lotes WHERE id = $1', [versiones[0].lote_id]);
    const [laboratorio] = await ctx.db.query('SELECT * FROM laboratorios WHERE id = $1', [usuario.laboratorio_id]);
    res.json({
      lote,
      versiones: await Promise.all(
        versiones.map(async (v) => ({
          ...publico(v),
          intentos_anclaje: v.intentos_anclaje,
          ultimo_error: v.ultimo_error,
          verificacion: await verificarAnalisis(ctx, v, lote, laboratorio),
        })),
      ),
    });
  });

  r.post('/analisis', subida.single('pdf'), async (req, res) => {
    const datos = validarAnalisis(req.body ?? {});
    const loteId = String(req.body?.lote_id ?? '');
    const fila = await registrarAnalisis(ctx, usuarioDe(req), loteId, datos, pdfDe(req.file));
    res.status(201).json(publico(fila));
  });

  r.post('/analisis/:analisisId/versiones', subida.single('pdf'), async (req, res) => {
    const datos = validarAnalisis(req.body ?? {});
    const motivo = validarMotivo(req.body ?? {});
    const fila = await registrarCorreccion(ctx, usuarioDe(req), String(req.params.analisisId), datos, motivo, pdfDe(req.file));
    res.status(201).json(publico(fila));
  });

  return r;
}
