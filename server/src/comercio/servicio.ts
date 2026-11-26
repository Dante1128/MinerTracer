import { createHash, randomUUID } from 'node:crypto';
import canonicalize from 'canonicalize';
import { ErrorHttp, type Contexto } from '../contexto.ts';
import type { Consultas, Db } from '../db/index.ts';
import type { InfoToken, LiquidacionComercial } from '../mercado/mercado.ts';
import { validarCuenta } from '../mercado/mercado.ts';
import { verificarLote } from '../servicios/verificacion.ts';
import { CODIGO_LOTE, ErrorValidacion } from '../validacion.ts';
import { decimal, normalizarImporte, unidades } from './dinero.ts';
import { cotizar, leerPolitica } from './politica.ts';
import type { AnuncioComercial, EvidenciaComercial, OfertaComercial, OrdenComercial, PerfilComercial, PerfilPublico } from './tipos.ts';

type Fila = Record<string, any>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const iso = (valor: string | Date) => new Date(valor).toISOString();
const huella = (valor: unknown) => createHash('sha256').update(canonicalize(valor) ?? '').digest('hex');

function texto(entrada: Fila, campo: string, maximo: number, obligatorio = false): string {
  const valor = typeof entrada[campo] === 'string' ? entrada[campo].trim().normalize('NFC') : '';
  if ((obligatorio && !valor) || valor.length > maximo) throw new ErrorValidacion({ [campo]: obligatorio && !valor ? 'Campo obligatorio' : `Máximo ${maximo} caracteres` });
  return valor;
}
function idCliente(entrada: Fila) {
  const id = entrada.cliente_id == null ? randomUUID() : entrada.cliente_id;
  if (typeof id !== 'string' || !UUID.test(id)) throw new ErrorHttp(400, 'Identificador de sincronización inválido');
  return id;
}
function loteDe(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const id = typeof valor === 'string' ? valor.trim().toUpperCase() : '';
  if (!CODIGO_LOTE.test(id)) throw new ErrorValidacion({ lote_id: 'Código de lote inválido' });
  return id;
}
function vencimiento(valor: unknown, maximo = Date.now() + 30 * 86_400_000): string {
  const fecha = typeof valor === 'string' ? new Date(valor) : new Date(NaN);
  if (!Number.isFinite(fecha.getTime()) || fecha.getTime() <= Date.now() || fecha.getTime() > maximo) {
    throw new ErrorValidacion({ vence: 'Indique un vencimiento futuro, dentro del plazo del anuncio y hasta 30 días' });
  }
  return fecha.toISOString();
}
async function repetido(db: Consultas, tabla: 'comercio_anuncios' | 'comercio_ofertas' | 'comercio_evidencias', cuenta: string, clienteId: string, hash: string) {
  const [anterior] = await db.query<Fila>(`SELECT * FROM ${tabla} WHERE cuenta=$1 AND cliente_id=$2`, [cuenta, clienteId]);
  if (anterior && anterior.entrada_hash !== hash) throw new ErrorHttp(409, 'Ese identificador ya se utilizó con otros datos');
  return anterior;
}

export async function obtenerPerfil(db: Consultas, cuenta: string): Promise<PerfilComercial | null> {
  const [fila] = await db.query<Fila>('SELECT * FROM comercio_perfiles WHERE cuenta=$1', [cuenta]);
  return fila ? { ...perfilPublico(fila), contacto: fila.contacto, documento_ref: fila.documento_ref, actualizado_en: iso(fila.actualizado_en) } : null;
}
function perfilPublico(fila: Fila): PerfilPublico {
  return { cuenta: fila.cuenta, nombre: fila.nombre, organizacion: fila.organizacion, tipo: fila.tipo, zona: fila.zona, verificado: false };
}
async function exigirPerfil(db: Consultas, cuenta: string) {
  const perfil = await obtenerPerfil(db, cuenta);
  if (!perfil) throw new ErrorHttp(409, 'Complete su perfil comercial antes de publicar o negociar');
  return perfil;
}
export async function guardarPerfil(db: Db, cuenta: string, entrada: Fila) {
  const nombre = texto(entrada, 'nombre', 120, true);
  const organizacion = texto(entrada, 'organizacion', 160);
  const zona = texto(entrada, 'zona', 160, true);
  const contacto = texto(entrada, 'contacto', 200);
  const documento = texto(entrada, 'documento_ref', 200);
  const tipo = entrada.tipo;
  if (!['productor', 'cooperativa', 'comprador'].includes(tipo)) throw new ErrorValidacion({ tipo: 'Seleccione productor, cooperativa o comprador' });
  await db.query(`INSERT INTO comercio_perfiles (cuenta,nombre,organizacion,tipo,zona,contacto,documento_ref)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(cuenta) DO UPDATE SET nombre=$2,organizacion=$3,tipo=$4,zona=$5,
    contacto=$6,documento_ref=$7,actualizado_en=now()`, [cuenta,nombre,organizacion,tipo,zona,contacto,documento]);
  return obtenerPerfil(db, cuenta);
}

export async function comprobarDueno(ctx: Contexto, cuenta: string, loteId: string, cantidad?: string) {
  if (!ctx.mercado) throw new ErrorHttp(503, 'La publicación de ventas requiere conexión con el contrato Stellar');
  const [lote] = await ctx.db.query<Fila>('SELECT id,tipo_mineral,peso_kg FROM lotes WHERE id=$1', [loteId]);
  if (!lote) throw new ErrorHttp(404, 'El lote no está registrado en MinerTrace');
  const estado = await ctx.mercado.estadoLote(loteId);
  if (!estado || estado.dueno !== cuenta) throw new ErrorHttp(403, 'Solo el dueño actual registrado en el contrato puede ofrecer este lote');
  if (!['Certificado', 'Vendido', 'EnVenta'].includes(estado.estado) || estado.venta?.comprador) {
    throw new ErrorHttp(409, 'El lote está comprometido en una compra o disputa');
  }
  if (cantidad && unidades(cantidad, 3, false) !== unidades(lote.peso_kg, 3, false)) {
    throw new ErrorValidacion({ cantidad: 'La venta comprende el lote completo: use su peso registrado en kg' });
  }
  return lote;
}

async function mostrarAnuncio(db: Consultas, fila: Fila): Promise<AnuncioComercial> {
  const perfil = await obtenerPerfil(db, fila.cuenta);
  return {
    id: fila.id, cuenta: fila.cuenta, tipo: fila.tipo, mineral: fila.mineral, zona: fila.zona, cantidad: fila.cantidad,
    precio: fila.precio, lote_id: fila.lote_id, condiciones: fila.condiciones, punto_entrega: fila.punto_entrega,
    gastos_ensayo: fila.gastos_ensayo, gastos_traslado: fila.gastos_traslado, oferta_externa_neta: fila.oferta_externa_neta,
    plazo_pago: fila.plazo_pago, estado: fila.estado, vigente: fila.estado === 'abierto' && new Date(fila.vence).getTime() > Date.now(),
    creado_en: iso(fila.creado_en), vence: iso(fila.vence), token: fila.token, perfil: perfil ? perfilPublico(perfil) : null,
  };
}
async function mostrarOferta(db: Consultas, fila: Fila): Promise<OfertaComercial> {
  const perfil = await obtenerPerfil(db, fila.cuenta);
  const [anuncio] = fila.destinatario ? [] : await db.query<Fila>('SELECT cuenta FROM comercio_anuncios WHERE id=$1', [fila.anuncio_id]);
  return {
    id: fila.id, anuncio_id: fila.anuncio_id, cuenta: fila.cuenta, precio: fila.precio, lote_id: fila.lote_id,
    proponente: fila.proponente ?? fila.cuenta, destinatario: fila.destinatario ?? anuncio?.cuenta ?? '', oferta_anterior_id: fila.oferta_anterior_id ?? null,
    condiciones: fila.condiciones, punto_entrega: fila.punto_entrega, gastos_ensayo: fila.gastos_ensayo,
    gastos_traslado: fila.gastos_traslado, plazo_pago: fila.plazo_pago, estado: fila.estado,
    vigente: fila.estado === 'pendiente' && new Date(fila.vence).getTime() > Date.now(),
    creado_en: iso(fila.creado_en), vence: iso(fila.vence), perfil: perfil ? perfilPublico(perfil) : null,
  };
}
function mostrarOrden(fila: Fila): OrdenComercial {
  return { id: fila.id, orden_id: fila.id, anuncio_id: fila.anuncio_id, oferta_id: fila.oferta_id, lote_id: fila.lote_id,
    vendedor: fila.vendedor, comprador: fila.comprador, precio: fila.precio, precio_unidades: fila.precio_unidades,
    comision_unidades: fila.comision_unidades, condiciones_hash: fila.condiciones_hash, condiciones: fila.condiciones,
    token: fila.token, politica: fila.politica, cotizacion: fila.cotizacion, estado: 'pendiente_firma',
    creado_en: iso(fila.creado_en), vence: iso(fila.vence) };
}
function mostrarEvidencia(fila: Fila): EvidenciaComercial {
  return { id: fila.id, operacion_id: fila.operacion_id, cuenta: fila.cuenta, tipo: fila.tipo,
    referencia: fila.referencia, descripcion: fila.descripcion, hash: fila.hash, creado_en: iso(fila.creado_en), alcance: 'declarada' };
}

export async function listarAnuncios(ctx: Contexto, filtros: Fila, cuenta: string | null) {
  const parametros: unknown[] = [];
  const condiciones = filtros.propios === 'true' ? [] : ["estado='abierto'", 'vence>now()'];
  const agregar = (condicion: string, valor: unknown) => { parametros.push(valor); condiciones.push(condicion.replace('?', `$${parametros.length}`)); };
  if (filtros.propios === 'true') {
    if (!cuenta) throw new ErrorHttp(401, 'Inicie sesión para consultar sus anuncios');
    agregar('cuenta=?', cuenta);
  }
  if (filtros.tipo) {
    if (!['compra','venta'].includes(filtros.tipo)) throw new ErrorHttp(400, 'Tipo de anuncio inválido');
    agregar('tipo=?', filtros.tipo);
  }
  if (filtros.cuenta) agregar('cuenta=?', validarCuenta(filtros.cuenta));
  if (filtros.mineral) agregar('mineral ILIKE ?', '%' + texto(filtros, 'mineral', 80) + '%');
  if (filtros.zona) agregar('zona ILIKE ?', '%' + texto(filtros, 'zona', 160) + '%');
  const filas = await ctx.db.query<Fila>(`SELECT * FROM comercio_anuncios${condiciones.length ? ' WHERE ' + condiciones.join(' AND ') : ''} ORDER BY creado_en DESC LIMIT 100`, parametros);
  return Promise.all(filas.map((fila) => mostrarAnuncio(ctx.db, fila)));
}

export async function crearAnuncio(ctx: Contexto, cuenta: string, entrada: Fila) {
  await exigirPerfil(ctx.db, cuenta);
  const clienteId = idCliente(entrada);
  const hash = huella(entrada);
  const anterior = await repetido(ctx.db, 'comercio_anuncios', cuenta, clienteId, hash);
  if (anterior) return mostrarAnuncio(ctx.db, anterior);
  if (!['compra', 'venta'].includes(entrada.tipo)) throw new ErrorValidacion({ tipo: 'Seleccione compra o venta' });
  const politica = await leerPolitica(ctx);
  if (!politica.token) throw new ErrorHttp(503, 'Configure el token del contrato para publicar importes');
  const token = politica.token;
  const cantidad = normalizarImporte(entrada.cantidad, 3, false);
  const precio = normalizarImporte(entrada.precio, token.decimales, false);
  const loteId = loteDe(entrada.lote_id);
  if (entrada.tipo === 'venta' && !loteId) throw new ErrorValidacion({ lote_id: 'Seleccione un lote certificado del que sea dueño' });
  if (entrada.tipo === 'compra' && loteId) throw new ErrorValidacion({ lote_id: 'El anuncio de compra no asigna un lote ajeno; el vendedor lo ofrece después' });
  const lote = loteId ? await comprobarDueno(ctx, cuenta, loteId, cantidad) : null;
  const mineral = lote ? lote.tipo_mineral : texto(entrada, 'mineral', 80, true);
  const zona = texto(entrada, 'zona', 160, true);
  const vence = vencimiento(entrada.vence);
  const condiciones = texto(entrada, 'condiciones', 2000);
  const punto = texto(entrada, 'punto_entrega', 240);
  const plazo = texto(entrada, 'plazo_pago', 240);
  const ensayo = normalizarImporte(entrada.gastos_ensayo ?? '0', token.decimales);
  const traslado = normalizarImporte(entrada.gastos_traslado ?? '0', token.decimales);
  const externa = entrada.oferta_externa_neta == null || entrada.oferta_externa_neta === '' ? null : normalizarImporte(entrada.oferta_externa_neta, token.decimales);
  const [fila] = await ctx.db.query<Fila>(`INSERT INTO comercio_anuncios
    (id,cliente_id,entrada_hash,cuenta,tipo,mineral,zona,cantidad,precio,lote_id,condiciones,punto_entrega,gastos_ensayo,gastos_traslado,oferta_externa_neta,plazo_pago,token,vence)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ON CONFLICT(cuenta,cliente_id) DO NOTHING RETURNING *`,
    [randomUUID(),clienteId,hash,cuenta,entrada.tipo,mineral,zona,cantidad,precio,loteId,condiciones,punto,ensayo,traslado,externa,plazo,JSON.stringify(token),vence]);
  return mostrarAnuncio(ctx.db, fila ?? (await repetido(ctx.db, 'comercio_anuncios', cuenta, clienteId, hash))!);
}

export async function detalleAnuncio(ctx: Contexto, id: string, cuenta: string | null) {
  const [fila] = await ctx.db.query<Fila>('SELECT * FROM comercio_anuncios WHERE id=$1', [id]);
  if (!fila) throw new ErrorHttp(404, 'Anuncio no encontrado');
  const ofertas = cuenta ? await ctx.db.query<Fila>('SELECT * FROM comercio_ofertas WHERE anuncio_id=$1 AND ($2=$3 OR cuenta=$2) ORDER BY creado_en DESC', [id,cuenta,fila.cuenta]) : [];
  return { anuncio: await mostrarAnuncio(ctx.db, fila), ofertas: await Promise.all(ofertas.map((oferta) => mostrarOferta(ctx.db, oferta))) };
}
export async function cerrarAnuncio(ctx: Contexto, id: string, cuenta: string) {
  return ctx.db.transaccion(async (conexion) => {
    const [fila] = await conexion.query<Fila>('SELECT * FROM comercio_anuncios WHERE id=$1 FOR UPDATE', [id]);
    if (!fila) throw new ErrorHttp(404, 'Anuncio no encontrado');
    if (fila.cuenta !== cuenta) throw new ErrorHttp(403, 'Solo quien publicó el anuncio puede cerrarlo');
    if (fila.estado === 'aceptado') throw new ErrorHttp(409, 'Ya existe un acuerdo: gestione la operación y su reserva en el contrato');
    await conexion.query("UPDATE comercio_anuncios SET estado='cerrado' WHERE id=$1", [id]);
    await conexion.query("UPDATE comercio_ofertas SET estado='rechazada' WHERE anuncio_id=$1 AND estado='pendiente'", [id]);
    return { id, estado: 'cerrado' };
  });
}

export async function crearOferta(ctx: Contexto, anuncioId: string, cuenta: string, entrada: Fila) {
  await exigirPerfil(ctx.db, cuenta);
  const clienteId = idCliente(entrada);
  const hash = huella({ ...entrada, anuncio_id: anuncioId });
  const anterior = await repetido(ctx.db, 'comercio_ofertas', cuenta, clienteId, hash);
  if (anterior) return mostrarOferta(ctx.db, anterior);
  const [anuncio] = await ctx.db.query<Fila>('SELECT * FROM comercio_anuncios WHERE id=$1', [anuncioId]);
  if (!anuncio) throw new ErrorHttp(404, 'Anuncio no encontrado');
  if (anuncio.cuenta === cuenta) throw new ErrorHttp(400, 'No puede ofertar en su propio anuncio');
  if (anuncio.estado !== 'abierto' || new Date(anuncio.vence).getTime() <= Date.now()) throw new ErrorHttp(409, 'El anuncio ya no acepta ofertas');
  const token = anuncio.token as InfoToken;
  const precio = normalizarImporte(entrada.precio, token.decimales, false);
  const loteId = anuncio.tipo === 'venta' ? anuncio.lote_id : loteDe(entrada.lote_id);
  if (!loteId) throw new ErrorValidacion({ lote_id: 'Seleccione el lote completo que ofrece vender' });
  if (anuncio.tipo === 'venta' && entrada.lote_id && loteDe(entrada.lote_id) !== loteId) throw new ErrorHttp(400, 'La oferta debe corresponder al lote anunciado');
  await comprobarDueno(ctx, anuncio.tipo === 'venta' ? anuncio.cuenta : cuenta, loteId, anuncio.cantidad);
  const condiciones = texto(entrada, 'condiciones', 2000) || anuncio.condiciones;
  const punto = texto(entrada, 'punto_entrega', 240) || anuncio.punto_entrega;
  const plazo = texto(entrada, 'plazo_pago', 240) || anuncio.plazo_pago;
  const ensayo = normalizarImporte(entrada.gastos_ensayo ?? anuncio.gastos_ensayo, token.decimales);
  const traslado = normalizarImporte(entrada.gastos_traslado ?? anuncio.gastos_traslado, token.decimales);
  const vence = vencimiento(entrada.vence ?? iso(anuncio.vence), new Date(anuncio.vence).getTime());
  const fila = await ctx.db.transaccion(async (conexion) => {
    const [vigente] = await conexion.query<Fila>('SELECT * FROM comercio_anuncios WHERE id=$1 FOR UPDATE', [anuncioId]);
    if (vigente.estado !== 'abierto' || new Date(vigente.vence).getTime() <= Date.now()) throw new ErrorHttp(409, 'El anuncio se cerró mientras preparaba su oferta');
    const [creada] = await conexion.query<Fila>(`INSERT INTO comercio_ofertas
      (id,cliente_id,entrada_hash,anuncio_id,cuenta,precio,lote_id,condiciones,punto_entrega,gastos_ensayo,gastos_traslado,plazo_pago,vence,proponente,destinatario)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$5,$14) ON CONFLICT(cuenta,cliente_id) DO NOTHING RETURNING *`,
      [randomUUID(),clienteId,hash,anuncioId,cuenta,precio,loteId,condiciones,punto,ensayo,traslado,plazo,vence,anuncio.cuenta]);
    return creada ?? (await repetido(conexion, 'comercio_ofertas', cuenta, clienteId, hash))!;
  });
  return mostrarOferta(ctx.db, fila);
}

export async function contraofertar(ctx: Contexto, ofertaId: string, cuenta: string, entrada: Fila) {
  const [previa] = await ctx.db.query<Fila>('SELECT o.*,a.cuenta AS autor FROM comercio_ofertas o JOIN comercio_anuncios a ON a.id=o.anuncio_id WHERE o.id=$1', [ofertaId]);
  if (!previa) throw new ErrorHttp(404, 'Oferta no encontrada');
  const destinatario = previa.destinatario ?? previa.autor;
  if (destinatario !== cuenta) throw new ErrorHttp(403, 'Solo el destinatario puede responder con una contraoferta');
  const clienteId = idCliente(entrada);
  const hash = huella({ ...entrada, oferta_anterior_id: ofertaId, proponente: cuenta });
  const anterior = await repetido(ctx.db, 'comercio_ofertas', previa.cuenta, clienteId, hash);
  if (anterior) return mostrarOferta(ctx.db, anterior);
  const [anuncio] = await ctx.db.query<Fila>('SELECT * FROM comercio_anuncios WHERE id=$1', [previa.anuncio_id]);
  const token = anuncio!.token as InfoToken;
  if (entrada.lote_id && loteDe(entrada.lote_id) !== previa.lote_id) throw new ErrorHttp(400, 'La contraoferta conserva el lote; publique otra oferta si desea cambiarlo');
  const precio = normalizarImporte(entrada.precio, token.decimales, false);
  const condiciones = texto(entrada, 'condiciones', 2000) || previa.condiciones;
  const punto = texto(entrada, 'punto_entrega', 240) || previa.punto_entrega;
  const plazo = texto(entrada, 'plazo_pago', 240) || previa.plazo_pago;
  const ensayo = normalizarImporte(entrada.gastos_ensayo ?? previa.gastos_ensayo, token.decimales);
  const traslado = normalizarImporte(entrada.gastos_traslado ?? previa.gastos_traslado, token.decimales);
  const vence = vencimiento(entrada.vence ?? iso(previa.vence), Math.min(new Date(previa.vence).getTime(), new Date(anuncio!.vence).getTime()));
  const fila = await ctx.db.transaccion(async (conexion) => {
    const [vigente] = await conexion.query<Fila>('SELECT * FROM comercio_anuncios WHERE id=$1 FOR UPDATE', [previa.anuncio_id]);
    const [oferta] = await conexion.query<Fila>('SELECT * FROM comercio_ofertas WHERE id=$1 FOR UPDATE', [ofertaId]);
    if (vigente!.estado !== 'abierto' || oferta!.estado !== 'pendiente' || new Date(vigente!.vence).getTime() <= Date.now() || new Date(oferta!.vence).getTime() <= Date.now()) throw new ErrorHttp(409, 'La negociación ya fue atendida o venció');
    const [creada] = await conexion.query<Fila>(`INSERT INTO comercio_ofertas
      (id,cliente_id,entrada_hash,anuncio_id,cuenta,precio,lote_id,condiciones,punto_entrega,gastos_ensayo,gastos_traslado,plazo_pago,vence,proponente,destinatario,oferta_anterior_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(cuenta,cliente_id) DO NOTHING RETURNING *`,
      [randomUUID(),clienteId,hash,previa.anuncio_id,previa.cuenta,precio,previa.lote_id,condiciones,punto,ensayo,traslado,plazo,vence,cuenta,previa.proponente ?? previa.cuenta,ofertaId]);
    if (creada) await conexion.query("UPDATE comercio_ofertas SET estado='rechazada' WHERE id=$1", [ofertaId]);
    return creada ?? (await repetido(conexion, 'comercio_ofertas', previa.cuenta, clienteId, hash))!;
  });
  return mostrarOferta(ctx.db, fila);
}

export async function aceptarOferta(ctx: Contexto, ofertaId: string, cuenta: string): Promise<OrdenComercial> {
  const [inicial] = await ctx.db.query<Fila>('SELECT o.*,a.cuenta AS autor,a.tipo,a.cantidad,a.token,a.oferta_externa_neta FROM comercio_ofertas o JOIN comercio_anuncios a ON a.id=o.anuncio_id WHERE o.id=$1', [ofertaId]);
  if (!inicial) throw new ErrorHttp(404, 'Oferta no encontrada');
  if ((inicial.destinatario ?? inicial.autor) !== cuenta) throw new ErrorHttp(403, 'Solo el destinatario puede aceptar esta propuesta');
  const [existente] = await ctx.db.query<Fila>('SELECT * FROM comercio_operaciones WHERE oferta_id=$1', [ofertaId]);
  if (existente) return mostrarOrden(existente);
  const vendedor = inicial.tipo === 'venta' ? inicial.autor : inicial.cuenta;
  const comprador = inicial.tipo === 'venta' ? inicial.cuenta : inicial.autor;
  await comprobarDueno(ctx, vendedor, inicial.lote_id, inicial.cantidad);
  const politica = await leerPolitica(ctx);
  if (!politica.disponible || !politica.token) throw new ErrorHttp(409, 'El contrato comercial debe estar configurado antes de aceptar una oferta');
  if (politica.token.contrato !== inicial.token.contrato || politica.token.decimales !== inicial.token.decimales) throw new ErrorHttp(409, 'El token cambió; publique un anuncio nuevo con la moneda actual');
  return ctx.db.transaccion(async (conexion) => {
    const [anuncio] = await conexion.query<Fila>('SELECT * FROM comercio_anuncios WHERE id=$1 FOR UPDATE', [inicial.anuncio_id]);
    const [oferta] = await conexion.query<Fila>('SELECT * FROM comercio_ofertas WHERE id=$1 FOR UPDATE', [ofertaId]);
    const [previa] = await conexion.query<Fila>('SELECT * FROM comercio_operaciones WHERE oferta_id=$1', [ofertaId]);
    if (previa) return mostrarOrden(previa);
    if (anuncio.estado !== 'abierto' || oferta.estado !== 'pendiente' || new Date(anuncio.vence).getTime() <= Date.now() || new Date(oferta.vence).getTime() <= Date.now()) {
      throw new ErrorHttp(409, 'El anuncio o la oferta venció o ya fue atendido');
    }
    await conexion.query('SELECT id FROM lotes WHERE id=$1 FOR UPDATE', [oferta.lote_id]);
    const comprometidas = await conexion.query<{ id: string }>('SELECT id FROM comercio_operaciones WHERE lote_id=$1 AND vendedor=$2 AND vence>now()', [oferta.lote_id,vendedor]);
    const liquidaciones = comprometidas.length ? await ctx.mercado!.historialLiquidaciones(oferta.lote_id) : [];
    for (const previa of comprometidas) {
      const cerrada = liquidaciones.some((liquidacion) => liquidacion.orden_id === previa.id) ||
        (typeof ctx.mercado!.ordenCancelada === 'function' && await ctx.mercado!.ordenCancelada(previa.id));
      if (!cerrada) throw new ErrorHttp(409, 'Ya existe otro acuerdo vigente para este lote');
    }
    const cotizacion = cotizar(politica, { precio: oferta.precio, gastos_ensayo: oferta.gastos_ensayo, gastos_traslado: oferta.gastos_traslado, oferta_externa_neta: anuncio.oferta_externa_neta });
    const condiciones = { condiciones: oferta.condiciones, punto_entrega: oferta.punto_entrega, plazo_pago: oferta.plazo_pago,
      gastos_ensayo: oferta.gastos_ensayo, gastos_traslado: oferta.gastos_traslado };
    const id = randomUUID();
    const vence = iso(new Date(Math.min(new Date(anuncio.vence).getTime(), new Date(oferta.vence).getTime())));
    const condicionesHash = huella({ orden_id: id, anuncio_id: anuncio.id, oferta_id: oferta.id, lote_id: oferta.lote_id,
      vendedor, comprador, precio_unidades: cotizacion.unidades.precio, comision_unidades: cotizacion.unidades.comision,
      condiciones, token: politica.token, politica, vence });
    const [orden] = await conexion.query<Fila>(`INSERT INTO comercio_operaciones
      (id,anuncio_id,oferta_id,lote_id,vendedor,comprador,precio,precio_unidades,comision_unidades,condiciones_hash,condiciones,token,politica,cotizacion,vence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [id,anuncio.id,oferta.id,oferta.lote_id,vendedor,comprador,oferta.precio,cotizacion.unidades.precio,cotizacion.unidades.comision,
        condicionesHash,JSON.stringify(condiciones),JSON.stringify(politica.token),JSON.stringify(politica),JSON.stringify(cotizacion),vence]);
    await conexion.query("UPDATE comercio_anuncios SET estado='aceptado' WHERE id=$1", [anuncio.id]);
    await conexion.query("UPDATE comercio_ofertas SET estado=CASE WHEN id=$2 THEN 'aceptada' ELSE 'rechazada' END WHERE anuncio_id=$1 AND estado='pendiente'", [anuncio.id,oferta.id]);
    return mostrarOrden(orden!);
  });
}

export async function rechazarOferta(ctx: Contexto, id: string, cuenta: string) {
  return ctx.db.transaccion(async (conexion) => {
    const [fila] = await conexion.query<Fila>('SELECT o.*,a.cuenta AS autor FROM comercio_ofertas o JOIN comercio_anuncios a ON a.id=o.anuncio_id WHERE o.id=$1', [id]);
    if (!fila) throw new ErrorHttp(404, 'Oferta no encontrada');
    if (fila.autor !== cuenta && fila.cuenta !== cuenta) throw new ErrorHttp(403, 'No participa en esta oferta');
    await conexion.query('SELECT id FROM comercio_anuncios WHERE id=$1 FOR UPDATE', [fila.anuncio_id]);
    const [oferta] = await conexion.query<Fila>('SELECT * FROM comercio_ofertas WHERE id=$1 FOR UPDATE', [id]);
    if (oferta.estado === 'aceptada') throw new ErrorHttp(409, 'La oferta ya tiene una orden; consulte su operación');
    await conexion.query("UPDATE comercio_ofertas SET estado='rechazada' WHERE id=$1", [id]);
    return { id, estado: 'rechazada' };
  });
}

export async function obtenerOrden(db: Consultas, id: string): Promise<OrdenComercial> {
  const [fila] = await db.query<Fila>('SELECT * FROM comercio_operaciones WHERE id=$1', [id]);
  if (!fila) throw new ErrorHttp(404, 'Operación no encontrada');
  return mostrarOrden(fila);
}
export async function obtenerOperacion(ctx: Contexto, id: string, cuenta: string) {
  const operacion = await obtenerOrden(ctx.db, id);
  if (![operacion.vendedor, operacion.comprador].includes(cuenta)) throw new ErrorHttp(403, 'No participa en esta operación');
  return detalleDeOrden(ctx, operacion);
}
async function detalleDeOrden(ctx: Contexto, operacion: OrdenComercial) {
  const id = operacion.id;
  if (!ctx.mercado) throw new ErrorHttp(503, 'No se puede comprobar el estado del contrato');
  const [cadena, venta, historial, evidencias] = await Promise.all([
    ctx.mercado.estadoLote(operacion.lote_id), ctx.mercado.ventaComercial(operacion.lote_id),
    ctx.mercado.historialLiquidaciones(operacion.lote_id),
    ctx.db.query<Fila>('SELECT * FROM comercio_evidencias WHERE operacion_id=$1 ORDER BY creado_en', [id]),
  ]);
  const cancelada = typeof ctx.mercado.ordenCancelada === 'function' && await ctx.mercado.ordenCancelada(id);
  return { operacion, cadena, cancelada_en_cadena: cancelada, venta_comercial: venta?.orden_id === id ? venta : null,
    liquidacion: historial.find((liquidacion) => liquidacion.orden_id === id) ?? null,
    evidencias: evidencias.map(mostrarEvidencia) };
}
/** Autoriza la wallet contra el administrador real del contrato, nunca contra el perfil declarado. */
export async function comprobarAdministradorComercial(ctx: Contexto, cuenta: string) {
  if (!ctx.mercado) throw new ErrorHttp(503, 'La revisión requiere consultar el administrador del contrato');
  const configuracion = await ctx.mercado.contrato.leer<{ admin: string }>('get_config');
  if (configuracion.admin !== cuenta) throw new ErrorHttp(403, 'Esta wallet no es la administradora del contrato');
}
export async function operacionesRevision(ctx: Contexto, cuenta: string, soloDisputas = false) {
  await comprobarAdministradorComercial(ctx, cuenta);
  const filas = await ctx.db.query<Fila>('SELECT * FROM comercio_operaciones ORDER BY creado_en DESC LIMIT 200');
  const operaciones = await Promise.all(filas.map((fila) => detalleDeOrden(ctx, mostrarOrden(fila))));
  return operaciones.filter((detalle) => !soloDisputas || (detalle.cadena?.estado === 'EnDisputa' && detalle.venta_comercial?.orden_id === detalle.operacion.id));
}
export async function agregarEvidenciaRevision(ctx: Contexto, id: string, cuenta: string, entrada: Fila) {
  await comprobarAdministradorComercial(ctx, cuenta);
  await obtenerOrden(ctx.db, id);
  return insertarEvidencia(ctx.db, id, cuenta, entrada, ['entrega','devolucion','decision']);
}
export async function operacionesLaboratorio(ctx: Contexto, laboratorioId: string) {
  const filas = await ctx.db.query<Fila>(`SELECT o.* FROM comercio_operaciones o JOIN lotes l ON l.id=o.lote_id
    WHERE l.laboratorio_id=$1 ORDER BY o.creado_en DESC LIMIT 100`, [laboratorioId]);
  return Promise.all(filas.map((fila) => detalleDeOrden(ctx, mostrarOrden(fila))));
}
export async function listarOperaciones(ctx: Contexto, cuenta: string) {
  const filas = await ctx.db.query<Fila>('SELECT * FROM comercio_operaciones WHERE vendedor=$1 OR comprador=$1 ORDER BY creado_en DESC LIMIT 100', [cuenta]);
  return filas.map(mostrarOrden);
}

export async function agregarEvidencia(ctx: Contexto, id: string, cuenta: string, entrada: Fila) {
  const operacion = await obtenerOrden(ctx.db, id);
  if (![operacion.vendedor, operacion.comprador].includes(cuenta)) throw new ErrorHttp(403, 'Solo las partes pueden adjuntar evidencias a esta operación');
  return insertarEvidencia(ctx.db, id, cuenta, entrada);
}
export async function agregarEvidenciaLaboratorio(ctx: Contexto, id: string, laboratorioId: string, entrada: Fila) {
  const operacion = await obtenerOrden(ctx.db, id);
  const [laboratorio] = await ctx.db.query<Fila>(`SELECT b.cuenta_publica FROM laboratorios b JOIN lotes l ON l.laboratorio_id=b.id
    WHERE b.id=$1 AND l.id=$2`, [laboratorioId, operacion.lote_id]);
  if (!laboratorio) throw new ErrorHttp(403, 'El lote no pertenece a su laboratorio');
  if (!['ensayo','entrega','devolucion'].includes(entrada.tipo)) throw new ErrorHttp(400, 'El laboratorio solo adjunta evidencias de ensayo, entrega o devolución');
  return insertarEvidencia(ctx.db, id, laboratorio.cuenta_publica, entrada);
}
async function insertarEvidencia(db: Db, id: string, cuenta: string, entrada: Fila, tiposPermitidos = ['origen', 'entrega', 'devolucion', 'ensayo']) {
  const clienteId = idCliente(entrada);
  const entradaHash = huella({ ...entrada, operacion_id: id });
  const anterior = await repetido(db, 'comercio_evidencias', cuenta, clienteId, entradaHash);
  if (anterior) return mostrarEvidencia(anterior);
  if (!tiposPermitidos.includes(entrada.tipo)) throw new ErrorValidacion({ tipo: 'Tipo de evidencia no permitido para este participante' });
  const referencia = texto(entrada, 'referencia', 500, true);
  const descripcion = texto(entrada, 'descripcion', 2000, true);
  const hash = texto(entrada, 'hash', 64, true).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash) || /^0+$/.test(hash)) throw new ErrorValidacion({ hash: 'Adjunte la huella SHA-256 de la evidencia' });
  const [fila] = await db.query<Fila>(`INSERT INTO comercio_evidencias (id,cliente_id,entrada_hash,operacion_id,cuenta,tipo,referencia,descripcion,hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(cuenta,cliente_id) DO NOTHING RETURNING *`,
    [randomUUID(),clienteId,entradaHash,id,cuenta,entrada.tipo,referencia,descripcion,hash]);
  return mostrarEvidencia(fila ?? (await repetido(db, 'comercio_evidencias', cuenta, clienteId, entradaHash))!);
}

export async function expedienteLote(ctx: Contexto, loteCrudo: string) {
  const loteId = loteDe(loteCrudo);
  if (!loteId) throw new ErrorHttp(400, 'Seleccione un lote');
  const verificacion = await verificarLote(ctx, loteId);
  if (!verificacion) throw new ErrorHttp(404, 'Lote no encontrado');
  const adjuntos = await ctx.db.query<Fila>(`SELECT e.id,e.tipo,e.hash,e.creado_en FROM comercio_evidencias e
    JOIN comercio_operaciones o ON o.id=e.operacion_id WHERE o.lote_id=$1 AND e.tipo='origen' ORDER BY e.creado_en`, [loteId]);
  const cadena = ctx.mercado ? await ctx.mercado.estadoLote(loteId) : null;
  return { version_expediente: '1', generado_en: new Date().toISOString(), verificacion,
    cadena, adjuntos_origen: adjuntos.map((fila) => ({ id: fila.id, tipo: fila.tipo, hash: fila.hash, creado_en: iso(fila.creado_en), alcance: 'declarada' })),
    alcance: 'La integridad comprueba los datos, la firma del laboratorio y el PDF. Las referencias de origen son declaraciones; no acreditan por sí mismas procedencia territorial ni custodia física.' };
}

export async function resumenComercial(ctx: Contexto, cuenta: string) {
  if (!ctx.mercado) throw new ErrorHttp(503, 'El resumen requiere leer las liquidaciones del contrato');
  const politica = await leerPolitica(ctx);
  if (!politica.token) throw new ErrorHttp(503, 'El token no está configurado');
  const filas = await ctx.db.query<Fila>(`SELECT * FROM comercio_operaciones WHERE vendedor=$1 OR comprador=$1
    OR politica->>'destinatario_plataforma'=$1 ORDER BY creado_en`, [cuenta]);
  const ordenes = new Map(filas.map((fila) => [fila.id, fila]));
  const lotes = [...new Set(filas.map((fila) => fila.lote_id as string))];
  const liquidaciones: LiquidacionComercial[] = [];
  const vistos = new Set<string>();
  for (const lote of lotes) {
    for (const liquidacion of await ctx.mercado.historialLiquidaciones(lote)) {
      const orden = liquidacion.orden_id ? ordenes.get(liquidacion.orden_id) : null;
      if (!orden || vistos.has(orden.id) || orden.token.contrato !== politica.token.contrato) continue;
      if (liquidacion.vendedor !== orden.vendedor || liquidacion.comprador !== orden.comprador || liquidacion.precio !== orden.precio_unidades) continue;
      vistos.add(orden.id);
      liquidaciones.push({ ...liquidacion, lote_id: lote });
    }
  }
  let volumen = 0n, comisiones = 0n, reintegros = 0n, ingresos = 0n, egresos = 0n;
  for (const liquidacion of liquidaciones) {
    if (liquidacion.reembolsada) continue;
    const precio = BigInt(liquidacion.precio), comision = BigInt(liquidacion.comision), reintegro = BigInt(liquidacion.reintegro);
    volumen += precio;
    if (liquidacion.vendedor === cuenta) { ingresos += precio + reintegro; reintegros += reintegro; }
    if (liquidacion.comprador === cuenta) egresos += BigInt(liquidacion.total);
    const orden = ordenes.get(liquidacion.orden_id!)!;
    if (orden.politica.destinatario_plataforma === cuenta) comisiones += comision - reintegro;
  }
  const convertir = (monto: bigint) => decimal(monto, politica.token!.decimales);
  return { origen: 'contrato', token: politica.token, operaciones_liquidadas: liquidaciones.filter((fila) => !fila.reembolsada).length,
    volumen_liquidado: convertir(volumen), comisiones_recibidas: convertir(comisiones), reintegros_recibidos: convertir(reintegros),
    ingresos_ventas: convertir(ingresos), egresos_compras: convertir(egresos), liquidaciones,
    mensaje: 'Solo se suman liquidaciones leídas del contrato. Las ofertas, estimaciones y acuerdos sin liquidación no generan ingresos.' };
}
