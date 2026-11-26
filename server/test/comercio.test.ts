import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import type { Contexto } from '../src/contexto.ts';
import type { EstadoComercial, LiquidacionComercial, Mercado, VentaComercial } from '../src/mercado/mercado.ts';

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'minertrace-comercio-'));
process.env.DATOS_DIR = temporal;
process.env.ANCLAJE = 'mock';
delete process.env.DATABASE_URL;
const { conectar } = await import('../src/db/index.ts');
const { crearApp } = await import('../src/app.ts');
const { AnclajeMock } = await import('../src/anclaje/AnclajeMock.ts');
const { ProcesadorAnclajes } = await import('../src/anclaje/procesador.ts');
const { sembrar } = await import('../src/semilla.ts');
const { cotizar } = await import('../src/comercio/politica.ts');
const { unidades, decimal } = await import('../src/comercio/dinero.ts');
const { leerPolitica } = await import('../src/comercio/politica.ts');
const db = await conectar({ memoria: true });
const anclaje = new AnclajeMock(db);
const procesador = new ProcesadorAnclajes(db, anclaje);
const vendedores = Keypair.random(), comprador = Keypair.random(), tercero = Keypair.random(), plataforma = Keypair.random(), administrador = Keypair.random();
const token = { contrato: 'TOKEN-PRUEBA', simbolo: 'TOK', decimales: 7 };
const estados = new Map<string, EstadoComercial>();
const historiales = new Map<string, LiquidacionComercial[]>();
const comerciales = new Map<string, VentaComercial>();
const canceladas = new Set<string>();
const ctx: Contexto = { db, anclaje, procesador, mercado: {
  contrato: { leer: async (metodo: string) => { assert.equal(metodo, 'get_config'); return { admin: administrador.publicKey() }; } },
  infoComercial: async () => ({ token, plazo_garantia_seg: '604800', configuracion: { version: 2, destinatario_plataforma: plataforma.publicKey(), comision_bps: 100,
    comision_minima: '200000000', reintegro_bps: 25, reintegro_maximo: '1000000000', plazo_entrega_seg: '86400' } }),
  estadoLote: async (id: string) => estados.get(id) ?? null,
  ventaComercial: async (id: string) => comerciales.get(id) ?? null,
  historialLiquidaciones: async (id: string) => historiales.get(id) ?? [],
  ordenCancelada: async (id: string) => canceladas.has(id),
} as unknown as Mercado };
let servidor: Server;
let base: string;

class Cliente {
  cookies = new Map<string, string>();
  get cookie() { return [...this.cookies].map(([clave,valor]) => `${clave}=${valor}`).join('; '); }
  async solicitar(ruta: string, json?: unknown, opciones: { metodo?: string; sinCsrf?: boolean; cabeceras?: Record<string,string> } = {}): Promise<{ respuesta: Response; cuerpo: any }> {
    const cabeceras: Record<string,string> = {};
    if (json !== undefined && !opciones.sinCsrf) cabeceras['X-CSRF-Token'] = (await this.solicitar('/auth/csrf')).cuerpo.csrf;
    cabeceras.cookie = this.cookie;
    if (json !== undefined) cabeceras['content-type'] = 'application/json';
    const respuesta = await fetch(`${base}/api${ruta}`, { method: opciones.metodo ?? (json === undefined ? 'GET' : 'POST'),
      headers: { ...cabeceras, ...opciones.cabeceras }, body: json === undefined ? undefined : JSON.stringify(json) });
    for (const valor of respuesta.headers.getSetCookie()) {
      const par = valor.split(';')[0]!;
      const corte = par.indexOf('=');
      this.cookies.set(par.slice(0,corte), par.slice(corte+1));
    }
    return { respuesta, cuerpo: await respuesta.json() };
  }
  copiar() { const copia = new Cliente(); copia.cookies = new Map(this.cookies); return copia; }
  async entrar(par: Keypair, tipo = 'comprador') {
    const reto = (await this.solicitar('/comercio/sesion/desafio', { cuenta: par.publicKey() })).cuerpo;
    const firma = Buffer.from(par.signMessage(reto.mensaje)).toString('base64');
    const ingreso = await this.solicitar('/comercio/sesion/verificar', { id: reto.id, firma });
    assert.equal(ingreso.respuesta.status, 200, JSON.stringify(ingreso.cuerpo));
    assert.equal((await this.solicitar('/comercio/perfil', { nombre: `Participante ${tipo}`, tipo, zona: 'Zona piloto',
      organizacion: 'Organización de prueba', contacto: 'CONTACTO_PRIVADO', documento_ref: 'DOCUMENTO_PRIVADO', verificado: true }, { metodo: 'PUT' })).respuesta.status, 200);
    return this;
  }
}
const vendedor = () => new Cliente().entrar(vendedores, 'cooperativa');
const clienteComprador = () => new Cliente().entrar(comprador);
async function lote(dueno = vendedores) {
  const id = 'LT-' + randomUUID().slice(0,8).toUpperCase();
  const [{ id: usuario }] = await db.query('SELECT id FROM usuarios LIMIT 1');
  await db.query(`INSERT INTO lotes(id,laboratorio_id,tipo_mineral,peso_kg,origen,creado_por,dueno)
    VALUES($1,'LAB-001','Oro doré','1.000','Procedencia declarada',$2,$3)`, [id,usuario,dueno.publicKey()]);
  estados.set(id, { lote_id: id, estado: 'Certificado', dueno: dueno.publicKey(), analisis_id: 'AN-PRUEBA', version: 1,
    lab: 'LAB-001', pureza_bps: 9500, venta: null, contra_analisis: null });
  return id;
}
async function anuncio(v: Cliente, loteId = '', otros: Record<string,unknown> = {}) {
  const loteCreado = loteId || await lote();
  const entrada = { cliente_id: randomUUID(), tipo: 'venta', mineral: 'Oro doré', zona: 'Zona piloto', cantidad: '1', precio: '10000',
    lote_id: loteCreado, vence: new Date(Date.now()+3_600_000).toISOString(), gastos_ensayo: '100', gastos_traslado: '50', ...otros };
  const respuesta = await v.solicitar('/comercio/anuncios', entrada);
  assert.equal(respuesta.respuesta.status, 201, JSON.stringify(respuesta.cuerpo));
  return { ...respuesta.cuerpo, entrada };
}
async function ofertar(c: Cliente, anuncioId: string, precio = '10000') {
  const resultado = await c.solicitar(`/comercio/anuncios/${anuncioId}/ofertas`, { precio, cliente_id: randomUUID() });
  assert.equal(resultado.respuesta.status, 201, JSON.stringify(resultado.cuerpo));
  return resultado.cuerpo;
}

before(async () => {
  await sembrar({ db,anclaje,procesador }, { lotesDemo: false });
  servidor = crearApp(ctx).listen(0);
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
beforeEach(async () => { await db.query('DELETE FROM limites_acceso'); });
after(async () => { servidor.close(); procesador.detener(); await db.cerrar(); fs.rmSync(temporal, { recursive: true, force: true }); });

test('la sesión comercial exige SEP-53, vínculo del navegador, CSRF y retos de un uso', async () => {
  const cliente = new Cliente();
  assert.equal((await cliente.solicitar('/comercio/sesion/desafio', { cuenta: comprador.publicKey() }, { sinCsrf: true })).respuesta.status, 403);
  const reto = (await cliente.solicitar('/comercio/sesion/desafio', { cuenta: comprador.publicKey() })).cuerpo;
  const firma = Buffer.from(comprador.signMessage(reto.mensaje)).toString('base64');
  assert.equal((await new Cliente().solicitar('/comercio/sesion/verificar', { id: reto.id, firma })).respuesta.status, 400);
  const firmaCruda = Buffer.from(comprador.sign(Buffer.from(reto.mensaje))).toString('base64');
  assert.equal((await cliente.solicitar('/comercio/sesion/verificar', { id: reto.id, firma: firmaCruda })).respuesta.status, 401);
  const copia = cliente.copiar();
  const respuestas = await Promise.all([cliente.solicitar('/comercio/sesion/verificar', { id: reto.id, firma }), copia.solicitar('/comercio/sesion/verificar', { id: reto.id, firma })]);
  assert.deepEqual(respuestas.map((r) => r.respuesta.status).sort(), [200,401]);
  const ingresado = respuestas[0]!.respuesta.status === 200 ? cliente : copia;
  const cookie = respuestas.find((r) => r.respuesta.status === 200)!.respuesta.headers.getSetCookie().find((valor) => valor.startsWith('minertrace.comercio='));
  assert.match(cookie ?? '', /HttpOnly/);
  assert.match(cookie ?? '', /SameSite=Strict/);
  assert.equal((await ingresado.solicitar('/comercio/sesion')).cuerpo.cuenta, comprador.publicKey());
  assert.equal((await ingresado.solicitar('/comercio/sesion/salir', {})).respuesta.status, 200);
  assert.equal((await ingresado.solicitar('/comercio/perfil')).respuesta.status, 401);
});

test('retos y sesiones vencidos no autorizan y el perfil nunca se autoverifica ni filtra sus campos privados', async () => {
  const c = new Cliente();
  const reto = (await c.solicitar('/comercio/sesion/desafio', { cuenta: comprador.publicKey() })).cuerpo;
  await db.query("UPDATE comercio_desafios SET vence=now()-interval '1 second' WHERE id=$1", [reto.id]);
  assert.equal((await c.solicitar('/comercio/sesion/verificar', { id: reto.id, firma: Buffer.from(comprador.signMessage(reto.mensaje)).toString('base64') })).respuesta.status, 401);
  const v = await vendedor();
  assert.equal((await v.solicitar('/comercio/perfil')).cuerpo.verificado, false);
  const creado = await anuncio(v);
  const publico = (await new Cliente().solicitar(`/comercio/anuncios/${creado.id}`)).cuerpo;
  assert.equal(publico.anuncio.perfil.verificado, false);
  assert.ok(!JSON.stringify(publico).includes('CONTACTO_PRIVADO'));
  assert.ok(!JSON.stringify(publico).includes('DOCUMENTO_PRIVADO'));
  await db.query("UPDATE comercio_sesiones SET vence=now()-interval '1 second' WHERE cuenta=$1", [vendedores.publicKey()]);
  assert.equal((await v.solicitar('/comercio/perfil')).respuesta.status, 401);
});

test('el escaparate filtra anuncios públicos por vendedor sin mezclar cuentas ni publicar contactos o documentos', async () => {
  const v = await vendedor(), otroVendedor = await new Cliente().entrar(tercero, 'cooperativa');
  const propio = await anuncio(v);
  const ajeno = await anuncio(otroVendedor, await lote(tercero));
  const cerrado = await anuncio(v);
  assert.equal((await v.solicitar(`/comercio/anuncios/${cerrado.id}/cerrar`, {})).respuesta.status, 200);
  const publico = new Cliente();
  const filtrado = await publico.solicitar(`/comercio/anuncios?cuenta=${vendedores.publicKey()}`);
  assert.equal(filtrado.respuesta.status, 200);
  assert.ok(filtrado.cuerpo.anuncios.some((fila: any) => fila.id === propio.id));
  assert.ok(filtrado.cuerpo.anuncios.every((fila: any) => fila.cuenta === vendedores.publicKey() && fila.vigente));
  assert.ok(!filtrado.cuerpo.anuncios.some((fila: any) => fila.id === ajeno.id || fila.id === cerrado.id));
  const otros = await publico.solicitar(`/comercio/anuncios?cuenta=${tercero.publicKey()}`);
  assert.ok(otros.cuerpo.anuncios.some((fila: any) => fila.id === ajeno.id));
  assert.deepEqual((await v.solicitar(`/comercio/anuncios?propios=true&cuenta=${tercero.publicKey()}`)).cuerpo.anuncios, []);
  assert.equal((await publico.solicitar(`/comercio/anuncios?propios=true&cuenta=${tercero.publicKey()}`)).respuesta.status, 401);
  assert.equal((await publico.solicitar('/comercio/anuncios?cuenta=cuenta-invalida')).respuesta.status, 400);
  const perfil = await publico.solicitar(`/mercado/cuentas/${vendedores.publicKey()}/perfil`);
  assert.equal(perfil.respuesta.status, 200, JSON.stringify(perfil.cuerpo));
  assert.deepEqual(Object.keys(perfil.cuerpo).sort(), ['cuenta','nombre','organizacion','tipo','verificado','zona']);
  assert.equal(perfil.cuerpo.verificado, false);
  assert.ok(!JSON.stringify(perfil.cuerpo).includes('CONTACTO_PRIVADO'));
  assert.ok(!JSON.stringify(perfil.cuerpo).includes('DOCUMENTO_PRIVADO'));
  assert.equal((await publico.solicitar(`/mercado/cuentas/${Keypair.random().publicKey()}/perfil`)).respuesta.status, 404);
  assert.equal((await publico.solicitar('/mercado/cuentas/invalida/perfil')).respuesta.status, 400);
});

test('venta comprueba dueño onchain y lote completo; reintentos son idempotentes y no aceptan otro contenido', async () => {
  const v = await vendedor(), c = await clienteComprador();
  const creado = await anuncio(v);
  assert.equal((await v.solicitar('/comercio/anuncios', creado.entrada)).cuerpo.id, creado.id);
  assert.equal((await v.solicitar('/comercio/anuncios', { ...creado.entrada, precio: '9999' })).respuesta.status, 409);
  assert.equal((await c.solicitar('/comercio/anuncios', { ...creado.entrada, cliente_id: randomUUID() })).respuesta.status, 403);
  assert.equal((await v.solicitar('/comercio/anuncios', { ...creado.entrada, cliente_id: randomUUID(), cantidad: '0.5' })).respuesta.status, 400);
  assert.equal((await v.solicitar(`/comercio/anuncios/${creado.id}/ofertas`, { precio: '10000' })).respuesta.status, 400);
  assert.equal((await c.solicitar(`/comercio/anuncios/${creado.id}/cerrar`, {})).respuesta.status, 403);
});

test('ofertas y contraofertas se aceptan por el destinatario y una carrera crea una sola orden', async () => {
  const v = await vendedor(), c = await clienteComprador(), t = await new Cliente().entrar(tercero);
  const creado = await anuncio(v);
  const primera = await ofertar(c, creado.id);
  const segunda = await ofertar(t, creado.id, '10100');
  assert.equal((await c.solicitar(`/comercio/ofertas/${primera.id}/aceptar`, {})).respuesta.status, 403);
  const contra = await v.solicitar(`/comercio/ofertas/${primera.id}/contraofertar`, { precio: '10200', cliente_id: randomUUID() });
  assert.equal(contra.respuesta.status, 201, JSON.stringify(contra.cuerpo));
  assert.equal(contra.cuerpo.proponente, vendedores.publicKey());
  assert.equal(contra.cuerpo.destinatario, comprador.publicKey());
  assert.equal((await v.solicitar(`/comercio/ofertas/${contra.cuerpo.id}/aceptar`, {})).respuesta.status, 403);
  const respuestas = await Promise.all([c.solicitar(`/comercio/ofertas/${contra.cuerpo.id}/aceptar`, {}), v.solicitar(`/comercio/ofertas/${segunda.id}/aceptar`, {})]);
  assert.deepEqual(respuestas.map((r) => r.respuesta.status).sort(), [200,409]);
  const orden = respuestas.find((r) => r.respuesta.status === 200)!.cuerpo;
  assert.equal(orden.estado, 'pendiente_firma');
  assert.match(orden.condiciones_hash, /^[a-f0-9]{64}$/);
  assert.equal(estados.get(creado.lote_id)!.dueno, vendedores.publicKey());
  assert.equal(estados.get(creado.lote_id)!.estado, 'Certificado');
  const [{ total }] = await db.query('SELECT count(*)::int AS total FROM comercio_operaciones WHERE anuncio_id=$1', [creado.id]);
  assert.equal(total, 1);
});

test('una oferta vencida se rechaza y una operación no autoriza al tercero a leer ni adjuntar', async () => {
  const v = await vendedor(), c = await clienteComprador(), t = await new Cliente().entrar(tercero);
  const creado = await anuncio(v);
  const caducada = await ofertar(c, creado.id);
  await db.query("UPDATE comercio_ofertas SET vence=now()-interval '1 second' WHERE id=$1", [caducada.id]);
  assert.equal((await v.solicitar(`/comercio/ofertas/${caducada.id}/aceptar`, {})).respuesta.status, 409);
  const vigente = await ofertar(c, creado.id);
  const orden = (await v.solicitar(`/comercio/ofertas/${vigente.id}/aceptar`, {})).cuerpo;
  assert.equal((await t.solicitar(`/comercio/operaciones/${orden.id}`)).respuesta.status, 403);
  const evidencia = { tipo: 'origen', referencia: 'DOCUMENTO_PRIVADO_ORIGEN', descripcion: 'Declaración del participante', hash: 'a'.repeat(64), cliente_id: randomUUID() };
  assert.equal((await t.solicitar(`/comercio/operaciones/${orden.id}/evidencias`, evidencia)).respuesta.status, 403);
  const guardada = await v.solicitar(`/comercio/operaciones/${orden.id}/evidencias`, evidencia);
  assert.equal(guardada.respuesta.status, 201, JSON.stringify(guardada.cuerpo));
  assert.equal((await v.solicitar(`/comercio/operaciones/${orden.id}/evidencias`, evidencia)).cuerpo.id, guardada.cuerpo.id);
  assert.equal(guardada.cuerpo.alcance, 'declarada');
  const expediente = (await new Cliente().solicitar(`/comercio/lotes/${creado.lote_id}/expediente`)).cuerpo;
  assert.equal(expediente.adjuntos_origen[0].hash, evidencia.hash);
  assert.ok(!JSON.stringify(expediente).includes('DOCUMENTO_PRIVADO_ORIGEN'));
  const detalle = (await c.solicitar(`/comercio/operaciones/${orden.id}`)).cuerpo;
  assert.equal(detalle.evidencias[0].referencia, evidencia.referencia);
  assert.equal(detalle.liquidacion, null);
});

test('la cotización usa BigInt, cobra mínimo en token y no promete reintegro por gasto declarado', async () => {
  const politica = await leerPolitica(ctx);
  const estimacion = cotizar(politica, { precio: '10000', gastos_ensayo: '100', gastos_traslado: '50', oferta_externa_neta: '9800' });
  assert.equal(estimacion.comision, '100');
  assert.equal(estimacion.total_comprador, '10100');
  assert.equal(estimacion.neto_vendedor_sin_reintegro, '9850');
  assert.equal(estimacion.reintegro_maximo_estimado, '25');
  assert.equal(estimacion.reintegro_acreditado, '0');
  assert.equal(estimacion.diferencia_oferta_externa, '50');
  assert.equal(politica.plazo_entrega_seg, '86400');
  assert.equal(politica.plazo_garantia_seg, '604800');
  assert.equal(cotizar(politica, { precio: '1' }).comision, '20');
  assert.equal(cotizar(politica, { precio: '40000', gastos_ensayo: '1000' }).reintegro_maximo_estimado, '100');
  assert.equal(cotizar(politica, { precio: '10000', gastos_ensayo: '3' }).reintegro_maximo_estimado, '3');
  const enorme = '9007199254740993.0000001';
  assert.equal(decimal(unidades(enorme,7),7), enorme);
  assert.throws(() => unidades('1e10',7));
  assert.throws(() => unidades('1.00000001',7));
  assert.throws(() => unidades('9'.repeat(60),7));
});

test('una reserva cancelada en cadena conserva historial y permite negociar nuevamente el mismo lote', async () => {
  const v = await vendedor(), c = await clienteComprador();
  const primero = await anuncio(v);
  const propuesta = await ofertar(c, primero.id);
  const orden = (await v.solicitar(`/comercio/ofertas/${propuesta.id}/aceptar`, {})).cuerpo;
  const nuevo = await anuncio(v, primero.lote_id);
  const segunda = await ofertar(c, nuevo.id);
  assert.equal((await v.solicitar(`/comercio/ofertas/${segunda.id}/aceptar`, {})).respuesta.status, 409);
  canceladas.add(orden.id);
  assert.equal((await v.solicitar(`/comercio/operaciones/${orden.id}`)).cuerpo.cancelada_en_cadena, true);
  const aceptada = await v.solicitar(`/comercio/ofertas/${segunda.id}/aceptar`, {});
  assert.equal(aceptada.respuesta.status, 200, JSON.stringify(aceptada.cuerpo));
  assert.notEqual(aceptada.cuerpo.id, orden.id);
});

test('el resumen reconoce ingresos solo con liquidación coincidente leída del contrato', async () => {
  const v = await vendedor(), c = await clienteComprador();
  const creado = await anuncio(v);
  const oferta = await ofertar(c, creado.id);
  const orden = (await v.solicitar(`/comercio/ofertas/${oferta.id}/aceptar`, {})).cuerpo;
  const antes = (await v.solicitar('/comercio/resumen')).cuerpo;
  const ingresoAnterior = unidades(antes.ingresos_ventas,7);
  historiales.set(creado.lote_id, [{ orden_id: orden.id, vendedor: vendedores.publicKey(), comprador: comprador.publicKey(),
    precio: orden.precio_unidades, comision: orden.comision_unidades, reintegro: '250000000', total: '101000000000', fecha: '1795630000' }]);
  const despues = (await v.solicitar('/comercio/resumen')).cuerpo;
  assert.equal(unidades(despues.ingresos_ventas,7) - ingresoAnterior, 100250000000n);
  const p = await new Cliente().entrar(plataforma);
  assert.equal((await p.solicitar('/comercio/resumen')).cuerpo.comisiones_recibidas, '75');
  assert.equal((await c.solicitar('/comercio/operaciones/' + orden.id)).cuerpo.liquidacion.orden_id, orden.id);
});

test('el portal del laboratorio solo ve sus lotes y sus evidencias no acreditan gasto por sí solas', async () => {
  const v = await vendedor(), c = await clienteComprador();
  const creado = await anuncio(v);
  const oferta = await ofertar(c, creado.id);
  const orden = (await v.solicitar(`/comercio/ofertas/${oferta.id}/aceptar`, {})).cuerpo;
  assert.equal((await v.solicitar('/comercio/laboratorio/operaciones')).respuesta.status, 401);
  const lab = new Cliente(), otroLab = new Cliente();
  assert.equal((await lab.solicitar('/auth/login', { email: 'analista@lab001.test', password: 'minertrace123' })).respuesta.status, 200);
  assert.equal((await otroLab.solicitar('/auth/login', { email: 'analista@lab002.test', password: 'minertrace123' })).respuesta.status, 200);
  const propias = (await lab.solicitar('/comercio/laboratorio/operaciones')).cuerpo;
  assert.ok(propias.some((detalle: any) => detalle.operacion.id === orden.id));
  assert.ok(!JSON.stringify(propias).includes('CONTACTO_PRIVADO'));
  const ajenas = (await otroLab.solicitar('/comercio/laboratorio/operaciones')).cuerpo;
  assert.ok(!ajenas.some((detalle: any) => detalle.operacion.id === orden.id));
  const evidencia = { tipo: 'ensayo', referencia: 'Comprobante de ensayo', descripcion: 'Documento presentado por el laboratorio', hash: 'b'.repeat(64), cliente_id: randomUUID() };
  assert.equal((await otroLab.solicitar(`/comercio/laboratorio/operaciones/${orden.id}/evidencias`, evidencia)).respuesta.status, 403);
  const guardada = await lab.solicitar(`/comercio/laboratorio/operaciones/${orden.id}/evidencias`, evidencia);
  assert.equal(guardada.respuesta.status, 201, JSON.stringify(guardada.cuerpo));
  assert.equal(guardada.cuerpo.alcance, 'declarada');
  await assert.rejects(db.query('UPDATE comercio_operaciones SET precio=$2 WHERE id=$1', [orden.id,'999']), /solo inserción/);
  await assert.rejects(db.query('DELETE FROM comercio_evidencias WHERE id=$1', [guardada.cuerpo.id]), /solo inserción/);
});

test('la revisión privada exige sesión y administrador onchain, sin aceptar un perfil o cuenta declarados', async () => {
  assert.equal((await new Cliente().solicitar('/comercio/revision')).respuesta.status, 401);
  const c = await clienteComprador();
  assert.equal((await c.solicitar('/comercio/revision')).respuesta.status, 403);
  const respuesta = await c.solicitar('/comercio/revision/orden-ajena/evidencias', { tipo: 'decision', cuenta: administrador.publicKey(),
    referencia: 'Acta declarada', descripcion: 'Un tercero intenta presentarse como administrador', hash: 'c'.repeat(64) });
  assert.equal(respuesta.respuesta.status, 403);
});

test('el administrador real consulta incidencias y adjunta decisiones inmutables sin convertirlas en un pago', async () => {
  const v = await vendedor(), c = await clienteComprador(), admin = await new Cliente().entrar(administrador);
  const creado = await anuncio(v);
  const oferta = await ofertar(c, creado.id);
  const orden = (await v.solicitar(`/comercio/ofertas/${oferta.id}/aceptar`, {})).cuerpo;
  estados.get(creado.lote_id)!.estado = 'EnDisputa';
  comerciales.set(creado.lote_id, { orden_id: orden.id, comprador_reservado: comprador.publicKey(), vence_publicacion: null,
    condiciones_hash: orden.condiciones_hash, comision: orden.comision_unidades, reintegro: '0', total: orden.cotizacion.unidades.total_comprador,
    destinatario_plataforma: plataforma.publicKey(), vence_entrega: null, recepcion: null,
    incidencia: { motivo: 'Entrega pendiente de revisión', fecha: '1795630000' }, devolucion_hash: null });
  const antes = (await v.solicitar('/comercio/resumen')).cuerpo.ingresos_ventas;
  const lectura = await admin.solicitar('/comercio/revision?solo_disputas=true');
  assert.equal(lectura.respuesta.status, 200, JSON.stringify(lectura.cuerpo));
  assert.equal(lectura.cuerpo.autorizado, true);
  assert.ok(lectura.cuerpo.operaciones.some((detalle: any) => detalle.operacion.id === orden.id && detalle.cadena.estado === 'EnDisputa'));
  assert.ok(!JSON.stringify(lectura.cuerpo).includes('CONTACTO_PRIVADO'));
  const evidencia = { tipo: 'decision', referencia: 'ACTA_PRIVADA_REVISION', descripcion: 'El administrador registra el fundamento de la revisión', hash: 'd'.repeat(64), cliente_id: randomUUID() };
  const guardada = await admin.solicitar(`/comercio/revision/${orden.id}/evidencias`, evidencia);
  assert.equal(guardada.respuesta.status, 201, JSON.stringify(guardada.cuerpo));
  assert.equal(guardada.cuerpo.cuenta, administrador.publicKey());
  assert.equal(guardada.cuerpo.alcance, 'declarada');
  assert.equal((await admin.solicitar(`/comercio/revision/${orden.id}/evidencias`, evidencia)).cuerpo.id, guardada.cuerpo.id);
  assert.equal((await admin.solicitar(`/comercio/revision/${orden.id}/evidencias`, { ...evidencia, cliente_id: randomUUID(), tipo: 'origen' })).respuesta.status, 400);
  assert.equal((await v.solicitar(`/comercio/operaciones/${orden.id}/evidencias`, { ...evidencia, cliente_id: randomUUID() })).respuesta.status, 400);
  await assert.rejects(db.query('UPDATE comercio_evidencias SET descripcion=$2 WHERE id=$1', [guardada.cuerpo.id,'Texto reemplazado']), /solo inserción/);
  const detalle = (await c.solicitar(`/comercio/operaciones/${orden.id}`)).cuerpo;
  assert.ok(detalle.evidencias.some((e: any) => e.id === guardada.cuerpo.id && e.referencia === evidencia.referencia));
  assert.equal(detalle.liquidacion, null);
  assert.equal((await v.solicitar('/comercio/resumen')).cuerpo.ingresos_ventas, antes);
  assert.equal(estados.get(creado.lote_id)!.estado, 'EnDisputa');
});
