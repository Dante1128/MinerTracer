/**
 * Demo comercial reproducible, exclusivamente contra una API local aislada y Stellar testnet.
 * Los lotes, ensayos, comprobantes y recepciones son SINTÉTICOS: no constituyen un piloto de campo.
 * Este programa de desarrollo firma las transacciones igual que lo haría cada wallet del portal.
 * No modifica .env, no inserta filas directamente y no imprime ni guarda claves privadas.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { pdfSimple } from '../src/pdfSimple.ts';
import { decimal, unidades } from '../src/comercio/dinero.ts';
import type { AnuncioComercial, DetalleOperacion, EvidenciaComercial, OfertaComercial, OrdenComercial, PoliticaComercial } from '../src/comercio/tipos.ts';
import type { LiquidacionComercial, VentaComercial } from '../src/mercado/mercado.ts';

const directorioServidor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archivoReferencia = path.resolve(directorioServidor, '../scripts/comercio-testnet.json');
const LOTE_ABIERTO = 'DEMO-COM-ORO-ABIERTA';
const LOTE_LIQUIDADO = 'DEMO-COM-ORO-LIQUIDADA';
const ORIGEN_DEMO = 'DEMO SINTETICA: procedencia declarada ficticia, sin mina ni cooperativa real';
const OBSERVACIONES_DEMO = 'DEMO COMERCIAL SINTETICA. Informe de ejemplo sin muestreo ni ensayo real.';
const CONDICIONES_DEMO = 'DEMO SINTETICA sin entrega fisica real. Precio en XLM testnet; ensayo simulado a cargo del vendedor; sin traslado.';
const PRECIO = '2000';
const ENSAYO = '50';
const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));
const hashDe = (texto: string) => createHash('sha256').update(texto).digest('hex');
const seguro = (texto: string) => texto.replace(/\bS[A-Z2-7]{55}\b/g, '[clave privada omitida]');

interface VersionDemo { analisis_id: string; version: number; lote_id: string; observaciones: string; estado_anclaje: string; firma_servidor: boolean; }
interface LoteDemo { id: string; tipo_mineral: string; peso_kg: string; origen: string; laboratorio_id: string; dueno: string | null; }
class ErrorApiDemo extends Error {
  estado: number;
  codigoContrato: number | null;
  constructor(ruta: string, estado: number, cuerpo: { error?: string; errores?: Record<string,string>; codigo_contrato?: number } | null) {
    super(`${ruta}: ${cuerpo?.error ?? `HTTP ${estado}`}${cuerpo?.errores ? ' · ' + Object.values(cuerpo.errores).join('; ') : ''}`);
    this.estado = estado;
    this.codigoContrato = cuerpo?.codigo_contrato ?? null;
  }
}

class ClienteDemo {
  base: string;
  cookies = new Map<string,string>();
  csrf = '';
  constructor(base: string) { this.base = base; }
  async solicitar<T = any>(ruta: string, opciones: { json?: unknown; form?: FormData; metodo?: string } = {}): Promise<T> {
    const escritura = opciones.json !== undefined || opciones.form !== undefined;
    if (escritura && !this.csrf) this.csrf = (await this.solicitar<{ csrf: string }>('/auth/csrf')).csrf;
    const cabeceras: Record<string,string> = { cookie: [...this.cookies].map(([nombre,valor]) => `${nombre}=${valor}`).join('; ') };
    if (escritura) cabeceras['X-CSRF-Token'] = this.csrf;
    if (opciones.json !== undefined) cabeceras['content-type'] = 'application/json';
    let respuesta: Response;
    try {
      respuesta = await fetch(this.base + ruta, { method: opciones.metodo ?? (escritura ? 'POST' : 'GET'), headers: cabeceras,
        body: opciones.form ?? (opciones.json !== undefined ? JSON.stringify(opciones.json) : undefined),
        redirect: 'error', signal: AbortSignal.timeout(90_000) });
    } catch {
      throw new Error(`No se pudo consultar la API local en ${ruta}. Compruebe que el entorno aislado sigue activo.`);
    }
    for (const cookie of respuesta.headers.getSetCookie()) {
      const par = cookie.split(';')[0]!;
      const separador = par.indexOf('=');
      this.cookies.set(par.slice(0,separador), par.slice(separador+1));
    }
    const cuerpo = respuesta.headers.get('content-type')?.includes('json') ? await respuesta.json() : null;
    if (typeof cuerpo?.csrf === 'string') this.csrf = cuerpo.csrf;
    if (!respuesta.ok) throw new ErrorApiDemo(ruta, respuesta.status, cuerpo);
    return cuerpo as T;
  }
}

function identificador(contrato: string, paso: string): string {
  const datos = createHash('sha256').update(`MinerTrace demo comercial v2:${contrato}:${paso}`).digest();
  datos[6] = (datos[6]! & 15) | 64;
  datos[8] = (datos[8]! & 63) | 128;
  const hexadecimal = datos.subarray(0,16).toString('hex');
  return `${hexadecimal.slice(0,8)}-${hexadecimal.slice(8,12)}-${hexadecimal.slice(12,16)}-${hexadecimal.slice(16,20)}-${hexadecimal.slice(20)}`;
}
function clave(identidad: string, secretoConfigurado?: string): Keypair {
  try {
    const secreto = secretoConfigurado || execFileSync('stellar', ['keys','secret',identidad], {
      encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 15_000,
    }).trim();
    return Keypair.fromSecret(secreto);
  } catch {
    // Los errores de execFileSync contienen stdout/stderr: nunca se propagan ni imprimen.
    throw new Error(`No se pudo cargar la identidad ${identidad}. Configure sus claves localmente con Stellar CLI.`);
  }
}
function firmar(xdr: string, cuenta: Keypair, passphrase?: string) {
  if (passphrase !== undefined && passphrase !== Networks.TESTNET) throw new Error('La API intentó preparar una firma fuera de Stellar testnet');
  const transaccion = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  transaccion.sign(cuenta);
  return transaccion.toXDR();
}
async function sesionWallet(base: string, cuenta: Keypair) {
  const cliente = new ClienteDemo(base);
  const desafio = await cliente.solicitar<{ id: string; mensaje: string }>('/comercio/sesion/desafio', { json: { cuenta: cuenta.publicKey() } });
  await cliente.solicitar('/comercio/sesion/verificar', { json: { id: desafio.id, firma: Buffer.from(cuenta.signMessage(desafio.mensaje)).toString('base64') } });
  return cliente;
}
async function perfil(cliente: ClienteDemo, tipo: 'cooperativa' | 'comprador') {
  const existente = await cliente.solicitar('/comercio/perfil');
  if (existente) return;
  await cliente.solicitar('/comercio/perfil', { metodo: 'PUT', json: { nombre: tipo === 'cooperativa' ? 'Vendedor DEMO SINTETICA' : 'Comprador DEMO SINTETICA',
    organizacion: 'Participante ficticio de la demo, sin identidad minera acreditada', tipo,
    zona: 'Zona ficticia de demostracion', contacto: '', documento_ref: '' } });
}
async function transaccion(cliente: ClienteDemo, cuenta: Keypair, accion: string, loteId: string, extra: Record<string,unknown> = {}) {
  const cuerpo = { accion, cuenta: cuenta.publicKey(), lote_id: loteId, ...extra };
  const preparada = await cliente.solicitar<{ xdr: string; preparacion_id: string; passphrase: string }>('/mercado/comercial/preparar', { json: cuerpo });
  const resultado = await cliente.solicitar<{ tx_id: string }>('/mercado/comercial/enviar', { json: {
    ...cuerpo, preparacion_id: preparada.preparacion_id, xdr: firmar(preparada.xdr, cuenta, preparada.passphrase),
  } });
  console.log(`  ${accion}: https://stellar.expert/explorer/testnet/tx/${resultado.tx_id}`);
}

async function prepararLote(lab: ClienteDemo, parLab: Keypair, vendedor: Keypair, loteId: string) {
  const lotes = await lab.solicitar<LoteDemo[]>('/lotes');
  const existente = lotes.find((lote) => lote.id === loteId);
  if (existente) {
    if (existente.origen !== ORIGEN_DEMO || existente.tipo_mineral !== 'Oro dore DEMO SINTETICA' || existente.peso_kg !== '0.010' || existente.dueno !== vendedor.publicKey()) {
      throw new Error(`El identificador ${loteId} ya contiene otros datos; se conserva sin modificarlo.`);
    }
  } else {
    await lab.solicitar('/lotes', { json: { codigo: loteId, tipo_mineral: 'Oro dore DEMO SINTETICA', peso_kg: '0.010',
      origen: ORIGEN_DEMO, coordenadas: '', dueno: vendedor.publicKey() } });
  }
  const analisis = (await lab.solicitar<VersionDemo[]>('/analisis')).filter((fila) => fila.lote_id === loteId);
  if (analisis.some((fila) => fila.observaciones !== OBSERVACIONES_DEMO || fila.version !== 1)) throw new Error(`Los análisis de ${loteId} fueron modificados fuera de esta demo; revíselos antes de continuar.`);
  let registro = analisis[0];
  if (!registro) {
    const formulario = new FormData();
    formulario.set('lote_id', loteId);
    formulario.set('fecha_analisis', new Date().toISOString());
    formulario.set('metodo', 'Ensayo al fuego (dato sintetico de demostracion)');
    formulario.set('pureza', '95.00');
    formulario.set('composicion', JSON.stringify({ Au: '95.00', Ag: '5.00' }));
    formulario.set('observaciones', OBSERVACIONES_DEMO);
    const pdf = pdfSimple('DEMO SINTETICA - SIN VALOR DE ENSAYO REAL', [
      `Lote: ${loteId}`, 'Oro dore de ejemplo: Au 95.00 %, Ag 5.00 %.',
      ORIGEN_DEMO, 'No hubo muestreo ni analisis fisico; documento para demostrar el software.',
    ]);
    formulario.set('pdf', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), `${loteId}-demo.pdf`);
    registro = await lab.solicitar<VersionDemo>('/analisis', { form: formulario });
  }
  if (registro.estado_anclaje !== 'anclado') {
    const ruta = `/analisis/${registro.analisis_id}/v/${registro.version}/firma`;
    const preparada = await lab.solicitar<{ xdr?: string; ya_anclado?: boolean }>(ruta, { json: { cuenta: parLab.publicKey() } });
    if (preparada.xdr) await lab.solicitar(`${ruta}/enviar`, { json: { cuenta: parLab.publicKey(), xdr: firmar(preparada.xdr, parLab) } });
  }
  const verificacion = await lab.solicitar<{ analisis: { vigente: { verificacion: { estado: string } } }[] }>(`/publico/lotes/${loteId}`);
  if (!verificacion.analisis.length || verificacion.analisis.some((grupo) => grupo.vigente.verificacion.estado !== 'integro')) throw new Error(`No se pudo comprobar íntegro el análisis de ${loteId}`);
  console.log(`  Lote y análisis íntegros: ${loteId} (origen declarado sintético).`);
}

async function anuncio(cliente: ClienteDemo, contrato: string, loteId: string): Promise<AnuncioComercial> {
  const propios = (await cliente.solicitar<{ anuncios: AnuncioComercial[] }>('/comercio/anuncios?propios=true')).anuncios;
  const existentes = propios.filter((fila) => fila.lote_id === loteId);
  if (existentes.length > 1) throw new Error(`Hay varios anuncios para ${loteId}; selecciónelos manualmente antes de repetir esta demo.`);
  const existente = existentes[0];
  if (existente) {
    if (existente.condiciones !== CONDICIONES_DEMO || existente.precio !== PRECIO || existente.gastos_ensayo !== ENSAYO || existente.gastos_traslado !== '0') {
      throw new Error(`El anuncio de ${loteId} tiene condiciones ajenas a esta demo; no se modifica.`);
    }
    return existente;
  }
  return cliente.solicitar<AnuncioComercial>('/comercio/anuncios', { json: { cliente_id: identificador(contrato, `anuncio:${loteId}`),
    tipo: 'venta', mineral: 'Oro dore DEMO SINTETICA', zona: 'Zona ficticia de demostracion', cantidad: '0.010', precio: PRECIO,
    lote_id: loteId, vence: new Date(Date.now()+7*86_400_000).toISOString(), condiciones: CONDICIONES_DEMO,
    punto_entrega: 'DEMO: recepción simulada en el laboratorio, sin movimiento físico', gastos_ensayo: ENSAYO, gastos_traslado: '0',
    oferta_externa_neta: null, plazo_pago: 'DEMO: liquidación al confirmar recepción simulada' } });
}
async function operacion(vendedor: ClienteDemo, comprador: ClienteDemo, parComprador: Keypair, contrato: string, publicado: AnuncioComercial) {
  const propias = (await vendedor.solicitar<{ operaciones: OrdenComercial[] }>('/comercio/operaciones')).operaciones.filter((fila) => fila.lote_id === LOTE_LIQUIDADO);
  if (propias.length > 1) throw new Error('El lote de liquidación tiene varios acuerdos; se conserva para revisión manual.');
  if (propias[0]) {
    if (propias[0].precio !== PRECIO || propias[0].comprador !== parComprador.publicKey() || propias[0].anuncio_id !== publicado.id ||
        propias[0].condiciones.condiciones !== CONDICIONES_DEMO || propias[0].condiciones.gastos_ensayo !== ENSAYO || propias[0].condiciones.gastos_traslado !== '0') {
      throw new Error('El acuerdo existente corresponde a otras condiciones.');
    }
    return propias[0];
  }
  if (!publicado.vigente) throw new Error('El anuncio de la operación de ejemplo venció o fue cerrado; no se reinicia automáticamente.');
  const detalle = await vendedor.solicitar<{ ofertas: OfertaComercial[] }>(`/comercio/anuncios/${publicado.id}`);
  let oferta = detalle.ofertas.find((fila) => fila.cuenta === parComprador.publicKey() && fila.precio === PRECIO && fila.estado === 'pendiente');
  if (!oferta) oferta = await comprador.solicitar<OfertaComercial>(`/comercio/anuncios/${publicado.id}/ofertas`, { json: {
    cliente_id: identificador(contrato, `oferta:${LOTE_LIQUIDADO}`), precio: PRECIO, condiciones: CONDICIONES_DEMO,
    gastos_ensayo: ENSAYO, gastos_traslado: '0', vence: publicado.vence,
  } });
  if (!oferta.vigente || oferta.proponente !== parComprador.publicKey() || oferta.condiciones !== CONDICIONES_DEMO ||
      oferta.gastos_ensayo !== ENSAYO || oferta.gastos_traslado !== '0') throw new Error('La oferta de ejemplo venció o tiene otras condiciones; no se acepta automáticamente.');
  return vendedor.solicitar<OrdenComercial>(`/comercio/ofertas/${oferta.id}/aceptar`, { json: {} });
}
async function evidencia(cliente: ClienteDemo, contrato: string, orden: OrdenComercial, tipo: 'origen' | 'ensayo' | 'entrega', laboratorio = false): Promise<EvidenciaComercial> {
  const referencia = `DEMO-SINTETICA-${tipo.toUpperCase()}-${orden.lote_id}`;
  const descripcion = tipo === 'origen' ? 'Procedencia ficticia declarada para la demo; sin validación territorial ni piloto de campo.'
    : tipo === 'ensayo' ? 'Comprobante sintético de ensayo por 50 XLM testnet; no es una factura ni acredita un servicio real.'
      : 'Recepción física simulada para demostrar el contrato. No se entregó material real.';
  const hash = hashDe(`MinerTrace demo comercial:${contrato}:${referencia}:${descripcion}`);
  const ruta = laboratorio ? `/comercio/laboratorio/operaciones/${orden.id}/evidencias` : `/comercio/operaciones/${orden.id}/evidencias`;
  return cliente.solicitar<EvidenciaComercial>(ruta, { json: { cliente_id: identificador(contrato, `evidencia:${tipo}:${orden.id}`), tipo, referencia, descripcion, hash } });
}

function comprobarReparto(venta: VentaComercial, politica: PoliticaComercial) {
  const precision = politica.token!.decimales;
  if (venta.comision !== unidades('20',precision).toString() || venta.reintegro !== unidades('5',precision).toString() || venta.total !== unidades('2020',precision).toString()) {
    throw new Error('La venta no tiene el reparto esperado (20 comisión, 5 reintegro, 2020 total); no se financia ni confirma.');
  }
}
function comprobarLiquidacion(liquidacion: LiquidacionComercial, orden: OrdenComercial, politica: PoliticaComercial) {
  comprobarReparto({ comision: liquidacion.comision, reintegro: liquidacion.reintegro, total: liquidacion.total } as VentaComercial, politica);
  const precision = politica.token!.decimales;
  if (liquidacion.reembolsada || liquidacion.orden_id !== orden.id || liquidacion.vendedor !== orden.vendedor || liquidacion.comprador !== orden.comprador ||
      liquidacion.recibido_vendedor !== unidades('2005',precision).toString() || liquidacion.recibido_plataforma !== unidades('15',precision).toString()) {
    throw new Error('El contrato no confirma el reparto esperado al vendedor y a la plataforma.');
  }
}

async function principal() {
  const argumentos = process.argv.slice(2);
  if (argumentos.length === 1 && argumentos[0] === '--help') {
    console.log('Uso: npm run demo:comercio -- --url http://localhost:3018');
    console.log('Requiere API comercial aislada, contrato de scripts/comercio-testnet.json y cuentas CLI de testnet. Todos los datos son sintéticos.');
    return;
  }
  if (argumentos.length && (argumentos.length !== 2 || argumentos[0] !== '--url')) throw new Error('Use únicamente --url http://localhost:3018 (o --help).');
  const url = new URL(argumentos[1] ?? 'http://localhost:3018');
  if (url.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !url.port || ['3000','5173'].includes(url.port) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use un origen HTTP local con puerto aislado explícito, por ejemplo http://localhost:3018. Se excluyen los puertos habituales 3000 y 5173.');
  }
  // config.ts sigue siendo quien carga .env; el lanzador raíz no necesita copiar ni alterar variables.
  process.chdir(directorioServidor);
  const { config } = await import('../src/config.ts');
  if (config.produccion) throw new Error('Esta demo solo se puede ejecutar en desarrollo.');
  const referencia = JSON.parse(readFileSync(archivoReferencia, 'utf8')) as { red: string; contrato_id: string; token: string; version_comercial: number };
  const contratoEsperado = (process.env.COMERCIO_CONTRATO_ID || referencia.contrato_id).trim();
  if (referencia.red !== 'testnet' || referencia.version_comercial !== 2 || !/^C[A-Z2-7]{55}$/.test(contratoEsperado)) throw new Error('La referencia del contrato comercial de testnet no es válida.');
  const base = url.origin + '/api';
  const publico = new ClienteDemo(base);
  const info = await publico.solicitar<{ anclaje: string; red: string; contrato_id: string; firma_laboratorio: string; motor_db: string }>('/publico/info');
  if (info.anclaje !== 'stellar' || info.red !== 'testnet' || info.contrato_id !== contratoEsperado || info.firma_laboratorio !== 'wallet' || info.motor_db !== 'pglite') {
    throw new Error('La API no corresponde al contrato comercial aislado de referencia, testnet, PGlite y firma wallet. No se creó ningún dato.');
  }
  const politica = await publico.solicitar<PoliticaComercial>('/comercio/politica');
  if (!politica.disponible || politica.origen !== 'contrato' || politica.version !== 2 || politica.token?.simbolo !== 'XLM' || politica.token.contrato !== referencia.token ||
      politica.token.decimales !== 7 || politica.comision_bps !== 100 || politica.comision_minima !== '20' || politica.reintegro_bps !== 25 || politica.reintegro_maximo !== '100') {
    throw new Error('La moneda o las tarifas no corresponden a esta demo de 2000 XLM testnet. No se creó ningún dato.');
  }
  console.log(`DEMO SINTÉTICA · API ${url.origin} · contrato ${contratoEsperado}`);
  console.log('Sin producción, servicios de laboratorio ni entrega de oro reales. El portal conserva la firma con wallet.');
  const parVendedor = clave('minertrace-vendedor');
  const parComprador = clave('minertrace-comprador');
  const parLab = clave('minertrace-lab-a', config.stellar.secretos['LAB-001']);
  if (new Set([parVendedor.publicKey(),parComprador.publicKey(),parLab.publicKey()]).size !== 3) throw new Error('La demo necesita cuentas distintas para laboratorio, vendedor y comprador.');
  const lab = new ClienteDemo(base);
  await lab.solicitar('/auth/login', { json: { email: 'analista@lab001.test', password: 'minertrace123' } });
  const identidadLab = await lab.solicitar<{ laboratorio: { id: string; cuenta_publica: string } }>('/auth/yo');
  if (identidadLab.laboratorio.id !== 'LAB-001' || identidadLab.laboratorio.cuenta_publica !== parLab.publicKey()) throw new Error('La clave del laboratorio no coincide con su cuenta registrada en esta API; no se crean lotes.');
  for (let intento=0; intento<30; intento++) {
    const pendientes = (await lab.solicitar<VersionDemo[]>('/analisis')).filter((fila) => fila.firma_servidor && fila.estado_anclaje !== 'anclado');
    if (!pendientes.length) break;
    if (intento === 29) throw new Error('La semilla todavía está firmando análisis del laboratorio. Espere a que termine antes de repetir.');
    if (intento === 0) console.log('Esperando a que termine el anclaje de la semilla para no compartir secuencia del laboratorio…');
    await esperar(2000);
  }
  const vendedor = await sesionWallet(base, parVendedor);
  const comprador = await sesionWallet(base, parComprador);
  await perfil(vendedor, 'cooperativa');
  await perfil(comprador, 'comprador');
  await prepararLote(lab, parLab, parVendedor, LOTE_ABIERTO);
  const abierto = await anuncio(vendedor, contratoEsperado, LOTE_ABIERTO);
  if (!abierto.vigente) throw new Error('El anuncio abierto de esta demo ya venció o fue atendido; se conserva sin reiniciarlo.');
  const estadoAbierto = (await publico.solicitar<{ estado: { dueno: string; estado: string } | null }>(`/mercado/lotes/${LOTE_ABIERTO}`)).estado;
  if (!estadoAbierto || estadoAbierto.dueno !== parVendedor.publicKey() || !['Certificado','Vendido'].includes(estadoAbierto.estado)) {
    throw new Error('El lote destinado al anuncio abierto ya fue comprometido fuera de esta demo; se conserva sin modificarlo.');
  }
  console.log(`Anuncio abierto: /comercio/anuncios/${abierto.id}`);
  await prepararLote(lab, parLab, parVendedor, LOTE_LIQUIDADO);
  const publicado = await anuncio(vendedor, contratoEsperado, LOTE_LIQUIDADO);
  const orden = await operacion(vendedor, comprador, parComprador, contratoEsperado, publicado);
  await evidencia(vendedor, contratoEsperado, orden, 'origen');
  const ruta = `/comercio/operaciones/${orden.id}`;
  let detalle = await vendedor.solicitar<DetalleOperacion>(ruta);
  if (!detalle.liquidacion && !detalle.venta_comercial) {
    if (detalle.cadena?.estado !== 'Certificado') throw new Error('El lote ya participa en otra venta o disputa; no se altera esa operación.');
    const comprobante = await evidencia(lab, contratoEsperado, orden, 'ensayo', true);
    try {
      await transaccion(lab, parLab, 'registrar_gasto_ensayo', LOTE_LIQUIDADO, { orden_id: orden.id, costo: ENSAYO, evidencia_id: comprobante.id });
    } catch (error) {
      if (!(error instanceof ErrorApiDemo) || error.codigoContrato !== 35) throw error;
      console.log('  Gasto del ensayo ya acreditado; se comprueba el reintegro al reservar.');
    }
    await transaccion(vendedor, parVendedor, 'reservar_venta', LOTE_LIQUIDADO, { orden_id: orden.id });
    detalle = await vendedor.solicitar<DetalleOperacion>(ruta);
  }
  if (!detalle.liquidacion) {
    if (!detalle.venta_comercial) throw new Error('El contrato no conserva la reserva de esta orden.');
    comprobarReparto(detalle.venta_comercial as VentaComercial, politica);
    if (detalle.cadena?.estado === 'EnVenta') {
      await transaccion(comprador, parComprador, 'buy', LOTE_LIQUIDADO, { orden_id: orden.id,
        total_esperado: (detalle.venta_comercial as VentaComercial).total,
        analisis_id_esperado: detalle.cadena.venta!.analisis_id, version_esperada: detalle.cadena.venta!.version });
      detalle = await comprador.solicitar<DetalleOperacion>(ruta);
    }
    if (detalle.cadena?.estado === 'EnGarantia') {
      if (!(detalle.venta_comercial as VentaComercial | null)?.recepcion) {
        const recepcion = await evidencia(comprador, contratoEsperado, orden, 'entrega');
        await transaccion(comprador, parComprador, 'registrar_recepcion', LOTE_LIQUIDADO, { orden_id: orden.id, evidencia_id: recepcion.id });
      }
      await transaccion(comprador, parComprador, 'confirm', LOTE_LIQUIDADO, { orden_id: orden.id });
    }
    detalle = await vendedor.solicitar<DetalleOperacion>(ruta);
  }
  if (!detalle.liquidacion) throw new Error('La venta no terminó liquidada. Se conservan sus pasos para retomarlos al repetir el comando.');
  comprobarLiquidacion(detalle.liquidacion as LiquidacionComercial, orden, politica);
  const liquidacion = detalle.liquidacion as LiquidacionComercial;
  console.log(`Operación liquidada: /operaciones/${orden.id}`);
  console.log(`  Precio ${PRECIO} XLM; comprador paga 2020 XLM; comisión 20 XLM; reintegro 5 XLM.`);
  console.log(`  El contrato transfirió ${decimal(BigInt(liquidacion.recibido_vendedor!),7)} XLM al vendedor y ${decimal(BigInt(liquidacion.recibido_plataforma!),7)} XLM a la plataforma.`);
  console.log('  El neto ilustrativo del vendedor, descontando el ensayo externo de 50 XLM, es 1955 XLM. El script no paga ese servicio externo.');
  console.log('Terminado. Repetir el comando reutiliza los mismos lotes, anuncios y liquidación; no resetea ninguna base.');
}

await principal().catch((error: unknown) => {
  console.error(seguro(error instanceof Error ? error.message : 'No se pudo completar la demo comercial.'));
  process.exitCode = 1;
});
