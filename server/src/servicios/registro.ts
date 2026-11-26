import { guardarPdf, esPdf } from '../almacenamiento.ts';
import { ErrorHttp, type Contexto, type Usuario } from '../contexto.ts';
import {
  VERSION_ESQUEMA,
  construirRegistro,
  hashRegistro,
  nuevoSalt,
  type DatosAnalisis,
} from '../integridad/canonico.ts';
import * as modeloAnalisis from '../modelos/analisis.ts';
import * as modeloLotes from '../modelos/lotes.ts';
import type { AnalisisValidado, LoteValidado } from '../validacion.ts';

export interface PdfSubido {
  buffer: Buffer;
  nombre: string;
}

const anio = () => new Date().getUTCFullYear();

export async function registrarLote(ctx: Contexto, usuario: Usuario, datos: LoteValidado) {
  const id = datos.codigo || await modeloLotes.siguienteCodigo(ctx.db, anio());
  if (await modeloLotes.existe(ctx.db, id)) throw new ErrorHttp(409, `El lote ${id} ya existe`);

  return modeloLotes.crear(ctx.db, {
    id,
    laboratorio_id: usuario.laboratorio_id,
    tipo_mineral: datos.tipo_mineral,
    peso_kg: datos.peso_kg,
    origen: datos.origen,
    coordenadas: datos.coordenadas,
    creado_por: usuario.id,
    dueno: datos.dueno,
  });
}

export async function prepararPdf(pdf: PdfSubido) {
  if (!esPdf(pdf.buffer)) throw new ErrorHttp(400, 'El informe debe ser un archivo PDF');
  const sha256 = await guardarPdf(pdf.buffer);
  return { sha256, nombre: pdf.nombre.slice(0, 200) || 'informe.pdf' };
}

/** `firmaServidor`: el servidor firma el anclaje aunque los laboratorios firmen con su wallet (semilla, pruebas). */
export interface OpcionesRegistro {
  firmaServidor?: boolean;
}

async function insertarAnalisis(
  ctx: Contexto,
  usuario: Usuario,
  datos: Omit<DatosAnalisis, 'salt' | 'version_esquema' | 'laboratorio_id'>,
  pdfNombre: string,
  opciones: OpcionesRegistro,
) {
  const lote = await modeloLotes.buscarPorId(ctx.db, datos.lote_id);
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

  const fila = await modeloAnalisis.insertar(ctx.db, {
    ...completo,
    analista_id: usuario.id,
    hash,
    pdf_nombre: pdfNombre,
    firma_servidor: opciones.firmaServidor === true,
  });
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
  opciones: OpcionesRegistro = {},
) {
  if (!pdf) throw new ErrorHttp(400, 'Adjunte el informe PDF');
  // Se comprueba antes de guardar el PDF y de consumir la secuencia, para no dejar huérfanos ni saltos.
  const lote = await modeloLotes.buscarPorId(ctx.db, loteId);
  if (!lote) throw new ErrorHttp(404, `Lote ${loteId} no encontrado`);
  if (lote.laboratorio_id !== usuario.laboratorio_id) throw new ErrorHttp(403, 'El lote pertenece a otro laboratorio');

  const archivo = await prepararPdf(pdf);
  const analisisId = await modeloAnalisis.siguienteCodigo(ctx.db, anio());
  return insertarAnalisis(
    ctx,
    usuario,
    {
      ...datos,
      analisis_id: analisisId,
      version: 1,
      lote_id: loteId,
      hash_anterior: null,
      motivo_correccion: null,
      pdf_sha256: archivo.sha256,
    },
    archivo.nombre,
    opciones,
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
  opciones: OpcionesRegistro = {},
) {
  if (usuario.rol !== 'supervisor') throw new ErrorHttp(403, 'Solo un supervisor puede registrar correcciones');
  const anterior = await modeloAnalisis.buscarUltimaVersion(ctx.db, analisisId);
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
      opciones,
    );
  } catch (error) {
    if (String((error as Error).message).includes('duplicate key')) {
      throw new ErrorHttp(409, 'Otra corrección se registró al mismo tiempo; recargue e intente de nuevo');
    }
    throw error;
  }
}
