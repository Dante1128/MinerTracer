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
  type RegistroContraAnalisis,
} from '../integridad/canonico.ts';
import type { EstadoComercial, Mercado } from '../mercado/mercado.ts';
import { CODIGO_LOTE, validarAnalisis, type AnalisisValidado } from '../validacion.ts';
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

interface Preparado {
  registro: RegistroContraAnalisis;
  hash: string;
  cuenta: string;
  pdfNombre: string;
}

/**
 * Comprueba en el contrato que el laboratorio del usuario puede registrar el
 * contra-análisis, guarda el PDF y sella el registro con su propio hash.
 */
async function prepararRegistro(
  ctx: Contexto,
  usuario: Usuario,
  loteId: string,
  datos: AnalisisValidado,
  pdf: PdfSubido | null,
): Promise<Preparado> {
  const mercado = requiereMercado(ctx);
  if (!pdf) throw new ErrorHttp(400, 'Adjunte el informe PDF del contra-análisis');
  const [lote] = await ctx.db.query('SELECT id FROM lotes WHERE id = $1', [loteId]);
  if (!lote) throw new ErrorHttp(404, `Lote ${loteId} no encontrado`);
  const lab = await laboratorioDe(ctx, usuario);
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
  return { registro, hash: hashRegistro(registro), cuenta: lab.cuenta_publica, pdfNombre: archivo.nombre };
}

async function laboratorioDe(ctx: Contexto, usuario: Usuario) {
  const [lab] = await ctx.db.query<{ id: string; cuenta_publica: string }>(
    'SELECT id, cuenta_publica FROM laboratorios WHERE id = $1',
    [usuario.laboratorio_id],
  );
  return lab;
}

const argumentosContrato = (p: Preparado) => ({
  lab: p.cuenta,
  lote_id: p.registro.lote_id,
  hash: Buffer.from(p.hash, 'hex'),
  pureza_bps: aPuntosBasicos(p.registro.pureza),
});

/** Se guarda solo después de que el contrato aceptó el contra-análisis. */
async function guardar(ctx: Contexto, usuario: Usuario, p: Preparado, txId: string, fecha: string) {
  const r = p.registro;
  const [fila] = await ctx.db.query(
    `INSERT INTO contra_analisis (lote_id, laboratorio_id, analista_id, fecha_analisis, metodo, pureza, composicion,
       observaciones, pdf_sha256, salt, version_esquema, hash, pdf_nombre, tx_id, fecha_anclaje)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
    [
      r.lote_id, r.laboratorio_id, usuario.id, r.fecha_analisis, r.metodo, r.pureza,
      JSON.stringify(r.composicion), r.observaciones, r.pdf_sha256, r.salt,
      r.version_esquema, p.hash, p.pdfNombre, txId, fecha,
    ],
  );
  void requiereMercado(ctx).indexador.sincronizar().catch(() => {});
  return fila;
}

/**
 * Un segundo laboratorio mide de nuevo la pureza de un lote en garantía.
 * Paso 1 (firma con wallet): devuelve el registro sellado y la transacción
 * `counter_analysis` sin firmar para Freighter. Todavía no se guarda nada.
 */
export async function prepararContraAnalisis(
  ctx: Contexto,
  usuario: Usuario,
  loteId: string,
  datos: AnalisisValidado,
  pdf: PdfSubido | null,
  cuenta: string,
) {
  const lab = await laboratorioDe(ctx, usuario);
  if (cuenta !== lab.cuenta_publica) {
    throw new ErrorHttp(403, `Conecte en Freighter la cuenta del laboratorio (${lab.cuenta_publica})`);
  }
  const p = await prepararRegistro(ctx, usuario, loteId, datos, pdf);
  const xdr = await requiereMercado(ctx).contrato.prepararTransaccion('counter_analysis', argumentosContrato(p), p.cuenta);
  return { xdr, registro: p.registro, pdf_nombre: p.pdfNombre };
}

/**
 * Paso 2: envía la transacción firmada por la wallet del laboratorio y guarda
 * el contra-análisis solo si el contrato registró exactamente este hash.
 */
export async function enviarContraAnalisis(ctx: Contexto, usuario: Usuario, entrada: Record<string, unknown>, xdrFirmado: string) {
  const mercado = requiereMercado(ctx);
  const lab = await laboratorioDe(ctx, usuario);
  const crudo = (entrada.registro ?? {}) as Record<string, unknown>;
  if (crudo.laboratorio_id !== lab.id) throw new ErrorHttp(403, 'El registro no es de su laboratorio');
  if (crudo.version_esquema !== VERSION_ESQUEMA) throw new ErrorHttp(400, 'Versión de esquema no soportada');
  const loteId = String(crudo.lote_id ?? '');
  const pdfSha = String(crudo.pdf_sha256 ?? '');
  const salt = String(crudo.salt ?? '');
  if (!CODIGO_LOTE.test(loteId) || !/^[0-9a-f]{32}$/.test(salt)) throw new ErrorHttp(400, 'Registro inválido');
  const pdf = await leerPdf(pdfSha);
  if (!pdf || sha256Hex(pdf) !== pdfSha) throw new ErrorHttp(400, 'El informe PDF del registro no está en el servidor');

  // Mismo formato y normalización que al preparar: si el cliente cambió algo, el hash no coincidirá con el del contrato.
  const datos = validarAnalisis(crudo);
  const registro = construirRegistroContraAnalisis({
    version_esquema: VERSION_ESQUEMA,
    lote_id: loteId,
    laboratorio_id: lab.id,
    ...datos,
    pdf_sha256: pdfSha,
    salt,
  });
  const p: Preparado = {
    registro,
    hash: hashRegistro(registro),
    cuenta: lab.cuenta_publica,
    pdfNombre: String(entrada.pdf_nombre ?? 'contra-analisis.pdf').slice(0, 200),
  };

  const { txId, fecha } = await mercado.contrato.enviarFirmada(xdrFirmado, { funcion: 'counter_analysis', cuenta: p.cuenta });
  const enCadena = (await mercado.estadoLote(loteId))?.contra_analisis;
  if (enCadena?.hash !== p.hash || enCadena.lab !== p.cuenta) {
    throw new ErrorHttp(409, 'La transacción se confirmó, pero el contrato registró otro contra-análisis');
  }
  return guardar(ctx, usuario, p, txId, fecha);
}

/**
 * Contra-análisis firmado por el servidor con la clave del laboratorio: solo
 * para pruebas y FIRMA_LABORATORIO=servidor. En el portal firma la wallet.
 */
export async function registrarContraAnalisis(
  ctx: Contexto,
  usuario: Usuario,
  loteId: string,
  datos: AnalisisValidado,
  pdf: PdfSubido | null,
) {
  const mercado = requiereMercado(ctx);
  const lab = await laboratorioDe(ctx, usuario);
  const secreto = config.stellar.secretos[lab.id];
  if (!secreto) throw new ErrorHttp(503, `Falta la clave del laboratorio en el servidor (${variableSecreto(lab.id)})`);
  const p = await prepararRegistro(ctx, usuario, loteId, datos, pdf);
  const { txId, fecha } = await mercado.contrato.firmarYEnviar('counter_analysis', argumentosContrato(p), Keypair.fromSecret(secreto));
  return guardar(ctx, usuario, p, txId, fecha);
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
