import { leerPdf } from '../almacenamiento.ts';
import { AnclajeNoEncontrado } from '../anclaje/ServicioAnclaje.ts';
import type { Contexto } from '../contexto.ts';
import { canonicalizar, construirRegistro, sha256Hex } from '../integridad/canonico.ts';

export type EstadoVerificacion = 'integro' | 'alterado' | 'pendiente' | 'error';

export interface ResultadoVerificacion {
  estado: EstadoVerificacion;
  motivos: string[];
  hash_recalculado: string;
  hash_anclado: string | null;
  comprobaciones: {
    /** Hash de los datos actuales = hash anclado. */
    datos: boolean | null;
    /** La transacción la firmó la cuenta pública del laboratorio. */
    firma: boolean | null;
    /** El PDF almacenado coincide con el pdf_sha256 del registro. */
    pdf: boolean;
  };
  anclaje: {
    tx_id: string;
    fecha: string;
    cuenta: string;
    cuenta_laboratorio: string;
    url_explorador: string | null;
    red: string;
  } | null;
  registro_canonico: string;
}

/**
 * Recalcula el hash a partir de los datos ACTUALES de la base de datos y lo
 * compara con el anclado (MinerTrace.md, sección 9). El hash guardado en la
 * propia fila no se usa como referencia: quien altera los datos puede alterarlo.
 */
export async function verificarAnalisis(ctx: Contexto, analisis: any, lote: any, laboratorio: any): Promise<ResultadoVerificacion> {
  const canonico = canonicalizar(construirRegistro(analisis, lote));
  const hashRecalculado = sha256Hex(canonico);

  const pdf = await leerPdf(analisis.pdf_sha256);
  const pdfOk = pdf !== null && sha256Hex(pdf) === analisis.pdf_sha256;

  const base = {
    hash_recalculado: hashRecalculado,
    registro_canonico: canonico,
  };
  const motivos: string[] = [];
  if (!pdfOk) {
    motivos.push(pdf === null ? 'El informe PDF no se encuentra' : 'El informe PDF fue reemplazado o modificado');
  }

  if (!analisis.tx_id) {
    // Aún sin evidencia pública; la comparación con el hash local solo sirve de alerta temprana.
    if (hashRecalculado !== analisis.hash) motivos.push('Los datos no coinciden con la huella calculada al registrar');
    return {
      ...base,
      estado: motivos.length ? 'alterado' : 'pendiente',
      motivos: motivos.length ? motivos : ['El anclaje en la blockchain está en curso'],
      hash_anclado: null,
      comprobaciones: { datos: null, firma: null, pdf: pdfOk },
      anclaje: null,
    };
  }

  let anclado;
  try {
    anclado = await ctx.anclaje.consultarAnclaje(analisis.tx_id);
  } catch (error) {
    const noExiste = error instanceof AnclajeNoEncontrado;
    return {
      ...base,
      estado: noExiste ? 'alterado' : 'error',
      motivos: [
        ...motivos,
        noExiste
          ? 'La transacción de anclaje indicada no existe'
          : 'No se pudo consultar la blockchain; intente más tarde',
      ],
      hash_anclado: null,
      comprobaciones: { datos: null, firma: null, pdf: pdfOk },
      anclaje: null,
    };
  }

  const datosOk = anclado.hash === hashRecalculado;
  const firmaOk = anclado.cuenta === laboratorio.cuenta_publica;
  if (!datosOk) motivos.push('Los datos actuales no corresponden a los anclados');
  if (!firmaOk) motivos.push('La transacción no fue firmada por la cuenta del laboratorio');

  const integro = datosOk && firmaOk && pdfOk;
  return {
    ...base,
    estado: integro ? 'integro' : 'alterado',
    motivos,
    hash_anclado: anclado.hash,
    comprobaciones: { datos: datosOk, firma: firmaOk, pdf: pdfOk },
    anclaje: {
      tx_id: analisis.tx_id,
      fecha: anclado.fecha,
      cuenta: anclado.cuenta,
      cuenta_laboratorio: laboratorio.cuenta_publica,
      url_explorador: ctx.anclaje.urlExplorador(analisis.tx_id),
      red: ctx.anclaje.nombre,
    },
  };
}

/** Verifica todas las versiones de los análisis de un lote y la cadena de versiones. */
export async function verificarLote(ctx: Contexto, loteId: string) {
  const [lote] = await ctx.db.query('SELECT * FROM lotes WHERE id = $1', [loteId]);
  if (!lote) return null;
  const [laboratorio] = await ctx.db.query(
    'SELECT id, nombre, cuenta_publica, acreditaciones FROM laboratorios WHERE id = $1',
    [lote.laboratorio_id],
  );
  const filas = await ctx.db.query(
    `SELECT a.*, u.nombre AS analista_nombre FROM analisis a JOIN usuarios u ON u.id = a.analista_id
     WHERE a.lote_id = $1 ORDER BY a.analisis_id, a.version`,
    [loteId],
  );

  const grupos = new Map<string, any[]>();
  for (const fila of filas) {
    const verificacion = await verificarAnalisis(ctx, fila, lote, laboratorio);
    const versiones = grupos.get(fila.analisis_id) ?? [];
    const anterior = versiones.at(-1);
    // Cada versión debe apuntar a la huella anclada de la anterior.
    const enlaceOk = anterior
      ? fila.hash_anterior === (anterior.verificacion.hash_anclado ?? anterior.hash)
      : fila.hash_anterior === null;
    if (!enlaceOk) {
      verificacion.estado = 'alterado';
      verificacion.motivos.push('La versión no está enlazada con la versión anterior');
    }
    versiones.push({ ...publico(fila), verificacion });
    grupos.set(fila.analisis_id, versiones);
  }

  return {
    lote: {
      id: lote.id,
      tipo_mineral: lote.tipo_mineral,
      peso_kg: lote.peso_kg,
      origen: lote.origen,
      coordenadas: lote.coordenadas,
      creado_en: lote.creado_en,
    },
    laboratorio,
    analisis: [...grupos.entries()].map(([analisis_id, versiones]) => ({
      analisis_id,
      vigente: versiones.at(-1),
      versiones,
    })),
  };
}

/** Campos de un análisis que pueden mostrarse públicamente. */
export function publico(fila: any) {
  return {
    analisis_id: fila.analisis_id,
    version: fila.version,
    lote_id: fila.lote_id,
    laboratorio_id: fila.laboratorio_id,
    analista_nombre: fila.analista_nombre,
    fecha_analisis: fila.fecha_analisis,
    metodo: fila.metodo,
    pureza: fila.pureza,
    composicion: fila.composicion,
    observaciones: fila.observaciones,
    pdf_nombre: fila.pdf_nombre,
    pdf_sha256: fila.pdf_sha256,
    hash: fila.hash,
    hash_anterior: fila.hash_anterior,
    motivo_correccion: fila.motivo_correccion,
    estado_anclaje: fila.estado_anclaje,
    tx_id: fila.tx_id,
    fecha_anclaje: fila.fecha_anclaje,
    creado_en: fila.creado_en,
  };
}
