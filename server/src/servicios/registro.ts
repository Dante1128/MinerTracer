import { guardarPdf, esPdf } from '../almacenamiento.ts';
import { ErrorHttp, type Contexto, type Usuario } from '../contexto.ts';
import {
  VERSION_ESQUEMA,
  construirRegistro,
  hashRegistro,
  nuevoSalt,
  type DatosAnalisis,
} from '../integridad/canonico.ts';
import type { AnalisisValidado, LoteValidado } from '../validacion.ts';

export interface PdfSubido {
  buffer: Buffer;
  nombre: string;
}

const anio = () => new Date().getUTCFullYear();

export async function registrarLote(ctx: Contexto, usuario: Usuario, datos: LoteValidado) {
  let id = datos.codigo;
  if (!id) {
    const [{ n }] = await ctx.db.query<{ n: number }>("SELECT nextval('seq_lote') AS n");
    id = `LT-${anio()}-${String(n).padStart(4, '0')}`;
  }
  const [existe] = await ctx.db.query('SELECT 1 FROM lotes WHERE id = $1', [id]);
  if (existe) throw new ErrorHttp(409, `El lote ${id} ya existe`);

  const [lote] = await ctx.db.query(
    `INSERT INTO lotes (id, laboratorio_id, tipo_mineral, peso_kg, origen, coordenadas, creado_por, dueno)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [id, usuario.laboratorio_id, datos.tipo_mineral, datos.peso_kg, datos.origen, datos.coordenadas, usuario.id, datos.dueno],
  );
  return lote;
}

async function prepararPdf(pdf: PdfSubido) {
  if (!esPdf(pdf.buffer)) throw new ErrorHttp(400, 'El informe debe ser un archivo PDF');
  const sha256 = await guardarPdf(pdf.buffer);
  return { sha256, nombre: pdf.nombre.slice(0, 200) || 'informe.pdf' };
}

async function insertarAnalisis(
  ctx: Contexto,
  usuario: Usuario,
  datos: Omit<DatosAnalisis, 'salt' | 'version_esquema' | 'laboratorio_id'>,
  pdfNombre: string,
) {
  const [lote] = await ctx.db.query('SELECT * FROM lotes WHERE id = $1', [datos.lote_id]);
  if (!lote) throw new ErrorHttp(404, `Lote ${datos.lote_id} no encontrado`);
  if (lote.laboratorio_id !== usuario.laboratorio_id) {
    throw new ErrorHttp(403, 'El lote pertenece a otro laboratorio');
  }

  const completo: DatosAnalisis = {
    ...datos,
    laboratorio_id: usuario.laboratorio_id,
    version_esquema: VERSION_ESQUEMA,
    salt: nuevoSalt(),
  };
  const hash = hashRegistro(construirRegistro(completo, lote));

  const [fila] = await ctx.db.query(
    `INSERT INTO analisis (analisis_id, version, lote_id, laboratorio_id, analista_id, fecha_analisis,
       metodo, pureza, composicion, observaciones, pdf_sha256, salt, version_esquema, hash_anterior,
       motivo_correccion, hash, pdf_nombre)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [
      completo.analisis_id, completo.version, completo.lote_id, completo.laboratorio_id, usuario.id,
      completo.fecha_analisis, completo.metodo, completo.pureza, JSON.stringify(completo.composicion),
      completo.observaciones, completo.pdf_sha256, completo.salt, completo.version_esquema,
      completo.hash_anterior, completo.motivo_correccion, hash, pdfNombre,
    ],
  );
  // El anclaje es asíncrono: el registro ya está a salvo en la base de datos.
  void ctx.procesador.procesar();
  return fila;
}

export async function registrarAnalisis(
  ctx: Contexto,
  usuario: Usuario,
  loteId: string,
  datos: AnalisisValidado,
  pdf: PdfSubido | null,
) {
  if (!pdf) throw new ErrorHttp(400, 'Adjunte el informe PDF');
  // Se comprueba antes de guardar el PDF y de consumir la secuencia, para no dejar huérfanos ni saltos.
  const [lote] = await ctx.db.query('SELECT laboratorio_id FROM lotes WHERE id = $1', [loteId]);
  if (!lote) throw new ErrorHttp(404, `Lote ${loteId} no encontrado`);
  if (lote.laboratorio_id !== usuario.laboratorio_id) throw new ErrorHttp(403, 'El lote pertenece a otro laboratorio');

  const archivo = await prepararPdf(pdf);
  const [{ n }] = await ctx.db.query<{ n: number }>("SELECT nextval('seq_analisis') AS n");
  return insertarAnalisis(
    ctx,
    usuario,
    {
      ...datos,
      analisis_id: `AN-${anio()}-${String(n).padStart(4, '0')}`,
      version: 1,
      lote_id: loteId,
      hash_anterior: null,
      motivo_correccion: null,
      pdf_sha256: archivo.sha256,
    },
    archivo.nombre,
  );
}

/** Una corrección nunca sobrescribe: crea la versión N+1 enlazada al hash de la versión N. */
export async function registrarCorreccion(
  ctx: Contexto,
  usuario: Usuario,
  analisisId: string,
  datos: AnalisisValidado,
  motivo: string,
  pdf: PdfSubido | null,
) {
  if (usuario.rol !== 'supervisor') throw new ErrorHttp(403, 'Solo un supervisor puede registrar correcciones');
  const [anterior] = await ctx.db.query(
    'SELECT * FROM analisis WHERE analisis_id = $1 ORDER BY version DESC LIMIT 1',
    [analisisId],
  );
  if (!anterior) throw new ErrorHttp(404, `Análisis ${analisisId} no encontrado`);
  if (anterior.laboratorio_id !== usuario.laboratorio_id) {
    throw new ErrorHttp(403, 'El análisis pertenece a otro laboratorio');
  }

  const archivo = pdf ? await prepararPdf(pdf) : { sha256: anterior.pdf_sha256, nombre: anterior.pdf_nombre };
  try {
    return await insertarAnalisis(
      ctx,
      usuario,
      {
        ...datos,
        analisis_id: analisisId,
        version: anterior.version + 1,
        lote_id: anterior.lote_id,
        hash_anterior: anterior.hash,
        motivo_correccion: motivo,
        pdf_sha256: archivo.sha256,
      },
      archivo.nombre,
    );
  } catch (error) {
    if (String((error as Error).message).includes('duplicate key')) {
      throw new ErrorHttp(409, 'Otra corrección se registró al mismo tiempo; recargue e intente de nuevo');
    }
    throw error;
  }
}
