import { Keypair } from '@stellar/stellar-sdk';
import { leerPdf } from '../almacenamiento.ts';
import { aPuntosBasicos, variableSecreto } from '../anclaje/AnclajeStellar.ts';
import { config } from '../config.ts';
import { ErrorHttp, type Contexto, type Usuario } from '../contexto.ts';
import {
  canonicalizar,
  construirRegistroContraAnalisis,
  hashRegistro,
  nuevoSalt,
  sha256Hex,
  VERSION_ESQUEMA,
} from '../integridad/canonico.ts';
import type { EstadoComercial, Mercado } from '../mercado/mercado.ts';
import type { AnalisisValidado } from '../validacion.ts';
import { prepararPdf, type PdfSubido } from './registro.ts';

export function requiereMercado(ctx: Contexto): Mercado {
  if (!ctx.mercado) throw new ErrorHttp(503, 'El marketplace requiere ANCLAJE=stellar');
  return ctx.mercado;
}

/** Comprueba en el contrato que el laboratorio puede registrar un contra-análisis del lote. */
function comprobarEstado(estado: EstadoComercial | null, cuentaLab: string) {
  if (!estado) throw new ErrorHttp(404, 'El lote no está registrado en el contrato');
  if (estado.contra_analisis) throw new ErrorHttp(409, 'El lote ya tiene un contra-análisis para esta venta');
  if (estado.estado !== 'EnGarantia') {
    throw new ErrorHttp(409, 'Solo se registra un contra-análisis mientras el lote está en garantía');
  }
  if (estado.venta?.lab === cuentaLab) {
    throw new ErrorHttp(409, 'El contra-análisis debe hacerlo un laboratorio distinto del que certificó el lote');
  }
}

/**
 * Un segundo laboratorio mide de nuevo la pureza de un lote en garantía. El
 * registro se sella con su propio hash y se envía a `counter_analysis`; la
 * fila se guarda solo cuando el contrato lo aceptó.
 *
 * TEMPORAL (hasta la etapa 4): firma el servidor con la clave del laboratorio.
 */
export async function registrarContraAnalisis(
  ctx: Contexto,
  usuario: Usuario,
  loteId: string,
  datos: AnalisisValidado,
  pdf: PdfSubido | null,
) {
  const mercado = requiereMercado(ctx);
  if (!pdf) throw new ErrorHttp(400, 'Adjunte el informe PDF del contra-análisis');
  const [lote] = await ctx.db.query('SELECT id FROM lotes WHERE id = $1', [loteId]);
  if (!lote) throw new ErrorHttp(404, `Lote ${loteId} no encontrado`);
  const [lab] = await ctx.db.query<{ id: string; cuenta_publica: string }>(
    'SELECT id, cuenta_publica FROM laboratorios WHERE id = $1',
    [usuario.laboratorio_id],
  );
  const secreto = config.stellar.secretos[lab.id];
  if (!secreto) throw new ErrorHttp(503, `Falta la clave del laboratorio en el servidor (${variableSecreto(lab.id)})`);

  comprobarEstado(await mercado.estadoLote(loteId), lab.cuenta_publica);

  const archivo = await prepararPdf(pdf);
  const registro = construirRegistroContraAnalisis({
    version_esquema: VERSION_ESQUEMA,
    lote_id: loteId,
    laboratorio_id: lab.id,
    ...datos,
    pdf_sha256: archivo.sha256,
    salt: nuevoSalt(),
  });
  const hash = hashRegistro(registro);
  const { txId, fecha } = await mercado.contrato.firmarYEnviar(
    'counter_analysis',
    { lab: lab.cuenta_publica, lote_id: loteId, hash: Buffer.from(hash, 'hex'), pureza_bps: aPuntosBasicos(datos.pureza) },
    Keypair.fromSecret(secreto),
  );

  const [fila] = await ctx.db.query(
    `INSERT INTO contra_analisis (lote_id, laboratorio_id, analista_id, fecha_analisis, metodo, pureza, composicion,
       observaciones, pdf_sha256, salt, version_esquema, hash, pdf_nombre, tx_id, fecha_anclaje)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
    [
      loteId, lab.id, usuario.id, registro.fecha_analisis, registro.metodo, registro.pureza,
      JSON.stringify(registro.composicion), registro.observaciones, registro.pdf_sha256, registro.salt,
      registro.version_esquema, hash, archivo.nombre, txId, fecha,
    ],
  );
  void mercado.indexador.sincronizar().catch(() => {});
  return fila;
}

/** Registro canónico de un contra-análisis guardado. */
export function registroDeContraAnalisis(fila: any) {
  return construirRegistroContraAnalisis({
    version_esquema: fila.version_esquema,
    lote_id: fila.lote_id,
    laboratorio_id: fila.laboratorio_id,
    fecha_analisis: fila.fecha_analisis,
    metodo: fila.metodo,
    pureza: fila.pureza,
    composicion: fila.composicion,
    observaciones: fila.observaciones,
    pdf_sha256: fila.pdf_sha256,
    salt: fila.salt,
  });
}

/**
 * Recalcula el hash desde la base de datos y lo compara con el que guarda el
 * contrato. El contrato solo conserva el contra-análisis de la última venta.
 */
export async function verificarContraAnalisis(fila: any, estado: EstadoComercial | null, cuentaLab: string) {
  const canonico = canonicalizar(registroDeContraAnalisis(fila));
  const hashRecalculado = sha256Hex(canonico);
  const pdf = await leerPdf(fila.pdf_sha256);
  const pdfOk = pdf !== null && sha256Hex(pdf) === fila.pdf_sha256;
  const enCadena = estado?.contra_analisis;
  const motivos: string[] = [];
  if (!pdfOk) motivos.push(pdf === null ? 'El informe PDF no se encuentra' : 'El informe PDF fue reemplazado o modificado');

  if (!enCadena || enCadena.lab !== cuentaLab) {
    return {
      estado: 'no_verificable' as const,
      motivos: [...motivos, 'El contrato ya no conserva este contra-análisis (el lote se volvió a publicar)'],
      hash_recalculado: hashRecalculado,
      hash_anclado: null,
      comprobaciones: { datos: null, pdf: pdfOk },
    };
  }
  const datosOk = enCadena.hash === hashRecalculado;
  if (!datosOk) motivos.push('Los datos actuales no corresponden a los registrados en el contrato');
  return {
    estado: datosOk && pdfOk ? ('integro' as const) : ('alterado' as const),
    motivos,
    hash_recalculado: hashRecalculado,
    hash_anclado: enCadena.hash,
    comprobaciones: { datos: datosOk, pdf: pdfOk },
  };
}

/** Lotes en garantía, sin contra-análisis, certificados por otro laboratorio. */
export async function lotesParaContraAnalisis(ctx: Contexto, usuario: Usuario) {
  const mercado = requiereMercado(ctx);
  const [lab] = await ctx.db.query<{ cuenta_publica: string }>('SELECT cuenta_publica FROM laboratorios WHERE id = $1', [
    usuario.laboratorio_id,
  ]);
  const lotes = await mercado.lotesFiltrados(
    (e) => e.estado === 'EnGarantia' && !e.contra_analisis && e.venta?.lab !== lab.cuenta_publica,
  );
  return lotes;
}
